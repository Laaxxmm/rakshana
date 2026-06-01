"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Decimal } from "decimal.js";
import { safeAction } from "@/lib/actions/safe-action";
import { prismaUnsafe } from "@/lib/db/prisma";
import { storage, storageKey } from "@/lib/storage";
import { aggregateFor10BD, buildCsv } from "@/lib/compliance/10bd-aggregator";
import { generateForm10BeCertificate } from "@/lib/pdf/form-10be";

/**
 * 10BD wizard server actions.
 *
 * We keep these tight: each action does one thing (create filing, refresh
 * aggregate snapshot, generate CSV, mark filed, bulk-generate 10BE).
 * Heavy work (aggregation + CSV + PDF rendering) lives in `lib/compliance`
 * and `lib/pdf` — these actions are thin transactional wrappers.
 */

const FY_RE = /^\d{4}-\d{2}$/;

export const createFilingAction = safeAction
  .metadata({ requires: "compliance.10bd.create" })
  .inputSchema(
    z.object({
      financialYear: z.string().regex(FY_RE, "FY must be in YYYY-YY format"),
      isRevision: z.boolean().default(false),
      originalFilingArn: z.string().optional(),
    }),
  )
  .action(async ({ parsedInput, ctx }) => {
    const { organisationId } = ctx.scope;
    // If a filing already exists for the FY and we're NOT marking a revision,
    // bounce back to that filing instead of throwing — surfaces to the user
    // as "you already have a 10BD draft for this FY, click to resume".
    const existing = await prismaUnsafe.form10BDFiling.findUnique({
      where: {
        organisationId_financialYear: {
          organisationId,
          financialYear: parsedInput.financialYear,
        },
      },
    });
    if (existing && !parsedInput.isRevision) {
      return { id: existing.id, financialYear: existing.financialYear, resumed: true };
    }
    if (parsedInput.isRevision && !parsedInput.originalFilingArn) {
      throw new Error("Revisions require the ARN of the original filing.");
    }
    // For revisions: the existing filing stays as the official history;
    // we create a NEW filing row marked as a revision pointing at the old ARN.
    if (parsedInput.isRevision) {
      // Drop the unique constraint conflict by archiving the old FY string
      // — append a `-rev` suffix when reading; here we just create a new
      // row with the same FY but a different organisationId+financialYear
      // would conflict. So instead, we mark the old row VOIDED and create
      // a fresh one for the revision.
      if (existing) {
        await prismaUnsafe.form10BDFiling.update({
          where: { id: existing.id },
          data: { filingStatus: "REVISED" },
        });
        // Free up the (organisationId, financialYear) unique slot by
        // tagging the old row's FY with a `-revN` suffix so the new
        // revision can claim the canonical FY string.
        const archivedFy = `${existing.financialYear}-rev${Date.now()}`;
        await prismaUnsafe.form10BDFiling.update({
          where: { id: existing.id },
          data: { financialYear: archivedFy },
        });
      }
    }
    const created = await prismaUnsafe.form10BDFiling.create({
      data: {
        organisationId,
        financialYear: parsedInput.financialYear,
        filingStatus: "DRAFT",
        isRevision: parsedInput.isRevision,
        originalFilingArn: parsedInput.originalFilingArn ?? null,
      },
    });
    revalidatePath("/compliance/10bd");
    return { id: created.id, financialYear: created.financialYear, resumed: false };
  });

export const refreshAggregateAction = safeAction
  .metadata({ requires: "compliance.10bd.create" })
  .inputSchema(z.object({ filingId: z.string() }))
  .action(async ({ parsedInput, ctx }) => {
    const { organisationId } = ctx.scope;
    const filing = await prismaUnsafe.form10BDFiling.findFirstOrThrow({
      where: { id: parsedInput.filingId, organisationId },
    });
    const agg = await aggregateFor10BD(organisationId, filing.financialYear);
    // Persist counts on the filing row so the index page shows them.
    await prismaUnsafe.form10BDFiling.update({
      where: { id: filing.id },
      data: {
        totalDonors: agg.rows.filter((r) => r.valid).length,
        totalDonations: agg.rows
          .filter((r) => r.valid)
          .reduce((acc, r) => acc.plus(r.aggregateAmount), new Decimal(0))
          .toString(),
        filingStatus: agg.rows.some((r) => !r.valid) ? "DRAFT" : "VALIDATED",
      },
    });
    revalidatePath(`/compliance/10bd/${filing.id}`);
    return {
      totalDonors: agg.rows.filter((r) => r.valid).length,
      totalIssues: agg.rows.filter((r) => !r.valid).length,
    };
  });

