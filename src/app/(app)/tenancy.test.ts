import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cross-tenant drive of every Server Action in the beneficiary, project,
 * volunteer, expense and petty-cash files.
 *
 * Two shapes of hole are covered, and the tenancy extension is blind to both.
 *
 * The models the beneficiary/project/volunteer actions write —
 * BeneficiaryEnrolment, BeneficiaryDisbursement, ImpactRecord, GrantAllocation,
 * ProjectBudgetHead, VolunteerAssignment, VolunteerCertificate — are in
 * PARENT_SCOPED_MODELS: they carry no organisationId, so the extension passes
 * their filters through verbatim and cannot refuse a foreign id. Only a scoped
 * read of the parent can.
 *
 * The money-out actions write models that DO carry organisationId, but they
 * write them from inside `prismaUnsafe.$transaction`, which the extension never
 * reaches into — a raw id from the payload is honoured there however scoped the
 * model is. Only a scoped read taken before the transaction opens can refuse it.
 *
 * Either way the check is the same one: resolve the id through `prisma` first
 * and write the resolved row's id. This file is the check that every action
 * does that.
 *
 * It is fixture-driven on purpose. The specs below must name every exported
 * action and every id field that action reads off its input, or the coverage
 * tests fail — so an action added to one of these files without a tenancy
 * check cannot land quietly.
 */

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
const beneficiaryActions = await import("./beneficiaries/actions");
const projectActions = await import("./projects/actions");
const volunteerActions = await import("./volunteers/actions");
const activityActions = await import("./volunteer-activities/actions");
const expenseActions = await import("./expenses/actions");
const pettyCashActions = await import("./petty-cash/actions");

const ORG_A = "test-org-tenancy-a";
const ORG_B = "test-org-tenancy-b";
const TEST_USER = "test-user-tenancy";
/** Per-fixture custodian users, cleaned up by this prefix. */
const CUSTODIAN_PREFIX = "test-user-tenancy-cust-";
const ORGS = [ORG_A, ORG_B];

const DATE = new Date("2025-06-11T09:00:00Z");
const LATER = new Date("2025-06-11T13:00:00Z");
const PERIOD_FROM = new Date("2025-04-01T00:00:00Z");
const PERIOD_TO = new Date("2026-03-31T00:00:00Z");

