import "server-only";
import { prismaUnsafe } from "@/lib/db/prisma";
import { formatIST } from "@/lib/format/date";
import type { ReportGenerator, ComputedReport, ValidationResult } from "./shared/types";
import { buildReportWorkbook } from "./shared/excel-renderer";

/**
 * Audit Trail Report — the auditor's primary tool.
 *
 * Filterable AuditLog by:
 *   - date range
 *   - user (optional)
 *   - entityType (optional — Donation / Expense / Project / etc.)
 *   - actionType (optional — *.create / *.update / etc.)
 *
 * Excel: flat table sorted by createdAt, with a "Detail" column that
 * stringifies the before/after diff. Auditors filter in Excel from there.
 */

export type AuditTrailParams = {
  organisationId: string;
  /** ISO date string for range start. Inclusive. */
  from: string;
  /** ISO date string for range end. Exclusive. */
  to: string;
  userId?: string;
  entityType?: string;
  action?: string;
};

export type AuditTrailRow = {
  timestamp: string;
  userName: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before: string;
  after: string;
};

export type AuditTrailData = {
  rows: AuditTrailRow[];
  filters: { from: string; to: string; userId?: string; entityType?: string; action?: string };
};

export const auditTrailReport: ReportGenerator<AuditTrailParams, AuditTrailData> = {
  slug: "audit-trail",
  title: "Audit Trail Report",
  reportType: "AUDIT_TRAIL",
  summary:
    "Filterable AuditLog: every mutation in the system within a date range, attributed to a user. The auditor's primary review tool.",

  validate(params: AuditTrailParams): ValidationResult {
    if (Number.isNaN(Date.parse(params.from)) || Number.isNaN(Date.parse(params.to))) {
      return { ok: false, errors: ["from and to must be valid ISO dates"] };
    }
    if (new Date(params.from) >= new Date(params.to)) {
      return { ok: false, errors: ["from must be before to"] };
    }
    return { ok: true };
  },

  async computeData(
    params: AuditTrailParams,
  ): Promise<ComputedReport<AuditTrailData>> {
    const rows = await prismaUnsafe.auditLog.findMany({
      where: {
        organisationId: params.organisationId,
        createdAt: {
          gte: new Date(params.from),
          lt: new Date(params.to),
        },
        ...(params.userId ? { userId: params.userId } : {}),
        ...(params.entityType ? { entityType: params.entityType } : {}),
        ...(params.action ? { action: { contains: params.action } } : {}),
      },
      orderBy: { createdAt: "asc" },
      include: { user: { select: { name: true, email: true } } },
      // Hard cap to avoid memory blowups on year-wide reports.
      take: 50_000,
    });

    return {
      type: "AUDIT_TRAIL",
      organisationId: params.organisationId,
      title: "Audit Trail Report",
      periodLabel: `${formatIST(new Date(params.from), "dd MMM yyyy")} – ${formatIST(new Date(params.to), "dd MMM yyyy")}`,
      generatedAt: new Date().toISOString(),
      data: {
        rows: rows.map((r) => ({
          timestamp: r.createdAt.toISOString(),
          userName: r.user?.name ?? r.user?.email ?? null,
          action: r.action,
          entityType: r.entityType,
          entityId: r.entityId,
          before: r.before ? JSON.stringify(r.before) : "",
          after: r.after ? JSON.stringify(r.after) : "",
        })),
        filters: {
          from: params.from,
          to: params.to,
          userId: params.userId,
          entityType: params.entityType,
          action: params.action,
        },
      },
    };
  },

  async renderExcel(report: ComputedReport<AuditTrailData>): Promise<Buffer> {
    const { data } = report;
    return buildReportWorkbook(
      {
        organisationId: report.organisationId,
        title: report.title,
        periodLabel: report.periodLabel,
        generatedAt: report.generatedAt,
        extra: [
          { label: "Rows", value: String(data.rows.length) },
          { label: "User filter", value: data.filters.userId ?? "all users" },
          {
            label: "Entity filter",
            value: data.filters.entityType ?? "all entities",
          },
          { label: "Action filter", value: data.filters.action ?? "all actions" },
        ],
      },
      [
        {
          name: "Audit trail",
          columns: [
            { header: "Timestamp (IST)", width: 22 },
            { header: "User", width: 24 },
            { header: "Action", width: 28 },
            { header: "Entity type", width: 18 },
            { header: "Entity id", width: 26 },
            { header: "Before", width: 60 },
            { header: "After", width: 60 },
          ],
          rows: data.rows.map((r) => [
            formatIST(new Date(r.timestamp), "dd MMM yyyy HH:mm:ss"),
            r.userName ?? "—",
            r.action,
            r.entityType,
            r.entityId,
            r.before,
            r.after,
          ]),
        },
      ],
    );
  },
};
