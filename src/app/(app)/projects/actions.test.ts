import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
// Server Actions call revalidatePath outside a Next request context here.
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { prismaUnsafe } = await import("@/lib/db/prisma");
const { generateUtilCert, migrateFromPlaceholder, reallocateBudget } = await import("./actions");
const { default: ProjectProfilePage } = await import("./[id]/page");

const ORG_A = "test-org-project-actions-a";
const ORG_B = "test-org-project-actions-b";
const TEST_USER = "test-user-project-actions";
const ORGS = [ORG_A, ORG_B];

function scopeFor(organisationId: string) {
  return {
    userId: TEST_USER,
    organisationId,
    organisationName: "Test Trust",
    role: "OWNER" as const,
  };
}

async function cleanup() {
  await prismaUnsafe.utilisationCertificate.deleteMany({
    where: { project: { organisationId: { in: ORGS } } },
  });
  await prismaUnsafe.auditLog.deleteMany({ where: { organisationId: { in: ORGS } } });
  await prismaUnsafe.expense.deleteMany({ where: { organisationId: { in: ORGS } } });
  await prismaUnsafe.donation.deleteMany({ where: { organisationId: { in: ORGS } } });
  await prismaUnsafe.donor.deleteMany({ where: { organisationId: { in: ORGS } } });
  await prismaUnsafe.projectBudgetHead.deleteMany({
    where: { project: { organisationId: { in: ORGS } } },
  });
  await prismaUnsafe.project.deleteMany({ where: { organisationId: { in: ORGS } } });
  await prismaUnsafe.certificateSeries.deleteMany({ where: { organisationId: { in: ORGS } } });
  await prismaUnsafe.membership.deleteMany({ where: { userId: TEST_USER } });
  await prismaUnsafe.user.deleteMany({ where: { id: TEST_USER } });
  await prismaUnsafe.organisation.deleteMany({ where: { id: { in: ORGS } } });
}

let seq = 0;

/** A project with two budget heads, a donor, and a project-tagged donation and expense. */
async function makeFixture(organisationId: string) {
  const n = ++seq;
  const project = await prismaUnsafe.project.create({
    data: {
      organisationId,
      code: `PRJ/2025-26/${String(n).padStart(4, "0")}`,
      name: `Project ${n}`,
      status: "ACTIVE",
      startDate: new Date("2025-04-01"),
      endDate: new Date("2026-03-31"),
      totalBudget: "600000",
      budgetHeads: {
        create: [
          { name: "Training", budgetedAmount: "500000" },
          { name: "Materials", budgetedAmount: "100000" },
        ],
      },
    },
    include: { budgetHeads: { orderBy: { name: "asc" } } },
  });
  const donor = await prismaUnsafe.donor.create({
    data: {
      organisationId,
      donorType: "INDIVIDUAL",
      name: `Donor ${n}`,
      pan: `ABCDE${String(n).padStart(4, "0")}F`,
    },
  });
  const donation = await prismaUnsafe.donation.create({
    data: {
      organisationId,
      donorId: donor.id,
      receiptNumber: `RKS/2025-26/${String(n).padStart(4, "0")}`,
      donationDate: new Date("2025-05-01"),
      amount: "100000",
      mode: "NEFT",
      purpose: "PROJECT_SPECIFIC",
      projectId: project.id,
      status: "RECEIVED",
    },
  });
  const expense = await prismaUnsafe.expense.create({
    data: {
      organisationId,
      voucherNumber: `TST/PRJ/EXP/${n}`,
      expenseDate: new Date("2025-06-01"),
      cashPayeeName: "Cash payee",
      grossAmount: "20000",
      tdsAmount: "0",
      netPayable: "20000",
      mode: "CASH",
      projectId: project.id,
      status: "APPROVED",
    },
  });
  const [materials, training] = project.budgetHeads;
  return { project, donor, donation, expense, materials: materials!, training: training! };
}

beforeAll(async () => {
  await cleanup();
  for (const id of ORGS) {
    await prismaUnsafe.organisation.create({
      data: {
        id,
        name: "Test Trust",
        legalName: "Test Charitable Trust",
        addressLine1: "12 Test Road",
        city: "Bengaluru",
        state: "Karnataka",
        pincode: "560001",
        pan: `AAATR888${id === ORG_A ? "1" : "2"}F`,
        email: "project-actions@testtrust.org",
        authorisedSignatoryName: "Test Signatory",
        authorisedSignatoryDesignation: "Trustee",
      },
    });
  }
  await prismaUnsafe.user.create({
    data: { id: TEST_USER, email: "project-actions@rakshana.local", name: "Project Test" },
  });
  await prismaUnsafe.membership.create({
    data: { userId: TEST_USER, organisationId: ORG_A, role: "OWNER" },
  });
});