function scopeFor(organisationId: string) {
  return {
    userId: TEST_USER,
    organisationId,
    organisationName: "Test Trust",
    role: "OWNER" as const,
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let seq = 0;

/**
 * One organisation's worth of rows: a project with two budget heads, a donor,
 * a project-tagged donation and expense, an enrolled beneficiary, a volunteer
 * checked in to an activity, and the money-out masters a voucher points at —
 * vendor (with the PAN a TdsEntry would copy), category, bank account, petty
 * cash float and LDC certificate. The `spare*` rows exist so the
 * own-organisation happy paths have somewhere to write that the seeded
 * enrolment and assignment have not already claimed, and the extra expenses
 * sit in the states the workflow actions each accept.
 */
async function makeFixture(organisationId: string) {
  const n = ++seq;
  const pad = String(n).padStart(4, "0");
  const project = await prismaUnsafe.project.create({
    data: {
      organisationId,
      code: `TEN/${pad}`,
      name: `Project ${n}`,
      status: "ACTIVE",
      startDate: PERIOD_FROM,
      endDate: PERIOD_TO,
      totalBudget: "600000",
      budgetHeads: {
        create: [
          { name: "Materials", budgetedAmount: "100000" },
          { name: "Training", budgetedAmount: "500000" },
        ],
      },
    },
    include: { budgetHeads: { orderBy: { name: "asc" } } },
  });
  const spareProject = await prismaUnsafe.project.create({
    data: {
      organisationId,
      code: `TEN/SPARE/${pad}`,
      name: `Spare project ${n}`,
      status: "ACTIVE",
      totalBudget: "0",
    },
  });
  const donor = await prismaUnsafe.donor.create({
    data: {
      organisationId,
      donorType: "INDIVIDUAL",
      name: `Donor ${n}`,
      pan: `ABCTN${pad}F`,
    },
  });
  const donation = await prismaUnsafe.donation.create({
    data: {
      organisationId,
      donorId: donor.id,
      receiptNumber: `TEN/RCT/${pad}`,
      donationDate: DATE,
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
      voucherNumber: `TEN/VCH/${pad}`,
      expenseDate: DATE,
      cashPayeeName: "Cash payee",
      grossAmount: "20000",
      tdsAmount: "0",
      netPayable: "20000",
      mode: "CASH",
      projectId: project.id,
      status: "APPROVED",
    },
  });
  const beneficiary = await prismaUnsafe.beneficiary.create({
    data: { organisationId, name: `Beneficiary ${n}` },
  });
  const enrolment = await prismaUnsafe.beneficiaryEnrolment.create({
    data: { beneficiaryId: beneficiary.id, projectId: project.id, enrolledOn: DATE },
  });
  const volunteer = await prismaUnsafe.volunteer.create({
    data: { organisationId, name: `Volunteer ${n}`, totalHours: "0" },
  });
  const activity = await prismaUnsafe.volunteerActivity.create({
    data: { organisationId, name: `Activity ${n}`, startsAt: DATE },
  });
  const spareActivity = await prismaUnsafe.volunteerActivity.create({
    data: { organisationId, name: `Spare activity ${n}`, startsAt: DATE },
  });
  const assignment = await prismaUnsafe.volunteerAssignment.create({
    data: { volunteerId: volunteer.id, activityId: activity.id, checkInAt: DATE },
  });

  // ---- Money-out masters ----
  // The custodian is a real member of this organisation, because that is what
  // a float custodian has to be; the foreign case then drives the other org's.
  const custodian = await prismaUnsafe.user.create({
    data: {
      id: `${CUSTODIAN_PREFIX}${pad}`,
      email: `custodian-${pad}@rakshana.local`,
      name: `Custodian ${n}`,
    },
  });
  await prismaUnsafe.membership.create({
    data: { userId: custodian.id, organisationId, role: "ACCOUNTANT" },
  });
  const vendor = await prismaUnsafe.vendor.create({
    data: {
      organisationId,
      name: `Vendor ${n}`,
      // A real deductee PAN is what a TdsEntry copies onto this trust's 26Q.
      pan: `AAACV${pad}K`,
      defaultTdsSection: "194C",
    },
  });
  const category = await prismaUnsafe.expenseCategory.create({
    data: { organisationId, name: `Category ${n}` },
  });
  const bankAccount = await prismaUnsafe.bankAccount.create({
    data: {
      organisationId,
      bankName: "HDFC Bank",
      accountNumber: `5${pad}00000000`,
      ifsc: "HDFC0000301",
      accountType: "CURRENT",
      purpose: "GENERAL",
    },
  });
  const float = await prismaUnsafe.pettyCashFloat.create({
    data: {
      organisationId,
      name: `Float ${n}`,
      custodianId: custodian.id,
      floatAmount: "50000",
      currentBalance: "50000",
    },
  });
  const ldc = await prismaUnsafe.ldcCertificate.create({
    data: {
      organisationId,
      deducteeName: `Vendor ${n}`,
      deducteePan: `AAACV${pad}K`,
      section: "194C",
      certNumber: `LDC/${pad}`,
      lowerRate: "1",
      validFrom: PERIOD_FROM,
      validTo: PERIOD_TO,
    },
  });
  const pendingExpense = await prismaUnsafe.expense.create({
    data: {
      organisationId,
      voucherNumber: `TEN/PND/${pad}`,
      expenseDate: DATE,
      cashPayeeName: "Cash payee",
      grossAmount: "5000",
      tdsAmount: "0",
      netPayable: "5000",
      mode: "CASH",
      status: "PENDING_APPROVAL",
    },
  });
  const rejectedExpense = await prismaUnsafe.expense.create({
    data: {
      organisationId,
      voucherNumber: `TEN/REJ/${pad}`,
      expenseDate: DATE,
      cashPayeeName: "Cash payee",
      grossAmount: "5000",
      tdsAmount: "0",
      netPayable: "5000",
      mode: "CASH",
      status: "REJECTED",
    },
  });

  const [materials, training] = project.budgetHeads;
  return {
    project,
    spareProject,
    donor,
    donation,
    expense,
    beneficiary,
    enrolment,
    volunteer,
    activity,
    spareActivity,
    assignment,
    custodian,
    vendor,
    category,
    bankAccount,
    float,
    ldc,
    pendingExpense,
    rejectedExpense,
    materials: materials!,
    training: training!,
  };
}

type Fixture = Awaited<ReturnType<typeof makeFixture>>;

/**
 * Every row either side of the tenancy line, serialised in a stable order and
 * keyed by model. Prisma's Decimal and Date both carry a `toJSON`, so each
 * string is the stored values verbatim — a single changed rupee or timestamp
 * shows up as a diff, and the key names the table it moved in.
 */
async function snapshot(organisationId: string): Promise<Record<string, string>> {
  const org = { organisationId };
  const viaProject = { project: { organisationId } };
  const viaBeneficiary = { beneficiary: { organisationId } };
  const viaVolunteer = { volunteer: { organisationId } };
  const viaExpense = { expense: { organisationId } };
  const viaFloat = { float: { organisationId } };
  const orderBy = { id: "asc" } as const;
  // Every query is in flight before the first `await` below.
  const queries = {
    project: prismaUnsafe.project.findMany({ where: org, orderBy }),
    projectBudgetHead: prismaUnsafe.projectBudgetHead.findMany({
      where: viaProject,
      orderBy,
    }),
    grantAllocation: prismaUnsafe.grantAllocation.findMany({ where: viaProject, orderBy }),
    utilisationCertificate: prismaUnsafe.utilisationCertificate.findMany({
      where: viaProject,
      orderBy,
    }),
    donor: prismaUnsafe.donor.findMany({ where: org, orderBy }),
    donation: prismaUnsafe.donation.findMany({ where: org, orderBy }),
    expense: prismaUnsafe.expense.findMany({ where: org, orderBy }),
    expenseApproval: prismaUnsafe.expenseApproval.findMany({ where: viaExpense, orderBy }),
    expenseAttachment: prismaUnsafe.expenseAttachment.findMany({
      where: viaExpense,
      orderBy,
    }),
    vendor: prismaUnsafe.vendor.findMany({ where: org, orderBy }),
    expenseCategory: prismaUnsafe.expenseCategory.findMany({ where: org, orderBy }),
    bankAccount: prismaUnsafe.bankAccount.findMany({ where: org, orderBy }),
    pettyCashFloat: prismaUnsafe.pettyCashFloat.findMany({ where: org, orderBy }),
    pettyCashTopUp: prismaUnsafe.pettyCashTopUp.findMany({ where: viaFloat, orderBy }),
    ldcCertificate: prismaUnsafe.ldcCertificate.findMany({ where: org, orderBy }),
    tdsEntry: prismaUnsafe.tdsEntry.findMany({ where: org, orderBy }),
    voucherSeries: prismaUnsafe.voucherSeries.findMany({ where: org, orderBy }),
    beneficiary: prismaUnsafe.beneficiary.findMany({ where: org, orderBy }),
    beneficiaryEnrolment: prismaUnsafe.beneficiaryEnrolment.findMany({
      where: viaBeneficiary,
      orderBy,
    }),
    beneficiaryDisbursement: prismaUnsafe.beneficiaryDisbursement.findMany({
      where: viaBeneficiary,
      orderBy,
    }),
    impactRecord: prismaUnsafe.impactRecord.findMany({ where: viaBeneficiary, orderBy }),
    volunteer: prismaUnsafe.volunteer.findMany({ where: org, orderBy }),
    volunteerActivity: prismaUnsafe.volunteerActivity.findMany({ where: org, orderBy }),
    volunteerAssignment: prismaUnsafe.volunteerAssignment.findMany({
      where: viaVolunteer,
      orderBy,
    }),
    volunteerCertificate: prismaUnsafe.volunteerCertificate.findMany({
      where: viaVolunteer,
      orderBy,
    }),
    certificateSeries: prismaUnsafe.certificateSeries.findMany({ where: org, orderBy }),
    notification: prismaUnsafe.notification.findMany({ where: org, orderBy }),
    auditLog: prismaUnsafe.auditLog.findMany({ where: org, orderBy }),
  };
  const entries = await Promise.all(
    Object.entries(queries).map(async ([model, rows]) => [
      model,
      JSON.stringify(await rows),
    ]),
  );
  return Object.fromEntries(entries);
}

async function cleanup() {
  const viaProject = { project: { organisationId: { in: ORGS } } };
  const viaBeneficiary = { beneficiary: { organisationId: { in: ORGS } } };
  const viaVolunteer = { volunteer: { organisationId: { in: ORGS } } };
  const viaExpense = { expense: { organisationId: { in: ORGS } } };
  const viaFloat = { float: { organisationId: { in: ORGS } } };
  const org = { organisationId: { in: ORGS } };
  await prismaUnsafe.volunteerCertificate.deleteMany({ where: viaVolunteer });
  await prismaUnsafe.volunteerAssignment.deleteMany({ where: viaVolunteer });
  await prismaUnsafe.volunteerActivity.deleteMany({ where: org });
  await prismaUnsafe.volunteer.deleteMany({ where: org });
  await prismaUnsafe.impactRecord.deleteMany({ where: viaBeneficiary });
  await prismaUnsafe.beneficiaryDisbursement.deleteMany({ where: viaBeneficiary });
  await prismaUnsafe.beneficiaryEnrolment.deleteMany({ where: viaBeneficiary });
  await prismaUnsafe.beneficiary.deleteMany({ where: org });
  await prismaUnsafe.auditLog.deleteMany({ where: org });
  await prismaUnsafe.notification.deleteMany({ where: org });
  await prismaUnsafe.expenseAttachment.deleteMany({ where: viaExpense });
  await prismaUnsafe.expenseApproval.deleteMany({ where: viaExpense });
  await prismaUnsafe.tdsEntry.deleteMany({ where: org });
  await prismaUnsafe.pettyCashTopUp.deleteMany({ where: viaFloat });
  await prismaUnsafe.expense.deleteMany({ where: org });
  await prismaUnsafe.ldcCertificate.deleteMany({ where: org });
  await prismaUnsafe.pettyCashFloat.deleteMany({ where: org });
  await prismaUnsafe.bankAccount.deleteMany({ where: org });
  await prismaUnsafe.expenseCategory.deleteMany({ where: org });
  await prismaUnsafe.vendor.deleteMany({ where: org });
  await prismaUnsafe.voucherSeries.deleteMany({ where: org });
  await prismaUnsafe.approvalPolicy.deleteMany({ where: org });
  await prismaUnsafe.donation.deleteMany({ where: org });
  await prismaUnsafe.donor.deleteMany({ where: org });
  await prismaUnsafe.utilisationCertificate.deleteMany({ where: viaProject });
  await prismaUnsafe.grantAllocation.deleteMany({ where: viaProject });
  await prismaUnsafe.projectBudgetHead.deleteMany({ where: viaProject });
  await prismaUnsafe.project.deleteMany({ where: org });
  await prismaUnsafe.certificateSeries.deleteMany({ where: org });
  await prismaUnsafe.membership.deleteMany({ where: { userId: TEST_USER } });
  await prismaUnsafe.user.deleteMany({ where: { id: TEST_USER } });
  // Memberships cascade off the user, so the custodians go last.
  await prismaUnsafe.user.deleteMany({
    where: { id: { startsWith: CUSTODIAN_PREFIX } },
  });
  await prismaUnsafe.organisation.deleteMany({ where: { id: { in: ORGS } } });
}

// ---------------------------------------------------------------------------
// Action fixtures
// ---------------------------------------------------------------------------

type ActionResult = { data?: unknown; serverError?: string };
type IdPick = (f: Fixture) => unknown;

type Spec = {
  run: (input: never) => Promise<ActionResult>;
  /** Every id the action takes from its caller, and where to find one. */
  ids: Record<string, IdPick>;
  /**
   * Ids the input schema lets the caller leave out. Driven absent as well as
   * foreign: a disbursement with no expense to cross-check against is the
   * shortest way to book money onto someone else's beneficiary.
   */
  optionalIds?: string[];
  /** The rest of a valid payload. A function, so unique columns can vary. */
  base?: () => Record<string, unknown>;
  /**
   * Own-organisation payload, when `base` plus the caller's own ids would be
   * refused for a reason other than tenancy — an enrolment or assignment that
   * already exists, a project code that must be new.
   */
  happy?: (f: Fixture) => Record<string, unknown>;
};

const beneficiarySpecs: Record<string, Spec> = {
  createBeneficiary: {
    run: beneficiaryActions.createBeneficiary,
    ids: {},
    base: () => ({ name: `Beneficiary ${++seq}` }),
  },
  updateBeneficiary: {
    run: beneficiaryActions.updateBeneficiary,
    ids: { id: (f) => f.beneficiary.id },
    base: () => ({ name: "Renamed beneficiary" }),
  },
  enrolBeneficiary: {
    run: beneficiaryActions.enrolBeneficiary,
    // spareProject, not project: the fixture beneficiary is already enrolled
    // in the fixture project, and a unique-constraint refusal would let an
    // unguarded action look guarded.
    ids: { beneficiaryId: (f) => f.beneficiary.id, projectId: (f) => f.spareProject.id },
    base: () => ({ enrolledOn: DATE, remarks: "Tenancy probe" }),
  },
  exitEnrolment: {
    run: beneficiaryActions.exitEnrolment,
    ids: { enrolmentId: (f) => f.enrolment.id },
    base: () => ({ exitedOn: LATER, reason: "Programme finished" }),
  },
  recordDisbursement: {
    run: beneficiaryActions.recordDisbursement,
    ids: { beneficiaryId: (f) => f.beneficiary.id, expenseId: (f) => f.expense.id },
    optionalIds: ["expenseId"],
    base: () => ({
      disbursementDate: DATE,
      type: "CASH",
      value: "25000",
      description: "Cash relief",
      ackUrl: "/api/files/org/ack.pdf",
    }),
  },
  recordImpactMetric: {
    run: beneficiaryActions.recordImpactMetric,
    ids: { beneficiaryId: (f) => f.beneficiary.id },
    base: () => ({ recordDate: DATE, metricName: "Attendance", metricValue: "92%" }),
  },
};

const projectSpecs: Record<string, Spec> = {
  createProject: {
    run: projectActions.createProject,
    ids: {},
    base: () => ({ code: `TEN/NEW/${++seq}`, name: "New project" }),
  },
  updateProject: {
    run: projectActions.updateProject,
    ids: { id: (f) => f.project.id },
    base: () => ({
      code: `TEN/UPD/${++seq}`,
      name: "Renamed project",
      totalBudget: "600000",
    }),
  },
  transitionProject: {
    run: projectActions.transitionProject,
    ids: { projectId: (f) => f.project.id },
    base: () => ({ toStatus: "ON_HOLD" }),
  },
  addBudgetHead: {
    run: projectActions.addBudgetHead,
    ids: { projectId: (f) => f.project.id },
    base: () => ({ name: `Head ${++seq}`, budgetedAmount: "1000" }),
  },
  reallocateBudget: {
    run: projectActions.reallocateBudget,
    ids: { fromHeadId: (f) => f.training.id, toHeadId: (f) => f.materials.id },
    base: () => ({ amount: "1000", reason: "Tenancy probe" }),
  },
  addGrantAllocation: {
    run: projectActions.addGrantAllocation,
    ids: { projectId: (f) => f.project.id, donorId: (f) => f.donor.id },
    optionalIds: ["donorId"],
    base: () => ({ description: "CSR grant FY 25-26", amount: "750000" }),
  },
  generateUtilCert: {
    run: projectActions.generateUtilCert,
    ids: { projectId: (f) => f.project.id, donorId: (f) => f.donor.id },
    base: () => ({ periodFrom: PERIOD_FROM, periodTo: PERIOD_TO }),
  },
  migrateFromPlaceholder: {
    run: projectActions.migrateFromPlaceholder,
    ids: {
      targetProjectId: (f) => f.project.id,
      donationIds: (f) => [f.donation.id],
      expenseIds: (f) => [f.expense.id],
    },
    // Moving rows onto the project they already sit on proves nothing.
    happy: (f) => ({
      targetProjectId: f.spareProject.id,
      donationIds: [f.donation.id],
      expenseIds: [f.expense.id],
    }),
  },
};

const volunteerSpecs: Record<string, Spec> = {
  createVolunteer: {
    run: volunteerActions.createVolunteer,
    ids: {},
    base: () => ({ name: `Volunteer ${++seq}` }),
  },
  updateVolunteer: {
    run: volunteerActions.updateVolunteer,
    ids: { id: (f) => f.volunteer.id },
    base: () => ({ name: "Renamed volunteer" }),
  },
  archiveVolunteer: {
    run: volunteerActions.archiveVolunteer,
    ids: { id: (f) => f.volunteer.id },
  },
  createVolunteerActivity: {
    run: volunteerActions.createVolunteerActivity,
    ids: {},
    base: () => ({ name: `Activity ${++seq}`, startsAt: DATE }),
  },
  assignVolunteer: {
    run: volunteerActions.assignVolunteer,
    // spareActivity, for the same reason enrolBeneficiary uses spareProject:
    // the fixture volunteer already holds an assignment to `activity`.
    ids: { volunteerId: (f) => f.volunteer.id, activityId: (f) => f.spareActivity.id },
  },
  checkInVolunteer: {
    run: volunteerActions.checkInVolunteer,
    ids: { assignmentId: (f) => f.assignment.id },
    base: () => ({ time: DATE }),
  },
  checkOutVolunteer: {
    run: volunteerActions.checkOutVolunteer,
    ids: { assignmentId: (f) => f.assignment.id },
    base: () => ({ time: LATER }),
  },
  generateVolCert: {
    run: volunteerActions.generateVolCert,
    ids: { volunteerId: (f) => f.volunteer.id },
    base: () => ({ periodFrom: PERIOD_FROM, periodTo: PERIOD_TO }),
  },
};

const activitySpecs: Record<string, Spec> = {
  createActivity: {
    run: activityActions.createActivity,
    ids: {},
    base: () => ({ name: `Activity ${++seq}`, startsAt: DATE }),
  },
  deleteActivity: {
    run: activityActions.deleteActivity,
    ids: { id: (f) => f.spareActivity.id },
  },
};

/**
 * One payload shape carries all six ids `expenseDraftSchema` accepts, because
 * the coverage scan wants every one of them driven and a spec is one payload.
 *
 * `isPettyCash` is on so the float debit inside the transaction actually runs —
 * that debit is the write that spends the cash register — and `tdsApplicable`
 * with a section so the TdsEntry is written, since that row is what carries a
 * deductee's name and PAN into a Form 26Q. A bank account rides along too:
 * `MODES_NEED_BANK` lets a petty-cash voucher omit it, but nothing forbids one,
 * and the id has to be driven somewhere.
 */
const expenseBase = () => ({
  cashPayeeName: "Cash payee",
  expenseDate: DATE,
  grossAmount: "12345.67",
  tdsApplicable: true,
  tdsSection: "194C",
  mode: "NEFT",
  paymentRef: `TEN/UTR/${++seq}`,
  isPettyCash: true,
  description: "Tenancy probe voucher",
});

const expenseIds: Record<string, IdPick> = {
  vendorId: (f) => f.vendor.id,
  categoryId: (f) => f.category.id,
  projectId: (f) => f.project.id,
  bankAccountId: (f) => f.bankAccount.id,
  pettyCashFloatId: (f) => f.float.id,
  ldcCertificateId: (f) => f.ldc.id,
};

/**
 * The five a valid payload can simply leave out. `pettyCashFloatId` is not one
 * of them: with `isPettyCash` on, the schema refuses a payload without it, and
 * a refusal from validation would let an unguarded action look guarded.
 */
const expenseOptionalIds = [
  "vendorId",
  "categoryId",
  "projectId",
  "bankAccountId",
  "ldcCertificateId",
];

/** A 1x1 PNG — the smallest thing `validateUpload` and `compressBill` accept. */
const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const expenseSpecs: Record<string, Spec> = {
  createExpenseDraft: {
    run: expenseActions.createExpenseDraft,
    ids: expenseIds,
    optionalIds: expenseOptionalIds,
    base: expenseBase,
  },
  submitExpense: {
    run: expenseActions.submitExpense,
    ids: expenseIds,
    optionalIds: expenseOptionalIds,
    base: expenseBase,
  },
  uploadExpenseBill: {
    run: expenseActions.uploadExpenseBill,
    ids: { expenseId: (f) => f.expense.id },
    base: () => ({
      filename: "bill.png",
      claimedMime: "image/png",
      fileBytes: TINY_PNG,
      pageLabel: "Bill 1 of 1",
    }),
  },
  listExpenseAttachments: {
    run: expenseActions.listExpenseAttachments,
    ids: { expenseId: (f) => f.expense.id },
  },
  approveExpense: {
    run: expenseActions.approveExpense,
    ids: { expenseId: (f) => f.pendingExpense.id },
    base: () => ({ notes: "Tenancy probe" }),
  },
  rejectExpense: {
    run: expenseActions.rejectExpense,
    ids: { expenseId: (f) => f.pendingExpense.id },
    base: () => ({ notes: "Tenancy probe" }),
  },
  markExpensePaid: {
    run: expenseActions.markExpensePaid,
    ids: { expenseId: (f) => f.expense.id },
    base: () => ({ paidAt: LATER, paymentRef: "UTR-TEN-1" }),
  },
  cancelExpense: {
    run: expenseActions.cancelExpense,
    ids: { expenseId: (f) => f.expense.id },
    base: () => ({ reason: "Tenancy probe" }),
  },
  reopenExpense: {
    run: expenseActions.reopenExpense,
    // reopen is only legal out of REJECTED; the APPROVED fixture voucher would
    // be refused by the workflow before tenancy ever came up.
    ids: { expenseId: (f) => f.rejectedExpense.id },
  },
};

const pettyCashSpecs: Record<string, Spec> = {
  createPettyCashFloat: {
    run: pettyCashActions.createPettyCashFloat,
    ids: { custodianId: (f) => f.custodian.id },
    base: () => ({ name: `Float ${++seq}`, floatAmount: "10000" }),
  },
  deactivatePettyCashFloat: {
    run: pettyCashActions.deactivatePettyCashFloat,
    ids: { id: (f) => f.float.id },
  },
  topUpPettyCash: {
    run: pettyCashActions.topUpPettyCash,
    ids: { floatId: (f) => f.float.id, sourceBankAccountId: (f) => f.bankAccount.id },
    base: () => ({ amount: "2500", topUpDate: DATE, remarks: "Tenancy probe" }),
  },
};

const MODULES = [
  { file: "beneficiaries/actions.ts", mod: beneficiaryActions, specs: beneficiarySpecs },
  { file: "projects/actions.ts", mod: projectActions, specs: projectSpecs },
  { file: "volunteers/actions.ts", mod: volunteerActions, specs: volunteerSpecs },
  { file: "volunteer-activities/actions.ts", mod: activityActions, specs: activitySpecs },
  { file: "expenses/actions.ts", mod: expenseActions, specs: expenseSpecs },
  { file: "petty-cash/actions.ts", mod: pettyCashActions, specs: pettyCashSpecs },
] as const;

/**
 * `managerId` names a User, not a row of the caller's tenant. Users are
 * cross-org by construction — one person can hold Memberships in several
 * organisations — and a session's organisation comes from a Membership
 * (src/auth.ts), so naming a foreign user as manager grants them nothing here
 * and takes nothing from there. It is the one caller-supplied `*Id` in these
 * files that does not address a tenant-owned row; every id that does is driven
 * below.
 */
const EXEMPT_ID_FIELDS = new Set(["managerId"]);

const ACTION_DECL = /^export const (\w+) = safeAction/gm;
const ID_FIELD = /^(id|\w+Ids?)$/;

function actionBlocks(src: string): Map<string, string> {
  const starts = [...src.matchAll(ACTION_DECL)].map((m) => ({
    name: m[1]!,
    at: m.index!,
  }));
  return new Map(
    starts.map((s, i) => [s.name, src.slice(s.at, starts[i + 1]?.at ?? src.length)]),
  );
}

/**
 * The ids an action takes from its caller: `parsedInput.projectId`, plus the
 * `id` the update actions pull out with `const { id, ...rest } = parsedInput`.
 */
function idFieldsIn(block: string): string[] {
  const found = new Set<string>();
  for (const m of block.matchAll(/parsedInput\.(\w+)/g)) {
    if (ID_FIELD.test(m[1]!)) found.add(m[1]!);
  }
  for (const m of block.matchAll(/const\s*\{([^}]*)\}\s*=\s*parsedInput/g)) {
    for (const part of m[1]!.split(",")) {
      const name = part.trim().split(/[:=]/)[0]!.trim();
      if (ID_FIELD.test(name)) found.add(name);
    }
  }
  return [...found];
}

function call(spec: Spec, input: Record<string, unknown>): Promise<ActionResult> {
  return (spec.run as unknown as (i: Record<string, unknown>) => Promise<ActionResult>)(
    input,
  );
}

// ---------------------------------------------------------------------------

let own: Fixture;
let victim: Fixture;

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
        pan: `AAATN999${id === ORG_A ? "1" : "2"}F`,
        email: "tenancy@testtrust.org",
        authorisedSignatoryName: "Test Signatory",
        authorisedSignatoryDesignation: "Trustee",
      },
    });
    // The half-open bands prisma/seed.ts plants. `approveExpense` refuses any
    // amount no band covers, and that refusal would stand in for a tenancy one.
    for (const p of [
      { minAmount: "0", maxAmount: "10000.01", requiredRole: "ACCOUNTANT" as const },
      { minAmount: "10000.01", maxAmount: "100000.01", requiredRole: "ADMIN" as const },
      { minAmount: "100000.01", maxAmount: null, requiredRole: "OWNER" as const },
    ]) {
      await prismaUnsafe.approvalPolicy.create({
        data: { organisationId: id, scope: "EXPENSE", ...p, level: 1, isActive: true },
      });
    }
  }
  await prismaUnsafe.user.create({
    data: { id: TEST_USER, email: "tenancy@rakshana.local", name: "Tenancy Test" },
  });
  await prismaUnsafe.membership.create({
    data: { userId: TEST_USER, organisationId: ORG_A, role: "OWNER" },
  });
  // Shared across the cross-tenant cases: a refused action writes nothing, so
  // these rows stay as seeded whatever order the suite is shuffled into. The
  // own-organisation cases each build their own fixture, because they do write.
  own = await makeFixture(ORG_A);
  victim = await makeFixture(ORG_B);
});

