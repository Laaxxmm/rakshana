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

const ORG_ID = "rakshana-trust";
const OWNER_USER_ID = "owner-lakshmanan";
const OWNER_EMAIL = "lakshmanan@indefine.in";
const OWNER_PASSWORD = "Welcome@2026";

async function main() {
  console.log("→ Seeding Rakshana Trust …");

  // -------------------------------------------------------------------
  // 1. Organisation
  // -------------------------------------------------------------------
  const org = await prisma.organisation.upsert({
    where: { id: ORG_ID },
    update: {},
    create: {
      id: ORG_ID,
      name: "Rakshana Trust",
      legalName: "Rakshana Charitable Trust",
      charitablePurpose: "Education, health, and rural development",
      subCategory: "Education",
      phone: "+91 80 4567 8900",
      email: "trust@rakshana.org",
      website: "https://rakshana.org",
      addressLine1: "12 Lavelle Road",
      city: "Bengaluru",
      district: "Bengaluru Urban",
      state: "Karnataka",
      stateCode: "29",
      pincode: "560001",
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
  // 2. Bank account (primary, GENERAL purpose)
  // -------------------------------------------------------------------
  await prisma.bankAccount.upsert({
    where: { organisationId_accountNumber: { organisationId: org.id, accountNumber: "00301234567890" } },
    update: {},
    create: {
      organisationId: org.id,
      bankName: "HDFC Bank",
      branch: "Lavelle Road, Bengaluru",
      accountNumber: "00301234567890",
      accountHolder: "Rakshana Trust",
      ifsc: "HDFC0000301",
      accountType: "CURRENT",
      purpose: "GENERAL",
      isPrimary: true,
      isActive: true,
    },
  });

  // -------------------------------------------------------------------
  // 3. Owner user + membership
  // -------------------------------------------------------------------
  const passwordHash = await bcrypt.hash(OWNER_PASSWORD, 12);
  const user = await prisma.user.upsert({
    where: { email: OWNER_EMAIL },
    update: { passwordHash, name: "Lakshmanan" },
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
  await prisma.gstInvoiceSeries.upsert({
    where: { organisationId_name_financialYear: { organisationId: org.id, name: "Default", financialYear: fy } },
    update: {},
    create: {
      organisationId: org.id,
      name: "Default",
      prefix: "INV",
      financialYear: fy,
      width: 4,
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

  console.log("✓ Seed complete.");
  console.log(`  Org:    ${org.name} (${org.id})`);
  console.log(`  Owner:  ${OWNER_EMAIL} / ${OWNER_PASSWORD}`);
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
  const policies = [
    { minAmount: 0,       maxAmount: 10_000,  requiredRole: "ACCOUNTANT" as const },
    { minAmount: 10_001,  maxAmount: 100_000, requiredRole: "ADMIN" as const },
    { minAmount: 100_001, maxAmount: null,    requiredRole: "OWNER" as const },
  ];
  for (const p of policies) {
    // No natural unique key — only seed if no policy exists for that tier yet.
    const exists = await prisma.approvalPolicy.findFirst({
      where: { organisationId, minAmount: p.minAmount, scope: "EXPENSE" },
    });
    if (exists) continue;
    await prisma.approvalPolicy.create({
      data: {
        organisationId,
        scope: "EXPENSE",
        minAmount: p.minAmount,
        maxAmount: p.maxAmount ?? null,
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
