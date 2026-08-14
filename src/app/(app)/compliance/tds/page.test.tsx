import { isValidElement } from "react";
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

const FY = "2025-26";
const NEXT_FY = "2026-27";

// The page reads the live financial year; pinning it keeps the Rule 30(2)
// fixture (March deduction, 30 April challan) meaningful whenever it is run.
vi.mock("@/lib/format/date", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/format/date")>()),
  getCurrentFY: () => FY,
}));

const { prismaUnsafe } = await import("@/lib/db/prisma");
const { default: TdsIndex } = await import("./page");

const TEST_ORG = "test-org-tds-page";
const TEST_USER = "test-user-tds-page";

async function cleanup() {
  await prismaUnsafe.tdsEntry.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.tdsChallan.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.tdsReturn.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.auditLog.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.membership.deleteMany({ where: { userId: TEST_USER } });
  await prismaUnsafe.user.deleteMany({ where: { id: TEST_USER } });
  await prismaUnsafe.organisation.deleteMany({ where: { id: TEST_ORG } });
}

beforeAll(async () => {
  await cleanup();
  await prismaUnsafe.organisation.create({
    data: { id: TEST_ORG, name: "TDS Page Trust", pan: "AAATP4444P" },
  });
  await prismaUnsafe.user.create({
    data: { id: TEST_USER, email: "tds-page@rakshana.local", name: "TDS Page" },
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
  getOrgScopeMock.mockReset();
  getOrgScopeMock.mockResolvedValue({
    userId: TEST_USER,
    organisationId: TEST_ORG,
    organisationName: "TDS Page Trust",
    role: "OWNER",
  });
  await prismaUnsafe.tdsEntry.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.tdsChallan.deleteMany({ where: { organisationId: TEST_ORG } });
});

/** Flatten the rendered element tree into its text runs, in document order. */
function collectText(node: unknown, out: string[] = []): string[] {
  if (node === null || node === undefined || typeof node === "boolean") return out;
  if (typeof node === "string" || typeof node === "number") {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out);
    return out;
  }
  if (isValidElement(node)) {
    collectText((node.props as { children?: unknown }).children, out);
  }
  return out;
}

async function renderReconciliation() {
  const text = collectText(await TdsIndex());
  const after = (label: string) => {
    const i = text.indexOf(label);
    if (i < 0) throw new Error(`"${label}" not rendered — got: ${text.join(" | ")}`);
    return text[i + 1];
  };
  return {
    deducted: after("TDS deducted (FY)"),
    applied: after("Challans applied (FY)"),
    unremitted: after("Unremitted (FY)"),
  };
}

function entry(over: {
  tdsAmount: string;
  financialYear?: string;
  quarter?: string;
  deductionDate?: Date;
  challanId?: string;
}) {
  return prismaUnsafe.tdsEntry.create({
    data: {
      organisationId: TEST_ORG,
      deducteeName: "Contractor A",
      deducteePan: "ABCDE1234F",
      section: "194C",
      amountPaid: "1000000",
      tdsRate: "2",
      tdsAmount: over.tdsAmount,
      deductionDate: over.deductionDate ?? new Date("2026-03-20"),
      quarter: over.quarter ?? "Q4",
      financialYear: over.financialYear ?? FY,
      challanId: over.challanId ?? null,
    },
  });
}

function challan(over: { challanNumber: string; amount: string; challanDate: Date }) {
  return prismaUnsafe.tdsChallan.create({
    data: {
      organisationId: TEST_ORG,
      challanNumber: over.challanNumber,
      bsrCode: "0510308",
      challanDate: over.challanDate,
      amount: over.amount,
      section: "194C",
    },
  });
}

describe("TDS challan reconciliation card", () => {
  it("treats March TDS paid by the 30 April due date as remitted, not outstanding", async () => {
    // Rule 30(2): March deductions are payable by 30 April, so the settling
    // challan is dated in FY 2026-27 while the liability belongs to FY 2025-26.
    const c = await challan({
      challanNumber: "CHL/APR",
      amount: "40000",
      challanDate: new Date("2026-04-30"),
    });
    await entry({ tdsAmount: "40000", challanId: c.id });

    const card = await renderReconciliation();
    expect(card.deducted).toBe("₹40,000");
    expect(card.applied).toBe("₹40,000");
    expect(card.unremitted).toBe("₹0");
  });

  it("leaves a challan that settles only another year's TDS off this year's card", async () => {
    // Dated 30 May 2025 — inside FY 2025-26 — but every entry it discharges
    // belongs to FY 2024-25. Crediting remittance by challanDate rather than by
    // the entries settled would apply its ₹77,000 against this year.
    const prior = await challan({
      challanNumber: "CHL/PRIOR-FY",
      amount: "77000",
      challanDate: new Date("2025-05-30"),
    });
    await entry({
      tdsAmount: "77000",
      financialYear: "2024-25",
      quarter: "Q4",
      deductionDate: new Date("2025-03-18"),
      challanId: prior.id,
    });
    await entry({ tdsAmount: "5000" });

    const card = await renderReconciliation();
    expect(card.deducted).toBe("₹5,000");
    expect(card.applied).toBe("₹0");
    expect(card.unremitted).toBe("₹5,000");
  });

  it("still reports TDS with no challan against it as unremitted", async () => {
    await entry({ tdsAmount: "12500" });

    const card = await renderReconciliation();
    expect(card.applied).toBe("₹0");
    expect(card.unremitted).toBe("₹12,500");
  });

  it("credits only this year's share of a challan that settles two years", async () => {
    const c = await challan({
      challanNumber: "CHL/SPLIT",
      amount: "4000",
      challanDate: new Date("2026-04-30"),
    });
    await entry({ tdsAmount: "1000", challanId: c.id });
    await entry({
      tdsAmount: "3000",
      financialYear: NEXT_FY,
      quarter: "Q1",
      deductionDate: new Date("2026-04-10"),
      challanId: c.id,
    });

    const card = await renderReconciliation();
    expect(card.deducted).toBe("₹1,000");
    expect(card.applied).toBe("₹1,000");
    expect(card.unremitted).toBe("₹0");
  });

  it("caps an over-paid challan at the TDS it settles instead of showing a negative", async () => {
    const c = await challan({
      challanNumber: "CHL/OVER",
      amount: "50000",
      challanDate: new Date("2026-01-07"),
    });
    await entry({ tdsAmount: "40000", quarter: "Q3", challanId: c.id });

    // ₹50,000 paid against ₹40,000 of TDS: applied stops at the liability it
    // settles, and the remainder is ₹0 rather than the −₹10,000 an uncapped
    // subtraction would print.
    const card = await renderReconciliation();
    expect(card.applied).toBe("₹40,000");
    expect(card.unremitted).toBe("₹0");
  });
});