afterAll(async () => {
  await cleanup();
  await prismaUnsafe.$disconnect();
});

beforeEach(() => {
  getOrgScopeMock.mockReset();
  getOrgScopeMock.mockResolvedValue(scopeFor(ORG_A));
});

describe("action coverage", () => {
  for (const { file, mod, specs } of MODULES) {
    it(`${file}: every exported action is driven by a tenancy fixture`, () => {
      expect(Object.keys(mod).sort()).toEqual(Object.keys(specs).sort());
    });

    it(`${file}: every caller-supplied id is driven with a foreign value`, () => {
      const blocks = actionBlocks(readFileSync(new URL(file, import.meta.url), "utf8"));
      // An action the scanner cannot see is an action whose ids nobody checked.
      expect([...blocks.keys()].sort()).toEqual(Object.keys(specs).sort());
      for (const [name, block] of blocks) {
        const driven = new Set(Object.keys(specs[name]!.ids));
        for (const field of idFieldsIn(block)) {
          if (EXEMPT_ID_FIELDS.has(field)) continue;
          expect(
            driven.has(field),
            `${name} reads parsedInput.${field} but no fixture drives it with another organisation's id`,
          ).toBe(true);
        }
      }
    });
  }
});

/** `deleteMany()` or `deleteMany({})` — a delete with nothing to filter it. */
const UNSCOPED_DELETE = /\.deleteMany\(\s*(\)|\{\s*\}\s*\))/;

