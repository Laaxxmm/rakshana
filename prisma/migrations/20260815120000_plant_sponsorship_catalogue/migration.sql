-- The brochure donation menu, and the two bank accounts printed beside it.
--
-- These already existed in prisma/seed.ts, and were still missing from
-- production: the seed is a manual command and Railway's preDeployCommand is
-- `npx prisma migrate deploy` and nothing else. So the quick-select picker on
-- /donations/new rendered an empty list for the trust that asked for it.
--
-- The rows are a frozen copy of src/lib/constants/sponsorship-catalogue.ts.
-- SQL cannot import TypeScript, and an applied migration can never be edited
-- because its checksum is recorded — so the two can drift. The tripwire is
-- src/lib/db/catalogue.test.ts, which migrates a clean schema and asserts the
-- rows it holds are exactly that constant. Revising a price means editing the
-- constant AND adding a migration that carries it; the test fails otherwise,
-- which is the same statement as "production would not have the new price".

-- Plant only where an organisation has no catalogue at all. Prices are
-- editable, so rewriting rows here would silently undo a trust's own revision
-- on the next deploy.
INSERT INTO "SponsorshipItem"
  ("id", "organisationId", "category", "label", "amount", "unitNoun", "allowsQuantity", "sortOrder", "isActive", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text, o."id", v.category::"SponsorshipCategory", v.label, v.amount, v."unitNoun", true, v."sortOrder", true, NOW(), NOW()
FROM "Organisation" o
CROSS JOIN (VALUES
    ('CHILDREN_EDUCATION', 'Monthly sponsorship', 800, 'month', 0),
    ('CHILDREN_EDUCATION', 'School bag & shoes per child', 1500, 'child', 1),
    ('CHILDREN_EDUCATION', 'Pair of uniform set per child', 3250, 'child', 2),
    ('CHILDREN_EDUCATION', 'Stationery for a year per child', 3450, 'child', 3),
    ('CHILDREN_EDUCATION', 'Weekly fruits & snacks', 3600, 'week', 4),
    ('CHILDREN_EDUCATION', 'Basic needs for our children', 6000, 'child', 5),
    ('CHILDREN_EDUCATION', 'One-time meal for 36 children', 7000, 'meal', 6),
    ('CHILDREN_EDUCATION', 'Medical & health care for 36 children', 8000, 'month', 7),
    ('CHILDREN_EDUCATION', 'School admission per child', 30500, 'child', 8),
    ('CHILDREN_EDUCATION', 'One year education sponsorship for a child', 46000, 'child', 9),
    ('CHILDREN_EDUCATION', 'Yearly sponsorship for a child (education, medical, nutrition)', 95000, 'child', 10),
    ('COMMUNITY_TRAINING', 'Wheelchair for a disabled child', 7500, 'wheelchair', 0),
    ('COMMUNITY_TRAINING', 'One sewing machine per woman', 8500, 'woman', 1),
    ('COMMUNITY_TRAINING', 'Tuition fees for 120 children per month', 10000, 'month', 2),
    ('COMMUNITY_TRAINING', 'Computer training and English coaching', 10000, 'batch', 3),
    ('COMMUNITY_TRAINING', 'Special training classes for women', 15000, 'batch', 4),
    ('COMMUNITY_TRAINING', 'Mid-day meal groceries for 100 elderly people', 15000, 'month', 5)
) AS v(category, label, amount, "unitNoun", "sortOrder")
WHERE NOT EXISTS (
  SELECT 1 FROM "SponsorshipItem" s WHERE s."organisationId" = o."id"
);

-- Same rule for the bank accounts: a volunteer recording a transfer has to
-- pick the account it landed in, and an account already on file — possibly
-- renamed, possibly carrying donations — is not ours to overwrite.
INSERT INTO "BankAccount"
  ("id", "organisationId", "bankName", "branch", "accountNumber", "ifsc", "accountHolder", "accountType", "purpose", "isPrimary", "isActive", "openingBalance", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text, o."id", v."bankName", v.branch, v."accountNumber", v.ifsc,
  o."name", 'CURRENT'::"BankAccountType", 'GENERAL'::"BankAccountPurpose",
  -- Only claim primary if the organisation has none; two primaries is the
  -- corruption an earlier round had to repair by hand.
  v."isPrimary" AND NOT EXISTS (
    SELECT 1 FROM "BankAccount" b WHERE b."organisationId" = o."id" AND b."isPrimary"
  ),
  true, 0, NOW(), NOW()
FROM "Organisation" o
CROSS JOIN (VALUES
    ('ICICI Bank', 'Marathahalli', '141705000636', 'ICIC0001417', true),
    ('Canara Bank', 'Nandidurga Road, Bangalore', '0793101030527', 'CNRB0000793', false)
) AS v("bankName", branch, "accountNumber", ifsc, "isPrimary")
WHERE NOT EXISTS (
  SELECT 1 FROM "BankAccount" b
  WHERE b."organisationId" = o."id" AND b."accountNumber" = v."accountNumber"
);
