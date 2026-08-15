import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/expenses" }));
vi.mock("@/lib/auth/scope", () => ({
  requireOrgScope: async () => ({
    userId: "u",
    organisationId: "o",
    organisationName: "Test Trust",
    role: "OWNER",
  }),
}));
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    expense: {
      findMany: async () => [],
      aggregate: async () => ({
        _sum: { grossAmount: "125000.50", tdsAmount: "2500.00" },
        _count: { _all: 14 },
      }),
    },
  },
}));

const ExpensesPage = (await import("./page")).default;

const render = async () =>
  renderToStaticMarkup(await ExpensesPage({ searchParams: Promise.resolve({}) }));

describe("expenses headline", () => {
  it("gives every figure its own label instead of one run-on line", async () => {
    const html = await render();

    for (const label of ["Vouchers", "Gross", "TDS"]) {
      expect(html).toContain(`>${label}<`);
    }
    expect(html).toContain("₹1,25,000.50");
    expect(html).toContain("₹2,500.00");
    // The strip the user could not read was one interpuncted sentence.
    expect(html).not.toContain("·");
  });

  it("says which window it is showing, next to the filter", async () => {
    expect(await render()).toContain("Showing ");
  });

  it("does not mention GST", async () => {
    expect(await render()).not.toContain("GST");
  });
});
