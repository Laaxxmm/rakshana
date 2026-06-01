import "server-only";
import { Decimal } from "decimal.js";
import { prismaUnsafe } from "@/lib/db/prisma";
import { storage, storageKey } from "@/lib/storage";
import { buildWorkbook, type ExcelSheet } from "@/lib/exporter/xlsx";
import {
  computeEightyFiveRule,
  type EightyFiveRuleBreakdown,
} from "./eighty-five-rule";

/**
 * ITR-7 figures preparation.
 *
 * Builds the numbers a trust's CA needs to file ITR-7 for an FY. The
 * 85% rule calculator does the heavy lifting; this layer adds schedule
 * structure (VC, AOI), persists to `FinancialYearSummary`, and exports
 * the figures as an Excel workbook (one sheet per schedule) + a
 * human-readable PDF for CA review.
 */

export type Itr7FiguresInput = {
  organisationId: string;
  financialYear: string;
  manualAdjustments?: {
    otherIncome?: string;
    loansRepaid?: string;
  };
};

export type Itr7Figures = {
  organisationId: string;
  financialYear: string;
  rule85: EightyFiveRuleBreakdown;
  scheduleVc: {
    corpusDonations: string;
    corpusDonorCount: number;
    domesticOtherThanCorpus: string;
    domesticDonorCount: number;
    fcraDonations: string;
    fcraDonorCount: number;
    anonymousDonations: string;
    anonymousDonorCount: number;
    anonymousFloor: string;
    anonymousTaxableExcess: string;
  };
  scheduleAoi: {
    revenueApplication: string;
    capitalApplication: string;
    accumulation: string;
    loansRepaid: string;
    total: string;
  };
  computedAt: string;
};

/**
 * Pure compute — does not write. Use `persistItr7Figures` to upsert into
 * `FinancialYearSummary` after the auditor approves the numbers.
 */
export async function computeItr7Figures(
  input: Itr7FiguresInput,
): Promise<Itr7Figures> {
  const rule85 = await computeEightyFiveRule({
    organisationId: input.organisationId,
    financialYear: input.financialYear,
    manualAdjustments: input.manualAdjustments,
  });

  // Schedule VC is the donor-side breakdown the IT department wants in ITR-7.
  // The 85% calc already segregates corpus / FCRA / domestic / anonymous —
  // we just relabel for the schedule.
  const scheduleVc = {
    corpusDonations: rule85.corpusContributions,
    corpusDonorCount: rule85.donorCounts.corpus,
    domesticOtherThanCorpus: new Decimal(rule85.voluntaryContributionsExCorpus)
      .minus(rule85.fcraContributions)
      .toFixed(2),
    domesticDonorCount: rule85.donorCounts.domestic,
    fcraDonations: rule85.fcraContributions,
    fcraDonorCount: rule85.donorCounts.fcra,
    anonymousDonations: rule85.anonymousDonations,
    anonymousDonorCount: rule85.donorCounts.anonymous,
    anonymousFloor: rule85.anonymousFloor,
    anonymousTaxableExcess: rule85.anonymousExcessOverFloor,
  };

  const scheduleAoi = {
    revenueApplication: rule85.revenueApplication,
    capitalApplication: rule85.capitalApplication,
    accumulation: rule85.accumulation,
    loansRepaid: rule85.loansRepaid,
    total: rule85.totalApplication,
  };

  return {
    organisationId: input.organisationId,
    financialYear: input.financialYear,
    rule85,
    scheduleVc,
    scheduleAoi,
    computedAt: new Date().toISOString(),
  };
}

/**
 * Snapshot the figures into `FinancialYearSummary` for downstream
 * (dashboard tile, audit report). Idempotent: same orgId+FY upserts.
 */
export async function persistItr7Figures(
  figures: Itr7Figures,
): Promise<{ id: string }> {
  const data = {
    organisationId: figures.organisationId,
    financialYear: figures.financialYear,
    totalReceipts: figures.rule85.totalReceipts,
    corpusDonations: figures.scheduleVc.corpusDonations,
    fcraDonations: figures.scheduleVc.fcraDonations,
    anonymousDonations: figures.scheduleVc.anonymousDonations,
    totalApplication: figures.rule85.totalApplication,
    revenueApplication: figures.rule85.revenueApplication,
    capitalApplication: figures.rule85.capitalApplication,
    accumulatedUnderSec11_2: figures.rule85.accumulation,
    applicationPercent: figures.rule85.applicationPercentage,
    computedAt: new Date(figures.computedAt),
  };
  const row = await prismaUnsafe.financialYearSummary.upsert({
    where: {
      organisationId_financialYear: {
        organisationId: figures.organisationId,
        financialYear: figures.financialYear,
      },
    },
    create: data,
    update: data,
  });
  return { id: row.id };
}

