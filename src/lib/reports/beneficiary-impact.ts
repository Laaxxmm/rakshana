import "server-only";
import { Decimal } from "decimal.js";
import { prismaUnsafe } from "@/lib/db/prisma";
import type { ReportGenerator, ComputedReport, ValidationResult } from "./shared/types";
import { buildReportWorkbook } from "./shared/excel-renderer";

/**
 * Beneficiary Impact Report — for the annual donor report. Aggregates:
 *   - Per-project beneficiary headcount
 *   - Per-project metric values (rolled up from ImpactRecord rows)
 *   - Per-project total disbursement amount + count
 *
 * The metric model is intentionally free-form (string metricValue) so the
 * report shows whatever the trust has captured. Empty data is the norm —
 * the report gracefully renders an empty-state instead of failing.
 */

export type BeneficiaryImpactParams = {
  organisationId: string;
  /** Optional project filter; empty = all active projects. */
  projectId?: string;
  /** Date range for the impact records and disbursements considered. */
  from: string;
  to: string;
};

export type ProjectImpactRow = {
  projectId: string;
  projectCode: string;
  projectName: string;
  beneficiaryCount: number;
  metrics: { name: string; aggregatedValue: string; rowCount: number }[];
  disbursementCount: number;
  disbursementValue: string;
};

export type BeneficiaryImpactData = {
  projects: ProjectImpactRow[];
  hasData: boolean;
};

export const beneficiaryImpactReport: ReportGenerator<
  BeneficiaryImpactParams,
  BeneficiaryImpactData
