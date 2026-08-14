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

const { prismaUnsafe } = await import("@/lib/db/prisma");
const { runRecurringExpenseGeneration } = await import("./recurring-expense-runner");

const TEST_ORG = "test-org-recurring-runner";
const TEST_USER = "test-user-recurring-runner";
const DUE = new Date("2026-01-10T00:00:00Z"); // in the past — every run sees it

async function cleanup() {
  await prismaUnsafe.auditLog.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.expense.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.recurringExpense.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.project.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.membership.deleteMany({ where: { userId: TEST_USER } });
  await prismaUnsafe.user.deleteMany({ where: { id: TEST_USER } });
  await prismaUnsafe.organisation.deleteMany({ where: { id: TEST_ORG } });
}

beforeAll(async () => {
  await cleanup();
  await prismaUnsafe.organisation.create({ data: { id: TEST_ORG, name: "Recurring Org" } });
  await prismaUnsafe.user.create({
    data: { id: TEST_USER, email: "recurring-runner@rakshana.local", name: "Recurring Test" },
  });
  await prismaUnsafe.membership.create({
    data: { userId: TEST_USER, organisationId: TEST_ORG, role: "OWNER" },
  });
});

afterAll(async () => {
  await cleanup();
  await prismaUnsafe.$disconnect();
});

beforeEach(async () => {
  await prismaUnsafe.expense.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.recurringExpense.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.project.deleteMany({ where: { organisationId: TEST_ORG } });
  getOrgScopeMock.mockReset();
  getOrgScopeMock.mockResolvedValue({
    userId: TEST_USER,
    organisationId: TEST_ORG,
    organisationName: "Recurring Org",
    role: "OWNER",
  });
});

async function seedProject(code: string, isFcra: boolean) {
  return prismaUnsafe.project.create({
    data: { organisationId: TEST_ORG, code, name: code, isFcra },
  });
}

async function seedTemplate(name: string, projectId: string | null) {
  return prismaUnsafe.recurringExpense.create({
    data: {
      organisationId: TEST_ORG,
      name,
      projectId,
      amount: "5000.00",
      frequency: "MONTHLY",
      nextDueDate: DUE,
      isActive: true,
    },
  });
}

describe("runRecurringExpenseGeneration", () => {
  it("generates a draft for a due template and advances nextDueDate", async () => {
    const t = await seedTemplate("Office rent", null);

    const r = await runRecurringExpenseGeneration();

    expect(r).toMatchObject({
      consideredTemplates: 1,
      draftsCreated: 1,
      skippedFcraProject: 0,
    });
    const after = await prismaUnsafe.recurringExpense.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.nextDueDate.toISOString()).toBe("2026-02-10T00:00:00.000Z");
    expect(after.lastGeneratedFor?.toISOString()).toBe(DUE.toISOString());
  });

  it("builds no expense for an FCRA-tagged project and leaves the template due", async () => {
    const project = await seedProject("FCRA-1", true);
    const t = await seedTemplate("FCRA field office rent", project.id);

    const r = await runRecurringExpenseGeneration();

    expect(r).toMatchObject({
      consideredTemplates: 1,
      draftsCreated: 0,
      skippedFcraProject: 1,
    });
    // Nothing built: `mode: "OTHER"` on an FCRA project is the state
    // assertFcraPaymentRoute refuses, so the row must not exist at all.
    expect(await prismaUnsafe.expense.count({ where: { organisationId: TEST_ORG } })).toBe(0);
    // Still due, and unstamped — the next run reports it again.
    const after = await prismaUnsafe.recurringExpense.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.nextDueDate.toISOString()).toBe(DUE.toISOString());
    expect(after.lastGeneratedFor).toBeNull();
    expect(after.isActive).toBe(true);
  });

  it("still generates for a non-FCRA project alongside a skipped FCRA one", async () => {
    const fcra = await seedProject("FCRA-2", true);
    const local = await seedProject("LOCAL-1", false);
    await seedTemplate("FCRA salaries", fcra.id);
    await seedTemplate("Local salaries", local.id);

    const r = await runRecurringExpenseGeneration();

    expect(r).toMatchObject({
      consideredTemplates: 2,
      draftsCreated: 1,
      skippedFcraProject: 1,
    });
    const expenses = await prismaUnsafe.expense.findMany({
      where: { organisationId: TEST_ORG },
      select: { projectId: true },
    });
    expect(expenses).toEqual([{ projectId: local.id }]);
  });
});
