import "server-only";
import { Decimal } from "decimal.js";
import { prismaUnsafe } from "@/lib/db/prisma";
import { getFinancialYearRange } from "@/lib/format/date";
import type { ReportGenerator, ComputedReport, ValidationResult } from "./shared/types";
import { buildReportWorkbook } from "./shared/excel-renderer";

/**
 * Project Utilisation Report — for every project: donations received,
 * expenses incurred, budget vs actual, utilisation %.
 *
 * Excel layout:
 *   - "Summary" sheet — one row per project
 *   - "Per project" sheet — head-wise breakup of budget vs actual for
 *     each project's budget heads
 */

export type ProjectUtilParams = {
  organisationId: string;
  financialYear: string;
  /** Optional project id to focus on a single project. Empty = all. */
  projectId?: string;
};

export type ProjectUtilRow = {
  id: string;
  code: string;
  name: string;
  status: string;
  totalBudget: string;
  funding: string;
  spend: string;
  utilisationPct: string;
  beneficiaries: number;
};

export type ProjectUtilHead = {
  projectCode: string;
  headName: string;
  budgeted: string;
  spent: string;
  variance: string;
};

export type ProjectUtilData = {
  projects: ProjectUtilRow[];
  heads: ProjectUtilHead[];
  totals: {
    totalBudget: string;
    totalFunding: string;
    totalSpend: string;
  };
};

export const projectUtilisationReport: ReportGenerator<
  ProjectUtilParams,
  ProjectUtilData
