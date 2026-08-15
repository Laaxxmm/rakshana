import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The masking contract every Server Action inherits.
 *
 * In production a caller sees exactly two kinds of message: the ones an action
 * chose to write for them (`UserFacingError`, and a permission denial, which is
 * one by construction) and a single generic line for everything else. The
 * "everything else" half is the one that matters here — a Prisma error names
 * the model, the constraint and often the id it failed on, and a plain
 * exception carries whatever a library put in it. Neither belongs on a screen
 * in a trust office.
 *
 * Outside production the real message is passed through, because the person
 * reading it is the developer who caused it.
 */

vi.mock("@/auth", () => ({ auth: async () => null }));

const { Prisma } = await import("@prisma/client");
const { handleServerError, UserFacingError } = await import("./safe-action");
const { PermissionDeniedError } = await import("@/lib/auth/require-permission");

const GENERIC = "Something went wrong. Please try again.";

/** `NODE_ENV` is read at throw time, so it is set per case and put back after. */
function withNodeEnv<T>(value: string, fn: () => T): T {
  const env = process.env as Record<string, string | undefined>;
  const before = env["NODE_ENV"];
  env["NODE_ENV"] = value;
  try {
    return fn();
  } finally {
    env["NODE_ENV"] = before;
  }
}

afterEach(() => {
  expect(process.env.NODE_ENV).not.toBe("production");
});

/** What a scoped `update` throws when the id belongs to another organisation. */
const prismaNotFound = () =>
  new Prisma.PrismaClientKnownRequestError(
    "An operation failed because it depends on one or more records that were required but not found. No record was found for an update.",
    { code: "P2025", clientVersion: "6.19.3", meta: { modelName: "BankAccount" } },
  );

describe("handleServerError in production", () => {
  it("forwards a refusal the action wrote for the user", () => {
    const message = "Cannot deactivate the last active bank account.";
    expect(withNodeEnv("production", () => handleServerError(new UserFacingError(message)))).toBe(
      message,
    );
  });

  it("names the permission on a denial", () => {
    const out = withNodeEnv("production", () =>
      handleServerError(new PermissionDeniedError("expense.reject", "VIEWER")),
    );
    expect(out).toContain("expense.reject");
    // The role the caller holds is theirs to know; the message says what is
    // missing, not who they are.
    expect(out).not.toContain("VIEWER");
  });

  it("masks a Prisma error, model name and all", () => {
    const err = prismaNotFound();
    const out = withNodeEnv("production", () => handleServerError(err));
    expect(out).toBe(GENERIC);
    expect(out).not.toContain("BankAccount");
    expect(out).not.toContain("P2025");
  });

  it("masks a plain exception", () => {
    const err = new Error("connect ECONNREFUSED 10.0.0.7:5432");
    const out = withNodeEnv("production", () => handleServerError(err));
    expect(out).toBe(GENERIC);
    expect(out).not.toContain("10.0.0.7");
  });
});

describe("handleServerError outside production", () => {
  it("passes the real message through for the developer reading it", () => {
    expect(withNodeEnv("test", () => handleServerError(prismaNotFound()))).toContain(
      "No record was found for an update",
    );
    expect(withNodeEnv("development", () => handleServerError(new Error("boom")))).toBe("boom");
  });
});
