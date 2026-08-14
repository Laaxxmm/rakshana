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

const { prismaUnsafe } = await import("@/lib/db/prisma");
const { actionFieldErrors } = await import("@/lib/actions/action-error");
const { changePassword } = await import("./actions");

const ORG = "test-org-account-actions";
const USER = "test-user-account-actions";
const OTHER_USER = "test-user-account-actions-other";
const OLD_PASSWORD = "OldPassw0rd!2026";
const NEW_PASSWORD = "NewPassw0rd!2026";

function scope(userId = USER) {
  return {
    userId,
    organisationId: ORG,
    organisationName: "Test Trust",
    role: "OWNER" as const,
  };
}

async function hashOf(userId: string) {
  const row = await prismaUnsafe.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });
  return row?.passwordHash ?? null;
}

async function cleanup() {
  await prismaUnsafe.user.deleteMany({ where: { id: { in: [USER, OTHER_USER] } } });
}

beforeAll(async () => {
  await cleanup();
  // A second user: proves the action never touches anyone but the session user.
  await prismaUnsafe.user.create({
    data: {
      id: OTHER_USER,
      email: `${OTHER_USER}@example.test`,
      name: "Other member",
      passwordHash: await bcrypt.hash(OLD_PASSWORD, 4),
    },
  });
});

afterAll(cleanup);

beforeEach(async () => {
  getOrgScopeMock.mockReset();
  getOrgScopeMock.mockResolvedValue(scope());
  await prismaUnsafe.user.deleteMany({ where: { id: USER } });
  await prismaUnsafe.user.create({
    data: {
      id: USER,
      email: `${USER}@example.test`,
      name: "Test member",
      // Cost 4 keeps the suite quick; the action always writes at cost 12.
      passwordHash: await bcrypt.hash(OLD_PASSWORD, 4),
    },
  });
});

describe("changePassword", () => {
  it("rejects a wrong current password without touching the stored hash", async () => {
    const before = await hashOf(USER);

    const res = await changePassword({
      currentPassword: "NotThePassw0rd!",
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });

    expect(res?.validationErrors).toMatchObject({
      currentPassword: { _errors: ["Current password is incorrect"] },
    });
    expect(res?.data).toBeUndefined();
    expect(await hashOf(USER)).toBe(before);
    expect(await bcrypt.compare(OLD_PASSWORD, before!)).toBe(true);
    // PasswordForm feeds the same result through actionFieldErrors and calls
    // setError with the keys it returns, so the message has to land on a real
    // form field name rather than in a generic toast.
    expect(actionFieldErrors(res)).toEqual({
      currentPassword: "Current password is incorrect",
    });
  });

  it("gives the same field error when the account has no password set", async () => {
    await prismaUnsafe.user.update({ where: { id: USER }, data: { passwordHash: null } });

    const res = await changePassword({
      currentPassword: OLD_PASSWORD,
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });

    expect(res?.validationErrors).toMatchObject({
      currentPassword: { _errors: ["Current password is incorrect"] },
    });
    expect(await hashOf(USER)).toBeNull();
  });

  it("rejects a new password that fails the schema", async () => {
    const before = await hashOf(USER);

    const res = await changePassword({
      currentPassword: OLD_PASSWORD,
      newPassword: "short",
      confirmPassword: "short",
    });

    expect(res?.validationErrors).toHaveProperty("newPassword");
    expect(res?.data).toBeUndefined();
    expect(await hashOf(USER)).toBe(before);
  });

  it("rejects a confirmation that does not match", async () => {
    const res = await changePassword({
      currentPassword: OLD_PASSWORD,
      newPassword: NEW_PASSWORD,
      confirmPassword: `${NEW_PASSWORD}x`,
    });

    expect(res?.validationErrors).toHaveProperty("confirmPassword");
    expect(await bcrypt.compare(OLD_PASSWORD, (await hashOf(USER))!)).toBe(true);
  });

  it("writes a hash that verifies against the new password and not the old", async () => {
    const res = await changePassword({
      currentPassword: OLD_PASSWORD,
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });

    expect(res?.data).toEqual({ ok: true });
    expect(res?.validationErrors).toBeUndefined();
    expect(res?.serverError).toBeUndefined();

    const after = await hashOf(USER);
    expect(after).not.toBeNull();
    expect(await bcrypt.compare(NEW_PASSWORD, after!)).toBe(true);
    expect(await bcrypt.compare(OLD_PASSWORD, after!)).toBe(false);
    // Cost factor stays on the documented 12 — the hash records its own.
    expect(after!.split("$")[2]).toBe("12");
    // Nothing in the response echoes either password back.
    expect(JSON.stringify(res)).not.toContain(NEW_PASSWORD);
    expect(JSON.stringify(res)).not.toContain(OLD_PASSWORD);
  });

  it("only rotates the session user's own row", async () => {
    const otherBefore = await hashOf(OTHER_USER);

    await changePassword({
      currentPassword: OLD_PASSWORD,
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });

    expect(await hashOf(OTHER_USER)).toBe(otherBefore);
  });

  it("refuses a caller whose role lacks the permission", async () => {
    getOrgScopeMock.mockResolvedValue({ ...scope(), role: "NOT_A_ROLE" });

    const res = await changePassword({
      currentPassword: OLD_PASSWORD,
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });

    expect(res?.serverError).toContain("user.password.change");
    expect(await bcrypt.compare(OLD_PASSWORD, (await hashOf(USER))!)).toBe(true);
  });
});
