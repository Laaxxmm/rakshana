import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { OrgRole } from "@prisma/client";

let role: OrgRole = "OWNER";

vi.mock("@/lib/auth/scope", () => ({
  requireOrgScope: async () => ({
    userId: "u",
    organisationId: "o",
    organisationName: "Test Trust",
    role,
  }),
}));

const findMany = vi.fn();
vi.mock("@/lib/db/prisma", () => ({ prisma: { membership: { findMany } } }));

const MembersPage = (await import("./page")).default;

const OWNER_ROW = {
  id: "m-owner",
  role: "OWNER" as OrgRole,
  isActive: true,
  user: { name: "Trustee", email: "trustee@example.test", lastLoginAt: new Date("2026-01-02T09:30:00Z") },
};
const ACCOUNTANT_ROW = {
  id: "m-ca",
  role: "ACCOUNTANT" as OrgRole,
  isActive: true,
  user: { name: "Priya CA", email: "priya@example.test", lastLoginAt: null },
};

// mockClear per render: the suite runs shuffled, so a call count only means
// something if it starts from zero here.
async function render(rows: unknown[], as: OrgRole = "OWNER") {
  role = as;
  findMany.mockClear();
  findMany.mockResolvedValue(rows);
  return renderToStaticMarkup(await MembersPage());
}

describe("members screen", () => {
  it("lists every member with role and access, for an owner", async () => {
    const html = await render([OWNER_ROW, ACCOUNTANT_ROW]);

    expect(html).toContain("Priya CA");
    expect(html).toContain("priya@example.test");
    expect(html).toContain("Accountant");
    expect(html).toContain("Remove access");
    expect(html).toContain("Add a member");
    // The picker defaults to ACCOUNTANT, so that role's summary is on screen
    // before anyone touches the form. GST is not a module of this app, and a
    // source scan cannot tell a rendered blurb from a dormant column name.
    expect(html).not.toContain("GST");
    // The list is filtered by the session's organisation, not by anything the
    // browser sent.
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organisationId: "o" } }),
    );
  });

  it("keeps the last active owner out of reach of both controls", async () => {
    const html = await render([OWNER_ROW]);

    expect(html).toContain("Last owner — keep one");
    expect(html).not.toContain("Remove access");
  });

  it("offers the controls once a second owner exists", async () => {
    const html = await render([OWNER_ROW, { ...ACCOUNTANT_ROW, role: "OWNER" as OrgRole }]);

    expect(html).not.toContain("Last owner — keep one");
    expect(html).toContain("Remove access");
  });

  it("shows a role that lacks user.invite nothing but a notice", async () => {
    const html = await render([OWNER_ROW, ACCOUNTANT_ROW], "ACCOUNTANT");

    expect(html).toContain("Owners only.");
    expect(html).not.toContain("priya@example.test");
    expect(html).not.toContain("Add a member");
    // Denied before the query runs — the page never reads the member list.
    expect(findMany).not.toHaveBeenCalled();
  });
});
