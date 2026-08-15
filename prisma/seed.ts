/**
 * Rakshana seed — idempotent.
 *
 * Runs OUTSIDE an HTTP session, so we use the unscoped Prisma client
 * (`basePrisma` from `src/lib/db/prisma-base.ts`) directly. The scoped
 * `prisma` export throws when no session is available.
 *
 * Run with:  npm run db:seed
 */
import bcrypt from "bcryptjs";
import { basePrisma as prisma } from "../src/lib/db/prisma-base";
import {
  BANK_ACCOUNTS,
  SPONSORSHIP_CATALOGUE,
} from "../src/lib/constants/sponsorship-catalogue";

const ORG_ID = "rakshana-trust";
const OWNER_USER_ID = "owner-lakshmanan";
const OWNER_EMAIL = "lakshmanan@indefine.in";
const OWNER_PASSWORD = "Welcome@2026";

/**
 * Identity and address as printed on the trust's brochure. Applied on both
 * create and update so a database seeded before the brochure landed
 * converges instead of keeping the old placeholder address.
 */
const ORG_BROCHURE_DETAILS = {
  legalName: "Rakshana Charitable Trust",
  phone: "+91 96867 60263",
  website: "https://www.rakshana.org",
  addressLine1: "#06, Muneshwara Layout, 3rd Cross",
  addressLine2: "Kogilu Agrahara, Sampigehalli Main Road",
  city: "Bengaluru",
  district: "Bengaluru Urban",
  state: "Karnataka",
  stateCode: "29",
  pincode: "560064",
};

