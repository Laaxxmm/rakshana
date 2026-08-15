import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The scope helper drags NextAuth in, and this suite talks to the database
// directly — it never goes through a session.
vi.mock("@/lib/auth/scope", () => ({ getOrgScope: vi.fn() }));

/**
 * This file works in a Postgres schema of its own.
 *
 * The migration under test plants rows for every organisation that has no
 * catalogue — which is what a deploy-time backfill has to do, and why it is not
 * narrowed to one tenant. Vitest runs test files in parallel workers against a
 * single database, so replaying it in the schema the rest of the suite uses
 * reaches their organisations too: it hands the fixture of
 * `src/lib/banking/primary.test.ts` two bank accounts it never created, one of
 * them primary, and it fails outright with `23503` when a sibling file deletes
 * an organisation between the `FROM "Organisation"` scan and the commit — the
 * parent row the insert names is gone by the time the key is checked.
 *
 * Pointing DATABASE_URL at a private schema before `@/lib/db/prisma` is
 * imported moves this file's whole world into it. The migration statements stay
 * verbatim; there is simply nothing but this fixture for them to reach.
 *
 * `beforeAll` drops and rebuilds the schema on every run, so a crashed run
 * leaves nothing behind that the next one has to reckon with. The rows of the
 * last run stay in the database until then, which is what you want to read when
 * one of these fails.
 */
const SCHEMA = "catalogue_test";
const schemaUrl = new URL(process.env.DATABASE_URL ?? "");
schemaUrl.searchParams.set("schema", SCHEMA);
process.env.DATABASE_URL = schemaUrl.href;

const { prismaUnsafe } = await import("@/lib/db/prisma");
const { SPONSORSHIP_CATALOGUE, BANK_ACCOUNTS } = await import(
  "@/lib/constants/sponsorship-catalogue"
);

/**
 * The tripwire src/lib/constants/sponsorship-catalogue.ts describes.
 *
 * Two things plant the catalogue and only one of them runs on Railway: the
 * seed is a manual command, the migration is the whole of the deploy. So the
 * frozen SQL copy is what production actually gets, and if a price is revised
 * in the constant without a migration carrying it, production keeps the old
 * figure and quotes it to donors. These tests apply the migration SQL to a
 * clean organisation and assert what it plants equals the constant — so that
 * drift fails here rather than on a brochure.
 */

const MIGRATION = join(
  process.cwd(),
  "prisma/migrations/20260815120000_plant_sponsorship_catalogue/migration.sql",
);

const EMPTY_ORG = "test-org-catalogue-empty";
const EDITED_ORG = "test-org-catalogue-edited";

async function applyMigration() {
  // The real file, statement by statement — Postgres refuses more than one
  // command per prepared statement, which is the only reason this is not a
  // single call. Comment lines are stripped first so a `;` inside prose
  // cannot split a statement in half.
  const sql = readFileSync(MIGRATION, "utf8")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  for (const statement of sql.split(";").map((s) => s.trim()).filter(Boolean)) {
    await prismaUnsafe.$executeRawUnsafe(statement);
  }
}

beforeAll(async () => {
  await prismaUnsafe.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
  // Inherits the rewritten DATABASE_URL, so it builds the private schema and
  // not the one the rest of the suite works in. This is also how the migration
  // first reaches the schema — against no organisations, before the fixture
  // exists, which is the run that must plant nothing.
  execFileSync(join(process.cwd(), "node_modules", ".bin", "prisma"), ["migrate", "deploy"], {
    stdio: "pipe",
  });

  await prismaUnsafe.organisation.create({
    data: { id: EMPTY_ORG, name: "Catalogue Empty Trust" },
  });
  await prismaUnsafe.organisation.create({
    data: { id: EDITED_ORG, name: "Catalogue Edited Trust" },
  });
  // This trust has already revised its own menu. Nothing a deploy does may
  // rewrite it — the prices are what it quotes to donors.
  await prismaUnsafe.sponsorshipItem.create({
    data: {
      organisationId: EDITED_ORG,
      category: "CHILDREN_EDUCATION",
      label: "School bag & shoes per child",
      amount: "1750",
      unitNoun: "child",
      sortOrder: 0,
    },
  });
});

afterAll(async () => {
  await prismaUnsafe.$disconnect();
});

describe("the sponsorship catalogue a deploy plants", () => {
  it("is exactly the constant the application reads", async () => {
    await applyMigration();

    const planted = await prismaUnsafe.sponsorshipItem.findMany({
      where: { organisationId: EMPTY_ORG },
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
      select: { category: true, label: true, amount: true, unitNoun: true, sortOrder: true },
    });

    const expected = [...SPONSORSHIP_CATALOGUE]
      .sort((a, b) => a.category.localeCompare(b.category) || a.sortOrder - b.sortOrder)
      .map((r) => ({ ...r, amount: r.amount }));

    expect(
      planted.map((p) => ({ ...p, amount: p.amount.toString() })),
      "the migration and the constant disagree — production would quote the wrong price",
    ).toEqual(expected);
  });

  it("plants the brochure's bank accounts, one of them primary", async () => {
    await applyMigration();

    const banks = await prismaUnsafe.bankAccount.findMany({
      where: { organisationId: EMPTY_ORG },
      orderBy: { accountNumber: "asc" },
      select: { bankName: true, accountNumber: true, ifsc: true, isPrimary: true },
    });

    expect(banks.map((b) => b.accountNumber).sort()).toEqual(
      BANK_ACCOUNTS.map((b) => b.accountNumber).sort(),
    );
    expect(banks.filter((b) => b.isPrimary)).toHaveLength(1);
    for (const b of banks) {
      const source = BANK_ACCOUNTS.find((s) => s.accountNumber === b.accountNumber)!;
      expect(b.ifsc).toBe(source.ifsc);
      expect(b.bankName).toBe(source.bankName);
    }
  });

  it("leaves a trust that has revised its own prices alone", async () => {
    await applyMigration();

    const items = await prismaUnsafe.sponsorshipItem.findMany({
      where: { organisationId: EDITED_ORG },
    });

    // One row, still theirs, still at the price they set — not seventeen at
    // the brochure's.
    expect(items).toHaveLength(1);
    expect(items[0]!.amount.toString()).toBe("1750");
  });

  it("changes nothing when the deploy runs again", async () => {
    await applyMigration();
    const first = await prismaUnsafe.sponsorshipItem.findMany({
      where: { organisationId: EMPTY_ORG },
      orderBy: { id: "asc" },
    });

    await applyMigration();
    const second = await prismaUnsafe.sponsorshipItem.findMany({
      where: { organisationId: EMPTY_ORG },
      orderBy: { id: "asc" },
    });

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
