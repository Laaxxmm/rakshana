import { renderToStaticMarkup } from "react-dom/server";
import { Decimal } from "decimal.js";
import { describe, expect, it, vi } from "vitest";

/**
 * The float list — the screen a custodian starts from. It carries one line of
 * fact per box and two things to do with it; the movements behind the balance
 * are on the ledger it links to.
 */

vi.mock("next/navigation", () => ({ usePathname: () => "/petty-cash" }));
vi.mock("@/lib/auth/scope", () => ({
  requireOrgScope: async () => ({
    userId: "u1",
    organisationId: "o1",
    organisationName: "Test Trust",
    role: "OWNER",
  }),
}));
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    pettyCashFloat: {
      findMany: async () => [
        {
          id: "float-1",
          name: "Office float",
          floatAmount: new Decimal("5000.00"),
          currentBalance: new Decimal("3210.75"),
          custodian: { name: "Asha Rao", email: "asha@testtrust.org" },
        },
      ],
    },
    bankAccount: { findMany: async () => [] },
    expense: {
      groupBy: async () => [
        {
          pettyCashFloatId: "float-1",
          _count: { _all: 2 },
          _sum: { grossAmount: new Decimal("777.77") },
        },
      ],
    },
  },
  prismaUnsafe: { user: { findMany: async () => [] } },
}));
// The two dialogs reach the server-action stack; neither carries a figure of
// this screen's.
vi.mock("./TopUpDialog", () => ({ TopUpDialog: () => null }));
vi.mock("./NewFloatDialog", () => ({ NewFloatDialog: () => null }));

const PettyCashPage = (await import("./page")).default;

const render = async () => renderToStaticMarkup(await PettyCashPage());

describe("petty cash floats", () => {
  it("sends each float to its own ledger", async () => {
    expect(await render()).toContain('href="/petty-cash/float-1"');
  });

  it("says which floats have rejected vouchers still to check", async () => {
    const html = await render();

    // The repair that left them could not tell an outstanding debit from one
    // already refunded, so this counts them and stops short of claiming the
    // balance is wrong by that much.
    expect(html).toContain("2 rejected vouchers to check against the box");
    expect(html).toContain("₹777.77");
  });

  it("shows the register each box is counted against", async () => {
    expect(await render()).toContain("₹3,210.75");
  });
});
