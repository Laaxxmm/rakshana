import { renderToStaticMarkup } from "react-dom/server";
import { Decimal } from "decimal.js";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The period window on the money-out screens that are not the expenses list:
 * approvals, recurring expenses and banking.
 *
 * Each one filters in the database, so the honest check is what the page asks
 * for: the stubs below are small query engines that apply the `where` they are
 * handed, and every assertion is read off the rendered markup. A page that
 * dropped the window, dated a row by the wrong column, or counted the same
 * movement in two windows fails here rather than looking plausible.
 *
 * Windows are written as custom ranges wherever the assertion is about a
 * boundary, so the answer does not depend on the day the suite runs; the one
 * test that exercises the "This FY" preset freezes the clock instead. Every
 * instant carries an explicit +05:30, because the suite runs shuffled on
 * machines in any timezone and none of these answers may depend on either.
 */

type Query = (args?: never) => Promise<unknown>;
const db: Record<string, Record<string, Query>> = {};

vi.mock("@/lib/db/prisma", () => ({
  prisma: new Proxy({}, { get: (_target, model) => db[String(model)] }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/approvals" }));
vi.mock("@/auth", () => ({ auth: async () => null }));
vi.mock("@/lib/auth/scope", () => ({
  requireOrgScope: async () => ({
    userId: "u1",
    organisationId: "o1",
    organisationName: "Test Trust",
    role: "OWNER",
  }),
}));
// Reaches the server-action stack; carries no figure of its own.
vi.mock("./recurring-expenses/RunJobButton", () => ({ RunJobButton: () => null }));

const ApprovalsPage = (await import("./approvals/page")).default;
const RecurringExpensesPage = (await import("./recurring-expenses/page")).default;
const BankingPage = (await import("./banking/page")).default;

// ---------------------------------------------------------------------------
// A window, and the rows that fall inside it.
// ---------------------------------------------------------------------------

type Bounds = { gte?: Date; lt?: Date } | undefined;
type Where = Record<string, never>;

/** The `gte`/`lt` pair a page put on a column, read back off its query. */
const bounds = (where: unknown, column: string): Bounds =>
  (where as Record<string, Bounds> | undefined)?.[column];

/** The same test both bounds mean in Prisma: `gte` inclusive, `lt` exclusive. */
function inside(b: Bounds, when: Date | null): boolean {
  if (when === null) return false;
  if (b?.gte && when.getTime() < b.gte.getTime()) return false;
  if (b?.lt && when.getTime() >= b.lt.getTime()) return false;
  return true;
}

/** The FY 2026-27 and FY 2027-28 windows, spelled out rather than computed. */
const FY_2026 = { period: "custom", from: "2026-04-01", to: "2027-03-31" };
const FY_2027 = { period: "custom", from: "2027-04-01", to: "2028-03-31" };

/** One table row's markup, from the cell naming it to the end of the row. */
function rowOf(html: string, name: string): string {
  const start = html.indexOf(name);
  expect(start, `no row for ${name}`).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf("</tr>", start));
}

/** 23:59 IST on the last day of FY 2026-27, and IST midnight opening FY 2027-28. */
const LAST_INSTANT_2026 = new Date("2027-03-31T23:59:00+05:30");
const FIRST_INSTANT_2027 = new Date("2027-04-01T00:00:00+05:30");

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

describe("approvals period filter", () => {
  const voucher = (id: string, voucherNumber: string, expenseDate: Date) => ({
    id,
    voucherNumber,
    expenseDate,
    vendor: { id: "vn1", name: "Anand Stationers" },
    cashPayeeName: null,
    category: { name: "Stationery" },
    netPayable: new Decimal("18000.00"),
    status: "PENDING_APPROVAL",
  });

  const closing = voucher("ex1", "VCH-2026-0031", LAST_INSTANT_2026);
  const opening = voucher("ex2", "VCH-2027-0001", FIRST_INSTANT_2027);
  const queue = [closing, opening];

  let asked: Where | undefined;

  const render = async (searchParams: Record<string, string>) => {
    asked = undefined;
    db["expense"] = {
      findMany: async (args) => {
        const where = (args as unknown as { where: Where }).where;
        asked = where;
        return queue.filter(
          (v) =>
            v.status === (where as Record<string, unknown>)["status"] &&
            inside(bounds(where, "expenseDate"), v.expenseDate),
        );
      },
      // The whole queue, whatever the window — what the page counts to say
      // how much work the window is hiding.
      count: async () => queue.length,
    };
    return renderToStaticMarkup(
      await ApprovalsPage({ searchParams: Promise.resolve(searchParams) }),
    );
  };

  it("filters the queue by the voucher's own date, not an approval date", async () => {
    await render(FY_2026);

    // Nothing in this queue has been approved yet, so approval dates would
    // empty it: the window has to cut on the date the voucher carries.
    expect(bounds(asked, "expenseDate")).toEqual({
      gte: new Date("2026-04-01T00:00:00+05:30"),
      lt: new Date("2027-04-01T00:00:00+05:30"),
    });
  });

  it("puts a voucher on the 1 April boundary in exactly one window", async () => {
    const closingYear = await render(FY_2026);
    expect(closingYear).toContain("VCH-2026-0031");
    expect(closingYear).not.toContain("VCH-2027-0001");

    const openingYear = await render(FY_2027);
    expect(openingYear).toContain("VCH-2027-0001");
    expect(openingYear).not.toContain("VCH-2026-0031");
  });

  it("says which window is on and how much pending work it leaves out", async () => {
    const html = await render(FY_2026);

    expect(html).toContain("Showing custom range: 01 Apr 2026 – 31 Mar 2027");
    expect(html).toContain("1 awaiting a decision");
    expect(html).toContain("1 more outside it");
  });

  it("names the empty window rather than claiming everything is done", async () => {
    const html = await render({ period: "custom", from: "2030-01-01", to: "2030-01-31" });

    expect(html).toContain("Nothing pending in custom range");
    expect(html).toContain("2 pending outside this window");
  });

  it("reads the financial year off an IST clock — 31 March in, 1 April out", async () => {
    // A UTC reading of this instant is still 14 August; a browser clock is not
    // in reach of a server component at all. Both would have to answer 2026-27.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-14T09:00:00+05:30"));

    const html = await render({ period: "fy" });

    expect(bounds(asked, "expenseDate")).toEqual({
      gte: new Date("2026-04-01T00:00:00+05:30"),
      lt: new Date("2027-04-01T00:00:00+05:30"),
    });
    expect(html).toContain("FY 2026-27");
    expect(html).toContain("VCH-2026-0031");
    expect(html).not.toContain("VCH-2027-0001");
  });
});

// ---------------------------------------------------------------------------
// Recurring expenses
// ---------------------------------------------------------------------------

describe("recurring expenses period filter", () => {
  const templates = [
    {
      id: "rt1",
      name: "Office rent",
      vendorId: null,
      amount: new Decimal("20000.00"),
      frequency: "MONTHLY",
      nextDueDate: new Date("2027-04-05T00:00:00+05:30"),
      isActive: true,
    },
    {
      // Paused two years back: its next due date sits in a window nobody will
      // pick, which is exactly why the list may not be filtered by that date.
      id: "rt2",
      name: "Old AMC",
      vendorId: null,
      amount: new Decimal("5000.00"),
      frequency: "YEARLY",
      nextDueDate: new Date("2025-06-01T00:00:00+05:30"),
      isActive: false,
    },
  ];

  const runs = [
    { recurringTemplateId: "rt1", expenseDate: LAST_INSTANT_2026, gross: "20000.00" },
    { recurringTemplateId: "rt1", expenseDate: FIRST_INSTANT_2027, gross: "20000.00" },
    { recurringTemplateId: "rt2", expenseDate: FIRST_INSTANT_2027, gross: "5000.00" },
  ];

  const render = async (searchParams: Record<string, string>) => {
    db["recurringExpense"] = { findMany: async () => templates };
    db["vendor"] = { findMany: async () => [] };
    db["expense"] = {
      groupBy: async (args) => {
        const where = (args as unknown as { where: Where }).where;
        const window = bounds(where, "expenseDate");
        const totals = new Map<string, { sum: Decimal; count: number }>();
        for (const run of runs) {
          if (!inside(window, run.expenseDate)) continue;
          const prev = totals.get(run.recurringTemplateId) ?? { sum: new Decimal(0), count: 0 };
          totals.set(run.recurringTemplateId, {
            sum: prev.sum.plus(run.gross),
            count: prev.count + 1,
          });
        }
        return [...totals].map(([recurringTemplateId, t]) => ({
          recurringTemplateId,
          _sum: { grossAmount: t.sum.toString() },
          _count: { _all: t.count },
        }));
      },
    };
    return renderToStaticMarkup(
      await RecurringExpensesPage({ searchParams: Promise.resolve(searchParams) }),
    );
  };

  it("counts what each template generated inside the window", async () => {
    const closingYear = await render(FY_2026);
    expect(closingYear).toContain("₹20,000.00");
    expect(closingYear).toContain(">1<"); // one run

    const openingYear = await render(FY_2027);
    expect(openingYear).toContain("₹25,000.00"); // ₹20,000 + ₹5,000
    expect(openingYear).toContain(">2<"); // two runs
  });

  it("counts a run on the 1 April boundary in exactly one window", async () => {
    // The two runs are one instant apart across the boundary; billed over the
    // two windows adds up to the pair exactly once each.
    const closingYear = await render(FY_2026);
    const openingYear = await render(FY_2027);

    expect(closingYear).toContain("₹20,000.00");
    expect(closingYear).not.toContain("₹25,000.00");
    expect(openingYear).not.toContain("₹45,000.00");
  });

  it("lists every template whatever the window, including a paused one", async () => {
    // A standing instruction is not an event: hiding it because its next due
    // date falls outside the window is how a template looks deleted.
    for (const searchParams of [FY_2026, FY_2027, { period: "week" }]) {
      const html = await render(searchParams);
      expect(html).toContain("Office rent");
      expect(html).toContain("Old AMC");
      expect(html).toContain("PAUSED");
    }
  });

  it("says which window the run figures cover", async () => {
    expect(await render(FY_2026)).toContain(
      "Showing custom range: 01 Apr 2026 – 31 Mar 2027",
    );
  });
});

// ---------------------------------------------------------------------------
// Banking
// ---------------------------------------------------------------------------

describe("banking period filter", () => {
  const account = {
    id: "ba1",
    bankName: "Canara Bank",
    accountNumber: "0491101012345",
    branch: "Jayanagar",
    isPrimary: true,
    isActive: true,
    purpose: "GENERAL",
    openingBalance: new Decimal("50000.00"),
  };

  /** paymentDate is the day the money reached the bank; null falls back. */
  const donations = [
    {
      id: "dn1",
      amount: new Decimal("10000.00"),
      donationDate: new Date("2026-03-15T10:00:00+05:30"),
      paymentDate: new Date("2026-03-15T10:00:00+05:30"),
      bankAccountId: "ba1",
      donor: { name: "Lakshmi Narayanan" },
    },
    {
      // No clearing date recorded, so it is dated by the donation itself —
      // and it sits on the last instant of FY 2026-27.
      id: "dn2",
      amount: new Decimal("20000.00"),
      donationDate: LAST_INSTANT_2026,
      paymentDate: null,
      bankAccountId: "ba1",
      donor: { name: "Anand Kumar" },
    },
    {
      id: "dn3",
      amount: new Decimal("5000.00"),
      donationDate: new Date("2027-03-28T10:00:00+05:30"),
      // Taken in March, cleared in April: April's money.
      paymentDate: FIRST_INSTANT_2027,
      bankAccountId: "ba1",
      donor: { name: "Meera Rao" },
    },
  ];

  const expenses = [
    {
      id: "ex1",
      grossAmount: new Decimal("8000.00"),
      paidAt: new Date("2026-06-10T10:00:00+05:30"),
      bankAccountId: "ba1",
      vendor: { name: "Anand Stationers" },
      cashPayeeName: null,
    },
  ];

  const topUps = [
    {
      id: "pt1",
      amount: new Decimal("3000.00"),
      topUpDate: new Date("2026-09-01T10:00:00+05:30"),
      bankAccountId: "ba1",
      float: { name: "Head office float" },
    },
  ];

  /** How the page must date a receipt: the OR it sends, read back. */
  const receiptBounds = (where: unknown): Bounds => {
    const or = (where as { OR?: { paymentDate?: Bounds }[] }).OR;
    return or?.[0]?.paymentDate;
  };
  const bankedOn = (d: (typeof donations)[number]) => d.paymentDate ?? d.donationDate;

  const groupOne = (rows: { amount: Decimal }[], key: "amount" | "grossAmount") =>
    rows.length
      ? [
          {
            bankAccountId: "ba1",
            _sum: {
              [key]: rows
                .reduce((acc, r) => acc.plus(r.amount), new Decimal(0))
                .toString(),
            },
            _count: { _all: rows.length },
          },
        ]
      : [];

  const render = async (searchParams: Record<string, string>) => {
    db["bankAccount"] = { findMany: async () => [account] };
    db["donation"] = {
      groupBy: async (args) => {
        const where = (args as unknown as { where: Where }).where;
        const window = receiptBounds(where);
        return groupOne(
          donations.filter((d) => inside(window, bankedOn(d))),
          "amount",
        );
      },
      findMany: async (args) => {
        const where = (args as unknown as { where: Where }).where;
        return donations.filter((d) => inside(receiptBounds(where), bankedOn(d)));
      },
    };
    db["expense"] = {
      groupBy: async (args) => {
        const where = (args as unknown as { where: Where }).where;
        const window = bounds(where, "paidAt");
        return groupOne(
          expenses
            .filter((e) => inside(window, e.paidAt))
            .map((e) => ({ amount: e.grossAmount })),
          "grossAmount",
        );
      },
      findMany: async (args) => {
        const where = (args as unknown as { where: Where }).where;
        return expenses.filter((e) => inside(bounds(where, "paidAt"), e.paidAt));
      },
    };
    db["pettyCashTopUp"] = {
      groupBy: async (args) => {
        const where = (args as unknown as { where: Where }).where;
        return groupOne(
          topUps.filter((t) => inside(bounds(where, "topUpDate"), t.topUpDate)),
          "amount",
        );
      },
      findMany: async (args) => {
        const where = (args as unknown as { where: Where }).where;
        return topUps.filter((t) => inside(bounds(where, "topUpDate"), t.topUpDate));
      },
    };
    return renderToStaticMarkup(
      await BankingPage({ searchParams: Promise.resolve(searchParams) }),
    );
  };

  it("reads every figure on the card against the same window", async () => {
    // ₹50,000 opened the account and ₹10,000 was banked before FY 2026-27, so
    // the year opens on ₹60,000. Inside it: ₹20,000 in, ₹8,000 paid and a
    // ₹3,000 top-up out — net ₹9,000, closing ₹69,000.
    const html = await render(FY_2026);

    expect(html).toContain("₹60,000");
    expect(html).toContain("₹9,000");
    expect(html).toContain("₹69,000");
    expect(html).toContain("1 receipt");
    expect(html).toContain("2 payments");
    // April's cleared cheque is next year's money, in every figure and the list.
    expect(html).not.toContain("₹5,000");
    expect(html).not.toContain("Meera Rao");
  });

  it("carries the closing balance into the next window as its opening", async () => {
    // Nothing is counted twice and nothing is dropped: FY 2027-28 opens where
    // FY 2026-27 closed, and only the ₹5,000 cleared on 1 April moves inside it.
    const html = await render(FY_2027);

    expect(html).toContain("₹69,000"); // opening
    expect(html).toContain("₹74,000"); // closing
    expect(html).toContain("Meera Rao");
    expect(html).toContain("1 receipt");
    expect(html).toContain("0 payments");
  });

  it("dates a receipt by the day the money reached the bank", async () => {
    // dn3 was given on 28 March and cleared on 1 April. A page dating receipts
    // by donationDate would bank it in the closing year and overstate that
    // year's balance by ₹5,000.
    const closingYear = await render(FY_2026);
    const openingYear = await render(FY_2027);

    expect(closingYear).not.toContain("28 Mar");
    expect(openingYear).toContain("01 Apr");
    // dn2 has no clearing date, so it keeps its own: 31 March, inside FY 2026-27.
    expect(closingYear).toContain("31 Mar");
    expect(closingYear).toContain("Anand Kumar");
  });

  it("says which window is on and when the balances close", async () => {
    const html = await render(FY_2026);

    expect(html).toContain("Showing custom range: 01 Apr 2026 – 31 Mar 2027");
    expect(html).toContain("as at 31 Mar 2027");
  });

  it("shows the current financial year when no window is asked for", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-14T09:00:00+05:30"));

    const html = await render({});

    expect(html).toContain("FY 2026-27");
    expect(html).toContain("as at 31 Mar 2027");
    expect(html).toContain("₹69,000");
  });
});