/**
 * The snapshots above are the whole proof, and they compare rows this suite
 * seeded against the same rows moments later. Vitest runs the test files in
 * parallel against one database, so an unfiltered `deleteMany` in any suite
 * empties another suite's table mid-assertion — the snapshot then reports a
 * cross-tenant write that never happened, or, worse, hides one behind the
 * noise. Every cleanup deletes only what its own fixture owns.
 */
it("no test suite deletes rows outside its own fixture", () => {
  const src = fileURLToPath(new URL("../../", import.meta.url));
  const offenders = readdirSync(src, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".test.ts") || f.endsWith(".test.tsx"))
    .filter((f) => UNSCOPED_DELETE.test(readFileSync(src + f, "utf8")));
  expect(
    offenders,
    "these suites delete every row of a table, including rows other suites are asserting on; scope the deleteMany to the fixture's own organisation",
  ).toEqual([]);
});

async function expectRefused(spec: Spec, input: Record<string, unknown>) {
  const [beforeVictim, beforeOwn] = await Promise.all([snapshot(ORG_B), snapshot(ORG_A)]);
  const result = await call(spec, input);

  expect(result.data).toBeUndefined();
  expect(result.serverError).toBeTruthy();
  expect(await snapshot(ORG_B)).toEqual(beforeVictim);
  expect(await snapshot(ORG_A)).toEqual(beforeOwn);
}

