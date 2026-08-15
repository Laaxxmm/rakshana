import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cross-tenant drive of the Server Actions the other two tenancy suites do not
 * reach: vendors and LDCs, notifications, reports, organisation settings
 * (banking, legal documents, branding), members, the account password, the
 * donor CSV import and the four read-only search actions.
 *
 * `src/app/(app)/tenancy.test.ts` covers beneficiaries, projects, volunteers,
 * expenses and petty cash; `src/app/(app)/tenancy-money-in.test.ts` covers
 * donations, donors, recurring expenses and the compliance filings. Between the
 * three, every file in the repository carrying `"use server"` is driven —
 * `src/app/(auth)/login/actions.ts` excepted, which takes no id and is checked
 * by the auth tests.
 *
 * Same contract as the other two: resolve every caller-supplied id through the
 * scoped `prisma` client before the write, and write the resolved row's id. The
 * coverage tests below fail if an action is added to one of these files without
 * a fixture driving each of its ids, so an unguarded one cannot land quietly.
 *
 * Read-only actions are here too. A search that leaks a name is a smaller loss
 * than a write that moves money, but it is the same boundary, and the four
 * search paths are the only actions in the app whose whole job is to return
 * rows matching a string the caller typed.
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
const { storage } = await import("@/lib/storage");
const vendorActions = await import("./vendors/actions");
const notificationActions = await import("./notifications/actions");
const reportActions = await import("./reports/actions");
const orgActions = await import("./settings/organisation/actions");
const memberActions = await import("./settings/members/actions");
const accountActions = await import("./settings/account/actions");
const sponsorshipActions = await import("./settings/sponsorship/actions");
const importActions = await import("./donors/import/actions");
const donorSearchActions = await import("./donations/new/donor-search");
const vendorSearchActions = await import("./expenses/new/vendor-search");
const searchActions = await import("@/lib/actions/search");

const ORG_A = "test-org-tensettings-a";
const ORG_B = "test-org-tensettings-b";
const TEST_USER = "test-user-tensettings";
/** Per-fixture member users and the ones `addMember` creates. */
const MEMBER_PREFIX = "tensettings-member-";
const ORGS = [ORG_A, ORG_B];

const DATE = new Date("2025-06-11T09:00:00Z");
const PERIOD_FROM = new Date("2025-04-01T00:00:00Z");
const PERIOD_TO = new Date("2026-03-31T00:00:00Z");
const FIXED_FY = "2025-26";

/** The caller's own password, and the one `changePassword` rotates it to. */
const OWN_PASSWORD = "TenSettings0ld!";
const NEXT_PASSWORD = "TenSettingsNew1!";

/** A 1x1 PNG — the smallest thing `validateUpload` accepts. */
const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

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
 * One organisation's worth of rows for these files: a vendor and an LDC, an
 * unread notification, a finished report, two active bank accounts (one
 * primary, so `deactivateBankAccount` has a legal target and the last-active
 * guard never stands in for a tenancy refusal), a legal document, and a second
 * member whose membership the role actions can move without touching the
 * caller's own owner seat.
 */
