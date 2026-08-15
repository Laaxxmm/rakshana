import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cross-tenant drive of every Server Action on the money-in side: donations,
 * the stall collection screen, donors, recurring-expense templates and the
 * compliance filings built on top of them.
 *
 * The models here mostly DO carry organisationId, which is what made them the
 * quiet half. The extension stamps the row with the caller's tenant and puts
 * an organisationId in every `where` — but it never looks at the ids INSIDE
 * `data`. A Donation lands in the caller's books holding another trust's
 * projectId; a Communication lands in the caller's books hanging off another
 * trust's donorId. Only a scoped read of each referenced row refuses that, and
 * `prismaUnsafe.$transaction` does not even get the row-level filtering, so
 * every id it touches has to have been proven outside it.
 *
 * Fixture-driven on purpose. `SPECS` below must name every exported action and
 * every id that action reads off its input, or the coverage tests fail — so an
 * action added to one of these files without a tenancy check cannot land
 * quietly.
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

// Razorpay is a live HTTP call to a third party. What is under test is which
// organisation the PaymentIntent lands in, not the vendor's API.
vi.mock("@/lib/payments/razorpay", () => ({
  createPaymentLink: async () => ({
    id: `plink_test_${randomUUID()}`,
    shortUrl: "https://rzp.test/link",
  }),
  createUpiQr: async () => ({ imageUrl: "https://rzp.test/qr.png" }),
}));

// `recordDonation` fires the receipt dispatcher from a microtask AFTER it
// returns, and the dispatcher writes Notification rows of its own. Left real,
// those writes land in the middle of whichever test the shuffle runs next and
// show up as a snapshot diff nobody made. Stubbed, every row written during a
// case is a row the action under test wrote.
vi.mock("@/lib/notify", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notify")>()),
  dispatchDonationReceipt: async () => ({
    sent: ["Email to donor"],
    failed: [],
    skipped: [],
  }),
  ensureReceiptPdf: async () => ({ url: "/api/files/test/receipt.pdf" }),
}));

const { prismaUnsafe } = await import("@/lib/db/prisma");
const donationActions = await import("./donations/actions");
const collectActions = await import("./donations/collect/actions");
const donorActions = await import("./donors/actions");
const recurringActions = await import("./recurring-expenses/actions");
const tenBdActions = await import("./compliance/10bd/actions");
const form10Actions = await import("./compliance/income-tax/form-10/actions");
const itr7Actions = await import("./compliance/income-tax/itr7/actions");
const calendarActions = await import("./compliance/calendar/actions");

const ORG_A = "test-org-money-in-a";
const ORG_B = "test-org-money-in-b";
const TEST_USER = "test-user-money-in";
const ORGS = [ORG_A, ORG_B];

const DATE = new Date("2025-06-11T09:00:00Z");
/** Recurring templates are seeded not-yet-due so the job only sees what a test plants. */
const NOT_YET_DUE = new Date("2030-01-10T00:00:00Z");
const PAST_DUE = new Date("2024-01-10T00:00:00Z");
/** The FY the compliance actions that take one from the caller are driven with. */
const FIXED_FY = "2024-25";

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
 * A filing is unique per (organisation, financialYear), so every fixture gets
 * its own FY and a donation dated inside it. Far enough back that the FY of
 * one fixture can never be the FY of the next, and a century clear of
 * FIXED_FY: the compliance actions write a filing for that year into the
 * caller's own books, so a fixture landing on it would collide on
 * (organisationId, financialYear) in whatever order the shuffle ran them.
 */
