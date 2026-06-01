"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Decimal } from "decimal.js";
import { safeAction } from "@/lib/actions/safe-action";
import { prisma } from "@/lib/db/prisma";
import {
  beneficiarySchema,
  beneficiaryEnrolmentSchema,
  disbursementSchema,
  impactRecordSchema,
  exitEnrolmentSchema,
} from "@/lib/schemas/beneficiary";

export const createBeneficiary = safeAction
  .metadata({ requires: "beneficiary.create" })
  .inputSchema(beneficiarySchema)
  .action(async ({ parsedInput, ctx }) => {
    const created = await prisma.beneficiary.create({
      data: { ...parsedInput } as never,
    });
    void ctx;
    revalidatePath("/beneficiaries");
    return { ok: true, id: created.id };
  });

export const updateBeneficiary = safeAction
  .metadata({ requires: "beneficiary.update" })
  .inputSchema(beneficiarySchema.and(z.object({ id: z.string().min(1) })))
  .action(async ({ parsedInput }) => {
    const { id, ...rest } = parsedInput;
    await prisma.beneficiary.update({ where: { id }, data: rest });
    revalidatePath("/beneficiaries");
    revalidatePath(`/beneficiaries/${id}`);
    return { ok: true };
  });

export const enrolBeneficiary = safeAction
  .metadata({ requires: "beneficiary.manage" })
  .inputSchema(beneficiaryEnrolmentSchema)
  .action(async ({ parsedInput }) => {
    try {
      await prisma.beneficiaryEnrolment.create({
        data: {
          beneficiaryId: parsedInput.beneficiaryId,
          projectId: parsedInput.projectId,
          enrolledOn: parsedInput.enrolledOn,
          remarks: parsedInput.remarks,
        },
      });
    } catch (err: unknown) {
      const e = err as { code?: string };
      if (e.code === "P2002") {
        throw new Error("Beneficiary is already enrolled in this project.");
      }
      throw err;
    }
    revalidatePath(`/beneficiaries/${parsedInput.beneficiaryId}`);
    revalidatePath(`/projects/${parsedInput.projectId}`);
    return { ok: true };
  });

export const exitEnrolment = safeAction
  .metadata({ requires: "beneficiary.manage" })
  .inputSchema(exitEnrolmentSchema)
  .action(async ({ parsedInput }) => {
    const enrolment = await prisma.beneficiaryEnrolment.update({
      where: { id: parsedInput.enrolmentId },
      data: { exitedOn: parsedInput.exitedOn, remarks: parsedInput.reason ?? undefined },
    });
    revalidatePath(`/beneficiaries/${enrolment.beneficiaryId}`);
    return { ok: true };
  });

export const recordDisbursement = safeAction
  .metadata({ requires: "beneficiary.disbursement.create" })
  .inputSchema(disbursementSchema)
  .action(async ({ parsedInput }) => {
    // If an expenseId is provided, verify the beneficiary is enrolled in the
    // project that owns that expense.
    if (parsedInput.expenseId) {
      const expense = await prisma.expense.findUnique({
        where: { id: parsedInput.expenseId },
        select: { projectId: true },
      });
      if (!expense?.projectId) {
        throw new Error("Linked expense is not tagged to a project.");
      }
      const enrolment = await prisma.beneficiaryEnrolment.findFirst({
        where: {
          beneficiaryId: parsedInput.beneficiaryId,
          projectId: expense.projectId,
        },
      });
      if (!enrolment) {
        throw new Error(
          "Cannot link disbursement to an expense from a project this beneficiary is not enrolled in.",
        );
      }
    }
    await prisma.beneficiaryDisbursement.create({
      data: {
        beneficiaryId: parsedInput.beneficiaryId,
        disbursementDate: parsedInput.disbursementDate,
        type: parsedInput.type,
        value: parsedInput.value.toString(),
        description: parsedInput.description,
        expenseId: parsedInput.expenseId,
        ackUrl: parsedInput.ackUrl,
      },
    });
    revalidatePath(`/beneficiaries/${parsedInput.beneficiaryId}`);
    return { ok: true };
  });

export const recordImpactMetric = safeAction
  .metadata({ requires: "beneficiary.impact.create" })
  .inputSchema(impactRecordSchema)
  .action(async ({ parsedInput }) => {
    await prisma.impactRecord.create({
      data: {
        beneficiaryId: parsedInput.beneficiaryId,
        recordDate: parsedInput.recordDate,
        metricName: parsedInput.metricName,
        metricValue: parsedInput.metricValue,
        notes: parsedInput.notes,
      },
    });
    revalidatePath(`/beneficiaries/${parsedInput.beneficiaryId}`);
    return { ok: true };
  });

void Decimal;
