import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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

/**
 * This file works in a Postgres schema of its own.
 *
 * Both migrations rewrite every row that matches, in every tenant — which is
 * what a data repair has to do, and why neither is narrowed to one
 * organisation. Vitest runs test files in parallel workers against a single
 * database, so applying them to the schema the rest of the suite uses would
 * rewrite rows another file had committed moments earlier: the REJECTED
 * petty-cash voucher that `expenses/actions.test.ts` leaves standing through
 * its rejection-reversal test would pick up the '[legacy-repair] Float not
 * adjusted' note appended here.
 *
 * Pointing DATABASE_URL at a private schema before `@/lib/db/prisma` is
 * imported moves this file's whole world into it — the client below and the
 * three calculators under test all resolve their tables through that one
 * connection string. The migration statements stay verbatim; there is simply
 * nothing but this fixture for them to reach.
 *
 * The schema is dropped and rebuilt before each describe, so a crashed run
 * leaves nothing behind that the next one has to reckon with. What is left in
 * the database once the file finishes is the fixture of whichever describe ran
 * last, repaired or not, and that is what you want to read when one fails.
 */
const SCHEMA = "legacy_repair_test";
const schemaUrl = new URL(process.env.DATABASE_URL ?? "");
schemaUrl.searchParams.set("schema", SCHEMA);
process.env.DATABASE_URL = schemaUrl.href;

const { prismaUnsafe } = await import("@/lib/db/prisma");
const { computeEightyFiveRule } = await import("@/lib/compliance/eighty-five-rule");
const { balanceSheetReport } = await import("@/lib/reports/balance-sheet");
const { aggregateTdsReturn } = await import("@/lib/compliance/tds-return");

/**
 * The two data migrations that repair rows the removed petty-cash top-up
 * writer left behind, exercised against the calculators that read them.
 *
 * The fixture is the legacy row shapes verbatim — a PettyCashTopUp with a null
 * createdById beside an Expense numbered 'PCV-TOPUP/<epoch ms>', and a REJECTED
 * voucher whose TdsEntry is still ACTIVE — and the assertions are the figures
 * `computeEightyFiveRule`, `balanceSheetReport.computeData` and
 * `aggregateTdsReturn` produce from them, before and after.
 */
const MIGRATIONS = [
  "20260815090000_repair_legacy_petty_cash_top_up_expenses",
  "20260815090100_cancel_tds_on_rejected_expenses",
];

/**
 * Runs a migration file the way `prisma migrate deploy` would, minus the
 * bookkeeping. Prisma's raw client rejects multi-statement queries, so the
 * file is split on `;` once its comment lines are dropped; neither migration
 * puts a semicolon or a `--` inside a string literal.
 */
async function applyMigrations() {
  for (const name of MIGRATIONS) {
    const file = path.join(process.cwd(), "prisma", "migrations", name, "migration.sql");
    const statements = readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const statement of statements) {
      await prismaUnsafe.$executeRawUnsafe(statement);
    }
  }
}

const ORG = "test-org-legacy-repair";
const ORG_AMBIGUOUS = "test-org-legacy-repair-ambig";
const ORG_OTHER = "test-org-legacy-repair-other";
const ALL_ORGS = [ORG, ORG_AMBIGUOUS, ORG_OTHER];
const USER_A = "test-user-legacy-repair-a";
const USER_B = "test-user-legacy-repair-b";
const FY = "2024-25";

// Populated by buildFixture; the ids the assertions reach for.
let floatId = "";
let topUpAId = "";
let topUpBId = "";
let ambiguousTopUpIds: string[] = [];
let crossOrgTopUpId = "";
let rejectedTdsExpenseId = "";
let rejectedPettyExpenseId = "";

/**
 * Rebuilds the private schema from `prisma/migrations`, which is also how the
 * two migrations under test first reach it — against no rows, before the
 * fixture exists. Everything they are asked to repair is created afterwards,
 * and `applyMigrations` runs them again over it.
 */
async function resetSchema() {
  await prismaUnsafe.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
  // Inherits the rewritten DATABASE_URL, so it builds the private schema and
  // not the one the rest of the suite works in.
  execFileSync(
    path.join(process.cwd(), "node_modules", ".bin", "prisma"),
    ["migrate", "deploy"],
    { stdio: "pipe" },
  );
}