describe("cross-tenant writes are refused", () => {
  for (const { specs } of MODULES) {
    for (const [name, spec] of Object.entries(specs)) {
      const fields = Object.keys(spec.ids);
      // Every mix of own and foreign ids with at least one foreign. The mixed
      // pairs are the ones worth something to an attacker: they attach the
      // victim's row to something the attacker can read.
      for (let mask = 1; mask < 1 << fields.length; mask++) {
        const foreign = fields.filter((_, i) => mask & (1 << i));
        const label = fields
          .map((f) => `${foreign.includes(f) ? "foreign" : "own"} ${f}`)
          .join(" + ");

        it(`${name} refuses ${label}`, async () => {
          const input = { ...(spec.base?.() ?? {}) };
          for (const field of fields) {
            input[field] = spec.ids[field]!(foreign.includes(field) ? victim : own);
          }
          await expectRefused(spec, input);
        });
      }

      // Leaving an optional id out removes whatever cross-check it carried,
      // so the remaining foreign id has to be refused on its own.
      for (const omitted of spec.optionalIds ?? []) {
        const rest = fields.filter((f) => f !== omitted);
        it(`${name} refuses ${rest.map((f) => `foreign ${f}`).join(" + ")} with no ${omitted}`, async () => {
          const input = { ...(spec.base?.() ?? {}) };
          for (const field of rest) input[field] = spec.ids[field]!(victim);
          await expectRefused(spec, input);
        });
      }
    }
  }
});