async function makeFixture(organisationId: string) {
  const n = ++seq;
  const pad = String(n).padStart(4, "0");
  const vendor = await prismaUnsafe.vendor.create({
    data: {
      organisationId,
      name: `Vendor ${n}`,
      pan: `AAACV${pad}K`,
      defaultTdsSection: "194C",
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
  const notification = await prismaUnsafe.notification.create({
    data: {
      organisationId,
      channel: "IN_APP",
      title: `Renewal due ${n}`,
      body: "The 80G registration expires this quarter.",
      isRead: false,
    },
  });
  const report = await prismaUnsafe.report.create({
    data: {
      organisationId,
      reportType: "PROJECT_UTILISATION",
      params: { financialYear: FIXED_FY },
      status: "READY",
      excelStorageKey: `org/${organisationId}/reports/${pad}.xlsx`,
      excelUrl: `/api/files/org/${organisationId}/reports/${pad}.xlsx`,
    },
  });
  const sponsorshipItem = await prismaUnsafe.sponsorshipItem.create({
    data: {
      organisationId,
      category: "CHILDREN_EDUCATION",
      label: `School bag & shoes per child ${pad}`,
      amount: "1500",
      unitNoun: "child",
      sortOrder: 0,
    },
  });
  const primaryBank = await prismaUnsafe.bankAccount.create({
    data: {
      organisationId,
      bankName: "HDFC Bank",
      accountNumber: `5${pad}00000000`,
      ifsc: "HDFC0000301",
      accountType: "CURRENT",
      purpose: "GENERAL",
      isPrimary: true,
    },
  });
  const spareBank = await prismaUnsafe.bankAccount.create({
    data: {
      organisationId,
      bankName: "SBI",
      accountNumber: `6${pad}00000000`,
      ifsc: "SBIN0000301",
      accountType: "SAVINGS",
      purpose: "GENERAL",
    },
  });
  const orgDocument = await prismaUnsafe.orgDocument.create({
    data: {
      organisationId,
      category: "TRUST_DEED",
      title: `Trust deed ${n}`,
      fileUrl: `/api/files/org/${organisationId}/documents/${pad}.pdf`,
      mimeType: "application/pdf",
      fileSize: 1024,
    },
  });
  const memberUser = await prismaUnsafe.user.create({
    data: {
      id: `${MEMBER_PREFIX}${pad}`,
      email: `member-${pad}@rakshana.local`,
      name: `Member ${n}`,
    },
  });
  const membership = await prismaUnsafe.membership.create({
    data: { userId: memberUser.id, organisationId, role: "ACCOUNTANT" },
  });

  return {
    vendor,
    ldc,
    notification,
    report,
    sponsorshipItem,
    primaryBank,
    spareBank,
    orgDocument,
    memberUser,
    membership,
  };
}

type Fixture = Awaited<ReturnType<typeof makeFixture>>;

/**
 * Every row either side of the tenancy line, serialised in a stable order.
 * Prisma's Decimal and Date both carry a `toJSON`, so the string is the stored
 * values verbatim — a flipped `isPrimary`, a read notification or a soft-delete
 * timestamp shows up as a diff.
 *
 * The Organisation row is in here too: half the actions in the settings file
 * write it directly, and it is the only row an action can reach without an id.
 */
async function snapshot(organisationId: string): Promise<string> {
  const org = { organisationId };
  const orderBy = { id: "asc" } as const;
  const rows = await Promise.all([
    prismaUnsafe.organisation.findMany({ where: { id: organisationId } }),
    prismaUnsafe.membership.findMany({ where: org, orderBy }),
    prismaUnsafe.vendor.findMany({ where: org, orderBy }),
    prismaUnsafe.ldcCertificate.findMany({ where: org, orderBy }),
    prismaUnsafe.notification.findMany({ where: org, orderBy }),
    prismaUnsafe.report.findMany({ where: org, orderBy }),
    prismaUnsafe.bankAccount.findMany({ where: org, orderBy }),
    prismaUnsafe.orgDocument.findMany({ where: org, orderBy }),
    prismaUnsafe.donor.findMany({ where: org, orderBy }),
    prismaUnsafe.twelveARegistration.findMany({ where: org, orderBy }),
    prismaUnsafe.eightyGRegistration.findMany({ where: org, orderBy }),
    prismaUnsafe.fcraRegistration.findMany({ where: org, orderBy }),
    prismaUnsafe.darpanRegistration.findMany({ where: org, orderBy }),
    prismaUnsafe.csrOneRegistration.findMany({ where: org, orderBy }),
    prismaUnsafe.complianceItem.findMany({ where: org, orderBy }),
    prismaUnsafe.auditLog.findMany({ where: org, orderBy }),
  ]);
  return JSON.stringify(rows);
}

async function cleanup() {
  const org = { organisationId: { in: ORGS } };
  await prismaUnsafe.auditLog.deleteMany({ where: org });
  await prismaUnsafe.notification.deleteMany({ where: org });
  await prismaUnsafe.complianceItem.deleteMany({ where: org });
  await prismaUnsafe.report.deleteMany({ where: org });
  await prismaUnsafe.orgDocument.updateMany({
    where: org,
    data: { replacedById: null },
  });
  await prismaUnsafe.orgDocument.deleteMany({ where: org });
  await prismaUnsafe.ldcCertificate.deleteMany({ where: org });
  await prismaUnsafe.vendor.deleteMany({ where: org });
  await prismaUnsafe.bankAccount.deleteMany({ where: org });
  // Donation → Donor and Donation → Project, so the donations go first.
  await prismaUnsafe.donation.deleteMany({ where: org });
  await prismaUnsafe.donor.deleteMany({ where: org });
  await prismaUnsafe.project.deleteMany({ where: org });
  await prismaUnsafe.twelveARegistration.deleteMany({ where: org });
  await prismaUnsafe.eightyGRegistration.deleteMany({ where: org });
  await prismaUnsafe.fcraRegistration.deleteMany({ where: org });
  await prismaUnsafe.darpanRegistration.deleteMany({ where: org });
  await prismaUnsafe.csrOneRegistration.deleteMany({ where: org });
  await prismaUnsafe.membership.deleteMany({ where: { userId: TEST_USER } });
  await prismaUnsafe.user.deleteMany({ where: { id: TEST_USER } });
  // Memberships cascade off the user.
  await prismaUnsafe.user.deleteMany({ where: { id: { startsWith: MEMBER_PREFIX } } });
  await prismaUnsafe.user.deleteMany({
    where: { email: { startsWith: "tensettings-invited-" } },
  });
  await prismaUnsafe.organisation.deleteMany({ where: { id: { in: ORGS } } });
}

// ---------------------------------------------------------------------------
// Action fixtures
// ---------------------------------------------------------------------------

type ActionResult = { data?: unknown; serverError?: string; validationErrors?: unknown };
type IdPick = (f: Fixture) => unknown;

type Spec = {
  run: (input: never) => Promise<ActionResult>;
  /** Every id the action takes from its caller, and where to find one. */
  ids: Record<string, IdPick>;
  /** Ids the input schema lets the caller leave out. Driven absent as well. */
  optionalIds?: string[];
  /** The rest of a valid payload. A function, so unique columns can vary. */
  base?: () => Record<string, unknown>;
  /**
   * Own-organisation payload, when `base` plus the caller's own ids would be
   * refused for a reason other than tenancy.
   */
  happy?: (f: Fixture) => Record<string, unknown>;
  /**
   * A refusal this action returns as a Zod field error rather than a thrown
   * one — `returnValidationErrors` puts it in `validationErrors` and leaves
   * `serverError` undefined.
   */
  refusesViaValidation?: boolean;
  /**
   * The action reports `{ ok: true }` for a foreign id instead of throwing,
   * because its whole write is a `deleteMany`/`updateMany` filtered by the
   * session's organisationId — a foreign id matches no row and nothing
   * happens. The tenancy assertion is then the snapshot alone: no row of
   * either organisation may move. Set only where that filter is on the write
   * itself and visible in the action, never to excuse a missing check.
   */
  refusesSilently?: boolean;
};

const vendorSpecs: Record<string, Spec> = {
  createVendor: {
    run: vendorActions.createVendor,
    ids: {},
    base: () => ({ name: `Vendor ${++seq}` }),
  },
  updateVendor: {
    run: vendorActions.updateVendor,
    ids: { id: (f) => f.vendor.id },
    base: () => ({ name: "Renamed vendor" }),
  },
  softDeleteVendor: {
    run: vendorActions.softDeleteVendor,
    ids: { id: (f) => f.vendor.id },
  },
  createLdc: {
    run: vendorActions.createLdc,
    ids: {},
    base: () => ({
      deducteeName: "Deductee",
      deducteePan: "AAACD1234K",
      section: "194C",
      certNumber: `LDC/NEW/${++seq}`,
      lowerRate: 1,
      validFrom: PERIOD_FROM,
      validTo: PERIOD_TO,
    }),
  },
  deleteLdc: {
    run: vendorActions.deleteLdc,
    ids: { id: (f) => f.ldc.id },
  },
};

const notificationSpecs: Record<string, Spec> = {
  markAllNotificationsRead: {
    run: notificationActions.markAllNotificationsRead,
    ids: {},
    base: () => ({}),
  },
  markNotificationRead: {
    run: notificationActions.markNotificationRead,
    ids: { id: (f) => f.notification.id },
  },
};

/**
 * `generateReport` takes no top-level id: the ids it accepts ride inside
 * `params`, which the wizard fills from the caller's own pickers. The foreign
 * `params.projectId` case is driven on its own below, because what has to be
 * proved there is not a refusal but an empty workbook.
 */
const reportSpecs: Record<string, Spec> = {
  generateReport: {
    run: reportActions.generateReport,
    ids: {},
    base: () => ({
      slug: "project-utilisation",
      params: { financialYear: FIXED_FY },
    }),
  },
  deleteReport: {
    run: reportActions.deleteReport,
    ids: { id: (f) => f.report.id },
  },
};

const orgSpecs: Record<string, Spec> = {
  updateIdentity: {
    run: orgActions.updateIdentity,
    ids: {},
    base: () => ({
      name: "Test Trust",
      legalName: "Test Charitable Trust",
      registrationType: "TRUST",
      addressLine1: "12 Test Road",
      city: "Bengaluru",
      state: "Karnataka",
      pincode: "560001",
      pan: "AAATN8881F",
      email: "tenancy@testtrust.org",
    }),
  },
  updateAuthorisedSignatory: {
    run: orgActions.updateAuthorisedSignatory,
    ids: {},
    base: () => ({
      authorisedSignatoryName: "Test Signatory",
      authorisedSignatoryDesignation: "Trustee",
    }),
  },
  upsertTwelveA: {
    run: orgActions.upsertTwelveA,
    ids: {},
    base: () => ({
      number: "AAATN8881FF20214",
      registrationDate: PERIOD_FROM,
      validityEndDate: PERIOD_TO,
    }),
  },
  upsertEightyG: {
    run: orgActions.upsertEightyG,
    ids: {},
    base: () => ({
      number: "AAATN8881FF20215",
      approvalDate: PERIOD_FROM,
      validityEndDate: PERIOD_TO,
    }),
  },
  upsertFcra: {
    run: orgActions.upsertFcra,
    ids: {},
    base: () => ({
      number: "094421234",
      registrationDate: PERIOD_FROM,
      validityEndDate: PERIOD_TO,
      fcraBankName: "SBI New Delhi Main Branch",
      fcraBankAccountNumber: "409000123456",
      fcraBankIfsc: "SBIN0000691",
    }),
  },
  upsertDarpan: {
    run: orgActions.upsertDarpan,
    ids: {},
    base: () => ({ darpanId: "KA/2021/0123456" }),
  },
  upsertCsrOne: {
    run: orgActions.upsertCsrOne,
    ids: {},
    base: () => ({ csrOneRef: "CSR00012345" }),
  },
  createBankAccount: {
    run: orgActions.createBankAccount,
    ids: {},
    base: () => ({
      bankName: "Canara Bank",
      accountNumber: `7${String(++seq).padStart(4, "0")}00000000`,
      ifsc: "CNRB0000301",
      accountType: "CURRENT",
      purpose: "GENERAL",
      // Primary on purpose: this is the payload that runs the unscoped
      // demote/promote transaction.
      isPrimary: true,
    }),
  },
  updateBankAccount: {
    run: orgActions.updateBankAccount,
    ids: { id: (f) => f.spareBank.id },
    base: () => ({
      bankName: "SBI",
      accountNumber: `8${String(++seq).padStart(4, "0")}00000000`,
      ifsc: "SBIN0000301",
      accountType: "SAVINGS",
      purpose: "GENERAL",
      isPrimary: true,
    }),
  },
  setPrimaryBank: {
    run: orgActions.setPrimaryBank,
    ids: { id: (f) => f.spareBank.id },
  },
  deactivateBankAccount: {
    run: orgActions.deactivateBankAccount,
    // spareBank, not primaryBank: deactivating a primary is refused by a rule
    // of its own, and that refusal would stand in for a tenancy one.
    ids: { id: (f) => f.spareBank.id },
  },
  updateBrandingText: {
    run: orgActions.updateBrandingText,
    ids: {},
    base: () => ({ receiptHeaderText: "Thank you", receiptFooterText: "80G applies" }),
  },
  uploadOrgDocument: {
    run: orgActions.uploadOrgDocument,
    ids: {},
    base: () => ({
      category: "TRUST_DEED",
      title: `Trust deed ${++seq}`,
      filename: "deed.png",
      claimedMime: "image/png",
      fileBytes: TINY_PNG,
    }),
  },
  replaceOrgDocument: {
    run: orgActions.replaceOrgDocument,
    ids: { id: (f) => f.orgDocument.id },
    base: () => ({
      filename: "deed.png",
      claimedMime: "image/png",
      fileBytes: TINY_PNG,
    }),
  },
  deleteOrgDocument: {
    run: orgActions.deleteOrgDocument,
    ids: { id: (f) => f.orgDocument.id },
  },
  uploadBrandingAsset: {
    run: orgActions.uploadBrandingAsset,
    ids: {},
    base: () => ({
      target: "logo",
      filename: "logo.png",
      claimedMime: "image/png",
      fileBytes: TINY_PNG,
    }),
  },
};

const memberSpecs: Record<string, Spec> = {
  addMember: {
    run: memberActions.addMember,
    ids: {},
    base: () => {
      const pad = String(++seq).padStart(4, "0");
      return {
        name: `Invited ${pad}`,
        email: `tensettings-invited-${pad}@rakshana.local`,
        role: "ACCOUNTANT",
        password: "InvitedPass1!",
        confirmPassword: "InvitedPass1!",
      };
    },
  },
  changeMemberRole: {
    run: memberActions.changeMemberRole,
    ids: { membershipId: (f) => f.membership.id },
    base: () => ({ role: "ADMIN" }),
  },
  setMemberAccess: {
    run: memberActions.setMemberAccess,
    ids: { membershipId: (f) => f.membership.id },
    base: () => ({ isActive: false }),
  },
};

/**
 * `changePassword` takes no id at all — the row it writes is the session's own
 * user. Driven here so the coverage scan can see it, and so the happy path
 * proves the rotation still works.
 */
const accountSpecs: Record<string, Spec> = {
  changePassword: {
    run: accountActions.changePassword,
    ids: {},
    base: () => ({
      currentPassword: OWN_PASSWORD,
      newPassword: NEXT_PASSWORD,
      confirmPassword: NEXT_PASSWORD,
    }),
  },
};

const IMPORT_CSV =
  "donorType,name,pan\nINDIVIDUAL,Imported Donor,ABCPI1234K\n";

const importSpecs: Record<string, Spec> = {
  previewImport: {
    run: importActions.previewImport,
    ids: {},
    base: () => ({ csvText: IMPORT_CSV }),
  },
  commitImport: {
    run: importActions.commitImport,
    ids: {},
    base: () => ({
      csvText: `donorType,name,pan\nINDIVIDUAL,Imported Donor ${++seq},ABCPI${String(
        seq,
      ).padStart(4, "0")}K\n`,
    }),
  },
};

const donorSearchSpecs: Record<string, Spec> = {
  searchDonors: {
    run: donorSearchActions.searchDonors,
    ids: {},
    base: () => ({ q: "Donor" }),
  },
};

const vendorSearchSpecs: Record<string, Spec> = {
  searchVendors: {
    run: vendorSearchActions.searchVendors,
    ids: {},
    base: () => ({ q: "Vendor" }),
  },
};

const globalSearchSpecs: Record<string, Spec> = {
  searchEverything: {
    run: searchActions.searchEverything,
    ids: {},
    base: () => ({ q: "Vendor" }),
  },
};

const sponsorshipSpecs: Record<string, Spec> = {
  createSponsorshipItem: {
    run: sponsorshipActions.createSponsorshipItem,
    ids: {},
    base: () => ({
      category: "CHILDREN_EDUCATION",
      label: "Uniform set from a tenancy probe",
      amount: "3250",
      unitNoun: "child",
      sortOrder: 1,
    }),
  },
  updateSponsorshipItem: {
    run: sponsorshipActions.updateSponsorshipItem,
    ids: { id: (f) => f.sponsorshipItem.id },
    // Every field the schema requires, so a refusal here is the tenancy check
    // and not a validation error wearing its clothes.
    base: () => ({
      category: "CHILDREN_EDUCATION",
      label: "Repriced by another trust",
      amount: "9999",
      unitNoun: "child",
      sortOrder: 0,
    }),
  },
  setSponsorshipItemActive: {
    run: sponsorshipActions.setSponsorshipItemActive,
    ids: { id: (f) => f.sponsorshipItem.id },
    base: () => ({ isActive: false }),
  },
};

const MODULES = [
  { file: "vendors/actions.ts", mod: vendorActions, specs: vendorSpecs },
  { file: "notifications/actions.ts", mod: notificationActions, specs: notificationSpecs },
  { file: "reports/actions.ts", mod: reportActions, specs: reportSpecs },
  { file: "settings/organisation/actions.ts", mod: orgActions, specs: orgSpecs },
  { file: "settings/members/actions.ts", mod: memberActions, specs: memberSpecs },
  { file: "settings/account/actions.ts", mod: accountActions, specs: accountSpecs },
  { file: "settings/sponsorship/actions.ts", mod: sponsorshipActions, specs: sponsorshipSpecs },
  { file: "donors/import/actions.ts", mod: importActions, specs: importSpecs },
  { file: "donations/new/donor-search.ts", mod: donorSearchActions, specs: donorSearchSpecs },
  { file: "expenses/new/vendor-search.ts", mod: vendorSearchActions, specs: vendorSearchSpecs },
  { file: "../../lib/actions/search.ts", mod: searchActions, specs: globalSearchSpecs },
] as const;

/**
 * `uploadedById`, `generatedById` and the rest are written from `ctx.scope`,
 * never from a payload. Nothing in these files takes a cross-org id off its
 * caller, so nothing is exempt.
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
        pan: `AAATN888${id === ORG_A ? "1" : "2"}F`,
        email: "tenancy@testtrust.org",
        authorisedSignatoryName: "Test Signatory",
        authorisedSignatoryDesignation: "Trustee",
      },
    });
  }
  const { hash } = await import("bcryptjs");
  await prismaUnsafe.user.create({
    data: {
      id: TEST_USER,
      email: "tensettings@rakshana.local",
      name: "Tenancy Settings Test",
      // `changePassword` checks the current one against this hash before it
      // rotates, so the happy path needs a real one.
      passwordHash: await hash(OWN_PASSWORD, 10),
    },
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
      // `donors/import/actions.ts` also exports SAMPLE_HEADERS, the CSV column
      // list the template route mirrors. It is data, not an action.
      const exported = Object.entries(mod)
        .filter(([, v]) => typeof v === "function")
        .map(([k]) => k);
      expect(exported.sort()).toEqual(Object.keys(specs).sort());
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

/**
 * Values only the other trust knows. A refusal may quote the id the caller
 * supplied — they typed it — but nothing it looked up on the way to deciding.
 */
function victimSecrets(): string[] {
  return [
    victim.vendor.name,
    victim.vendor.pan!,
    victim.ldc.certNumber,
    victim.ldc.deducteePan,
    victim.notification.title,
    victim.primaryBank.accountNumber,
    victim.spareBank.accountNumber,
    victim.orgDocument.title,
    victim.memberUser.email,
  ];
}

async function expectRefused(spec: Spec, input: Record<string, unknown>) {
  const [beforeVictim, beforeOwn] = await Promise.all([snapshot(ORG_B), snapshot(ORG_A)]);
  const result = await call(spec, input);

  const said = JSON.stringify({
    serverError: result.serverError,
    validationErrors: result.validationErrors,
  });
  for (const secret of victimSecrets()) {
    expect(said, `the refusal quoted "${secret}" back at the caller`).not.toContain(secret);
  }

  if (!spec.refusesSilently) {
    expect(result.data).toBeUndefined();
    expect(
      spec.refusesViaValidation ? result.validationErrors : result.serverError,
    ).toBeTruthy();
  }
  expect(await snapshot(ORG_B)).toBe(beforeVictim);
  expect(await snapshot(ORG_A)).toBe(beforeOwn);
}

describe("cross-tenant writes are refused", () => {
  for (const { specs } of MODULES) {
    for (const [name, spec] of Object.entries(specs)) {
      const fields = Object.keys(spec.ids);
      // Every mix of own and foreign ids with at least one foreign.
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
 * The blast-radius cases no id can express, because the action takes none: an
 * action whose `where` clause names no row at all is scoped by the extension or
 * by nothing.
 */
/**
 * The suite above is only worth what `snapshot` can see. This is the check on
 * the check: a write to the other trust's row, made deliberately and put back,
 * has to show up as a difference.
 */
describe("the snapshot notices a foreign write", () => {
  it("catches a notification of the other trust being marked read", async () => {
    const before = await snapshot(ORG_B);
    await prismaUnsafe.notification.update({
      where: { id: victim.notification.id },
      data: { isRead: true, readAt: DATE },
    });
    expect(await snapshot(ORG_B)).not.toBe(before);

    await prismaUnsafe.notification.update({
      where: { id: victim.notification.id },
      data: { isRead: false, readAt: null },
    });
    expect(await snapshot(ORG_B)).toBe(before);
  });
});

describe("id-less actions stay inside the caller's organisation", () => {
  it("markAllNotificationsRead leaves the other trust's unread notifications unread", async () => {
    const before = await snapshot(ORG_B);
    const result = await notificationActions.markAllNotificationsRead({});
    expect(result.serverError).toBeUndefined();
    expect(await snapshot(ORG_B)).toBe(before);
  });

  it("commitImport files the donors under the caller's organisation", async () => {
    const pad = String(++seq).padStart(4, "0");
    const result = await importActions.commitImport({
      csvText: `donorType,name,pan\nINDIVIDUAL,Import Probe ${pad},ABCPI${pad}K\n`,
    });
    expect(result.serverError).toBeUndefined();
    const rows = await prismaUnsafe.donor.findMany({
      where: { name: `Import Probe ${pad}` },
    });
    expect(rows.map((r) => r.organisationId)).toEqual([ORG_A]);
  });
});

/**
 * The four read paths. Each takes a string the caller typed and returns
 * whatever matches it, so the only thing standing between a caller and the
 * other trust's donor list is the scope on the query.
 */
describe("search returns nothing from the other trust", () => {
  /**
   * Each case searches for a string only the other trust's row carries, then
   * runs the same query again as that trust. The second half is what makes the
   * first mean anything: it proves the query does match the row, so the empty
   * answer to the first caller is the organisation filter and not a query that
   * was never going to match.
   */
  it("searchDonors omits a donor of another organisation", async () => {
    const pan = `ZZZPV${String(++seq).padStart(4, "0")}K`;
    const foreign = await prismaUnsafe.donor.create({
      data: {
        organisationId: ORG_B,
        donorType: "INDIVIDUAL",
        name: `Victim Donor ${seq}`,
        pan,
      },
    });

    const mine = await donorSearchActions.searchDonors({ q: pan });
    expect(mine.serverError).toBeUndefined();
    expect(mine.data?.donors.map((d) => d.id)).not.toContain(foreign.id);

    getOrgScopeMock.mockResolvedValue(scopeFor(ORG_B));
    const theirs = await donorSearchActions.searchDonors({ q: pan });
    expect(theirs.data?.donors.map((d) => d.id)).toEqual([foreign.id]);
  });

  it("searchVendors omits a vendor of another organisation", async () => {
    const pan = victim.vendor.pan!;

    const mine = await vendorSearchActions.searchVendors({ q: pan });
    expect(mine.serverError).toBeUndefined();
    expect(mine.data?.vendors.map((v) => v.id)).not.toContain(victim.vendor.id);

    getOrgScopeMock.mockResolvedValue(scopeFor(ORG_B));
    const theirs = await vendorSearchActions.searchVendors({ q: pan });
    expect(theirs.data?.vendors.map((v) => v.id)).toContain(victim.vendor.id);
  });

  it("searchEverything omits every row of another organisation", async () => {
    const pan = victim.vendor.pan!;

    const mine = await searchActions.searchEverything({ q: pan });
    expect(mine.serverError).toBeUndefined();
    expect(mine.data?.map((h) => h.key)).not.toContain(`Vendors:${victim.vendor.id}`);

    getOrgScopeMock.mockResolvedValue(scopeFor(ORG_B));
    const theirs = await searchActions.searchEverything({ q: pan });
    expect(theirs.data?.map((h) => h.key)).toContain(`Vendors:${victim.vendor.id}`);
  });
});

/**
 * `generateReport` is the one action whose ids arrive inside a free-form
 * `params` object: the wizard posts `projectId` there and the generator filters
 * on it. A foreign one must not put that project — its code, its name, its
 * budget — into a workbook this trust can download.
 */
describe("a report cannot be run over another trust's project", () => {
  it("generateReport with a foreign projectId returns an empty workbook", async () => {
    const foreignProject = await prismaUnsafe.project.create({
      data: {
        organisationId: ORG_B,
        code: `TENSET/VIC/${++seq}`,
        name: `Victim Project ${seq}`,
        status: "ACTIVE",
        startDate: PERIOD_FROM,
        endDate: PERIOD_TO,
        totalBudget: "600000",
      },
    });
    const donor = await prismaUnsafe.donor.create({
      data: {
        organisationId: ORG_B,
        donorType: "INDIVIDUAL",
        name: `Victim Donor P${seq}`,
        pan: `ZZZPP${String(seq).padStart(4, "0")}K`,
      },
    });
    await prismaUnsafe.donation.create({
      data: {
        organisationId: ORG_B,
        donorId: donor.id,
        receiptNumber: `TENSET/RCT/${seq}`,
        donationDate: DATE,
        amount: "100000",
        mode: "NEFT",
        purpose: "PROJECT_SPECIFIC",
        projectId: foreignProject.id,
        status: "RECEIVED",
      },
    });

    const result = await reportActions.generateReport({
      slug: "project-utilisation",
      params: { financialYear: FIXED_FY, projectId: foreignProject.id },
    });

    expect(result.serverError).toBeUndefined();
    const key = result.data?.excelUrl;
    expect(key).toBeTruthy();

    const report = await prismaUnsafe.report.findUniqueOrThrow({
      where: { id: result.data!.id },
    });
    expect(report.organisationId).toBe(ORG_A);

    const stored = await storage.get(report.excelStorageKey!);
    expect(stored).toBeTruthy();
    const bytes = await new Response(stored!.stream).arrayBuffer();
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes);
    const text: string[] = [];
    wb.eachSheet((sheet) => {
      sheet.eachRow((row) => {
        row.eachCell((cell) => text.push(String(cell.value ?? "")));
      });
    });
    const joined = text.join("");
    expect(joined).not.toContain(foreignProject.name);
    expect(joined).not.toContain(foreignProject.code);
    expect(joined).not.toContain("100000");
  });
});

/**
 * The one id in the app that arrives nested inside an array rather than as a
 * field of its own: `recordDonation` takes `lineItems[].sponsorshipItemId`.
 * The id scanners in the two sibling suites walk `parsedInput.<field>` and so
 * cannot see it, which is exactly why it is driven here — a catalogue row of
 * another trust priced onto this trust's receipt would put a label and a rate
 * nobody here published onto an 80G document.
 */
describe("a donation cannot be priced from another trust's catalogue", () => {
  it("recordDonation refuses a foreign sponsorshipItemId", async () => {
    const donationActions = await import("./donations/actions");
    const item = await prismaUnsafe.sponsorshipItem.create({
      data: {
        organisationId: ORG_B,
        category: "CHILDREN_EDUCATION",
        label: `Victim catalogue row ${++seq}`,
        amount: "5000",
        unitNoun: "child",
      },
    });
    const donor = await prismaUnsafe.donor.create({
      data: {
        organisationId: ORG_A,
        donorType: "INDIVIDUAL",
        name: `Own Donor ${seq}`,
        pan: `AAAPD${String(seq).padStart(4, "0")}K`,
      },
    });
    const before = await snapshot(ORG_B);

    const result = await donationActions.recordDonation({
      donorId: donor.id,
      donationDate: DATE,
      amount: "5000",
      mode: "CASH",
      purpose: "GENERAL",
      is80GEligible: true,
      lineItems: [
        {
          sponsorshipItemId: item.id,
          label: item.label,
          unitAmount: "5000",
          quantity: 1,
        },
      ],
    });

    expect(result.data).toBeUndefined();
    expect(result.serverError).toBeTruthy();
    expect(await snapshot(ORG_B)).toBe(before);
    expect(
      await prismaUnsafe.donation.count({ where: { organisationId: ORG_A, donorId: donor.id } }),
    ).toBe(0);
  });
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
