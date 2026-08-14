import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { OrgRole } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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

/**
 * This file works in a Postgres schema of its own.
 *
 * The migration under test plants rows for every organisation that has no
 * active EXPENSE band — which is what a deploy-time repair has to do, and why
 * it is not narrowed to one tenant. Vitest runs test files in parallel workers
 * against a single database, so running it in the schema the rest of the suite
 * uses would hand bands to organisations another file had just created without
 * them: `expenses/actions.test.ts` asserts that an amount above a capped top
 * band has no approver, and this migration's whole purpose is to give it one.
 *
 * Pointing DATABASE_URL at a private schema before `@/lib/db/prisma` is
 * imported moves this file's whole world into it — the client below and
 * `requiredApprovalRole` both resolve their tables through that one connection
 * string.
 *
 * `beforeAll` drops and rebuilds the schema on every run, so a crashed run
 * leaves nothing behind that the next one has to reckon with. The rows of the
 * last run stay in the database until then, which is what you want to read
 * when one of these fails.
 */
const SCHEMA = "approval_band_safety_test";
const schemaUrl = new URL(process.env.DATABASE_URL ?? "");
schemaUrl.searchParams.set("schema", SCHEMA);
process.env.DATABASE_URL = schemaUrl.href;

const { prismaUnsafe } = await import("@/lib/db/prisma");
const { requiredApprovalRole } = await import("@/lib/services/approval-policy");

const MIGRATION = "20260815091500_plant_missing_approval_bands";

/**
 * Runs the migration file the way `prisma migrate deploy` would, minus the
 * bookkeeping. Prisma's raw client rejects multi-statement queries, so the file
 * is split on `;` once its comment lines are dropped; it puts no semicolon or
 * `--` inside a string literal.
 */
async function applyMigration() {
  const file = path.join(process.cwd(), "prisma", "migrations", MIGRATION, "migration.sql");
  const statements = readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const statement of statements) {
    await prismaUnsafe.$executeRawUnsafe(statement);
  }
}

/** No bands at all — the organisation a deploy would strand. */
const ORG_NONE = "test-org-band-safety-none";
/** The tiling prisma/seed.ts plants, already correct. */
const ORG_TILED = "test-org-band-safety-tiled";
/** Every band capped, so the amounts above the highest ceiling have no role. */
const ORG_CAPPED = "test-org-band-safety-capped";
/** Bands exist but none is active, so the matcher reads nothing. */
const ORG_INACTIVE = "test-org-band-safety-inactive";
const ALL_ORGS = [ORG_NONE, ORG_TILED, ORG_CAPPED, ORG_INACTIVE];

const SEED_BANDS = [
  { minAmount: "0", maxAmount: "10000.01", requiredRole: "ACCOUNTANT" as const },
  { minAmount: "10000.01", maxAmount: "100000.01", requiredRole: "ADMIN" as const },
  { minAmount: "100000.01", maxAmount: null, requiredRole: "OWNER" as const },
];

/** The tiling the migration plants, as `bandsOf` reports it. */
const SEEDED_TILING = [
  { minAmount: "0.00", maxAmount: "10000.01", requiredRole: "ACCOUNTANT", level: 1, isActive: true },
  {
    minAmount: "10000.01",
    maxAmount: "100000.01",
    requiredRole: "ADMIN",
    level: 1,
    isActive: true,
  },
  { minAmount: "100000.01", maxAmount: null, requiredRole: "OWNER", level: 1, isActive: true },
];

/**
 * The amounts an approver meets at the tier boundaries, plus the two ends of
 * Decimal(18, 2) as the money columns hold it. Every one of them must name a
 * role, or `approveExpense` throws on the voucher.
 */
const PROBES = ["0.01", "9999.99", "10000", "10000.01", "100000", "100000.01", "99999999.99"];

const UNDER_SEEDED_TILING: Record<string, OrgRole> = {
  "0.01": "ACCOUNTANT",
  "9999.99": "ACCOUNTANT",
  "10000": "ACCOUNTANT",
  "10000.01": "ADMIN",
  "100000": "ADMIN",
  "100000.01": "OWNER",
  "99999999.99": "OWNER",
};