/**
 * The reversal path, which no payload reaches: `reject` and `cancel` credit the
 * float named on the voucher, and the voucher is the caller's own. A voucher
 * raised before the expense actions resolved their ids can still carry another
 * trust's floatId, so the row is planted directly — the actions no longer let
 * one be created.
 */
const reversals: Record<string, (expenseId: string) => Promise<ActionResult>> = {
  rejectExpense: (expenseId) =>
    expenseActions.rejectExpense({ expenseId, notes: "Bill unreadable" }),
  cancelExpense: (expenseId) =>
    expenseActions.cancelExpense({ expenseId, reason: "Duplicate voucher" }),
};

describe("a voucher naming another trust's float cannot credit it back", () => {
  for (const [name, run] of Object.entries(reversals)) {
    it(`${name} refuses one and leaves that trust's cash register alone`, async () => {
      const planted = await prismaUnsafe.expense.create({
        data: {
          organisationId: ORG_A,
          voucherNumber: `TEN/LEG/${++seq}`,
          expenseDate: DATE,
          cashPayeeName: "Cash payee",
          grossAmount: "700",
          tdsAmount: "0",
          netPayable: "700",
          mode: "CASH",
          isPettyCash: true,
          pettyCashFloatId: victim.float.id,
          status: "PENDING_APPROVAL",
        },
      });
      const before = await snapshot(ORG_B);

      const result = await run(planted.id);

      expect(result.data).toBeUndefined();
      expect(result.serverError).toBeTruthy();
      expect(await snapshot(ORG_B)).toEqual(before);
    });
  }
});

/**
 * The other half of the contract. Without these, refusing everything would
 * pass the suite above.
 */
describe("own-organisation writes still succeed", () => {
  for (const { specs } of MODULES) {
    for (const [name, spec] of Object.entries(specs)) {
      it(`${name} accepts the caller's own ids`, async () => {
        const mine = await makeFixture(ORG_A);
        const input =
          spec.happy?.(mine) ??
          Object.entries(spec.ids).reduce(
            (acc, [field, pick]) => ({ ...acc, [field]: pick(mine) }),
            { ...(spec.base?.() ?? {}) },
          );

        const result = await call(spec, input);

        expect(result.serverError).toBeUndefined();
        expect(result.data).toBeTruthy();
      });
    }
  }
});
