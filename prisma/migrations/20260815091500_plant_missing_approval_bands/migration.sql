-- src/lib/services/approval-policy.ts matches ApprovalPolicy bands half-open —
-- [minAmount, maxAmount), a null maxAmount unbounded — across an
-- organisation's active EXPENSE rows, and returns null when none of them
-- covers the amount. approveExpense in src/app/(app)/expenses/actions.ts
-- turns that null into a thrown "No approval policy covers ₹X", so an amount
-- no band covers is an amount nobody in the organisation can approve.
--
-- prisma/seed.ts is the only writer of ApprovalPolicy — approval-policy.ts
-- reads the bands and nothing else in src touches the table — and seeding is
-- a manual command. railway.json's preDeployCommand runs
-- `npx prisma migrate deploy` and nothing else, so an organisation that never
-- had a seed run has no bands and no way to acquire them.

-- 1. No active EXPENSE band at all: every amount falls through. The three
-- tiers below are the ones prisma/seed.ts:453 plants — an accountant clears
-- below ₹10,000.01, an admin below ₹1,00,000.01, an owner anything above —
-- chained ceiling-to-floor so every amount from zero upwards matches exactly
-- one band.
--
-- Inactive rows are not a tiling: the matcher does not read them, so an
-- organisation holding only inactive rows can approve nothing and gets the
-- same three bands. Those rows stay where they are, and a later `db:seed:prod`
-- run still plants no duplicate, because its guard (prisma/seed.ts:469) looks
-- for a row of the same role without regard to isActive.
INSERT INTO "ApprovalPolicy" (
  "id", "organisationId", "scope", "minAmount", "maxAmount", "requiredRole", "level", "isActive"
)
SELECT
  gen_random_uuid()::text,
  o.id,
  'EXPENSE'::"ApprovalScope",
  b.min_amount,
  b.max_amount,
  b.required_role,
  1,
  true
FROM "Organisation" o
CROSS JOIN (VALUES
  (0::numeric(18, 2),         10000.01::numeric(18, 2),  'ACCOUNTANT'::"OrgRole"),
  (10000.01::numeric(18, 2),  100000.01::numeric(18, 2), 'ADMIN'::"OrgRole"),
  (100000.01::numeric(18, 2), NULL::numeric(18, 2),      'OWNER'::"OrgRole")
) AS b(min_amount, max_amount, required_role)
WHERE NOT EXISTS (
  SELECT 1
  FROM "ApprovalPolicy" p
  WHERE p."organisationId" = o.id
    AND p.scope = 'EXPENSE'
    AND p."isActive"
);

-- 2. Every active band capped: the amounts above the highest ceiling fall
-- through. A new band takes them, floored at that ceiling — ceilings are
-- exclusive, so it starts exactly where cover ran out — and requiring OWNER.
--
-- The other way to cover them is to clear the capped band's own maxAmount,
-- which hands whatever role that band names authority over every amount above
-- the cap. Where that role is ACCOUNTANT it is an unbounded grant to a junior
-- role, made on an organisation nobody can query to see which role it landed
-- on. A separate OWNER band instead leaves every amount that already resolved
-- to a role resolving to the same role, and gives the amounts that resolved to
-- none the strictest role there is. The third option, leaving them uncovered,
-- keeps approveExpense throwing on large vouchers with no way to fix it from
-- the application.
--
-- bool_and is the test for "no unbounded band": one active row with a null
-- maxAmount already covers everything from its own floor upwards. This insert
-- creates one, so the test is false on a second run — and statement 1 above
-- has already given a bandless organisation its own, so it is false for those
-- too.
INSERT INTO "ApprovalPolicy" (
  "id", "organisationId", "scope", "minAmount", "maxAmount", "requiredRole", "level", "isActive"
)
SELECT
  gen_random_uuid()::text,
  "organisationId",
  'EXPENSE'::"ApprovalScope",
  MAX("maxAmount"),
  NULL::numeric(18, 2),
  'OWNER'::"OrgRole",
  1,
  true
FROM "ApprovalPolicy"
WHERE scope = 'EXPENSE'
  AND "isActive"
GROUP BY "organisationId"
HAVING bool_and("maxAmount" IS NOT NULL);
