"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { safeAction } from "@/lib/actions/safe-action";
import { prismaUnsafe } from "@/lib/db/prisma";

const FY_RE = /^\d{4}-\d{2}$/;

export const createAccumulationAction = safeAction
  .metadata({ requires: "compliance.it.create" })
  .inputSchema(
    z.object({
      financialYear: z.string().regex(FY_RE),
      amount: z.string(),
      purpose: z.string().min(5),
      periodYears: z.number().min(1).max(5).default(5),
      supportDocUrl: z.string().optional(),
    }),
  )
  .action(async ({ parsedInput, ctx }) => {
    const startYear = Number(parsedInput.financialYear.split("-")[0]);
    const startDate = new Date(`${startYear}-04-01T00:00:00+05:30`);
    const endDate = new Date(
      `${startYear + parsedInput.periodYears}-03-31T00:00:00+05:30`,
    );
    await prismaUnsafe.accumulation.create({
      data: {
        organisationId: ctx.scope.organisationId,
        financialYear: parsedInput.financialYear,
        amount: parsedInput.amount,
        purpose: parsedInput.purpose,
        periodYears: parsedInput.periodYears,
        startDate,
        endDate,
        status: "ACTIVE",
        supportDocUrl: parsedInput.supportDocUrl ?? null,
      },
    });
    revalidatePath("/compliance/income-tax/form-10");
    return { ok: true };
  });

export const closeAccumulationAction = safeAction
  .metadata({ requires: "compliance.it.create" })
  .inputSchema(
    z.object({
      id: z.string(),
      newStatus: z.enum(["UTILISED", "EXPIRED"]),
    }),
  )
  .action(async ({ parsedInput, ctx }) => {
    await prismaUnsafe.accumulation.updateMany({
      where: { id: parsedInput.id, organisationId: ctx.scope.organisationId },
      data: { status: parsedInput.newStatus },
    });
    revalidatePath("/compliance/income-tax/form-10");
    return { ok: true };
  });