export const generateCsvAction = safeAction
  .metadata({ requires: "compliance.10bd.export" })
  .inputSchema(z.object({ filingId: z.string() }))
  .action(async ({ parsedInput, ctx }) => {
    const { organisationId } = ctx.scope;
    const filing = await prismaUnsafe.form10BDFiling.findFirstOrThrow({
      where: { id: parsedInput.filingId, organisationId },
    });
    const agg = await aggregateFor10BD(organisationId, filing.financialYear);

    const portalCsv = buildCsv(agg, { withHeader: false });
    const auditCsv = buildCsv(agg, { withHeader: true });

    const portalKey = storageKey.form10BdExport(organisationId, filing.id, false);
    const auditKey = storageKey.form10BdExport(organisationId, filing.id, true);

    const portalBuf = Buffer.from(portalCsv, "utf8");
    const auditBuf = Buffer.from(auditCsv, "utf8");

    const [portalStored, auditStored] = await Promise.all([
      storage.put(portalKey, portalBuf, {
        contentType: "text/csv",
        size: portalBuf.length,
      }),
      storage.put(auditKey, auditBuf, {
        contentType: "text/csv",
        size: auditBuf.length,
      }),
    ]);

    await prismaUnsafe.form10BDFiling.update({
      where: { id: filing.id },
      data: {
        csvExportUrl: portalStored.url,
        filingStatus:
          filing.filingStatus === "FILED" ? filing.filingStatus : "EXPORTED",
      },
    });
    revalidatePath(`/compliance/10bd/${filing.id}`);
    return { portalUrl: portalStored.url, auditUrl: auditStored.url };
  });

export const markFiledAction = safeAction
  .metadata({ requires: "compliance.10bd.markFiled" })
  .inputSchema(
    z.object({
      filingId: z.string(),
      arnNumber: z.string().min(8, "ARN looks too short"),
      filedAt: z.string(), // ISO date
      acknowledgementUrl: z.string().optional(),
    }),
  )
  .action(async ({ parsedInput, ctx }) => {
    const { organisationId } = ctx.scope;
    const filing = await prismaUnsafe.form10BDFiling.findFirstOrThrow({
      where: { id: parsedInput.filingId, organisationId },
    });
    await prismaUnsafe.form10BDFiling.update({
      where: { id: filing.id },
      data: {
        filingStatus: "FILED",
        arnNumber: parsedInput.arnNumber.trim(),
        filedAt: new Date(parsedInput.filedAt),
        acknowledgementUrl: parsedInput.acknowledgementUrl ?? null,
      },
    });
    revalidatePath(`/compliance/10bd/${filing.id}`);
    return { ok: true };
  });

export const generateOne10BeAction = safeAction
  .metadata({ requires: "compliance.10be.generate" })
  .inputSchema(z.object({ filingId: z.string(), donorId: z.string() }))
  .action(async ({ parsedInput, ctx }) => {
    const { organisationId } = ctx.scope;
    const filing = await prismaUnsafe.form10BDFiling.findFirstOrThrow({
      where: { id: parsedInput.filingId, organisationId },
    });
    const result = await generateForm10BeCertificate({
      filingId: filing.id,
      donorId: parsedInput.donorId,
    });
    revalidatePath(`/compliance/10bd/${filing.id}`);
    return {
      certificateNumber: result.certificateNumber,
      certificateId: result.certificateId,
      url: result.url,
    };
  });

export const bulkGenerate10BeAction = safeAction
  .metadata({ requires: "compliance.10be.generate" })
  .inputSchema(z.object({ filingId: z.string() }))
  .action(async ({ parsedInput, ctx }) => {
    const { organisationId } = ctx.scope;
    const filing = await prismaUnsafe.form10BDFiling.findFirstOrThrow({
      where: { id: parsedInput.filingId, organisationId },
    });
    if (filing.filingStatus !== "FILED" || !filing.arnNumber) {
      throw new Error("Mark the filing FILED with an ARN before generating 10BE.");
    }
    const agg = await aggregateFor10BD(organisationId, filing.financialYear);
    const validRows = agg.rows.filter((r) => r.valid);

    // Sequential generation — concurrency at the wizard level is overkill
    // because the share-core sequence allocator already serialises writes.
    // Doing this serially gives us cleaner failure semantics for the UI
    // (one donor's error doesn't take down the entire batch).
    let generated = 0;
    const errors: { donorId: string; donorName: string; message: string }[] = [];
    for (const row of validRows) {
      try {
        await generateForm10BeCertificate({
          filingId: filing.id,
          donorId: row.donorId,
        });
        generated += 1;
      } catch (err) {
        errors.push({
          donorId: row.donorId,
          donorName: row.name,
          message: (err as Error).message,
        });
      }
    }
    revalidatePath(`/compliance/10bd/${filing.id}`);
    return { generated, total: validRows.length, errors };
  });
