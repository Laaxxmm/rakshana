import { renderToStaticMarkup } from "react-dom/server";
import { Window, type Element } from "happy-dom";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The float ledger, driven against the database.
 *
 * The figures this screen exists for are a subtraction across two tables and
 * a stored register, so the fixtures are real rows: a float, the top-ups and
 * vouchers that make up its movements, and the vouchers that must not — a
 * draft, one cancelled before payment, and one rejected before the legacy
 * repair ran. The register itself sits below what those movements sum to, the
 * way the live ones do; see CURRENT_BALANCE.
 */

const getOrgScopeMock = vi.fn();
vi.mock("@/lib/auth/scope", () => ({
  getOrgScope: getOrgScopeMock,
  requireOrgScope: async () => {
    const v = await getOrgScopeMock();
    if (!v) throw new Error("Authentication required");
    return v;
  },
}));
vi.mock("@/auth", () => ({ auth: async () => null }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/petty-cash",
  notFound: () => {
    throw new Error("notFound()");
  },
}));

const { prismaUnsafe } = await import("@/lib/db/prisma");
const { formatINRWithSymbol } = await import("@/lib/format/inr");
const { LEGACY_FLOAT_NOTE } = await import("../float-ledger");
const FloatLedgerPage = (await import("./page")).default;

const ORG_A = "test-org-float-ledger-a";
const ORG_B = "test-org-float-ledger-b";
const TEST_USER = "test-user-float-ledger";
const ORGS = [ORG_A, ORG_B];

/**
 * 5,000.00 seeded, then: +1,000.55, −250.25, +2,000.10, −100.05, −75.50.
 *
 * The register is 777.77 below that sum, and deliberately: PCV/0006 was
 * rejected before rejection started refunding the float, so its debit still
 * stands against `currentBalance` while the ledger — which cannot tell a
 * still-debited legacy voucher from an already-refunded one — leaves it out of
 * the movements. That is the state the live floats are in, and it is what
 * separates a ledger anchored on the register from one walked forwards off
 * `floatAmount`: the second closes at 7,574.85 and contradicts both the badge
 * on the float list and the cash in the box.
 */
const OPENING = "5000";
const CURRENT_BALANCE = "6797.08";
const LIFETIME_IN = "₹3,000.65";
const LIFETIME_OUT = "₹425.80";

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

let floatA = "";
let floatB = "";

async function cleanup() {
  await prismaUnsafe.pettyCashTopUp.deleteMany({
    where: { float: { organisationId: { in: ORGS } } },
  });
  await prismaUnsafe.expense.deleteMany({ where: { organisationId: { in: ORGS } } });
  await prismaUnsafe.pettyCashFloat.deleteMany({ where: { organisationId: { in: ORGS } } });
  await prismaUnsafe.membership.deleteMany({ where: { userId: TEST_USER } });
  await prismaUnsafe.user.deleteMany({ where: { id: TEST_USER } });
  await prismaUnsafe.organisation.deleteMany({ where: { id: { in: ORGS } } });
}

async function voucher(fields: {
  voucherNumber: string;
  expenseDate: Date;
  grossAmount: string;
  status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "PAID" | "CANCELLED";
  paidAt?: Date | null;
  description?: string;
}) {
  await prismaUnsafe.expense.create({
    data: {
      organisationId: ORG_A,
      voucherNumber: fields.voucherNumber,
      expenseDate: fields.expenseDate,
      cashPayeeName: "Auto stand",
      grossAmount: fields.grossAmount,
      netPayable: fields.grossAmount,
      mode: "CASH",
      isPettyCash: true,
      pettyCashFloatId: floatA,
      status: fields.status,
      paidAt: fields.paidAt ?? null,
      description: fields.description ?? null,
      createdById: TEST_USER,
    },
  });
}