/**
 * Build an Excel workbook with one sheet per schedule. The shape is what
 * a CA would expect to see when reviewing ITR-7 source data.
 */
export async function exportItr7Workbook(figures: Itr7Figures): Promise<{
  buffer: Buffer;
  url: string;
}> {
  const f = figures;
  const sheets: ExcelSheet[] = [
    {
      name: "Cover",
      columns: [
        { header: "Field", width: 36 },
        { header: "Value", width: 28 },
      ],
      rows: [
        ["Financial Year", f.financialYear],
        ["Organisation ID", f.organisationId],
        ["Computed At", f.computedAt],
        [],
        ["85% Application Rule Outcome", f.rule85.meetsThreshold ? "PASS" : "SHORTFALL"],
        ["Application Percentage", `${f.rule85.applicationPercentage}%`],
        ["Threshold", `${f.rule85.thresholdPercentage}%`],
        ["Shortfall Amount", f.rule85.shortfallAmount],
      ],
    },
    {
      name: "Schedule VC",
      preHeaderRows: [["Schedule VC — Voluntary Contributions"]],
      columns: [
        { header: "Item", width: 50 },
        { header: "Donors", width: 12 },
        { header: "Amount (₹)", width: 20 },
      ],
      rows: [
        ["Corpus donations", f.scheduleVc.corpusDonorCount, f.scheduleVc.corpusDonations],
        [
          "Other than corpus — domestic",
          f.scheduleVc.domesticDonorCount,
          f.scheduleVc.domesticOtherThanCorpus,
        ],
        [
          "Other than corpus — foreign source (FCRA)",
          f.scheduleVc.fcraDonorCount,
          f.scheduleVc.fcraDonations,
        ],
        [
          "Anonymous donations (subject to 115BBC)",
          f.scheduleVc.anonymousDonorCount,
          f.scheduleVc.anonymousDonations,
        ],
        ["  Anonymous floor (max ₹1L or 5%)", null, f.scheduleVc.anonymousFloor],
        ["  Anonymous taxable excess @ 30%", null, f.scheduleVc.anonymousTaxableExcess],
      ],
    },
    {
      name: "Schedule AOI",
      preHeaderRows: [["Schedule AOI — Application of Income"]],
      columns: [
        { header: "Item", width: 50 },
        { header: "Amount (₹)", width: 20 },
      ],
      rows: [
        ["Revenue application (non-capital expenses)", f.scheduleAoi.revenueApplication],
        ["Capital application (capital expenses)", f.scheduleAoi.capitalApplication],
        ["Accumulation under Sec 11(2) (Form 10)", f.scheduleAoi.accumulation],
        ["Loans repaid (manual entry)", f.scheduleAoi.loansRepaid],
        ["Total application", f.scheduleAoi.total],
      ],
    },
    {
      name: "85% Computation",
      preHeaderRows: [["85% Rule — Section 11 Application of Income"]],
      columns: [
        { header: "Line", width: 56 },
        { header: "Amount (₹)", width: 20 },
      ],
      rows: [
        ["Total receipts (denominator)", f.rule85.totalReceipts],
        ["Total application (numerator)", f.rule85.totalApplication],
        [
          "Application %",
          `${f.rule85.applicationPercentage} (threshold ${f.rule85.thresholdPercentage}%)`,
        ],
        ["Outcome", f.rule85.meetsThreshold ? "PASS" : "SHORTFALL"],
        ["Shortfall amount", f.rule85.shortfallAmount],
      ],
    },
  ];

  const buffer = await buildWorkbook(sheets);
  const key = storageKey.itr7Export(
    f.organisationId,
    `${f.financialYear}-itr7-figures`,
    "excel",
  );
  const stored = await storage.put(key, buffer, {
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    size: buffer.length,
  });
  return { buffer, url: stored.url };
}
