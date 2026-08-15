import type { SponsorshipCategory } from "@prisma/client";

/**
 * The trust's brochure donation menu — the single source of truth for the
 * sponsorship catalogue.
 *
 * Two things plant this list, and only one of them ever runs on Railway:
 *
 *  - `prisma/seed.ts` imports it. Seeding is a manual command; a deploy does
 *    not run it.
 *  - `prisma/migrations/20260815120000_plant_sponsorship_catalogue` carries a
 *    copy of these rows as SQL literals, because `npx prisma migrate deploy`
 *    is the whole of railway.json's preDeployCommand and SQL cannot import
 *    TypeScript. That copy is frozen: a migration already applied to
 *    production can never be edited, its checksum is recorded.
 *
 * So the two can drift, and prices are revised yearly. The tripwire is
 * `src/lib/db/catalogue.test.ts`: it migrates a clean schema, plants nothing
 * by hand, and asserts the rows a migrated-only database holds are exactly
 * this list. Revise a price here without a migration carrying it and that test
 * fails — which is the same statement as "production would not have the new
 * price", because a migration is all production gets.
 *
 * Revising a price is therefore: edit here, add a migration that updates the
 * rows it owns, run the suite.
 *
 * Amounts are rupee strings, not numbers — they land in Decimal(18, 2) and
 * nothing in this codebase does Number arithmetic on money.
 */
export type SponsorshipCatalogueRow = {
  category: SponsorshipCategory;
  label: string;
  amount: string;
  unitNoun: string;
  /** Position within the category, in the order the brochure prints them. */
  sortOrder: number;
};

/**
 * Order within each category is the order the brochure prints them, and
 * becomes `sortOrder`. The monthly entry leads the page, so it sorts first.
 */
export const SPONSORSHIP_CATALOGUE: readonly SponsorshipCatalogueRow[] = [
  { category: "CHILDREN_EDUCATION", label: "Monthly sponsorship", amount: "800", unitNoun: "month", sortOrder: 0 },
  { category: "CHILDREN_EDUCATION", label: "School bag & shoes per child", amount: "1500", unitNoun: "child", sortOrder: 1 },
  { category: "CHILDREN_EDUCATION", label: "Pair of uniform set per child", amount: "3250", unitNoun: "child", sortOrder: 2 },
  { category: "CHILDREN_EDUCATION", label: "Stationery for a year per child", amount: "3450", unitNoun: "child", sortOrder: 3 },
  { category: "CHILDREN_EDUCATION", label: "Weekly fruits & snacks", amount: "3600", unitNoun: "week", sortOrder: 4 },
  { category: "CHILDREN_EDUCATION", label: "Basic needs for our children", amount: "6000", unitNoun: "child", sortOrder: 5 },
  { category: "CHILDREN_EDUCATION", label: "One-time meal for 36 children", amount: "7000", unitNoun: "meal", sortOrder: 6 },
  { category: "CHILDREN_EDUCATION", label: "Medical & health care for 36 children", amount: "8000", unitNoun: "month", sortOrder: 7 },
  { category: "CHILDREN_EDUCATION", label: "School admission per child", amount: "30500", unitNoun: "child", sortOrder: 8 },
  { category: "CHILDREN_EDUCATION", label: "One year education sponsorship for a child", amount: "46000", unitNoun: "child", sortOrder: 9 },
  {
    category: "CHILDREN_EDUCATION",
    label: "Yearly sponsorship for a child (education, medical, nutrition)",
    amount: "95000",
    unitNoun: "child",
    sortOrder: 10,
  },

  { category: "COMMUNITY_TRAINING", label: "Wheelchair for a disabled child", amount: "7500", unitNoun: "wheelchair", sortOrder: 0 },
  { category: "COMMUNITY_TRAINING", label: "One sewing machine per woman", amount: "8500", unitNoun: "woman", sortOrder: 1 },
  { category: "COMMUNITY_TRAINING", label: "Tuition fees for 120 children per month", amount: "10000", unitNoun: "month", sortOrder: 2 },
  { category: "COMMUNITY_TRAINING", label: "Computer training and English coaching", amount: "10000", unitNoun: "batch", sortOrder: 3 },
  { category: "COMMUNITY_TRAINING", label: "Special training classes for women", amount: "15000", unitNoun: "batch", sortOrder: 4 },
  { category: "COMMUNITY_TRAINING", label: "Mid-day meal groceries for 100 elderly people", amount: "15000", unitNoun: "month", sortOrder: 5 },
];

/**
 * The trust's bank accounts as printed on the brochure. Planted by the same
 * migration and the same seed, for the same reason: a volunteer recording a
 * bank transfer has to pick the account it landed in.
 */
export const BANK_ACCOUNTS = [
  {
    bankName: "ICICI Bank",
    branch: "Marathahalli",
    accountNumber: "141705000636",
    ifsc: "ICIC0001417",
    isPrimary: true,
  },
  {
    bankName: "Canara Bank",
    branch: "Nandidurga Road, Bangalore",
    accountNumber: "0793101030527",
    ifsc: "CNRB0000793",
    isPrimary: false,
  },
] as const;