beforeAll(async () => {
  await cleanup();
  for (const id of ORGS) {
    await prismaUnsafe.organisation.create({
      data: {
        id,
        name: "Test Trust",
        legalName: "Test Charitable Trust",
        addressLine1: "12 Test Road",
        city: "Bengaluru",
        state: "Karnataka",
        pincode: "560001",
        pan: `AAATP666${id === ORG_A ? "1" : "2"}F`,
        email: "float-ledger@testtrust.org",
        authorisedSignatoryName: "Test Signatory",
        authorisedSignatoryDesignation: "Trustee",
      },
    });
  }
  await prismaUnsafe.user.create({
    data: { id: TEST_USER, email: "float-ledger@rakshana.local", name: "Asha Rao" },
  });
  await prismaUnsafe.membership.create({
    data: { userId: TEST_USER, organisationId: ORG_A, role: "OWNER" },
  });
  for (const id of ORGS) {
    const float = await prismaUnsafe.pettyCashFloat.create({
      data: {
        organisationId: id,
        name: "Office float",
        custodianId: id === ORG_A ? TEST_USER : null,
        floatAmount: OPENING,
        currentBalance: id === ORG_A ? CURRENT_BALANCE : OPENING,
      },
    });
    if (id === ORG_A) floatA = float.id;
    else floatB = float.id;
  }

  await prismaUnsafe.pettyCashTopUp.createMany({
    data: [
      { floatId: floatA, amount: "1000.55", topUpDate: day("2025-06-05"), createdById: TEST_USER },
      { floatId: floatA, amount: "2000.10", topUpDate: day("2025-06-20"), createdById: TEST_USER },
    ],
  });

  // The three that move the balance.
  await voucher({
    voucherNumber: "PCV/0001",
    expenseDate: day("2025-06-12"),
    grossAmount: "250.25",
    status: "PAID",
    paidAt: day("2025-06-12"),
  });
  await voucher({
    voucherNumber: "PCV/0002",
    expenseDate: day("2025-07-03"),
    grossAmount: "100.05",
    status: "APPROVED",
  });
  // Cancelled after payment: the cash had already left the box, so the debit
  // stands and the ledger has to carry it.
  await voucher({
    voucherNumber: "PCV/0003",
    expenseDate: day("2025-07-10"),
    grossAmount: "75.50",
    status: "CANCELLED",
    paidAt: day("2025-07-10"),
  });

  // The three that must not appear as movements. The rejected one below is
  // still debited against CURRENT_BALANCE — the ledger cannot know that, which
  // is why it is listed to check rather than counted.
  await voucher({
    voucherNumber: "PCV/0004",
    expenseDate: day("2025-06-15"),
    grossAmount: "999.99",
    status: "DRAFT",
  });
  await voucher({
    voucherNumber: "PCV/0005",
    expenseDate: day("2025-06-16"),
    grossAmount: "888.88",
    status: "CANCELLED",
  });
  await voucher({
    voucherNumber: "PCV/0006",
    expenseDate: day("2025-06-18"),
    grossAmount: "777.77",
    status: "REJECTED",
    description: `Auto fare\n${LEGACY_FLOAT_NOTE}. Count the box and correct the float by hand if this is one of them.`,
  });

  getOrgScopeMock.mockResolvedValue({
    userId: TEST_USER,
    organisationId: ORG_A,
    organisationName: "Test Trust",
    role: "OWNER" as const,
  });
});

afterAll(async () => {
  await cleanup();
  await prismaUnsafe.$disconnect();
});

// ---------------------------------------------------------------------------

function parse(html: string): Element {
  const window = new Window();
  const document = new window.DOMParser().parseFromString(html, "text/html");
  return document.body as unknown as Element;
}

async function render(query: { from?: string; to?: string }, id = floatA) {
  return parse(
    renderToStaticMarkup(
      await FloatLedgerPage({
        params: Promise.resolve({ floatId: id }),
        searchParams: Promise.resolve({ period: "custom", ...query }),
      }),
    ),
  );
}

/**
 * The ledger table's rows — the first table on the page, the legacy panel's
 * being the second. Cells in source order: date, movement, by, amount,
 * balance; the ones a phone hides are still in the markup.
 */
const MOVEMENT = 1;
const BY = 2;
const BALANCE = 4;

function ledgerRows(body: Element): string[][] {
  const table = body.querySelector("table") as Element;
  return Array.from(table.querySelectorAll("tbody tr")).map((row) =>
    Array.from(row.querySelectorAll("td")).map((cell) => cell.textContent?.trim() ?? ""),
  );
}

/** A StatRow figure by its label. */
function stat(body: Element, label: string): string | undefined {
  const figure = Array.from(body.querySelectorAll("dl > div")).find(
    (f) => f.querySelector("dt")?.textContent?.trim() === label,
  );
  return figure?.querySelector("dd")?.textContent?.trim();
}

const LIFETIME = { from: "2025-01-01", to: "2025-12-31" };
const JUNE_WINDOW = { from: "2025-06-10", to: "2025-06-30" };

