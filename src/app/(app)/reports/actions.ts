"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { safeAction, UserFacingError } from "@/lib/actions/safe-action";
import { prisma, prismaUnsafe } from "@/lib/db/prisma";
import { storage, storageKey } from "@/lib/storage";
import { REPORT_REGISTRY, REPORT_SLUGS, type ReportSlug } from "@/lib/reports/registry";

/**
 * Generate a report. Persists a Report row, runs the generator's Excel
 * (and PDF if implemented), uploads to storage, returns the URLs.
 *
 * Errors during render still persist the Report row in FAILED state so
 * the operator can see what happened.
 */
export const generateReport = safeAction
  .metadata({ requires: "report.generate" })
  .inputSchema(
    z.object({
      slug: z.enum(REPORT_SLUGS as [ReportSlug, ...ReportSlug[]]),
      params: z.record(z.string(), z.unknown()),
    }),
  )
  .action(async ({ parsedInput, ctx }) => {
    const generator = REPORT_REGISTRY[parsedInput.slug as ReportSlug];
    // Inject orgId server-side so the client can't override it.
    const params = {
      ...parsedInput.params,
      organisationId: ctx.scope.organisationId,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const validation = (generator as any).validate(params);
    if (!validation.ok) {
      throw new Error(validation.errors.join("; "));
    }

    const report = await prismaUnsafe.report.create({
      data: {
        organisationId: ctx.scope.organisationId,
        reportType: generator.reportType,
        params: parsedInput.params as never,
        generatedById: ctx.scope.userId,
        status: "GENERATING",
      },
    });

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const computed = await (generator as any).computeData(params);

      // Excel — every report ships one.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const xlsxBuf = await (generator as any).renderExcel(computed);
      const xlsxKey = storageKey.report(
        ctx.scope.organisationId,
        generator.reportType,
        report.id,
        "xlsx",
      );
      const xlsxStored = await storage.put(xlsxKey, xlsxBuf, {
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        size: xlsxBuf.length,
      });

      // PDF — optional per generator.
      let pdfKey: string | null = null;
      let pdfUrl: string | null = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((generator as any).renderPdf) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pdfBuf = await (generator as any).renderPdf(computed);
        pdfKey = storageKey.report(
          ctx.scope.organisationId,
          generator.reportType,
          report.id,
          "pdf",
        );
        const pdfStored = await storage.put(pdfKey, pdfBuf, {
          contentType: "application/pdf",
          size: pdfBuf.length,
        });
        pdfUrl = pdfStored.url;
      }

      await prismaUnsafe.report.update({
        where: { id: report.id },
        data: {
          status: "READY",
          excelStorageKey: xlsxKey,
          excelUrl: xlsxStored.url,
          pdfStorageKey: pdfKey,
          pdfUrl,
        },
      });

      revalidatePath("/reports");
      return {
        ok: true,
        id: report.id,
        excelUrl: xlsxStored.url,
        pdfUrl,
        hasPdf: Boolean(pdfUrl),
      };
    } catch (err) {
      await prismaUnsafe.report.update({
        where: { id: report.id },
        data: {
          status: "FAILED",
          errorMessage: (err as Error).message,
        },
      });
      throw err;
    }
  });

/**
 * Deleting a report takes its stored objects with it: the row's two storage
 * keys are the app's only pointer to those bytes, so a row removed on its own
 * leaves them unreachable and unaccounted for.
 *
 * The row is resolved through the scoped client first — a report id belonging
 * to another organisation resolves to nothing, and the caller is told that
 * rather than told the delete worked.
 */
export const deleteReport = safeAction
  .metadata({ requires: "report.delete" })
  .inputSchema(z.object({ id: z.string().min(1) }))
  .action(async ({ parsedInput }) => {
    const report = await prisma.report.findUnique({
      where: { id: parsedInput.id },
      select: { id: true, excelStorageKey: true, pdfStorageKey: true },
    });
    if (!report) {
      throw new UserFacingError(
        "That report is not in this organisation's records.",
      );
    }

    await prisma.report.delete({ where: { id: report.id } });
    // Idempotent in every adapter, so a key whose object was never written
    // (a FAILED generation) is not an error.
    for (const key of [report.excelStorageKey, report.pdfStorageKey]) {
      if (key) await storage.remove(key);
    }

    revalidatePath("/reports");
    return { ok: true };
  });