function fyFor(n: number): { fy: string; startYear: number; donationDate: Date } {
  const startYear = 1900 + n;
  const fy = `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
  if (fy === FIXED_FY) throw new Error(`fixture FY ${fy} collides with FIXED_FY`);
  return { fy, startYear, donationDate: new Date(Date.UTC(startYear, 5, 11)) };
}

/**
 * One organisation's worth of money-in rows: a project, a bank account, a
 * vendor and a category to point a template at, a donor with a receipted
 * donation, a 10BD filing already FILED with an ARN over that donation's FY,
 * an open accumulation, a recurring template and a payment intent still
 * awaiting the webhook.
 */
async function makeFixture(organisationId: string) {
  const n = ++seq;
  const pad = String(n).padStart(4, "0");
  const { fy, startYear, donationDate } = fyFor(n);

  const project = await prismaUnsafe.project.create({
    data: {
      organisationId,
      code: `MI/${pad}`,
      name: `Project ${n}`,
      status: "ACTIVE",
      totalBudget: "500000",
    },
  });
  const bankAccount = await prismaUnsafe.bankAccount.create({
    data: {
      organisationId,
      bankName: "Test Bank",
      branch: "Test Branch",
      accountNumber: `MIACC${pad}`,
      accountType: "SAVINGS",
      purpose: "GENERAL",
    },
  });
  const vendor = await prismaUnsafe.vendor.create({
    data: { organisationId, name: `Vendor ${n}` },
  });
  const category = await prismaUnsafe.expenseCategory.create({
    data: { organisationId, name: `Category ${n}` },
  });
  const donor = await prismaUnsafe.donor.create({
    data: {
      organisationId,
      donorType: "INDIVIDUAL",
      name: `Donor ${n}`,
      pan: `ABCMI${pad}F`,
      email: `donor-${pad}@example.org`,
      whatsapp: "9876543210",
      addressLine1: "4 Test Street",
      city: "Bengaluru",
      state: "Karnataka",
      stateCode: "29",
      pincode: "560001",
    },
  });
  const donation = await prismaUnsafe.donation.create({
    data: {
      organisationId,
      donorId: donor.id,
      bankAccountId: bankAccount.id,
      receiptNumber: `MI/RCT/${pad}`,
      donationDate,
      amount: "100000",
      mode: "NEFT",
      paymentRef: `UTR${pad}`,
      purpose: "GENERAL",
      is80GEligible: true,
      isInKind: false,
      status: "RECEIVED",
    },
  });
  const filing = await prismaUnsafe.form10BDFiling.create({
    data: {
      organisationId,
      financialYear: fy,
      filingStatus: "FILED",
      filedAt: new Date("2026-05-30T00:00:00Z"),
      arnNumber: `ARN${pad}9876543`,
    },
  });
  const accumulation = await prismaUnsafe.accumulation.create({
    data: {
      organisationId,
      financialYear: fy,
      amount: "50000",
      purpose: "Construction of a school building",
      periodYears: 5,
      startDate: new Date(Date.UTC(startYear, 3, 1)),
      endDate: new Date(Date.UTC(startYear + 5, 2, 31)),
      status: "ACTIVE",
    },
  });
  const recurring = await prismaUnsafe.recurringExpense.create({
    data: {
      organisationId,
      name: `Recurring ${n}`,
      vendorId: vendor.id,
      categoryId: category.id,
      projectId: project.id,
      amount: "5000.00",
      frequency: "MONTHLY",
      nextDueDate: NOT_YET_DUE,
      isActive: true,
    },
  });
  const paymentIntent = await prismaUnsafe.paymentIntent.create({
    data: {
      organisationId,
      razorpayOrderId: `plink_fixture_${randomUUID()}`,
      amount: "1500",
      status: "CREATED",
      donorName: `Stall donor ${n}`,
      purpose: "GENERAL",
    },
  });

  return {
    project,
    bankAccount,
    vendor,
    category,
    donor,
    donation,
    filing,
    accumulation,
    recurring,
    paymentIntent,
  };
}

type Fixture = Awaited<ReturnType<typeof makeFixture>>;

/**
 * Every row either side of the tenancy line, serialised in a stable order.
 * Prisma's Decimal and Date both carry a `toJSON`, so the string is the stored
 * values verbatim — a single changed rupee, status or `updatedAt` shows up as
 * a diff.
 */
async function snapshot(organisationId: string): Promise<string> {
  const org = { organisationId };
  const orderBy = { id: "asc" } as const;
  const rows = await Promise.all([
    prismaUnsafe.donor.findMany({ where: org, orderBy }),
    prismaUnsafe.donation.findMany({ where: org, orderBy }),
    prismaUnsafe.donationLineItem.findMany({ where: { donation: org }, orderBy }),
    prismaUnsafe.communication.findMany({ where: org, orderBy }),
    prismaUnsafe.bankAccount.findMany({ where: org, orderBy }),
    prismaUnsafe.project.findMany({ where: org, orderBy }),
    prismaUnsafe.vendor.findMany({ where: org, orderBy }),
    prismaUnsafe.expenseCategory.findMany({ where: org, orderBy }),
    prismaUnsafe.expense.findMany({ where: org, orderBy }),
    prismaUnsafe.recurringExpense.findMany({ where: org, orderBy }),
    prismaUnsafe.paymentIntent.findMany({ where: org, orderBy }),
    prismaUnsafe.receiptSeries.findMany({ where: org, orderBy }),
    prismaUnsafe.certificateSeries.findMany({ where: org, orderBy }),
    prismaUnsafe.form10BDFiling.findMany({ where: org, orderBy }),
    prismaUnsafe.form10BECertificate.findMany({ where: org, orderBy }),
    prismaUnsafe.itFiling.findMany({ where: org, orderBy }),
    prismaUnsafe.financialYearSummary.findMany({ where: org, orderBy }),
    prismaUnsafe.accumulation.findMany({ where: org, orderBy }),
    prismaUnsafe.complianceItem.findMany({ where: org, orderBy }),
    prismaUnsafe.notification.findMany({ where: org, orderBy }),
    prismaUnsafe.auditLog.findMany({ where: org, orderBy }),
  ]);
  return JSON.stringify(rows);
}

async function cleanup() {
  const org = { organisationId: { in: ORGS } };
  await prismaUnsafe.communication.deleteMany({ where: org });
  await prismaUnsafe.form10BECertificate.deleteMany({ where: org });
  await prismaUnsafe.paymentIntent.deleteMany({ where: org });
  await prismaUnsafe.donationLineItem.deleteMany({ where: { donation: org } });
  await prismaUnsafe.expense.deleteMany({ where: org });
  await prismaUnsafe.donation.deleteMany({ where: org });
  await prismaUnsafe.form10BDFiling.deleteMany({ where: org });
  await prismaUnsafe.recurringExpense.deleteMany({ where: org });
  await prismaUnsafe.donor.deleteMany({ where: org });
  await prismaUnsafe.receiptSeries.deleteMany({ where: org });
  await prismaUnsafe.certificateSeries.deleteMany({ where: org });
  await prismaUnsafe.bankAccount.deleteMany({ where: org });
  await prismaUnsafe.vendor.deleteMany({ where: org });
  await prismaUnsafe.expenseCategory.deleteMany({ where: org });
  await prismaUnsafe.project.deleteMany({ where: org });
  await prismaUnsafe.itFiling.deleteMany({ where: org });
  await prismaUnsafe.financialYearSummary.deleteMany({ where: org });
  await prismaUnsafe.accumulation.deleteMany({ where: org });
  await prismaUnsafe.complianceItem.deleteMany({ where: org });
  await prismaUnsafe.notification.deleteMany({ where: org });
  await prismaUnsafe.auditLog.deleteMany({ where: org });
  await prismaUnsafe.membership.deleteMany({ where: { userId: TEST_USER } });
  await prismaUnsafe.user.deleteMany({ where: { id: TEST_USER } });
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
   * foreign: a donation with no project to cross-check against is the shortest
   * way to book a receipt against someone else's bank account.
   */
  optionalIds?: string[];
  /** The rest of a valid payload. A function, so unique columns can vary. */
  base?: () => Record<string, unknown>;
  /**
   * Own-organisation payload, when `base` plus the caller's own ids would be
   * refused for a reason other than tenancy.
   */
  happy?: (f: Fixture) => Record<string, unknown>;
};

const donationSpecs: Record<string, Spec> = {
  recordDonation: {
    run: donationActions.recordDonation,
    ids: {
      donorId: (f) => f.donor.id,
      projectId: (f) => f.project.id,
      bankAccountId: (f) => f.bankAccount.id,
    },
    // CASH + GENERAL is the payload where the schema demands neither, which is
    // also the payload with no cross-field rule left to refuse a foreign id
    // for the wrong reason.
    optionalIds: ["projectId", "bankAccountId"],
    base: () => ({
      donationDate: DATE,
      amount: "5000",
      mode: "CASH",
      purpose: "GENERAL",
      is80GEligible: true,
      remarks: "Tenancy probe",
    }),
  },
  cancelDonation: {
    run: donationActions.cancelDonation,
    ids: { donationId: (f) => f.donation.id },
    base: () => ({ reason: "Cheque returned unpaid" }),
  },
  regenerateReceipt: {
    run: donationActions.regenerateReceipt,
    ids: { donationId: (f) => f.donation.id },
  },
  prepareReceiptDownload: {
    run: donationActions.prepareReceiptDownload,
    ids: { donationId: (f) => f.donation.id },
  },
  resendReceipt: {
    run: donationActions.resendReceipt,
    ids: { donationId: (f) => f.donation.id },
  },
  prepareWhatsAppLink: {
    run: donationActions.prepareWhatsAppLink,
    ids: { donationId: (f) => f.donation.id },
  },
  markWhatsAppSent: {
    run: donationActions.markWhatsAppSent,
    ids: { donationId: (f) => f.donation.id },
  },
};

const collectSpecs: Record<string, Spec> = {
  createCollectionLink: {
    run: collectActions.createCollectionLink,
    ids: {},
    base: () => ({
      amount: "1500",
      donorName: "Stall donor",
      donorPhone: "9876543210",
    }),
  },
  getCollectionStatus: {
    run: collectActions.getCollectionStatus,
    ids: { paymentIntentId: (f) => f.paymentIntent.id },
  },
};

const donorSpecs: Record<string, Spec> = {
  createDonor: {
    run: donorActions.createDonor,
    ids: {},
    base: () => ({ donorType: "INDIVIDUAL", name: `Donor ${++seq}` }),
  },
  updateDonor: {
    run: donorActions.updateDonor,
    ids: { id: (f) => f.donor.id },
    base: () => ({ donorType: "INDIVIDUAL", name: "Renamed donor", pan: null }),
  },
  softDeleteDonor: {
    run: donorActions.softDeleteDonor,
    ids: { id: (f) => f.donor.id },
  },
  createDonorMini: {
    run: donorActions.createDonorMini,
    ids: {},
    base: () => ({ donorType: "INDIVIDUAL", name: `Mini donor ${++seq}` }),
  },
  addCommunication: {
    run: donorActions.addCommunication,
    ids: { donorId: (f) => f.donor.id },
    base: () => ({
      channel: "CALL",
      direction: "OUTBOUND",
      subject: "Thank-you call",
      body: "Spoke to the donor about the annual report.",
      occurredAt: DATE,
    }),
  },
};

const recurringSpecs: Record<string, Spec> = {
  createRecurringExpense: {
    run: recurringActions.createRecurringExpense,
    ids: {
      vendorId: (f) => f.vendor.id,
      categoryId: (f) => f.category.id,
      projectId: (f) => f.project.id,
    },
    optionalIds: ["vendorId", "categoryId", "projectId"],
    base: () => ({
      name: `Recurring ${++seq}`,
      amount: "5000",
      frequency: "MONTHLY",
      nextDueDate: NOT_YET_DUE,
    }),
  },
  pauseRecurringExpense: {
    run: recurringActions.pauseRecurringExpense,
    ids: { id: (f) => f.recurring.id },
  },
  runRecurringJob: {
    run: recurringActions.runRecurringJob,
    ids: {},
    base: () => ({}),
  },
};

const tenBdSpecs: Record<string, Spec> = {
  createFilingAction: {
    run: tenBdActions.createFilingAction,
    ids: {},
    base: () => ({ financialYear: FIXED_FY }),
  },
  refreshAggregateAction: {
    run: tenBdActions.refreshAggregateAction,
    ids: { filingId: (f) => f.filing.id },
  },
  generateCsvAction: {
    run: tenBdActions.generateCsvAction,
    ids: { filingId: (f) => f.filing.id },
  },
  markFiledAction: {
    run: tenBdActions.markFiledAction,
    ids: { filingId: (f) => f.filing.id },
    base: () => ({ arnNumber: "ARN000123456", filedAt: "2026-05-30" }),
  },
  generateOne10BeAction: {
    run: tenBdActions.generateOne10BeAction,
    ids: { filingId: (f) => f.filing.id, donorId: (f) => f.donor.id },
  },
  bulkGenerate10BeAction: {
    run: tenBdActions.bulkGenerate10BeAction,
    ids: { filingId: (f) => f.filing.id },
  },
};

const form10Specs: Record<string, Spec> = {
  createAccumulationAction: {
    run: form10Actions.createAccumulationAction,
    ids: {},
    base: () => ({
      financialYear: FIXED_FY,
      amount: "100000",
      purpose: "Construction of a school building",
      periodYears: 5,
    }),
  },
  closeAccumulationAction: {
    run: form10Actions.closeAccumulationAction,
    ids: { id: (f) => f.accumulation.id },
    base: () => ({ newStatus: "UTILISED" }),
  },
};

const itr7Specs: Record<string, Spec> = {
  computeAction: {
    run: itr7Actions.computeAction,
    ids: {},
    base: () => ({ financialYear: FIXED_FY }),
  },
  exportExcelAction: {
    run: itr7Actions.exportExcelAction,
    ids: {},
    base: () => ({ financialYear: FIXED_FY }),
  },
};

const calendarSpecs: Record<string, Spec> = {
  regenerateCalendarAction: {
    run: calendarActions.regenerateCalendarAction,
    ids: {},
    base: () => ({}),
  },
};

const MODULES = [
  { file: "donations/actions.ts", mod: donationActions, specs: donationSpecs },
  { file: "donations/collect/actions.ts", mod: collectActions, specs: collectSpecs },
  { file: "donors/actions.ts", mod: donorActions, specs: donorSpecs },
  { file: "recurring-expenses/actions.ts", mod: recurringActions, specs: recurringSpecs },
  { file: "compliance/10bd/actions.ts", mod: tenBdActions, specs: tenBdSpecs },
  {
    file: "compliance/income-tax/form-10/actions.ts",
    mod: form10Actions,
    specs: form10Specs,
  },
  { file: "compliance/income-tax/itr7/actions.ts", mod: itr7Actions, specs: itr7Specs },
  { file: "compliance/calendar/actions.ts", mod: calendarActions, specs: calendarSpecs },
] as const;

/**
 * Empty, and it stays empty: every `*Id` these files take off a request names a
 * row owned by one tenant — a donor, a donation, a project, a bank account, a
 * vendor, a category, a filing, an accumulation, a payment intent. There is no
 * cross-org id among them to exempt.
 */
const EXEMPT_ID_FIELDS = new Set<string>([]);

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
/** Strings only the victim's trust is entitled to read. */
let victimStrings: string[];

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
        pan: `AAAMI888${id === ORG_A ? "1" : "2"}F`,
        email: "money-in@testtrust.org",
        authorisedSignatoryName: "Test Signatory",
        authorisedSignatoryDesignation: "Trustee",
      },
    });
  }
  await prismaUnsafe.user.create({
    data: { id: TEST_USER, email: "money-in@rakshana.local", name: "Money-in Test" },
  });
  await prismaUnsafe.membership.create({
    data: { userId: TEST_USER, organisationId: ORG_A, role: "OWNER" },
  });
  // Shared across the cross-tenant cases: a refused action writes nothing, so
  // these rows stay as seeded whatever order the suite is shuffled into. The
  // own-organisation cases each build their own fixture, because they do write.
  own = await makeFixture(ORG_A);
  victim = await makeFixture(ORG_B);
  victimStrings = [
    victim.donor.name,
    victim.donor.pan!,
    victim.donor.email!,
    victim.donation.receiptNumber,
    victim.project.code,
    victim.project.name,
    victim.vendor.name,
    victim.category.name,
    victim.bankAccount.accountNumber,
    victim.filing.arnNumber!,
    victim.accumulation.purpose,
    victim.recurring.name,
  ];
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

async function expectRefused(spec: Spec, input: Record<string, unknown>) {
  const [beforeVictim, beforeOwn] = await Promise.all([snapshot(ORG_B), snapshot(ORG_A)]);
  const result = await call(spec, input);

  expect(result.data).toBeUndefined();
  expect(result.serverError).toBeTruthy();
  // A refusal must not describe what it refused. The 10BE generator used to
  // name the foreign donor in the message it threw, which handed over a row
  // the caller had just been told they could not have.
  for (const secret of victimStrings) {
    expect(result.serverError).not.toContain(secret);
  }
  expect(await snapshot(ORG_B)).toBe(beforeVictim);
  expect(await snapshot(ORG_A)).toBe(beforeOwn);
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

/**
 * The second half of the recurring-expense hole. `createRecurringExpense` now
 * resolves its three ids, but RecurringExpense declares them as plain columns
 * with no relation, so rows written before that — or by any other route — can
 * still hold a foreign one, and the runner is what turns a template into a
 * real voucher. A reviewer reading only the create sees nothing wrong.
 */
describe("the recurring runner refuses a template that already holds a foreign id", () => {
  it("books the own-organisation template and leaves the foreign one due", async () => {
    const planted = await prismaUnsafe.recurringExpense.create({
      data: {
        organisationId: ORG_A,
        name: "Planted foreign template",
        vendorId: victim.vendor.id,
        categoryId: victim.category.id,
        projectId: victim.project.id,
        amount: "9000.00",
        frequency: "MONTHLY",
        nextDueDate: PAST_DUE,
        isActive: true,
      },
    });
    const local = await prismaUnsafe.recurringExpense.create({
      data: {
        organisationId: ORG_A,
        name: "Planted local template",
        vendorId: own.vendor.id,
        categoryId: own.category.id,
        projectId: own.project.id,
        amount: "4000.00",
        frequency: "MONTHLY",
        nextDueDate: PAST_DUE,
        isActive: true,
      },
    });

    const beforeVictim = await snapshot(ORG_B);
    try {
      const result = await call(recurringSpecs["runRecurringJob"]!, {});

      expect(result.serverError).toBeUndefined();
      expect(result.data).toMatchObject({
        draftsCreated: 1,
        skippedForeignReference: 1,
      });
      // Nothing generated, and the template is left due and unstamped so it
      // resurfaces on the next run rather than being quietly consumed.
      expect(
        await prismaUnsafe.expense.count({ where: { recurringTemplateId: planted.id } }),
      ).toBe(0);
      const after = await prismaUnsafe.recurringExpense.findUniqueOrThrow({
        where: { id: planted.id },
      });
      expect(after.lastGeneratedFor).toBeNull();
      expect(after.nextDueDate.toISOString()).toBe(PAST_DUE.toISOString());
      // The voucher that was written points only at the caller's own rows.
      const generated = await prismaUnsafe.expense.findMany({
        where: { recurringTemplateId: local.id },
      });
      expect(generated).toHaveLength(1);
      expect(generated[0]).toMatchObject({
        organisationId: ORG_A,
        vendorId: own.vendor.id,
        categoryId: own.category.id,
        projectId: own.project.id,
      });
      expect(await snapshot(ORG_B)).toBe(beforeVictim);
    } finally {
      await prismaUnsafe.expense.deleteMany({
        where: { recurringTemplateId: { in: [planted.id, local.id] } },
      });
      await prismaUnsafe.recurringExpense.deleteMany({
        where: { id: { in: [planted.id, local.id] } },
      });
    }
  });
});