> = {
  slug: "beneficiary-impact",
  title: "Beneficiary Impact Report",
  reportType: "BENEFICIARY_IMPACT",
  summary:
    "Per-project beneficiary headcount, impact metrics aggregated, and total disbursements. Designed to gracefully handle limited data.",

  validate(params: BeneficiaryImpactParams): ValidationResult {
    if (Number.isNaN(Date.parse(params.from)) || Number.isNaN(Date.parse(params.to))) {
      return { ok: false, errors: ["from and to must be valid ISO dates"] };
    }
    return { ok: true };
  },

  async computeData(
    params: BeneficiaryImpactParams,
  ): Promise<ComputedReport<BeneficiaryImpactData>> {
    const from = new Date(params.from);
    const to = new Date(params.to);
    const projects = await prismaUnsafe.project.findMany({
      where: {
        organisationId: params.organisationId,
        ...(params.projectId ? { id: params.projectId } : {}),
      },
      orderBy: [{ status: "asc" }, { name: "asc" }],
    });

    const projectIds = projects.map((p) => p.id);
    const enrolments = await prismaUnsafe.beneficiaryEnrolment.findMany({
      where: { projectId: { in: projectIds } },
      select: { projectId: true, beneficiaryId: true },
    });
    const benIdsByProject = new Map<string, Set<string>>();
    const allBenIds = new Set<string>();
    for (const e of enrolments) {
      const set = benIdsByProject.get(e.projectId) ?? new Set<string>();
      set.add(e.beneficiaryId);
      allBenIds.add(e.beneficiaryId);
      benIdsByProject.set(e.projectId, set);
    }

    const impactRows = await prismaUnsafe.impactRecord.findMany({
      where: {
        beneficiaryId: { in: [...allBenIds] },
        recordDate: { gte: from, lt: to },
      },
    });
    // metricName values are free-form numerics OR strings. Try to parse as
    // a number for sum aggregation; fall back to row count for strings.
    type MetricBucket = { numericSum: Decimal; isNumeric: boolean; count: number };
    const metricsByProject = new Map<string, Map<string, MetricBucket>>();
    for (const r of impactRows) {
      // Find the project(s) this beneficiary is enrolled in
      const projectsOfBen: string[] = [];
      for (const [pid, set] of benIdsByProject)
        if (set.has(r.beneficiaryId)) projectsOfBen.push(pid);
      const n = Number(r.metricValue);
      const numeric = !Number.isNaN(n);
      for (const pid of projectsOfBen) {
        const inner =
          metricsByProject.get(pid) ?? new Map<string, MetricBucket>();
        const cur = inner.get(r.metricName) ?? {
          numericSum: new Decimal(0),
          isNumeric: true,
          count: 0,
        };
        if (!numeric) cur.isNumeric = false;
        else cur.numericSum = cur.numericSum.plus(n);
        cur.count += 1;
        inner.set(r.metricName, cur);
        metricsByProject.set(pid, inner);
      }
    }

    const disbursements = await prismaUnsafe.beneficiaryDisbursement.findMany({
      where: {
        beneficiaryId: { in: [...allBenIds] },
        disbursementDate: { gte: from, lt: to },
      },
      include: { beneficiary: { include: { enrolments: true } } },
    });
    type DBucket = { count: number; value: Decimal };
    const disbByProject = new Map<string, DBucket>();
    for (const d of disbursements) {
      for (const e of d.beneficiary.enrolments) {
        const cur = disbByProject.get(e.projectId) ?? {
          count: 0,
          value: new Decimal(0),
        };
        cur.count += 1;
        cur.value = cur.value.plus(d.value.toString());
        disbByProject.set(e.projectId, cur);
      }
    }

    const rows: ProjectImpactRow[] = projects.map((p) => {
      const bens = benIdsByProject.get(p.id) ?? new Set<string>();
      const metrics = metricsByProject.get(p.id);
      const disb = disbByProject.get(p.id);
      return {
        projectId: p.id,
        projectCode: p.code,
        projectName: p.name,
        beneficiaryCount: bens.size,
        metrics: metrics
          ? [...metrics.entries()].map(([name, b]) => ({
              name,
              aggregatedValue: b.isNumeric
                ? b.numericSum.toFixed(2)
                : `${b.count} records (non-numeric)`,
              rowCount: b.count,
            }))
          : [],
        disbursementCount: disb?.count ?? 0,
        disbursementValue: (disb?.value ?? new Decimal(0)).toFixed(2),
      };
    });

    const hasData = rows.some(
      (r) =>
        r.beneficiaryCount > 0 ||
        r.metrics.length > 0 ||
        r.disbursementCount > 0,
    );

    return {
      type: "BENEFICIARY_IMPACT",
      organisationId: params.organisationId,
      title: "Beneficiary Impact Report",
      periodLabel: `${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)}`,
      generatedAt: new Date().toISOString(),
      data: { projects: rows, hasData },
    };
  },

  async renderExcel(
    report: ComputedReport<BeneficiaryImpactData>,
  ): Promise<Buffer> {
    const { data } = report;
    const sheets = [
      {
        name: "Project summary",
        columns: [
          { header: "Code", width: 16 },
          { header: "Name", width: 30 },
          { header: "Beneficiaries", width: 14 },
          { header: "Disbursements (#)", width: 18 },
          { header: "Disbursement value (₹)", width: 24 },
        ],
        rows: data.hasData
          ? data.projects.map((p) => [
              p.projectCode,
              p.projectName,
              p.beneficiaryCount,
              p.disbursementCount,
              p.disbursementValue,
            ])
          : [
              [
                "Impact metrics will appear here once recorded in beneficiary profiles.",
                "",
                "",
                "",
                "",
              ],
            ],
      },
      {
        name: "Metrics",
        columns: [
          { header: "Project", width: 26 },
          { header: "Metric", width: 30 },
          { header: "Aggregated value", width: 22 },
          { header: "Record count", width: 14 },
        ],
        rows: data.projects.flatMap((p) =>
          p.metrics.length > 0
            ? p.metrics.map((m) => [
                p.projectCode,
                m.name,
                m.aggregatedValue,
                m.rowCount,
              ])
            : [],
        ),
      },
    ];
    return buildReportWorkbook(
      {
        organisationId: report.organisationId,
        title: report.title,
        periodLabel: report.periodLabel,
        generatedAt: report.generatedAt,
      },
      sheets,
    );
  },
};