afterAll(async () => {
  await cleanup();
  await prismaUnsafe.$disconnect();
});

beforeEach(() => {
  getOrgScopeMock.mockReset();
  getOrgScopeMock.mockResolvedValue(scopeFor(ORG_A));
});

describe("project profile page", () => {
  it("404s instead of rendering a project owned by another organisation", async () => {
    const foreign = await makeFixture(ORG_B);
    await expect(
      ProjectProfilePage({ params: Promise.resolve({ id: foreign.project.id }) }),
    ).rejects.toThrow();
  });

  it("renders a project owned by the caller's organisation", async () => {
    const own = await makeFixture(ORG_A);
    await expect(
      ProjectProfilePage({ params: Promise.resolve({ id: own.project.id }) }),
    ).resolves.toBeTruthy();
  });
});

describe("generateUtilCert", () => {
  it("refuses a project belonging to another organisation", async () => {
    const foreign = await makeFixture(ORG_B);

    const result = await generateUtilCert({
      projectId: foreign.project.id,
      donorId: foreign.donor.id,
      periodFrom: new Date("2025-04-01"),
      periodTo: new Date("2026-03-31"),
    });

    expect(result.data).toBeUndefined();
    expect(result.serverError).toBeDefined();
    // No certificate filed and no number burnt from the victim's series.
    expect(
      await prismaUnsafe.utilisationCertificate.count({
        where: { projectId: foreign.project.id },
      }),
    ).toBe(0);
    expect(
      await prismaUnsafe.certificateSeries.count({ where: { organisationId: ORG_B } }),
    ).toBe(0);
  });

  it("issues a certificate for the caller's own project", async () => {
    const own = await makeFixture(ORG_A);

    const result = await generateUtilCert({
      projectId: own.project.id,
      donorId: own.donor.id,
      periodFrom: new Date("2025-04-01"),
      periodTo: new Date("2026-03-31"),
    });

    expect(result.serverError).toBeUndefined();
    expect(result.data!.certificateNumber).toMatch(/^UTIL\/\d{4}-\d{2}\/\d{4}$/);
  });
});

describe("migrateFromPlaceholder", () => {
  it("refuses to repoint another organisation's donations and expenses", async () => {
    const own = await makeFixture(ORG_A);
    const foreign = await makeFixture(ORG_B);

    const result = await migrateFromPlaceholder({
      targetProjectId: own.project.id,
      donationIds: [foreign.donation.id],
      expenseIds: [],
    });

    expect(result.data).toBeUndefined();
    expect(result.serverError).toBeDefined();
    const stored = await prismaUnsafe.donation.findUniqueOrThrow({
      where: { id: foreign.donation.id },
    });
    expect(stored.projectId).toBe(foreign.project.id);
  });

  it("aborts the whole migration when one id is foreign", async () => {
    const own = await makeFixture(ORG_A);
    const target = await makeFixture(ORG_A);
    const foreign = await makeFixture(ORG_B);

    const result = await migrateFromPlaceholder({
      targetProjectId: target.project.id,
      donationIds: [own.donation.id, foreign.donation.id],
      expenseIds: [],
    });

    expect(result.serverError).toBeDefined();
    const stored = await prismaUnsafe.donation.findUniqueOrThrow({
      where: { id: own.donation.id },
    });
    expect(stored.projectId).toBe(own.project.id);
  });

  it("tolerates the same id listed twice", async () => {
    const own = await makeFixture(ORG_A);
    const target = await makeFixture(ORG_A);

    const result = await migrateFromPlaceholder({
      targetProjectId: target.project.id,
      donationIds: [own.donation.id, own.donation.id],
      expenseIds: [own.expense.id, own.expense.id],
    });

    expect(result.serverError).toBeUndefined();
    // Counts are rows moved, not ids supplied.
    expect(result.data!.donationsMoved).toBe(1);
    expect(result.data!.expensesMoved).toBe(1);
    const [donation, expense] = await Promise.all([
      prismaUnsafe.donation.findUniqueOrThrow({ where: { id: own.donation.id } }),
      prismaUnsafe.expense.findUniqueOrThrow({ where: { id: own.expense.id } }),
    ]);
    expect(donation.projectId).toBe(target.project.id);
    expect(expense.projectId).toBe(target.project.id);
  });

  it("still aborts when a foreign id is repeated alongside an own id", async () => {
    const own = await makeFixture(ORG_A);
    const target = await makeFixture(ORG_A);
    const foreign = await makeFixture(ORG_B);

    const result = await migrateFromPlaceholder({
      targetProjectId: target.project.id,
      donationIds: [own.donation.id, foreign.donation.id, foreign.donation.id],
      expenseIds: [],
    });

    expect(result.serverError).toBeDefined();
    const [stored, victim] = await Promise.all([
      prismaUnsafe.donation.findUniqueOrThrow({ where: { id: own.donation.id } }),
      prismaUnsafe.donation.findUniqueOrThrow({ where: { id: foreign.donation.id } }),
    ]);
    expect(stored.projectId).toBe(own.project.id);
    expect(victim.projectId).toBe(foreign.project.id);
  });

  it("moves the caller's own donations", async () => {
    const own = await makeFixture(ORG_A);
    const target = await makeFixture(ORG_A);

    const result = await migrateFromPlaceholder({
      targetProjectId: target.project.id,
      donationIds: [own.donation.id],
      expenseIds: [],
    });

    expect(result.serverError).toBeUndefined();
    expect(result.data!.donationsMoved).toBe(1);
    const stored = await prismaUnsafe.donation.findUniqueOrThrow({
      where: { id: own.donation.id },
    });
    expect(stored.projectId).toBe(target.project.id);
  });
});