/**
 * `prisma` auto-scopes ApprovalPolicy to the session's organisation, so
 * `requiredApprovalRole` reads the bands of whichever org the scope names —
 * not the id passed to it. Both say the same thing here.
 */
async function probeAll(organisationId: string): Promise<Record<string, OrgRole | null>> {
  getOrgScopeMock.mockResolvedValue({
    userId: "test-user-band-safety",
    organisationId,
    organisationName: "Band Safety Trust",
    role: "OWNER",
  });
  const out: Record<string, OrgRole | null> = {};
  for (const amount of PROBES) {
    out[amount] = await requiredApprovalRole(organisationId, amount);
  }
  return out;
}

async function bandsOf(organisationId: string) {
  const rows = await prismaUnsafe.approvalPolicy.findMany({
    where: { organisationId, scope: "EXPENSE" },
    orderBy: [{ minAmount: "asc" }, { requiredRole: "asc" }],
  });
  return rows.map((r) => ({
    minAmount: r.minAmount.toFixed(2),
    maxAmount: r.maxAmount === null ? null : r.maxAmount.toFixed(2),
    requiredRole: r.requiredRole as string,
    level: r.level,
    isActive: r.isActive,
  }));
}

/** Rows with their ids, so a rewritten or replaced row shows up as a change. */
async function rowsWithIds() {
  return prismaUnsafe.approvalPolicy.findMany({
    where: { organisationId: { in: ALL_ORGS } },
    orderBy: { id: "asc" },
  });
}

async function plantBands(
  organisationId: string,
  bands: { minAmount: string; maxAmount: string | null; requiredRole: OrgRole }[],
  isActive = true,
) {
  for (const b of bands) {
    await prismaUnsafe.approvalPolicy.create({
      data: { organisationId, scope: "EXPENSE", ...b, level: 1, isActive },
    });
  }
}

/**
 * The state of the fixture before the migration has ever touched it. Captured
 * once, because every test below applies the migration — that it can be
 * applied repeatedly is the property under test — and the pre-migration rows
 * are gone the moment the first one does.
 */
let before: {
  bands: Record<string, Awaited<ReturnType<typeof bandsOf>>>;
  roles: Record<string, Record<string, OrgRole | null>>;
};

beforeAll(async () => {
  await prismaUnsafe.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
  // Inherits the rewritten DATABASE_URL, so it builds the private schema and
  // not the one the rest of the suite works in. This is also how the migration
  // first reaches the schema — against no organisations, before the fixture
  // exists, which is the run that must plant nothing.
  execFileSync(
    path.join(process.cwd(), "node_modules", ".bin", "prisma"),
    ["migrate", "deploy"],
    { stdio: "pipe" },
  );

  for (const [id, name, pan] of [
    [ORG_NONE, "Band Safety Bandless Trust", "AAATB7771A"],
    [ORG_TILED, "Band Safety Tiled Trust", "AAATB7772A"],
    [ORG_CAPPED, "Band Safety Capped Trust", "AAATB7773A"],
    [ORG_INACTIVE, "Band Safety Inactive Trust", "AAATB7774A"],
  ] as const) {
    await prismaUnsafe.organisation.create({ data: { id, name, pan } });
  }

  await plantBands(ORG_TILED, SEED_BANDS);
  // The seeded tiers with the owner's unbounded band missing: everything from
  // ₹1,00,000.01 up is covered by nothing.
  await plantBands(ORG_CAPPED, SEED_BANDS.slice(0, 2));
  await plantBands(ORG_INACTIVE, SEED_BANDS, false);

  before = {
    bands: {
      [ORG_NONE]: await bandsOf(ORG_NONE),
      [ORG_TILED]: await bandsOf(ORG_TILED),
      [ORG_CAPPED]: await bandsOf(ORG_CAPPED),
      [ORG_INACTIVE]: await bandsOf(ORG_INACTIVE),
    },
    roles: {
      [ORG_NONE]: await probeAll(ORG_NONE),
      [ORG_TILED]: await probeAll(ORG_TILED),
      [ORG_CAPPED]: await probeAll(ORG_CAPPED),
      [ORG_INACTIVE]: await probeAll(ORG_INACTIVE),
    },
  };
});

