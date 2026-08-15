import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/donations" }));
// The drawer this page imports reaches the auth stack; the headline does not.
vi.mock("@/auth", () => ({ auth: async () => null }));
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
    donation: {
      findMany: async () => [],
      groupBy: async () => [
        { donorId: "d1", _sum: { amount: "5000.25" }, _count: { _all: 2 } },
        { donorId: "d2", _sum: { amount: "1000.00" }, _count: { _all: 1 } },
      ],
    },
  },
}));

const DonationsPage = (await import("./page")).default;

const render = async () =>
  renderToStaticMarkup(await DonationsPage({ searchParams: Promise.resolve({}) }));

describe("donations headline", () => {
  it("gives every figure its own label instead of one run-on line", async () => {
    const html = await render();

    for (const label of ["Donations", "Received", "Donors"]) {
      expect(html).toContain(`>${label}<`);
    }
    // Three donations across two donors, summed with Decimal.
    expect(html).toContain(">3<");
    expect(html).toContain("₹6,000.25");
    expect(html).toContain(">2<");
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