> = {
  slug: "project-utilisation",
  title: "Project Utilisation Report",
  reportType: "PROJECT_UTILISATION",
  summary:
    "Per-project income vs expenditure with budget-head breakup. The standard grant-funder ask.",

  validate(params: ProjectUtilParams): ValidationResult {
    if (!/^\d{4}-\d{2}$/.test(params.financialYear)) {
      return { ok: false, errors: ["financialYear must be YYYY-YY"] };
    }
    return { ok: true };
  },

  async computeData(
    params: ProjectUtilParams,
  ): Promise<ComputedReport<ProjectUtilData>> {
    const { start, end } = getFinancialYearRange(params.financialYear);

    const projects = await prismaUnsafe.project.findMany({
      where: {
        organisationId: params.organisationId,
        ...(params.projectId ? { id: params.projectId } : {}),
      },
      include: {
        budgetHeads: { orderBy: { name: "asc" } },
        _count: { select: { beneficiaryEnrolments: true } },
      },
      orderBy: [{ status: "asc" }, { name: "asc" }],
    });

    const projectIds = projects.map((p) => p.id);

    const [donationsAgg, expensesAgg, expensesByHead] = await Promise.all([
      prismaUnsafe.donation.groupBy({
        by: ["projectId"],
        _sum: { amount: true },
        where: {
          organisationId: params.organisationId,
          projectId: { in: projectIds },
          donationDate: { gte: start, lt: end },
          status: { not: "CANCELLED" },
        },
      }),
      prismaUnsafe.expense.groupBy({
        by: ["projectId"],
        _sum: { grossAmount: true },
        where: {
          organisationId: params.organisationId,
          projectId: { in: projectIds },
          expenseDate: { gte: start, lt: end },
          status: { in: ["APPROVED", "PAID"] },
        },
      }),
      prismaUnsafe.expense.groupBy({
        by: ["projectId", "budgetHeadId"],
        _sum: { grossAmount: true },
        where: {
          organisationId: params.organisationId,
          projectId: { in: projectIds },
          expenseDate: { gte: start, lt: end },
          status: { in: ["APPROVED", "PAID"] },
        },
      }),
    ]);

    const fundingByProject = new Map(
      donationsAgg.map((a) => [
        a.projectId,
        new Decimal(a._sum.amount?.toString() ?? "0"),
      ]),
    );
    const spendByProject = new Map(
      expensesAgg.map((a) => [
        a.projectId,
        new Decimal(a._sum.grossAmount?.toString() ?? "0"),
      ]),
    );
    const spendByProjectHead = new Map<string, Decimal>();
    for (const a of expensesByHead) {
      const key = `${a.projectId}::${a.budgetHeadId ?? "_uncategorised"}`;
      spendByProjectHead.set(
        key,
        new Decimal(a._sum.grossAmount?.toString() ?? "0"),
      );
    }

    let totalBudget = new Decimal(0);
    let totalFunding = new Decimal(0);
    let totalSpend = new Decimal(0);

    const rows: ProjectUtilRow[] = projects.map((p) => {
      const budget = new Decimal(p.totalBudget.toString());
      const funding = fundingByProject.get(p.id) ?? new Decimal(0);
      const spend = spendByProject.get(p.id) ?? new Decimal(0);
      const pct = budget.isZero()
        ? new Decimal(0)
        : spend.div(budget).mul(100).toDecimalPlaces(2);
      totalBudget = totalBudget.plus(budget);
      totalFunding = totalFunding.plus(funding);
      totalSpend = totalSpend.plus(spend);
      return {
        id: p.id,
        code: p.code,
        name: p.name,
        status: p.status,
        totalBudget: budget.toFixed(2),
        funding: funding.toFixed(2),
        spend: spend.toFixed(2),
        utilisationPct: pct.toFixed(2),
        beneficiaries: p._count.beneficiaryEnrolments,
      };
    });

    const heads: ProjectUtilHead[] = [];
    for (const p of projects) {
      for (const h of p.budgetHeads) {
        const key = `${p.id}::${h.id}`;
        const spent = spendByProjectHead.get(key) ?? new Decimal(0);
        const budgeted = new Decimal(h.budgetedAmount.toString());
        heads.push({
          projectCode: p.code,
          headName: h.name,
          budgeted: budgeted.toFixed(2),
          spent: spent.toFixed(2),
          variance: budgeted.minus(spent).toFixed(2),
        });
      }
    }

    return {
      type: "PROJECT_UTILISATION",
      organisationId: params.organisationId,
      title: "Project Utilisation Report",
      periodLabel: `FY ${params.financialYear}`,
      generatedAt: new Date().toISOString(),
      data: {
        projects: rows,
        heads,
        totals: {
          totalBudget: totalBudget.toFixed(2),
          totalFunding: totalFunding.toFixed(2),
          totalSpend: totalSpend.toFixed(2),
        },
      },
    };
  },

  async renderExcel(
    report: ComputedReport<ProjectUtilData>,
  ): Promise<Buffer> {
    const { data } = report;
    return buildReportWorkbook(
      {
        organisationId: report.organisationId,
        title: report.title,
        periodLabel: report.periodLabel,
        generatedAt: report.generatedAt,
      },
      [
        {
          name: "Project summary",
          columns: [
            { header: "Code", width: 16 },
            { header: "Name", width: 32 },
            { header: "Status", width: 12 },
            { header: "Budget (₹)", width: 18 },
            { header: "Funding (₹)", width: 18 },
            { header: "Spend (₹)", width: 18 },
            { header: "Utilisation %", width: 14 },
            { header: "Beneficiaries", width: 14 },
          ],
          rows: [
            ...data.projects.map((p) => [
              p.code,
              p.name,
              p.status,
              p.totalBudget,
              p.funding,
              p.spend,
              p.utilisationPct,
              p.beneficiaries,
            ]),
            [],
            [
              "TOTALS",
              "",
              "",
              data.totals.totalBudget,
              data.totals.totalFunding,
              data.totals.totalSpend,
              "",
              "",
            ],
          ],
        },
        {
          name: "Budget heads",
          columns: [
            { header: "Project", width: 18 },
            { header: "Head", width: 30 },
            { header: "Budgeted (₹)", width: 18 },
            { header: "Spent (₹)", width: 18 },
            { header: "Variance (₹)", width: 18 },
          ],
          rows: data.heads.map((h) => [
            h.projectCode,
            h.headName,
            h.budgeted,
            h.spent,
            h.variance,
          ]),
        },
      ],
    );
  },
};
