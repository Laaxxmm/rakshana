import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";

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
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { prismaUnsafe } = await import("@/lib/db/prisma");
const { addMember, changeMemberRole, setMemberAccess } = await import("./actions");

const ORG = "test-org-members-actions";
const OTHER_ORG = "test-org-members-actions-other";
const OWNER_USER = "test-user-members-owner";
const SECOND_OWNER = "test-user-members-owner-2";
const STAFF_USER = "test-user-members-staff";
const OTHER_ORG_USER = "test-user-members-other-org";
const ACCOUNTANT_EMAIL = "test-members-accountant@example.test";
const PASSWORD = "FirstPassw0rd!26";

function scope(role = "OWNER", organisationId = ORG) {
  return {
    userId: OWNER_USER,
    organisationId,
    organisationName: "Test Trust",
    role,
  };
}

function membership(userId: string, organisationId: string) {
  return prismaUnsafe.membership.findFirst({ where: { userId, organisationId } });
}

async function cleanup() {
  await prismaUnsafe.user.deleteMany({
    where: {
      OR: [
        { id: { in: [OWNER_USER, SECOND_OWNER, STAFF_USER, OTHER_ORG_USER] } },
        { email: ACCOUNTANT_EMAIL },
      ],
    },
  });
  await prismaUnsafe.organisation.deleteMany({ where: { id: { in: [ORG, OTHER_ORG] } } });
}

beforeAll(async () => {
  await cleanup();
  await prismaUnsafe.organisation.createMany({
    data: [
      { id: ORG, name: "Test Trust" },
      { id: OTHER_ORG, name: "Another Trust" },
    ],
  });
});

afterAll(cleanup);

/**
 * Rebuilt before every test: the suite runs shuffled, and several of these
 * cases change roles or switch access off.
 */
beforeEach(async () => {
  getOrgScopeMock.mockReset();
  getOrgScopeMock.mockResolvedValue(scope());
  await prismaUnsafe.user.deleteMany({
    where: {
      OR: [
        { id: { in: [OWNER_USER, SECOND_OWNER, STAFF_USER, OTHER_ORG_USER] } },
        { email: ACCOUNTANT_EMAIL },
      ],
    },
  });
  await prismaUnsafe.user.create({
    data: {
      id: OWNER_USER,
      name: "Trustee",
      email: `${OWNER_USER}@example.test`,
      memberships: { create: { organisationId: ORG, role: "OWNER" } },
    },
  });
  await prismaUnsafe.user.create({
    data: {
      id: STAFF_USER,
      name: "Staff",
      email: `${STAFF_USER}@example.test`,
      memberships: { create: { organisationId: ORG, role: "VIEWER" } },
    },
  });
  await prismaUnsafe.user.create({
    data: {
      id: OTHER_ORG_USER,
      name: "Someone else's owner",
      email: `${OTHER_ORG_USER}@example.test`,
      memberships: { create: { organisationId: OTHER_ORG, role: "OWNER" } },
    },
  });
});

const addAccountant = (over: Record<string, unknown> = {}) =>
  addMember({
    name: "Priya CA",
    email: ACCOUNTANT_EMAIL,
    role: "ACCOUNTANT",
    password: PASSWORD,
    confirmPassword: PASSWORD,
    ...over,
  } as never);

describe("addMember", () => {
  it("creates an accountant who can then sign in", async () => {
    const res = await addAccountant();
    expect(res?.data).toEqual({ ok: true });
    expect(res?.validationErrors).toBeUndefined();
    expect(res?.serverError).toBeUndefined();

    // Exactly the lookup `authorize()` in src/auth.ts runs: user by
    // lower-cased email, password against the stored hash, first active
    // membership for the session's org and role.
    const user = await prismaUnsafe.user.findUnique({
      where: { email: ACCOUNTANT_EMAIL.toLowerCase() },
      include: {
        memberships: {
          where: { isActive: true },
          orderBy: { joinedAt: "asc" },
          take: 1,
        },
      },
    });

    expect(user?.name).toBe("Priya CA");
    expect(await bcrypt.compare(PASSWORD, user!.passwordHash!)).toBe(true);
    expect(user!.memberships[0]).toMatchObject({
      organisationId: ORG,
      role: "ACCOUNTANT",
      isActive: true,
    });
    // Same documented cost factor as /settings/account — the hash records it.
    expect(user!.passwordHash!.split("$")[2]).toBe("12");
    // Nothing about the credential travels back to the browser.
    expect(JSON.stringify(res)).not.toContain(PASSWORD);
    expect(JSON.stringify(res)).not.toContain(user!.passwordHash);
  });

  it("uses the caller's organisation even when the payload names another", async () => {
    await addAccountant({ organisationId: OTHER_ORG, isActive: false });

    const user = await prismaUnsafe.user.findUnique({
      where: { email: ACCOUNTANT_EMAIL },
      include: { memberships: true },
    });
    expect(user!.memberships).toHaveLength(1);
    expect(user!.memberships[0]).toMatchObject({ organisationId: ORG, isActive: true });
  });

  it("refuses an email that already belongs to an account", async () => {
    const res = await addAccountant({ email: `${OTHER_ORG_USER}@example.test` });

    expect(res?.validationErrors).toMatchObject({
      email: { _errors: ["This email is already registered"] },
    });
    // The other trust's membership list is untouched.
    const other = await prismaUnsafe.membership.findMany({
      where: { organisationId: OTHER_ORG },
    });
    expect(other).toHaveLength(1);
    expect(other[0]!.userId).toBe(OTHER_ORG_USER);
  });

  it("rejects a password that fails the shared rules, creating nobody", async () => {
    const res = await addAccountant({ password: "short", confirmPassword: "short" });

    expect(res?.validationErrors).toHaveProperty("password");
    expect(await prismaUnsafe.user.findUnique({ where: { email: ACCOUNTANT_EMAIL } })).toBeNull();
  });

  it("refuses a role that lacks user.invite", async () => {
    getOrgScopeMock.mockResolvedValue(scope("ACCOUNTANT"));

    const res = await addAccountant();

    expect(res?.serverError).toContain("user.invite");
    expect(await prismaUnsafe.user.findUnique({ where: { email: ACCOUNTANT_EMAIL } })).toBeNull();
  });
});

