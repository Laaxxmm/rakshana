import { renderToStaticMarkup } from "react-dom/server";
import { Window, type Element, type Node } from "happy-dom";
import { Decimal } from "decimal.js";
import { describe, expect, it, vi } from "vitest";

import { formatIST, resolvePeriod } from "@/lib/format/date";
import { DateRangeFilter } from "@/components/patterns/DateRangeFilter";
import { StatRow } from "@/components/patterns/StatRow";

/**
 * What the seven list screens show on a phone.
 *
 * Vitest runs environment "node": there is no layout engine here, nothing
 * below measures a pixel, and none of it can tell you whether a row looks
 * right — that part is done by eye and reported separately. What a node test
 * can check honestly is the vocabulary these screens use to decide what a
 * narrow viewport gets. Tailwind's bare `hidden` is `display:none` until a
 * breakpoint variant lifts it, and every lift in these files is `sm:`
 * (≥640px), so below that width a row is its markup minus every element
 * carrying `hidden`; `sm:hidden` is the mirror image, the lines only the
 * phone sees. That is the model `phoneText` and `phoneCells` implement.
 *
 * So the assertions are: how many columns survive at 375px, which ones, that
 * the facts each screen decided matter are still readable there, and that the
 * column left holding a name can wrap instead of pushing the page sideways.
 */

const DAY = new Date("2026-08-12T04:00:00Z");
const DATE = formatIST(DAY);

/** Per-test Prisma stubs, read through the proxy at call time. */
type Query = (args?: Record<string, unknown>) => Promise<unknown>;
const db: Record<string, Record<string, Query>> = {};

