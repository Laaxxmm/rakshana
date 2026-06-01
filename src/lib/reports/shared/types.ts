/**
 * Common types for the Reports module (Phase 6).
 *
 * Each report module under `src/lib/reports/` exports a `ReportGenerator`.
 * The wizard at `/reports/[type]` validates params, calls `computeData`
 * for the preview render, then calls `renderExcel` / `renderPdf` when the
 * user clicks Generate.
 *
 * Sub-typed generics (`TParams`, `TData`) let each report keep its own
 * domain shape while sharing the lifecycle. Type narrowing happens in the
 * dispatch action via the `type` discriminator on `ReportType`.
 */

import type { ReportType } from "@prisma/client";

export type ValidationResult =
  | { ok: true }
  | { ok: false; errors: string[] };

/** Common parameter base — every report has at least an org id. */
export type BaseParams = { organisationId: string };

export type ComputedReport<TData> = {
  type: ReportType;
  /** Carried through so the renderers can fetch org branding for the cover/header. */
  organisationId: string;
  title: string;
  subtitle?: string;
  /** Human-readable period label (e.g. "FY 2024-25" or "Apr 2024 – Sep 2024"). */
  periodLabel: string;
  /** The data payload, shape-defined by each report module. */
  data: TData;
  /** ISO timestamp for the cover page / audit log. */
  generatedAt: string;
};

export interface ReportGenerator<TParams extends BaseParams, TData> {
  /** Stable string used in URLs (e.g. "receipt-payment"). */
  slug: string;
  /** Pretty title shown in the wizard and on the PDF cover. */
  title: string;
  /** Optional one-liner for the wizard card. */
  summary?: string;
  /** The discriminator stored on the Report row. */
  reportType: ReportType;

  validate(params: TParams): ValidationResult;
  computeData(params: TParams): Promise<ComputedReport<TData>>;
  renderExcel(report: ComputedReport<TData>): Promise<Buffer>;
  /** PDF is optional — Excel ships for all 10; PDF for the highest-value 5. */
  renderPdf?(report: ComputedReport<TData>): Promise<Buffer>;
}