/** The Expense the removed writer created for the bank leg of a top-up. */
async function makeLegacyTopUpExpense(opts: {
  organisationId: string;
  suffix: string;
  amount: string;
  date: Date;
  bankAccountId: string;
  createdById: string | null;
  paid?: boolean;
}) {
  return prismaUnsafe.expense.create({
    data: {
      organisationId: opts.organisationId,
      voucherNumber: `PCV-TOPUP/${opts.suffix}`,
      expenseDate: opts.date,
      grossAmount: opts.amount,
      tdsAmount: "0",
      netPayable: opts.amount,
      mode: "OTHER",
      bankAccountId: opts.bankAccountId,
      isPettyCash: false,
      categoryId: null,
      description: "Petty cash top-up: Office float",
      status: opts.paid ? "PAID" : "APPROVED",
      paidAt: opts.paid ? opts.date : null,
      createdById: opts.createdById,
    },
  });
}

/**
 * Rebuilds the schema and plants the legacy fixture in it, leaving the rows
 * exactly as the removed top-up writer left them. Each describe below runs it
 * in its own `beforeAll`, because the migrations rewrite the very rows the
 * pre-repair assertions read: whichever describe runs second needs an
 * unrepaired fixture of its own, and vitest is free to order them either way.
 */
async function buildFixture() {
  await resetSchema();
  ambiguousTopUpIds = [];
  for (const [id, name, pan] of [
    [ORG, "Legacy Repair Trust", "AAATR7771A"],
    [ORG_AMBIGUOUS, "Legacy Repair Ambiguous Trust", "AAATR7772A"],
    [ORG_OTHER, "Legacy Repair Other Trust", "AAATR7773A"],
  ] as const) {
    await prismaUnsafe.organisation.create({ data: { id, name, pan } });
  }
  await prismaUnsafe.user.createMany({
    data: [
      { id: USER_A, email: "legacy-a@rakshana.local", name: "Custodian A" },
      { id: USER_B, email: "legacy-b@rakshana.local", name: "Custodian B" },
    ],
  });
  await prismaUnsafe.membership.createMany({
    data: [
      { userId: USER_A, organisationId: ORG, role: "OWNER" },
      { userId: USER_B, organisationId: ORG, role: "ACCOUNTANT" },
    ],
  });

  const bank = await prismaUnsafe.bankAccount.create({
    data: {
      organisationId: ORG,
      bankName: "State Bank",
      accountNumber: "LEGACY-REPAIR-1",
      openingBalance: "0",
    },
  });
  const float = await prismaUnsafe.pettyCashFloat.create({
    data: {
      organisationId: ORG,
      name: "Office float",
      floatAmount: "10000",
      currentBalance: "10000",
    },
  });
  floatId = float.id;

  // Receipts: one ₹40,000 donation, banked on the day it is recognised.
  const donor = await prismaUnsafe.donor.create({
    data: { organisationId: ORG, donorType: "INDIVIDUAL", name: "Legacy Donor" },
  });
  await prismaUnsafe.donation.create({
    data: {
      organisationId: ORG,
      donorId: donor.id,
      receiptNumber: "RKS/2024-25/LEGACY-1",
      donationDate: new Date("2024-05-01"),
      amount: "40000",
      mode: "NEFT",
      purpose: "GENERAL",
      status: "RECEIVED",
    },
  });

  // Legacy top-up 1 — ₹50,000, its Expense left APPROVED as written.
  const topUpA = await prismaUnsafe.pettyCashTopUp.create({
    data: {
      floatId: float.id,
      amount: "50000",
      topUpDate: new Date("2024-06-10"),
      bankAccountId: bank.id,
      remarks: "June float",
    },
  });
  topUpAId = topUpA.id;
  await makeLegacyTopUpExpense({
    organisationId: ORG,
    suffix: "1718000000000",
    amount: "50000",
    date: new Date("2024-06-10"),
    bankAccountId: bank.id,
    createdById: USER_A,
  });

  // Legacy top-up 2 — ₹25,000, its Expense marked PAID by hand afterwards.
  const topUpB = await prismaUnsafe.pettyCashTopUp.create({
    data: {
      floatId: float.id,
      amount: "25000",
      topUpDate: new Date("2024-07-05"),
      bankAccountId: bank.id,
    },
  });
  topUpBId = topUpB.id;
  await makeLegacyTopUpExpense({
    organisationId: ORG,
    suffix: "1718000000001",
    amount: "25000",
    date: new Date("2024-07-05"),
    bankAccountId: bank.id,
    createdById: USER_B,
    paid: true,
  });

  // The one genuine voucher in the ledger.
  await prismaUnsafe.expense.create({
    data: {
      organisationId: ORG,
      voucherNumber: "VCH/2024-25/0001",
      expenseDate: new Date("2024-08-01"),
      grossAmount: "20000",
      tdsAmount: "0",
      netPayable: "20000",
      mode: "NEFT",
      bankAccountId: bank.id,
      status: "APPROVED",
      createdById: USER_A,
    },
  });

  // A voucher rejected before rejectExpense unwound its postings: the TdsEntry
  // is still ACTIVE and files ₹2,000 against a contractor nobody paid.
  const rejected = await prismaUnsafe.expense.create({
    data: {
      organisationId: ORG,
      voucherNumber: "VCH/2024-25/0002",
      expenseDate: new Date("2024-05-20"),
      grossAmount: "100000",
      tdsAmount: "2000",
      tdsSection: "194C",
      tdsRate: "2",
      netPayable: "98000",
      mode: "NEFT",
      bankAccountId: bank.id,
      status: "REJECTED",
      createdById: USER_A,
    },
  });
  rejectedTdsExpenseId = rejected.id;
  await prismaUnsafe.tdsEntry.create({
    data: {
      organisationId: ORG,
      expenseId: rejected.id,
      deducteeName: "Ghost Contractor",
      deducteePan: "ABCDE1234F",
      section: "194C",
      amountPaid: "100000",
      tdsRate: "2",
      tdsAmount: "2000",
      deductionDate: new Date("2024-05-20"),
      quarter: "Q1",
      financialYear: FY,
      status: "ACTIVE",
    },
  });

  // A rejected petty-cash voucher whose submit-time float debit was never
  // refunded — the case the migration annotates instead of moving money.
  const rejectedPetty = await prismaUnsafe.expense.create({
    data: {
      organisationId: ORG,
      voucherNumber: "PCV/2024-25/0001",
      expenseDate: new Date("2024-06-01"),
      grossAmount: "3000",
      tdsAmount: "0",
      netPayable: "3000",
      mode: "CASH",
      isPettyCash: true,
      pettyCashFloatId: float.id,
      status: "REJECTED",
      createdById: USER_B,
    },
  });
  rejectedPettyExpenseId = rejectedPetty.id;

  // --- Second org: two identical top-ups on one day, so neither has a single
  // candidate expense.
  const ambiguousFloat = await prismaUnsafe.pettyCashFloat.create({
    data: {
      organisationId: ORG_AMBIGUOUS,
      name: "Ambiguous float",
      floatAmount: "5000",
      currentBalance: "5000",
    },
  });
  const ambiguousBank = await prismaUnsafe.bankAccount.create({
    data: {
      organisationId: ORG_AMBIGUOUS,
      bankName: "State Bank",
      accountNumber: "LEGACY-REPAIR-2",
      openingBalance: "0",
    },
  });
  // Two top-ups of the same amount on the same day, out of the same account:
  // the pair the migration cannot tell apart.
  for (let i = 0; i < 2; i += 1) {
    const t = await prismaUnsafe.pettyCashTopUp.create({
      data: {
        floatId: ambiguousFloat.id,
        amount: "5000",
        topUpDate: new Date("2024-09-01"),
        bankAccountId: ambiguousBank.id,
      },
    });
    ambiguousTopUpIds.push(t.id);
  }
  await makeLegacyTopUpExpense({
    organisationId: ORG_AMBIGUOUS,
    suffix: "1718000000002",
    amount: "5000",
    date: new Date("2024-09-01"),
    bankAccountId: ambiguousBank.id,
    createdById: USER_A,
  });
  await makeLegacyTopUpExpense({
    organisationId: ORG_AMBIGUOUS,
    suffix: "1718000000003",
    amount: "5000",
    date: new Date("2024-09-01"),
    bankAccountId: ambiguousBank.id,
    createdById: USER_B,
  });

  // --- Third org: the only expense that matches this top-up on amount, date
  // and bank account belongs to a different tenant.
  const otherBank = await prismaUnsafe.bankAccount.create({
    data: {
      organisationId: ORG_OTHER,
      bankName: "State Bank",
      accountNumber: "LEGACY-REPAIR-3",
      openingBalance: "0",
    },
  });
  const crossOrgTopUp = await prismaUnsafe.pettyCashTopUp.create({
    data: {
      floatId: ambiguousFloat.id,
      amount: "7000",
      topUpDate: new Date("2024-10-01"),
      bankAccountId: otherBank.id,
    },
  });
  crossOrgTopUpId = crossOrgTopUp.id;
  await makeLegacyTopUpExpense({
    organisationId: ORG_OTHER,
    suffix: "1718000000004",
    amount: "7000",
    date: new Date("2024-10-01"),
    bankAccountId: otherBank.id,
    createdById: USER_A,
  });
}