describe("reallocateBudget", () => {
  it("refuses two budget heads of another organisation's project", async () => {
    const foreign = await makeFixture(ORG_B);

    const result = await reallocateBudget({
      fromHeadId: foreign.training.id,
      toHeadId: foreign.materials.id,
      amount: "400000",
      reason: "Cross-tenant attempt",
    });

    expect(result.data).toBeUndefined();
    expect(result.serverError).toBeDefined();
    const head = await prismaUnsafe.projectBudgetHead.findUniqueOrThrow({
      where: { id: foreign.training.id },
    });
    expect(head.budgetedAmount.toFixed(2)).toBe("500000.00");
  });

  // The mixed pairs are the ones worth money to an attacker: they move a
  // victim's budget onto a head the attacker can read, or push their own budget
  // into the victim's certificate breakup.
  it("refuses an own source head paired with a foreign target head", async () => {
    const own = await makeFixture(ORG_A);
    const foreign = await makeFixture(ORG_B);

    const result = await reallocateBudget({
      fromHeadId: own.training.id,
      toHeadId: foreign.materials.id,
      amount: "400000",
      reason: "Cross-tenant attempt",
    });

    expect(result.data).toBeUndefined();
    expect(result.serverError).toBeDefined();
    const [from, to] = await Promise.all([
      prismaUnsafe.projectBudgetHead.findUniqueOrThrow({ where: { id: own.training.id } }),
      prismaUnsafe.projectBudgetHead.findUniqueOrThrow({ where: { id: foreign.materials.id } }),
    ]);
    expect(from.budgetedAmount.toFixed(2)).toBe("500000.00");
    expect(to.budgetedAmount.toFixed(2)).toBe("100000.00");
  });

  it("refuses a foreign source head paired with an own target head", async () => {
    const own = await makeFixture(ORG_A);
    const foreign = await makeFixture(ORG_B);

    const result = await reallocateBudget({
      fromHeadId: foreign.training.id,
      toHeadId: own.materials.id,
      amount: "400000",
      reason: "Cross-tenant attempt",
    });

    expect(result.data).toBeUndefined();
    expect(result.serverError).toBeDefined();
    const [from, to] = await Promise.all([
      prismaUnsafe.projectBudgetHead.findUniqueOrThrow({ where: { id: foreign.training.id } }),
      prismaUnsafe.projectBudgetHead.findUniqueOrThrow({ where: { id: own.materials.id } }),
    ]);
    expect(from.budgetedAmount.toFixed(2)).toBe("500000.00");
    expect(to.budgetedAmount.toFixed(2)).toBe("100000.00");
  });

  it("moves budget between two heads of the caller's own project", async () => {
    const own = await makeFixture(ORG_A);

    const result = await reallocateBudget({
      fromHeadId: own.training.id,
      toHeadId: own.materials.id,
      amount: "400000",
      reason: "Training under-spend funds materials",
    });

    expect(result.serverError).toBeUndefined();
    const [from, to] = await Promise.all([
      prismaUnsafe.projectBudgetHead.findUniqueOrThrow({ where: { id: own.training.id } }),
      prismaUnsafe.projectBudgetHead.findUniqueOrThrow({ where: { id: own.materials.id } }),
    ]);
    expect(from.budgetedAmount.toFixed(2)).toBe("100000.00");
    expect(to.budgetedAmount.toFixed(2)).toBe("500000.00");
  });
});