async function main() {
  console.log("→ Seeding Rakshana Trust …");

  // -------------------------------------------------------------------
  // 1. Organisation
  // -------------------------------------------------------------------
  // PAN / TAN / registration numbers stay as seeded placeholders — they were
  // not on the brochure, and an invented number is worse than an obvious one.
  const org = await prisma.organisation.upsert({
    where: { id: ORG_ID },
    update: ORG_BROCHURE_DETAILS,
    create: {
      id: ORG_ID,
      name: "Rakshana Trust",
      charitablePurpose: "Education, health, and rural development",
      subCategory: "Education",
      email: "trust@rakshana.org",
      ...ORG_BROCHURE_DETAILS,
      registrationType: "TRUST",
      registrationNumber: "TR/BLR/2024/0001",
      registrationDate: new Date("2024-04-15T00:00:00+05:30"),
      pan: "AAATR1234F",
      tan: "BLRR12345C",
      authorisedSignatoryName: "Lakshmanan",
      authorisedSignatoryDesignation: "Managing Trustee",
      caFirmName: "Indefine & Co.",
      caPartnerName: "S. Krishnamurthy",
      caEmail: "ca@indefine.in",
      receiptHeaderText: "Rakshana Trust · Bengaluru",
      receiptFooterText:
        "Donations to Rakshana Trust are eligible for deduction under Sec 80G(5)(iii) of the Income Tax Act, 1961.",
      fyStartMonth: 4,
      fyStartDay: 1,
    },
  });

  // Tax registrations (empty placeholders — Phase 1 will populate)
  await prisma.twelveARegistration.upsert({
    where: { organisationId: org.id },
    update: {},
    create: {
      organisationId: org.id,
      number: "12A/AABCD/2024-25",
      registrationDate: new Date("2024-05-01T00:00:00+05:30"),
      validityEndDate: new Date("2029-03-31T00:00:00+05:30"),
    },
  });
  await prisma.eightyGRegistration.upsert({
    where: { organisationId: org.id },
    update: {},
    create: {
      organisationId: org.id,
      number: "80G/AABCD/2024-25",
      approvalDate: new Date("2024-05-15T00:00:00+05:30"),
      validityEndDate: new Date("2029-03-31T00:00:00+05:30"),
    },
  });

  // -------------------------------------------------------------------
  // 2. Bank accounts
  // -------------------------------------------------------------------
  await seedBankAccounts(org.id);

  // -------------------------------------------------------------------
  // 3. Owner user + membership
  // -------------------------------------------------------------------
  const ownerExisted =
    (await prisma.user.count({ where: { email: OWNER_EMAIL } })) > 0;
  const passwordHash = await bcrypt.hash(OWNER_PASSWORD, 12);
  const user = await prisma.user.upsert({
    where: { email: OWNER_EMAIL },
    // The seeded password is written once, at create. `db:seed:prod` is a
    // manual command that nothing stops anyone running a second time against a
    // populated database, and resetting the hash here would silently revert a
    // rotation made at /settings/account, handing the account back to anyone
    // holding a copy of this repository — OWNER_PASSWORD above is a committed
    // literal, which is why the deploy steps in OPERATIONS.md have the owner
    // rotate it at first sign-in.
    // Locked-out owners are recovered by the direct hash rewrite in
    // OPERATIONS.md §7, not by re-seeding.
    update: { name: "Lakshmanan" },
    create: {
      id: OWNER_USER_ID,
      email: OWNER_EMAIL,
      name: "Lakshmanan",
      passwordHash,
      status: "ACTIVE",
    },
  });
  await prisma.membership.upsert({
    where: { userId_organisationId: { userId: user.id, organisationId: org.id } },
    update: { role: "OWNER", isActive: true },
    create: {
      userId: user.id,
      organisationId: org.id,
      role: "OWNER",
      isActive: true,
    },
  });

  // -------------------------------------------------------------------
  // 4. Expense category tree (Operations, Programmes, Administration, …)
  // -------------------------------------------------------------------
  await seedExpenseCategories(org.id);

  // -------------------------------------------------------------------
  // 5. Receipt series (general + FCRA, GST invoice series)
  // -------------------------------------------------------------------
  const fy = currentFinancialYear();
  await prisma.receiptSeries.upsert({
    where: { organisationId_name_financialYear: { organisationId: org.id, name: "General", financialYear: fy } },
    update: {},
    create: {
      organisationId: org.id,
      name: "General",
      prefix: "RKS",
      financialYear: fy,
      width: 4,
      isFcraOnly: false,
      isActive: true,
    },
  });
  await prisma.receiptSeries.upsert({
    where: { organisationId_name_financialYear: { organisationId: org.id, name: "FCRA", financialYear: fy } },
    update: {},
    create: {
      organisationId: org.id,
      name: "FCRA",
      prefix: "RKS-FC",
      financialYear: fy,
      width: 4,
      isFcraOnly: true,
      isActive: true,
    },
  });

  // -------------------------------------------------------------------
  // 6. Approval policies (₹ tier → required role)
  // -------------------------------------------------------------------
  await seedApprovalPolicies(org.id);

  // -------------------------------------------------------------------
  // 7. Anonymous donor (system bucket)
  // -------------------------------------------------------------------
  await prisma.donor.upsert({
    where: { organisationId_pan: { organisationId: org.id, pan: "__ANONYMOUS__" } },
    update: {},
    create: {
      organisationId: org.id,
      donorType: "ANONYMOUS",
      name: "Anonymous Donations",
      pan: "__ANONYMOUS__",
      isAnonymousBucket: true,
      is80GEligible: false,
      status: "ACTIVE",
    },
  });

  // -------------------------------------------------------------------
  // 8. Placeholder project (real projects ship in Phase 4)
  // -------------------------------------------------------------------
  await prisma.project.upsert({
    where: { organisationId_code: { organisationId: org.id, code: "GEN-001" } },
    update: {},
    create: {
      organisationId: org.id,
      code: "GEN-001",
      name: "General Programmes",
      description:
        "Default project that captures donations not tied to a specific programme. Replaced by real project records in Phase 4.",
      status: "ACTIVE",
      isCsr: false,
    },
  });

  // -------------------------------------------------------------------
  // 9. ExpenseCategory flags (Phase 3)
  // -------------------------------------------------------------------
  await prisma.expenseCategory.updateMany({
    where: { organisationId: org.id, name: "Capital" },
    data: { isCapital: true },
  });
  await prisma.expenseCategory.updateMany({
    where: { organisationId: org.id, name: { in: ["Materials", "Training", "Beneficiary Aid"] } },
    data: { requiresProject: true },
  });

  // -------------------------------------------------------------------
  // 10. Sample vendor + petty cash float for Phase 3 demos
  // -------------------------------------------------------------------
  const existingVendor = await prisma.vendor.findFirst({
    where: { organisationId: org.id, name: "Lumina Stationers" },
  });
  if (!existingVendor) {
    await prisma.vendor.create({
      data: {
        organisationId: org.id,
        name: "Lumina Stationers",
        pan: "AABCS1234L",
        gstin: "29AABCS1234L1Z3",
        defaultTdsSection: "194C",
        addressLine1: "44, 80 ft Road",
        city: "Bengaluru",
        state: "Karnataka",
        stateCode: "29",
        pincode: "560038",
        phone: "+918022334455",
        email: "billing@lumina.example",
      },
    });
  }

  const owner = await prisma.user.findUnique({ where: { email: OWNER_EMAIL } });
  const existingFloat = await prisma.pettyCashFloat.findFirst({
    where: { organisationId: org.id, name: "Office petty cash" },
  });
  if (!existingFloat && owner) {
    await prisma.pettyCashFloat.create({
      data: {
        organisationId: org.id,
        name: "Office petty cash",
        custodianId: owner.id,
        floatAmount: 5000,
        currentBalance: 5000,
        isActive: true,
      },
    });
  }

  // -------------------------------------------------------------------
  // 11. Sponsorship catalogue (the brochure's donation menu)
  // -------------------------------------------------------------------
  await seedSponsorshipItems(org.id);

  console.log("✓ Seed complete.");
  console.log(`  Org:    ${org.name} (${org.id})`);
  // The credential is printed only for an owner this run created — on a re-seed
  // it is no longer the live password, and the deploy log is not the place for it.
  console.log(`  Owner:  ${OWNER_EMAIL}${ownerExisted ? "" : ` / ${OWNER_PASSWORD}`}`);
  console.log(`  FY:     ${fy}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function currentFinancialYear(): string {
  const now = new Date();
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const ist = new Date(now.getTime() + istOffsetMs);
  const year = ist.getUTCFullYear();
  const month = ist.getUTCMonth(); // 0 = Jan
  const fyStart = month >= 3 ? year : year - 1;
  return `${fyStart}-${(fyStart + 1).toString().slice(-2)}`;
}

async function seedBankAccounts(organisationId: string) {
  for (const a of BANK_ACCOUNTS) {
    await prisma.bankAccount.upsert({
      where: { organisationId_accountNumber: { organisationId, accountNumber: a.accountNumber } },
      update: { bankName: a.bankName, branch: a.branch, ifsc: a.ifsc, isPrimary: a.isPrimary },
      create: {
        organisationId,
        ...a,
        accountHolder: "Rakshana Charitable Trust",
        accountType: "CURRENT",
        purpose: "GENERAL",
        isActive: true,
      },
    });
  }

  // Retire the HDFC placeholder this seed used to create. It is deleted only
  // when nothing points at it; where demo donations or expenses were already
  // booked against it, deactivating keeps that history readable and stops it
  // competing with ICICI for primary.
  const placeholder = { organisationId, accountNumber: "00301234567890" };
  await prisma.bankAccount.updateMany({
    where: placeholder,
    data: { isPrimary: false, isActive: false },
  });
  await prisma.bankAccount.deleteMany({
    where: { ...placeholder, donations: { none: {} }, expenses: { none: {} } },
  });
}

async function seedSponsorshipItems(organisationId: string) {
  // src/lib/constants/sponsorship-catalogue.ts is the source of truth; the
  // deploy-time copy lives in migration 20260815120000. See that file for why
  // there are two and what keeps them equal.
  for (const item of SPONSORSHIP_CATALOGUE) {
    // Prices are revised yearly — update on re-seed so the menu stays current.
    await prisma.sponsorshipItem.upsert({
      where: { organisationId_label: { organisationId, label: item.label } },
      update: {
        category: item.category,
        amount: item.amount,
        unitNoun: item.unitNoun,
        sortOrder: item.sortOrder,
        isActive: true,
      },
      create: { organisationId, ...item },
    });
  }
}

async function seedExpenseCategories(organisationId: string) {
  type Node = { name: string; children?: Node[] };
  const tree: Node[] = [
    {
      name: "Operations",
      children: [
        { name: "Office Rent" },
        { name: "Utilities" },
        { name: "Bank Charges" },
        { name: "Stationery" },
      ],
    },
    {
      name: "Programmes",
      children: [
        { name: "Training" },
        { name: "Materials" },
        { name: "Beneficiary Aid" },
      ],
    },
    {
      name: "Administration",
      children: [
        { name: "Audit Fees" },
        { name: "Legal & Professional" },
        { name: "Travel" },
      ],
    },
    { name: "Capital" },
    {
      name: "Personnel",
      children: [
        { name: "Salaries" },
        { name: "Stipends" },
      ],
    },
  ];

  async function plant(nodes: Node[], parentId: string | null) {
    for (const n of nodes) {
      const created = await prisma.expenseCategory.upsert({
        where: { organisationId_name: { organisationId, name: n.name } },
        update: {},
        create: {
          organisationId,
          name: n.name,
          parentId,
          isActive: true,
        },
      });
      if (n.children?.length) {
        await plant(n.children, created.id);
      }
    }
  }
  await plant(tree, null);
}

async function seedApprovalPolicies(organisationId: string) {
  // PRD §7.3 tiers: an accountant clears up to ₹10,000, an admin up to
  // ₹1,00,000, anything above needs an owner. Bands are half-open
  // [minAmount, maxAmount) — each ceiling is the next tier's floor, one paisa
  // above its own inclusive limit — so every amount from zero upwards matches
  // exactly one band. Amounts that match none can never be approved at all.
  const policies = [
    { minAmount: "0",         maxAmount: "10000.01",  requiredRole: "ACCOUNTANT" as const },
    { minAmount: "10000.01",  maxAmount: "100000.01", requiredRole: "ADMIN" as const },
    { minAmount: "100000.01", maxAmount: null,        requiredRole: "OWNER" as const },
  ];
  for (const p of policies) {
    // No natural unique key — one row per tier, identified by the role it
    // grants. Only a missing tier is planted. Nothing in the app writes
    // ApprovalPolicy (approval-policy.ts reads the bands, no screen edits
    // them), so a band that differs from these defaults got there by hand in
    // the database or from a migration repairing the shape of existing rows —
    // and writing to a tier that already exists would undo that. OPERATIONS.md
    // §1 step 5 calls `db:seed:prod` a one-off just after the first deploy,
    // but it is a manual command with nothing stopping a second run against a
    // populated database, which is the run this guard is for. Repairing rows
    // already in the database stays a migration's job, since that is what a
    // deploy runs.
    const existing = await prisma.approvalPolicy.findFirst({
      where: { organisationId, scope: "EXPENSE", requiredRole: p.requiredRole },
    });
    if (existing) continue;
    await prisma.approvalPolicy.create({
      data: {
        organisationId,
        scope: "EXPENSE",
        minAmount: p.minAmount,
        maxAmount: p.maxAmount,
        requiredRole: p.requiredRole,
        level: 1,
        isActive: true,
      },
    });
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