afterAll(async () => {
  await prismaUnsafe.$disconnect();
});

function line(rows: { label: string; amount: string }[], startsWith: string): string {
  const found = rows.find((r) => r.label.startsWith(startsWith));
  if (!found) throw new Error(`No line starting "${startsWith}" in ${JSON.stringify(rows)}`);
  return found.amount;
}

async function balanceSheet() {
  const report = await balanceSheetReport.computeData({
    organisationId: ORG,
    financialYear: FY,
  });
  return report.data;
}

async function moneyRowCounts() {
  return {
    expenses: await prismaUnsafe.expense.count({
      where: { organisationId: { in: ALL_ORGS } },
    }),
    tdsEntries: await prismaUnsafe.tdsEntry.count({
      where: { organisationId: { in: ALL_ORGS } },
    }),
    topUps: await prismaUnsafe.pettyCashTopUp.count({
      where: { float: { organisationId: { in: ALL_ORGS } } },
    }),
    floats: await prismaUnsafe.pettyCashFloat.count({
      where: { organisationId: { in: ALL_ORGS } },
    }),
    donations: await prismaUnsafe.donation.count({
      where: { organisationId: { in: ALL_ORGS } },
    }),
  };
}

describe("legacy petty-cash top-up rows, before the migrations", () => {
  beforeAll(buildFixture);

  it("counts the top-up vouchers as application of income", async () => {
    const out = await computeEightyFiveRule({ organisationId: ORG, financialYear: FY });
    expect(out.totalReceipts).toBe("40000.00");
    // 50,000 + 25,000 of top-up legs on top of the one ₹20,000 voucher.
    expect(out.totalApplication).toBe("95000.00");
    expect(out.applicationPercentage).toBe("237.50");
    expect(out.meetsThreshold).toBe(true);
  });

  it("shows the top-up legs as creditors and drains the bank twice", async () => {
    const data = await balanceSheet();
    expect(line(data.liabilities, "Sundry creditors")).toBe("70000.00");
    expect(line(data.liabilities, "General Fund")).toBe("-55000.00");
    // ₹40,000 banked less the ₹25,000 top-up leg someone marked PAID — the
    // same withdrawal banking/page.tsx also subtracts from its PettyCashTopUp
    // aggregate.
    expect(line(data.assets, "Cash + Bank")).toBe("15000.00");
  });

  it("files TDS for a deductee whose voucher was rejected", async () => {
    const out = await aggregateTdsReturn({
      organisationId: ORG,
      formType: "FORM_26Q",
      financialYear: FY,
      quarter: "Q1",
    });
    expect(out.totalTds).toBe("2000.00");
    expect(out.deductees.map((d) => d.deducteeName)).toEqual(["Ghost Contractor"]);
  });

  it("has no actor on the top-ups", async () => {
    const topUps = await prismaUnsafe.pettyCashTopUp.findMany({
      where: { id: { in: [topUpAId, topUpBId] } },
    });
    expect(topUps.map((t) => t.createdById)).toEqual([null, null]);
  });
});

