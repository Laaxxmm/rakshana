-- ApprovalPolicy bands are matched half-open — [minAmount, maxAmount) — by
-- src/lib/services/approval-policy.ts. Rows carrying an inclusive ceiling,
-- with the next band's floor a whole rupee above it, lose their own ceiling
-- amount under that matcher: a ₹10,000 voucher drops out of the tier that
-- ends at ₹10,000 and escalates to the tier above, and the same voucher an
-- accountant could clear starts demanding a trustee.
--
-- A gap between one band's ceiling and the next band's floor is the signature
-- of an inclusive ceiling: half-open bands chain ceiling-to-floor, so an
-- organisation already tiled that way has no gaps and no row here matches it.
-- Each gap closes at one paisa above the lower ceiling, the smallest step
-- Decimal(18,2) holds. The lower band therefore keeps every amount it already
-- cleared, and the orphaned paise between the two bands — an amount no band
-- covered, so nobody could approve it — go to the upper, stricter band rather
-- than widening a junior role's authority.
--
-- Ceilings move by that one paisa and by nothing else, and only where a gap
-- exists. Nothing in the application writes ApprovalPolicy — prisma/seed.ts
-- plants the missing tiers and src/lib/services/approval-policy.ts reads
-- them, and there is no settings screen for bands — so any row that differs
-- from the seeded defaults was put there by hand in the database or by an
-- earlier migration. Whatever its provenance, a row already tiled
-- ceiling-to-floor is not touched. Idempotent — once a pair meets, its gap
-- test is false forever.
--
-- Only active rows are considered. They are the ones the matcher walks, and
-- an inactive row sitting between two active ones is not the neighbour of
-- either.
WITH ordered AS (
  SELECT
    id,
    "maxAmount",
    LEAD("minAmount") OVER w AS next_min,
    LEAD(id)          OVER w AS next_id
  FROM "ApprovalPolicy"
  WHERE "isActive"
  WINDOW w AS (PARTITION BY "organisationId", scope ORDER BY "minAmount", id)
),
gaps AS (
  SELECT id AS lower_id, next_id AS upper_id, "maxAmount" + 0.01 AS boundary
  FROM ordered
  WHERE "maxAmount" IS NOT NULL
    AND next_min IS NOT NULL
    AND "maxAmount" < next_min
),
edits AS (
  SELECT lower_id AS id, boundary AS new_max, NULL::numeric(18, 2) AS new_min FROM gaps
  UNION ALL
  SELECT upper_id AS id, NULL::numeric(18, 2) AS new_max, boundary AS new_min FROM gaps
)
UPDATE "ApprovalPolicy" p
SET "maxAmount" = COALESCE(e.new_max, p."maxAmount"),
    "minAmount" = COALESCE(e.new_min, p."minAmount")
FROM (
  SELECT id, MAX(new_max) AS new_max, MAX(new_min) AS new_min FROM edits GROUP BY id
) e
WHERE e.id = p.id;