afterAll(async () => {
  await prismaUnsafe.$disconnect();
});

describe("approval bands after the deploy-safety migration", () => {
  it("plants the seeded tiling for an organisation that has none", async () => {
    expect(before.bands[ORG_NONE]).toEqual([]);
    expect(before.roles[ORG_NONE]).toEqual({
      "0.01": null,
      "9999.99": null,
      "10000": null,
      "10000.01": null,
      "100000": null,
      "100000.01": null,
      "99999999.99": null,
    });

    await applyMigration();

    expect(await bandsOf(ORG_NONE)).toEqual(SEEDED_TILING);
    expect(await probeAll(ORG_NONE)).toEqual(UNDER_SEEDED_TILING);
  });

  it("treats an organisation whose every band is inactive as bandless", async () => {
    // The matcher filters on isActive, so these rows cover nothing.
    expect(before.roles[ORG_INACTIVE]).toEqual(before.roles[ORG_NONE]);

    await applyMigration();

    expect(await probeAll(ORG_INACTIVE)).toEqual(UNDER_SEEDED_TILING);
    // The inactive rows are left standing beside the three new ones.
    const bands = await bandsOf(ORG_INACTIVE);
    expect(bands.filter((b) => !b.isActive)).toEqual(before.bands[ORG_INACTIVE]);
    expect(bands.filter((b) => b.isActive)).toEqual(SEEDED_TILING);
  });

  it("gives the amounts above a capped top band to OWNER and moves no other amount", async () => {
    // Nothing in the fixture is unbounded, which is the shape that strands the
    // amounts above the highest ceiling.
    expect(before.bands[ORG_CAPPED].every((b) => b.maxAmount !== null)).toBe(true);
    expect(before.roles[ORG_CAPPED]["100000.01"]).toBeNull();
    expect(before.roles[ORG_CAPPED]["99999999.99"]).toBeNull();

    await applyMigration();

    // The existing rows stand as they were; the cover is a fourth band that
    // starts at the ceiling they reached.
    const bands = await bandsOf(ORG_CAPPED);
    expect(bands.slice(0, 2)).toEqual(before.bands[ORG_CAPPED]);
    expect(bands[2]).toEqual({
      minAmount: "100000.01",
      maxAmount: null,
      requiredRole: "OWNER",
      level: 1,
      isActive: true,
    });

    const after = await probeAll(ORG_CAPPED);
    expect(after["100000.01"]).toBe("OWNER");
    expect(after["99999999.99"]).toBe("OWNER");
    // No amount that already had an approver gets a cheaper one.
    for (const amount of PROBES) {
      const was = before.roles[ORG_CAPPED][amount];
      if (was !== null) expect([amount, after[amount]]).toEqual([amount, was]);
    }
  });

  it("leaves an organisation that is already tiled alone", async () => {
    const rows = await prismaUnsafe.approvalPolicy.findMany({
      where: { organisationId: ORG_TILED },
      orderBy: { id: "asc" },
    });

    await applyMigration();

    expect(
      await prismaUnsafe.approvalPolicy.findMany({
        where: { organisationId: ORG_TILED },
        orderBy: { id: "asc" },
      }),
    ).toEqual(rows);
    expect(await bandsOf(ORG_TILED)).toEqual(before.bands[ORG_TILED]);
    expect(await probeAll(ORG_TILED)).toEqual(UNDER_SEEDED_TILING);
  });

  it("is a no-op on a second run", async () => {
    await applyMigration();
    const rows = await rowsWithIds();

    await applyMigration();

    expect(await rowsWithIds()).toEqual(rows);
    for (const org of ALL_ORGS) {
      expect([org, await probeAll(org)]).toEqual([org, UNDER_SEEDED_TILING]);
    }
  });
});