describe("float ledger", () => {
  it("runs the balance down to the float's stored balance, to the paisa", async () => {
    const body = await render(LIFETIME);
    const rows = ledgerRows(body);

    // Opening row, then one row per movement that moved the register.
    expect(rows).toHaveLength(6);
    expect(rows[0]![MOVEMENT]).toContain("Opening balance");

    const balances = rows.map((cells) => cells[BALANCE]);
    expect(balances).toEqual([
      "₹4,222.23",
      "₹5,222.78",
      "₹4,972.53",
      "₹6,972.63",
      "₹6,872.58",
      "₹6,797.08",
    ]);
    // The whole point: the last one is the register the previous screen shows
    // and the cash box is counted against.
    const stored = await prismaUnsafe.pettyCashFloat.findUniqueOrThrow({ where: { id: floatA } });
    expect(balances.at(-1)).toBe(formatINRWithSymbol(stored.currentBalance.toString(), { paise: true }));

    // Below the 5,000.00 the float was opened with, by the legacy debit the
    // movements above do not carry — the ledger reaches its opening by
    // subtracting them from the register, never by trusting `floatAmount`.
    expect(stat(body, "Opening")).toBe("₹4,222.23");
    expect(stat(body, "Opening")).not.toBe(
      formatINRWithSymbol(stored.floatAmount.toString(), { paise: true }),
    );
    expect(stat(body, "In")).toBe(LIFETIME_IN);
    expect(stat(body, "Out")).toBe(LIFETIME_OUT);
    expect(stat(body, "Closing")).toBe("₹6,797.08");
  });

  it("leaves out the vouchers that never took cash out of the box", async () => {
    const movements = ledgerRows(await render(LIFETIME))
      .map((cells) => cells[MOVEMENT])
      .join(" ");

    // A draft was never submitted, and a voucher cancelled before payment was
    // credited back — counting either would show a shortage that is not there.
    expect(movements).not.toContain("PCV/0004");
    expect(movements).not.toContain("PCV/0005");
    // Rejected: refunded by the app, and unknowable for the legacy rows.
    expect(movements).not.toContain("PCV/0006");
    // Cancelled after payment keeps its debit.
    expect(movements).toContain("PCV/0003");
  });

  it("opens a period at the balance the box held when it started", async () => {
    const body = await render(JUNE_WINDOW);
    const rows = ledgerRows(body);

    // The lifetime opening plus the 1,000.55 topped up on 5 June, before the
    // window — the register wound back past everything dated after it.
    expect(stat(body, "Opening")).toBe("₹5,222.78");
    expect(rows[0]![BALANCE]).toBe("₹5,222.78");

    // Only the two movements inside 10–30 June, in date order.
    expect(rows.slice(1).map((cells) => cells[BALANCE])).toEqual(["₹4,972.53", "₹6,972.63"]);
    expect(rows[1]![MOVEMENT]).toContain("PCV/0001");
    expect(rows[2]![MOVEMENT]).toContain("Top-up");

    // Totals agree with those two rows, and with the running balance: the
    // closing is the opening plus in less out, not today's register.
    expect(stat(body, "In")).toBe("₹2,000.10");
    expect(stat(body, "Out")).toBe("₹250.25");
    expect(stat(body, "Closing")).toBe("₹6,972.63");
  });

  it("names the signatory behind every movement", async () => {
    const rows = ledgerRows(await render(LIFETIME));

    // Top-ups carry createdById, vouchers carry their own; both render.
    for (const cells of rows.slice(1)) expect(cells[BY]).toBe("Asha Rao");
  });

  it("surfaces the vouchers the legacy repair left debited, without claiming they all are", async () => {
    const body = await render(LIFETIME);
    const text = body.textContent ?? "";

    expect(text).toContain("PCV/0006");
    expect(text).toContain("₹777.77");
    // Honest about what the repair could not tell: no wording that says every
    // voucher listed is still outstanding.
    expect(text).toContain("some are still debited and some were refunded");
    expect(text).toContain("nothing has been adjusted");
  });

  /**
   * Same model as mobile-lists.test.tsx: nothing here measures a pixel, but a
   * bare `hidden` is `display:none` until the `sm:` variant lifts it, so what
   * a 375px viewport gets is the markup minus every element carrying it.
   */
  it("keeps the date, the signatory and the running balance on a phone", async () => {
    const body = await render(LIFETIME);
    const table = body.querySelector("table") as Element;
    const onPhone = (el: Element) => !el.classList.contains("hidden");

    const headings = Array.from(table.querySelectorAll("thead th"))
      .filter(onPhone)
      .map((th) => th.textContent?.trim());
    // Two columns is what fits across 375px; the rest ride under them.
    expect(headings).toEqual(["Movement", "Amount"]);

    const row = table.querySelectorAll("tbody tr")[2] as Element;
    const cells = Array.from(row.querySelectorAll("td")).filter(onPhone);
    // A payee long enough to need two lines must wrap, not widen the page.
    expect(cells[0]!.classList.contains("whitespace-normal")).toBe(true);
    expect(cells[0]!.textContent).toContain("12 Jun 2025");
    expect(cells[0]!.textContent).toContain("Asha Rao");
    // The balance after the movement — the column this screen exists for.
    expect(cells[1]!.textContent).toContain("-₹250.25");
    expect(cells[1]!.textContent).toContain("₹4,972.53");
  });

  it("404s on another organisation's float", async () => {
    await expect(render(LIFETIME, floatB)).rejects.toThrow("notFound()");

    // And nothing of theirs leaked on the way.
    const foreign = await prismaUnsafe.pettyCashFloat.findUniqueOrThrow({ where: { id: floatB } });
    expect(foreign.currentBalance.toFixed(2)).toBe("5000.00");
  });
});