describe("legacy petty-cash top-up rows, after the migrations", () => {
  let countsBefore: Awaited<ReturnType<typeof moneyRowCounts>>;

  beforeAll(async () => {
    await buildFixture();
    countsBefore = await moneyRowCounts();
    await applyMigrations();
  });

  it("recovers the top-up actor from the paired expense", async () => {
    const a = await prismaUnsafe.pettyCashTopUp.findUniqueOrThrow({ where: { id: topUpAId } });
    const b = await prismaUnsafe.pettyCashTopUp.findUniqueOrThrow({ where: { id: topUpBId } });
    expect(a.createdById).toBe(USER_A);
    expect(b.createdById).toBe(USER_B);
  });

  it("leaves the actor null where the pairing is ambiguous or cross-tenant", async () => {
    const ambiguous = await prismaUnsafe.pettyCashTopUp.findMany({
      where: { id: { in: ambiguousTopUpIds } },
    });
    expect(ambiguous.map((t) => t.createdById)).toEqual([null, null]);
    const crossOrg = await prismaUnsafe.pettyCashTopUp.findUniqueOrThrow({
      where: { id: crossOrgTopUpId },
    });
    expect(crossOrg.createdById).toBeNull();
  });

  it("cancels the top-up vouchers in the shape cancelExpense produces", async () => {
    const legacy = await prismaUnsafe.expense.findMany({
      where: { organisationId: ORG, voucherNumber: { startsWith: "PCV-TOPUP/" } },
      orderBy: { voucherNumber: "asc" },
    });
    expect(legacy).toHaveLength(2);
    expect(legacy.map((e) => e.status)).toEqual(["CANCELLED", "CANCELLED"]);
    // cancelExpense leaves paidAt alone; every reader of it pairs it with
    // status PAID.
    expect(legacy[1]?.paidAt).not.toBeNull();
    for (const e of legacy) {
      expect(e.description).toContain("Petty cash top-up: Office float");
      expect(e.description).toContain("[legacy-repair] Petty-cash top-up leg");
    }
  });

  it("takes the top-up legs out of the section 11 application figure", async () => {
    const out = await computeEightyFiveRule({ organisationId: ORG, financialYear: FY });
    expect(out.totalReceipts).toBe("40000.00");
    expect(out.totalApplication).toBe("20000.00");
    expect(out.applicationPercentage).toBe("50.00");
    expect(out.meetsThreshold).toBe(false);
    expect(out.shortfallAmount).toBe("14000.00");
  });

  it("clears the phantom creditor and restores the bank balance", async () => {
    const data = await balanceSheet();
    expect(line(data.liabilities, "Sundry creditors")).toBe("20000.00");
    expect(line(data.liabilities, "General Fund")).toBe("20000.00");
    expect(line(data.assets, "Cash + Bank")).toBe("40000.00");
    // Nothing PCV-TOPUP is left in the PAID population banking/page.tsx sums
    // alongside its PettyCashTopUp aggregate.
    const paidLegacy = await prismaUnsafe.expense.count({
      where: { organisationId: ORG, voucherNumber: { startsWith: "PCV-TOPUP/" }, status: "PAID" },
    });
    expect(paidLegacy).toBe(0);
  });

  it("drops the rejected voucher out of the quarterly TDS return", async () => {
    const out = await aggregateTdsReturn({
      organisationId: ORG,
      formType: "FORM_26Q",
      financialYear: FY,
      quarter: "Q1",
    });
    expect(out.totalTds).toBe("0.00");
    expect(out.totalPaid).toBe("0.00");
    expect(out.deductees).toEqual([]);
    const entry = await prismaUnsafe.tdsEntry.findFirstOrThrow({
      where: { expenseId: rejectedTdsExpenseId },
    });
    expect(entry.status).toBe("CANCELLED");
  });

  it("leaves the petty-cash float untouched and says so on the voucher", async () => {
    const float = await prismaUnsafe.pettyCashFloat.findUniqueOrThrow({
      where: { id: floatId },
    });
    expect(float.currentBalance.toFixed(2)).toBe("10000.00");
    const voucher = await prismaUnsafe.expense.findUniqueOrThrow({
      where: { id: rejectedPettyExpenseId },
    });
    expect(voucher.status).toBe("REJECTED");
    expect(voucher.description).toContain("[legacy-repair] Float not adjusted");
  });

  it("deletes nothing from any money table", async () => {
    expect(await moneyRowCounts()).toEqual(countsBefore);
  });

  it("is a no-op on a second run", async () => {
    const before = await prismaUnsafe.expense.findMany({
      where: { organisationId: { in: ALL_ORGS } },
      orderBy: { id: "asc" },
      select: { id: true, status: true, description: true, updatedAt: true },
    });
    const topUpsBefore = await prismaUnsafe.pettyCashTopUp.findMany({
      where: { float: { organisationId: { in: ALL_ORGS } } },
      orderBy: { id: "asc" },
      select: { id: true, createdById: true },
    });
    const tdsBefore = await prismaUnsafe.tdsEntry.findMany({
      where: { organisationId: { in: ALL_ORGS } },
      orderBy: { id: "asc" },
      select: { id: true, status: true },
    });

    await applyMigrations();

    expect(
      await prismaUnsafe.expense.findMany({
        where: { organisationId: { in: ALL_ORGS } },
        orderBy: { id: "asc" },
        select: { id: true, status: true, description: true, updatedAt: true },
      }),
    ).toEqual(before);
    expect(
      await prismaUnsafe.pettyCashTopUp.findMany({
        where: { float: { organisationId: { in: ALL_ORGS } } },
        orderBy: { id: "asc" },
        select: { id: true, createdById: true },
      }),
    ).toEqual(topUpsBefore);
    expect(
      await prismaUnsafe.tdsEntry.findMany({
        where: { organisationId: { in: ALL_ORGS } },
        orderBy: { id: "asc" },
        select: { id: true, status: true },
      }),
    ).toEqual(tdsBefore);
    expect(await moneyRowCounts()).toEqual(countsBefore);
  });
});
