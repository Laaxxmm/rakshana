"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { safeAction } from "@/lib/actions/safe-action";
import { prismaUnsafe } from "@/lib/db/prisma";
import {
  computeItr7Figures,
  exportItr7Workbook,
  persistItr7Figures,
} from "@/lib/compliance/itr7-figures";

const FY_RE = /^\d{4}-\d{2}$/;

export const computeAction = safeAction
  .metadata({ requires: "compliance.it.create" })
  .inputSchema(
    z.object({
      financialYear: z.string().regex(FY_RE),
      otherIncome: z.string().optional(),
      loansRepaid: z.string().optional(),
    }),
  )
  .action(async ({ parsedInput, ctx }) => {
    const figures = await computeItr7Figures({
      organisationId: ctx.scope.organisationId,
      financialYear: parsedInput.financialYear,
      manualAdjustments: {
        otherIncome: parsedInput.otherIncome,
        loansRepaid: parsedInput.loansRepaid,
      },
    });
    await persistItr7Figures(figures);
    revalidatePath("/compliance/income-tax/itr7");
    return { figures };
  });

export const exportExcelAction = safeAction
  .metadata({ requires: "compliance.it.itr7.export" })
  .inputSchema(
    z.object({
      financialYear: z.string().regex(FY_RE),
      otherIncome: z.string().optional(),
      loansRepaid: z.string().optional(),
    }),
  )
  .action(async ({ parsedInput, ctx }) => {
    const figures = await computeItr7Figures({
      organisationId: ctx.scope.organisationId,
      financialYear: parsedInput.financialYear,
      manualAdjustments: {
        otherIncome: parsedInput.otherIncome,
        loansRepaid: parsedInput.loansRepaid,
      },
    });
    const { url } = await exportItr7Workbook(figures);
    // Track that an export happened so the IT module dashboard can show it
    await prismaUnsafe.itFiling.upsert({
      where: {
        organisationId_financialYear_filingType: {
          organisationId: ctx.scope.organisationId,
          financialYear: parsedInput.financialYear,
          filingType: "ITR7",
        },
      },
      create: {
        organisationId: ctx.scope.organisationId,
        financialYear: parsedInput.financialYear,
        filingType: "ITR7",
        status: "PREPARED",
        excelUrl: url,
      },
      update: { excelUrl: url, status: "PREPARED" },
    });
    revalidatePath("/compliance/income-tax/itr7");
    return { url };
  });
