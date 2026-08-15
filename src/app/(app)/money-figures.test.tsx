import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { todayInIST } from "@/lib/format/date";

/**
 * The rupee figures a trustee reads first: the dashboard headline and bars,
 * a beneficiary's total disbursed, a donor's average donation.
 *
 * Every amount behind them is a Decimal(18,2) column. Added as JavaScript
 * numbers the totals drift from the ledger they claim to summarise, and the
 * drift reaches the screen wherever the figure is rounded for display — a
 * total that is exactly ₹….50 renders a whole rupee short, a division lands a
 * paisa short. Each fixture below is a real set of two-decimal amounts whose
 * double sum falls on the wrong side of that rounding.
 */

type Query = (args?: Record<string, unknown>) => Promise<unknown>;

/** Per-test Prisma stubs, read through the proxy at call time. */
const db: Record<string, Record<string, Query>> = {};

vi.mock("@/lib/db/prisma", () => ({
  prisma: new Proxy(
    {},
    { get: (_target, model) => db[String(model)] },
  ),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  notFound: () => {
    throw new Error("notFound()");
  },
}));
vi.mock("@/auth", () => ({ auth: async () => null }));
vi.mock("@/lib/auth/scope", () => ({
  requireOrgScope: async () => ({
    userId: "u1",
    organisationId: "o1",
    organisationName: "Test Trust",
    role: "OWNER",
  }),
}));
vi.mock("@/lib/audit/history", () => ({ loadEditHistory: async () => [] }));
vi.mock("@/lib/compliance/eighty-five-rule", () => ({
  computeEightyFiveRule: async () => ({
    applicationPercentage: "90.00",
    meetsThreshold: true,
    shortfallAmount: "0.00",
  }),
}));
// Row controls that reach the server-action stack; no rupee figure of theirs.
vi.mock("@/components/patterns/DonationReceiptActions", () => ({
  DonationReceiptActions: () => null,
}));

const DashboardPage = (await import("./page")).default;
const BeneficiariesPage = (await import("./beneficiaries/page")).default;
const BeneficiaryProfilePage = (await import("./beneficiaries/[id]/page")).default;
const DonorProfilePage = (await import("./donors/[id]/page")).default;

/** Anchors trend rows to the month the dashboard buckets them into. */
const day = todayInIST();

describe("dashboard money figures", () => {
  /**
   * ₹1,16,907.40 + ₹9,59,874.20 + ₹2,46,048.90 = ₹13,22,830.50 exactly.
   * The 0.1 + 0.2 case at rupee scale: a double lands on
   * 1322830.4999999998, one rupee lower once rounded for display.
   */
  const donationsInMonth = ["116907.40", "959874.20", "246048.90"];

  /** Twelve two-decimal amounts totalling ₹65,88,779.50; a double reaches
   *  6588779.499999999. */
  const expensesInMonth = [
    "832206.32", "100219.99", "179190.23", "480617.56",
    "981478.13", "318827.13", "455852.46", "698916.90",
    "630442.18", "760286.39", "836676.86", "314065.35",
  ];

  const render = async () => {
    db.donation = {
      aggregate: async () => ({ _sum: { amount: "4567890.12" }, _count: { _all: 3 } }),
      // The recent-donations list selects the donor; the trend strip does not.
      findMany: async (args) =>
        args?.select && "donor" in (args.select as Record<string, unknown>)
          ? []
          : donationsInMonth.map((amount) => ({ amount, donationDate: day })),
    };
    db.expense = {
      aggregate: async () => ({
        _sum: { grossAmount: "1234567.89" },
        _count: { _all: 12 },
      }),
      count: async () => 0,
      findMany: async () =>
        expensesInMonth.map((grossAmount) => ({ grossAmount, expenseDate: day })),
    };
    db.complianceItem = { findMany: async () => [] };
    return renderToStaticMarkup(await DashboardPage());
  };

  it("totals a month's donations to the paisa before rounding the bar label", async () => {
    const html = await render();

    expect(html).toContain('title="In ₹13,22,831"');
    expect(html).not.toContain("In ₹13,22,830");
  });

  it("totals a month's expenses to the paisa before rounding the bar label", async () => {
    const html = await render();

    expect(html).toContain('title="Out ₹65,88,780"');
    expect(html).not.toContain("Out ₹65,88,779");
  });

  // A guard, not a demonstration: "Money in" and "Money out" arrive as one
  // aggregated Decimal each, and a double round-trips a single such figure
  // unchanged at any magnitude a trust will see. This holds with or without
  // the Decimal, and is here so the formatter's input cannot regress.
  it("carries the aggregated headline figures through unrounded", async () => {
    const html = await render();

    expect(html).toContain("₹45,67,890");
    expect(html).toContain("₹12,34,568");
  });
});