vi.mock("@/lib/db/prisma", () => ({
  prisma: new Proxy({}, { get: (_target, model) => db[String(model)] }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/donations" }));
vi.mock("@/auth", () => ({ auth: async () => null }));
vi.mock("@/lib/auth/scope", () => ({
  requireOrgScope: async () => ({
    userId: "u1",
    organisationId: "o1",
    organisationName: "Test Trust",
    role: "OWNER",
  }),
}));

const DonationsPage = (await import("./donations/page")).default;
const ExpensesPage = (await import("./expenses/page")).default;
const DonorsPage = (await import("./donors/page")).default;
const VendorsPage = (await import("./vendors/page")).default;
const ProjectsPage = (await import("./projects/page")).default;
const BeneficiariesPage = (await import("./beneficiaries/page")).default;
const VolunteersPage = (await import("./volunteers/page")).default;

// ---------------------------------------------------------------------------
// The phone's view of some markup.
// ---------------------------------------------------------------------------

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

function parse(html: string): Element {
  const window = new Window();
  const document = new window.DOMParser().parseFromString(html, "text/html");
  return document.body as unknown as Element;
}

/** Hidden below `sm`: a `hidden` with no variant prefix of its own. */
const hiddenOnPhone = (el: Element) => el.classList.contains("hidden");

function collectPhoneText(node: Node, out: string[]): void {
  if (node.nodeType === TEXT_NODE) {
    out.push(node.textContent ?? "");
    return;
  }
  if (node.nodeType === ELEMENT_NODE && hiddenOnPhone(node as Element)) return;
  for (const child of node.childNodes) collectPhoneText(child, out);
}

/** Everything a ≤639px viewport renders as text, whitespace normalised. */
function phoneText(node: Node): string {
  const out: string[] = [];
  collectPhoneText(node, out);
  return out.join(" ").replace(/\s+/g, " ").trim();
}

const phoneCells = (row: Element, selector: "th" | "td") =>
  Array.from(row.querySelectorAll(selector)).filter((cell) => !hiddenOnPhone(cell));

// ---------------------------------------------------------------------------
// One row per screen, with the facts that screen decided a phone must show.
// ---------------------------------------------------------------------------

type Screen = {
  /** Column headings that survive at 375px, in order. */
  columns: string[];
  /** Facts readable off the row at 375px, in a column or under the name. */
  facts: string[];
  render: () => Promise<string>;
};

const donation = {
  id: "dn1",
  receiptNumber: "RCT-2026-0001",
  receiptUrl: null,
  donationDate: DAY,
  amount: new Decimal("125000.50"),
  mode: "UPI",
  paymentRef: null,
  is80GEligible: true,
  status: "RECEIVED",
  cancellationReason: null,
  donor: {
    id: "dr1",
    name: "Lakshmi Narayanan",
    pan: "ABCDE1234F",
    isAnonymousBucket: false,
  },
};

const expense = {
  id: "ex1",
  voucherNumber: "VCH-2026-0007",
  expenseDate: DAY,
  vendor: { id: "vn1", name: "Anand Stationers", pan: "AAAAA1111A" },
  cashPayeeName: null,
  category: { name: "Stationery" },
  project: { name: "Midday Meals", code: "MDM-01" },
  grossAmount: new Decimal("18000.00"),
  tdsAmount: new Decimal("0.00"),
  netPayable: new Decimal("18000.00"),
  mode: "BANK",
  paymentRef: null,
  status: "PENDING_APPROVAL",
  description: null,
  isPettyCash: false,
};

const screens: Record<string, Screen> = {
  donations: {
    columns: ["Donor", "Amount"],
    facts: ["Lakshmi Narayanan", "₹1,25,000.50", "RCT-2026-0001", DATE],
    render: async () => {
      db["donation"] = {
        findMany: async () => [donation],
        groupBy: async () => [
          { donorId: "dr1", _sum: { amount: "125000.50" }, _count: { _all: 1 } },
        ],
      };
      return renderToStaticMarkup(await DonationsPage({ searchParams: Promise.resolve({}) }));
    },
  },
  expenses: {
    columns: ["Vendor", "Gross"],
    // A voucher's status decides what the reader does next, so it stays —
    // spelt with a space, which is where the phone is allowed to break it.
    facts: ["Anand Stationers", "₹18,000.00", "VCH-2026-0007", DATE, "PENDING APPROVAL"],
    render: async () => {
      db["expense"] = {
        findMany: async () => [expense],
        aggregate: async () => ({
          _sum: { grossAmount: "18000.00", tdsAmount: "0.00" },
          _count: { _all: 1 },
        }),
      };
      return renderToStaticMarkup(await ExpensesPage({ searchParams: Promise.resolve({}) }));
    },
  },
  donors: {
    columns: ["Name", "Lifetime"],
    facts: ["Lakshmi Narayanan", "₹1,25,000.50", DATE],
    render: async () => {
      db["donor"] = {
        findMany: async () => [
          {
            id: "dr1",
            name: "Lakshmi Narayanan",
            tags: ["monthly"],
            donorType: "INDIVIDUAL",
            isAnonymousBucket: false,
            pan: "ABCDE1234F",
            lastDonationDate: DAY,
            totalDonatedLifetime: new Decimal("125000.50"),
            status: "ACTIVE",
          },
        ],
      };
      return renderToStaticMarkup(await DonorsPage({ searchParams: Promise.resolve({}) }));
    },
  },
  vendors: {
    columns: ["Name"],
    facts: ["Anand Stationers", "Bengaluru, Karnataka", "194C"],
    render: async () => {
      db["vendor"] = {
        findMany: async () => [
          {
            id: "vn1",
            name: "Anand Stationers",
            pan: "AAAAA1111A",
            defaultTdsSection: "194C",
            city: "Bengaluru",
            state: "Karnataka",
          },
        ],
      };
      return renderToStaticMarkup(await VendorsPage({ searchParams: Promise.resolve({}) }));
    },
  },
  projects: {
    columns: ["Name", "Spent"],
    // ₹2,00,000 of a ₹5,00,000 budget — the bar's 40%, in three characters.
    facts: ["Midday Meals", "₹2,00,000", "MDM-01", "40%"],
    render: async () => {
      db["project"] = {
        findMany: async () => [
          {
            id: "pr1",
            code: "MDM-01",
            name: "Midday Meals",
            manager: { name: "Asha Rao" },
            status: "ACTIVE",
            startDate: DAY,
            endDate: null,
            totalBudget: new Decimal("500000.00"),
            isFcra: false,
            isCsr: false,
            _count: { donations: 1, expenses: 1 },
          },
        ],
      };
      db["expense"] = {
        groupBy: async () => [{ projectId: "pr1", _sum: { grossAmount: "200000.00" } }],
      };
      return renderToStaticMarkup(await ProjectsPage({ searchParams: Promise.resolve({}) }));
    },
  },
  beneficiaries: {
    columns: ["Name", "Disbursements"],
    facts: ["Ravi Kumar", "₹4,500.00", "BEN-004", "Midday Meals"],
    render: async () => {
      db["beneficiary"] = {
        findMany: async () => [
          {
            id: "bn1",
            name: "Ravi Kumar",
            code: "BEN-004",
            status: "ACTIVE",
            enrolments: [{ project: { id: "pr1", name: "Midday Meals", managerId: "u1" } }],
            disbursements: [{ value: new Decimal("4500.00") }],
          },
        ],
      };
      return renderToStaticMarkup(await BeneficiariesPage({ searchParams: Promise.resolve({}) }));
    },
  },
  volunteers: {
    columns: ["Name", "Total hours"],
    facts: ["Meera Rao", "+91 98450 12345", "42"],
    render: async () => {
      db["volunteer"] = {
        findMany: async () => [
          {
            id: "vl1",
            name: "Meera Rao",
            phone: "+91 98450 12345",
            skills: ["Teaching", "Driving"],
            totalHours: new Decimal("42"),
            joinedOn: DAY,
            status: "ACTIVE",
          },
        ],
      };
      return renderToStaticMarkup(await VolunteersPage());
    },
  },
};

describe.each(Object.entries(screens))("%s on a 375px phone", (_name, screen) => {
  const listTable = async () => {
    const body = parse(await screen.render());
    const table = body.querySelector("table");
    expect(table).not.toBeNull();
    return table as Element;
  };

  it("keeps only the columns that screen decided matter", async () => {
    const table = await listTable();
    const headerRow = table.querySelector("thead tr") as Element;

    expect(phoneCells(headerRow, "th").map((th) => th.textContent?.trim())).toEqual(
      screen.columns,
    );
    // Two columns is what fits beside each other at 375px; the rest either
    // move under the name or wait for a wider screen.
    expect(screen.columns.length).toBeLessThanOrEqual(2);
  });

  it("keeps every fact the row is read for", async () => {
    const table = await listTable();
    const row = table.querySelector("tbody tr") as Element;
    const visible = phoneText(row);

    for (const fact of screen.facts) expect(visible).toContain(fact);
  });

  it("hides a column and its heading together", async () => {
    const table = await listTable();
    const headerRow = table.querySelector("thead tr") as Element;
    const row = table.querySelector("tbody tr") as Element;

    const hidden = (cells: Element[]) => cells.map(hiddenOnPhone);
    // A heading with no cell under it, or a cell with no heading over it,
    // shifts every column right of it by one.
    expect(hidden(Array.from(row.querySelectorAll("td")))).toEqual(
      hidden(Array.from(headerRow.querySelectorAll("th"))),
    );
  });

  it("lets the name column wrap rather than widening the page", async () => {
    const table = await listTable();
    const row = table.querySelector("tbody tr") as Element;
    const [nameCell] = phoneCells(row, "td");

    // Cells are `whitespace-nowrap` by default so a wide table scrolls
    // instead of crushing its columns. The cell holding a name is the one
    // that must give, or a long name drags the row sideways.
    expect(nameCell?.classList.contains("whitespace-normal")).toBe(true);
  });

  it("scrolls inside its own container, never the page", async () => {
    const body = parse(await screen.render());
    const container = body.querySelector('[data-slot="table-container"]') as Element;
    const table = body.querySelector("table") as Element;

    expect(container.className).toContain("overflow-x-auto");
    expect(container.contains(table)).toBe(true);
  });
});

describe("DateRangeFilter on a 375px phone", () => {
  const render = () =>
    parse(
      renderToStaticMarkup(
        <DateRangeFilter basePath="/donations" range={resolvePeriod({ period: "month" })} />,
      ),
    );

  it("shows all four presets and the custom range, none behind a disclosure", () => {
    const visible = phoneText(render());

    for (const label of ["This week", "This month", "This quarter", "This FY", "Apply"]) {
      expect(visible).toContain(label);
    }
  });

  it("still says which window is on", () => {
    const active = render().querySelector('[aria-current="page"]');

    expect(active?.textContent).toBe("This month");
  });

  it("sizes the date inputs to the screen instead of a fixed width", () => {
    const inputs = Array.from(render().querySelectorAll('input[type="date"]'));
    expect(inputs).toHaveLength(2);

    for (const input of inputs) {
      const classes = Array.from(input.classList);
      // A fixed width with no variant prefix is a width the phone is stuck
      // with; two of them plus "to" plus Apply do not fit across 375px.
      expect(classes.filter((c) => /^w-\[/.test(c))).toEqual([]);
      expect(classes).toContain("w-full");
    }
  });
});

describe("StatRow on a 375px phone", () => {
  const render = () =>
    parse(
      renderToStaticMarkup(
        <StatRow
          stats={[
            { label: "Vouchers", value: "14" },
            { label: "Gross", value: "₹13,22,830.50" },
            { label: "TDS", value: "₹1,32,283.05" },
          ]}
        />,
      ),
    );

  it("gives each figure a line of its own, then a row again when there is room", () => {
    const strip = render().querySelector("dl") as Element;

    expect(strip.classList.contains("flex-col")).toBe(true);
    expect(strip.classList.contains("sm:flex-row")).toBe(true);
  });

  it("pushes the value to the opposite edge from its label", () => {
    const figures = Array.from(render().querySelectorAll("dl > div"));

    expect(figures).toHaveLength(3);
    // Label left, value right: the gap between them is what stops two
    // figures from reading as one.
    for (const figure of figures) {
      expect(figure.classList.contains("justify-between")).toBe(true);
    }
  });

  it("keeps every figure readable", () => {
    const visible = phoneText(render());

    for (const fact of ["Vouchers", "14", "Gross", "₹13,22,830.50", "TDS", "₹1,32,283.05"]) {
      expect(visible).toContain(fact);
    }
  });
});