describe("changeMemberRole", () => {
  it("changes a member's role inside the caller's organisation", async () => {
    const staff = (await membership(STAFF_USER, ORG))!;

    const res = await changeMemberRole({ membershipId: staff.id, role: "ACCOUNTANT" });

    expect(res?.data).toEqual({ ok: true });
    expect((await membership(STAFF_USER, ORG))!.role).toBe("ACCOUNTANT");
  });

  it("refuses to demote the last active owner", async () => {
    const owner = (await membership(OWNER_USER, ORG))!;

    const res = await changeMemberRole({ membershipId: owner.id, role: "VIEWER" });

    expect(res?.validationErrors).toBeDefined();
    expect(JSON.stringify(res?.validationErrors)).toContain("last owner");
    expect((await membership(OWNER_USER, ORG))!.role).toBe("OWNER");
  });

  it("allows the demotion once a second owner is in place", async () => {
    await prismaUnsafe.user.create({
      data: {
        id: SECOND_OWNER,
        name: "Co-trustee",
        email: `${SECOND_OWNER}@example.test`,
        memberships: { create: { organisationId: ORG, role: "OWNER" } },
      },
    });
    const owner = (await membership(OWNER_USER, ORG))!;

    const res = await changeMemberRole({ membershipId: owner.id, role: "ACCOUNTANT" });

    expect(res?.data).toEqual({ ok: true });
    expect((await membership(OWNER_USER, ORG))!.role).toBe("ACCOUNTANT");
  });

  it("cannot touch a membership of another organisation", async () => {
    const outsider = (await membership(OTHER_ORG_USER, OTHER_ORG))!;

    const res = await changeMemberRole({ membershipId: outsider.id, role: "VIEWER" });

    expect(res?.data).toBeUndefined();
    expect((await membership(OTHER_ORG_USER, OTHER_ORG))!.role).toBe("OWNER");
  });

  it("refuses a role that lacks user.role.change", async () => {
    getOrgScopeMock.mockResolvedValue(scope("ADMIN"));
    const staff = (await membership(STAFF_USER, ORG))!;

    const res = await changeMemberRole({ membershipId: staff.id, role: "OWNER" });

    expect(res?.serverError).toContain("user.role.change");
    expect((await membership(STAFF_USER, ORG))!.role).toBe("VIEWER");
  });
});

describe("setMemberAccess", () => {
  it("takes access away without deleting the membership, and gives it back", async () => {
    const staff = (await membership(STAFF_USER, ORG))!;

    expect((await setMemberAccess({ membershipId: staff.id, isActive: false }))?.data).toEqual({
      ok: true,
    });
    expect((await membership(STAFF_USER, ORG))!.isActive).toBe(false);

    expect((await setMemberAccess({ membershipId: staff.id, isActive: true }))?.data).toEqual({
      ok: true,
    });
    expect((await membership(STAFF_USER, ORG))!.isActive).toBe(true);
  });

  it("refuses to deactivate the last active owner", async () => {
    const owner = (await membership(OWNER_USER, ORG))!;

    const res = await setMemberAccess({ membershipId: owner.id, isActive: false });

    expect(res?.validationErrors).toBeDefined();
    expect(JSON.stringify(res?.validationErrors)).toContain("last owner");
    expect((await membership(OWNER_USER, ORG))!.isActive).toBe(true);
  });

  it("cannot deactivate a membership of another organisation", async () => {
    const outsider = (await membership(OTHER_ORG_USER, OTHER_ORG))!;

    const res = await setMemberAccess({ membershipId: outsider.id, isActive: false });

    expect(res?.data).toBeUndefined();
    expect((await membership(OTHER_ORG_USER, OTHER_ORG))!.isActive).toBe(true);
  });

  it("refuses a role that lacks user.deactivate", async () => {
    getOrgScopeMock.mockResolvedValue(scope("ACCOUNTANT"));
    const staff = (await membership(STAFF_USER, ORG))!;

    const res = await setMemberAccess({ membershipId: staff.id, isActive: false });

    expect(res?.serverError).toContain("user.deactivate");
    expect((await membership(STAFF_USER, ORG))!.isActive).toBe(true);
  });
});