describe("beneficiary disbursement totals", () => {
  /**
   * Three disbursements totalling ₹7,03,70,35,80,37,037.01. A double carries
   * fifteen significant digits, so it reports a paisa more.
   *
   * The magnitude is what it takes to see this one on screen: below roughly
   * ₹10^13 a double sum of two-decimal amounts still rounds to the same
   * string, which is why summing Decimal columns as numbers went unnoticed
   * here. The arithmetic is wrong at every magnitude; only its display is
   * forgiving.
   */
  const values = ["12345678901234.56", "23456789012345.67", "34567890123456.78"];
  const exactTotal = "₹7,03,70,35,80,37,037.01";
  const doubleTotal = "₹7,03,70,35,80,37,037.02";

  const disbursements = values.map((value, i) => ({
    id: `d${i}`,
    value,
    type: "CASH",
    description: "Support",
    disbursementDate: day,
    expenseId: null,
  }));

  it("adds the list column with Decimal", async () => {
    db.beneficiary = {
      findMany: async () => [
        {
          id: "b1",
          name: "Test Beneficiary",
          code: "BEN-1",
          status: "ACTIVE",
          enrolments: [],
          disbursements: values.map((value) => ({ value })),
        },
      ],
    };

    const html = renderToStaticMarkup(
      await BeneficiariesPage({ searchParams: Promise.resolve({}) }),
    );

    expect(html).toContain(exactTotal);
    expect(html).not.toContain(doubleTotal);
  });

  it("adds the profile KPI with Decimal", async () => {
    db.beneficiary = {
      findUnique: async () => ({
        id: "b1",
        name: "Test Beneficiary",
        code: "BEN-1",
        status: "ACTIVE",
        gender: null,
        category: null,
        phone: null,
        email: null,
        dob: null,
        addressLine1: null,
        city: null,
        state: null,
        pincode: null,
        internalNotes: null,
        enrolments: [],
        disbursements,
        impactRecords: [],
      }),
    };

    const html = renderToStaticMarkup(
      await BeneficiaryProfilePage({ params: Promise.resolve({ id: "b1" }) }),
    );

    expect(html).toContain(exactTotal);
    expect(html).not.toContain(doubleTotal);
  });
});

describe("donor average donation", () => {
  it("rounds the average half-up to the paisa", async () => {
    // ₹1,000.05 over six donations is ₹166.675 exactly — a tie, which
    // half-up settles at ₹166.68. Divided as doubles it is 166.67499999999998
    // and the trustee is quoted a paisa less.
    const amounts = ["500.00", "200.05", "100.00", "100.00", "50.00", "50.00"];

    db.donor = {
      findUnique: async () => ({
        id: "dn1",
        name: "Test Donor",
        donorType: "INDIVIDUAL",
        status: "ACTIVE",
        isAnonymousBucket: false,
        is80GEligible: true,
        isFcraEligible: false,
        isCsrDonor: false,
        csrCompanyCin: null,
        tags: [],
        internalNotes: null,
        phone: null,
        whatsapp: null,
        email: null,
        pan: null,
        aadhaarLast4: null,
        addressLine1: null,
        addressLine2: null,
        city: null,
        district: null,
        state: null,
        pincode: null,
        country: "India",
        totalDonatedLifetime: "1000.05",
      }),
    };
    db.donation = {
      findMany: async () =>
        amounts.map((amount, i) => ({
          id: `dnt${i}`,
          receiptNumber: `R-${i}`,
          donationDate: day,
          mode: "UPI",
          amount,
          status: "RECEIVED",
        })),
    };
    db.communication = { findMany: async () => [] };

    const html = renderToStaticMarkup(
      await DonorProfilePage({ params: Promise.resolve({ id: "dn1" }) }),
    );

    expect(html).toContain("₹166.68");
    expect(html).not.toContain("₹166.67");
  });
});
