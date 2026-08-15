import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { todayInIST } from "@/lib/format/date";

/**
 * What the dashboard puts first, and how many things it puts across.
 *
 * This is the screen a volunteer lands on, on a phone, standing in front of a
 * donor. Reading order is the only layout a 375px screen has: a single column
 * renders top to bottom, so DOM order *is* what the thumb reaches first. The
 * quick actions used to sit under three stat cards and above a twelve-month
 * chart, which put "Record donation" most of a screen down.
 *
 * Nothing here measures pixels — vitest has no layout engine. It asserts the
 * two things a phone layout is made of that survive into the markup: the
 * order blocks appear in, and whether any of them is laid out multi-column
 * before a breakpoint prefix widens it.
 */

type Query = (args?: Record<string, unknown>) => Promise<unknown>;

const db: Record<string, Record<string, Query>> = {};

vi.mock("@/lib/db/prisma", () => ({
  prisma: new Proxy({}, { get: (_target, model) => db[String(model)] }),
}));
vi.mock("@/lib/auth/scope", () => ({
  requireOrgScope: async () => ({
    userId: "u1",
    organisationId: "o1",
    organisationName: "Test Trust",
    role: "OWNER",
  }),
}));
vi.mock("@/lib/compliance/eighty-five-rule", () => ({
  computeEightyFiveRule: async () => ({
    applicationPercentage: "90.00",
    meetsThreshold: true,
    shortfallAmount: "0.00",
  }),
}));

const DashboardPage = (await import("./page")).default;

const day = todayInIST();

async function render() {
  db.donation = {
    aggregate: async () => ({ _sum: { amount: "4567890.12" }, _count: { _all: 3 } }),
    // The recent-donations list selects the donor; the trend strip does not.
    findMany: async (args) =>
      args?.select && "donor" in (args.select as Record<string, unknown>)
        ? [
            {
              id: "d1",
              amount: "5000.00",
              donationDate: day,
              receiptNumber: "RKS/2026-27/0001",
              donor: { name: "Anitha Rao" },
            },
          ]
        : [{ amount: "5000.00", donationDate: day }],
  };
  db.expense = {
    aggregate: async () => ({ _sum: { grossAmount: "1234567.89" }, _count: { _all: 2 } }),
    count: async () => 2,
    findMany: async () => [{ grossAmount: "1000.00", expenseDate: day }],
  };
  db.complianceItem = {
    findMany: async () => [
      { id: "c1", title: "TDS payment", dueDate: day, status: "DUE", category: "TDS" },
    ],
  };
  return renderToStaticMarkup(await DashboardPage());
}

/** Where a block starts in the document, which on a phone is where it sits. */
function at(html: string, text: string): number {
  const i = html.indexOf(text);
  if (i < 0) throw new Error(`"${text}" is not on the dashboard at all`);
  return i;
}

/**
 * Every class that applies at 375px — a token carrying a `sm:` / `lg:` prefix
 * is a wider screen's instruction and is dropped.
 */
function unprefixedClasses(html: string): string[] {
  return [...html.matchAll(/class="([^"]*)"/g)]
    .flatMap((m) => m[1]!.split(/\s+/))
    .filter((t) => t.length > 0 && !t.includes(":"));
}

describe("dashboard reading order", () => {
  it("puts the quick actions above the figures and the chart", async () => {
    const html = await render();

    // The three things a volunteer opens the app to do come before anything
    // to read.
    expect(at(html, "Record donation")).toBeLessThan(at(html, "Money in"));
    expect(at(html, "Record donation")).toBeLessThan(at(html, "Last 12 months"));
    expect(at(html, "Collect online")).toBeLessThan(at(html, "Money in"));
  });

  it("puts what is due above the twelve-month chart", async () => {
    const html = await render();

    // Due next is something to act on; the trend strip is background, and on
    // a phone background does not go first.
    expect(at(html, "Due next")).toBeLessThan(at(html, "Last 12 months"));
  });

  it("lays nothing out three or more across at phone width", async () => {
    const html = await render();

    // A guard rather than a demonstration: the stat strip and the quick
    // actions each declare their columns at `sm` and up, so an unprefixed
    // `grid-cols-3` here would be three cards in 375px.
    expect(
      unprefixedClasses(html).filter((t) => /^grid-cols-([3-9]|1[0-2])$/.test(t)),
    ).toEqual([]);
  });

  it("keeps all twelve months of the trend after the reflow", async () => {
    const html = await render();

    // Narrowing the strip drops labels, never buckets — each month still
    // renders its in and out bar.
    expect(html.match(/title="In ₹/g)).toHaveLength(12);
    expect(html.match(/title="Out ₹/g)).toHaveLength(12);
  });
});
