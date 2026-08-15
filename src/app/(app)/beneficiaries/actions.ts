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
    // beneficiarySchema shares its address block with the donor and vendor
    // forms, so it derives a GST state code from the state name. Beneficiary
    // has no stateCode column and Prisma rejects the unknown argument, so it
    // is dropped here.
    const { stateCode, ...data } = parsedInput;
    void stateCode;
    const created = await prisma.beneficiary.create({
      data: data as never,
    });
    void ctx;
    revalidatePath("/beneficiaries");
    return { ok: true, id: created.id };
  });

export const updateBeneficiary = safeAction
  .metadata({ requires: "beneficiary.update" })
  .inputSchema(beneficiarySchema.and(z.object({ id: z.string().min(1) })))
  .action(async ({ parsedInput }) => {
    // stateCode is derived by the shared address schema and has no column on
    // Beneficiary; see createBeneficiary.
    const { id, stateCode, ...rest } = parsedInput;
    void stateCode;
    await prisma.beneficiary.update({ where: { id }, data: rest });
    revalidatePath("/beneficiaries");
    revalidatePath(`/beneficiaries/${id}`);
    return { ok: true };
  });

export const enrolBeneficiary = safeAction
  .metadata({ requires: "beneficiary.manage" })
  .inputSchema(beneficiaryEnrolmentSchema)
  .action(async ({ parsedInput }) => {
    // BeneficiaryEnrolment carries no organisationId, so the extension passes
    // its filters through verbatim. Both parents are resolved through the
    // scoped client first: an enrolment puts a beneficiary on a project's
    // roster, and it is what /beneficiaries widens a PROJECT_MANAGER's list
    // by, so neither side may come from another tenant.
    const beneficiary = await prisma.beneficiary.findUniqueOrThrow({
      where: { id: parsedInput.beneficiaryId },
    });
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: parsedInput.projectId },
    });
    try {
      await prisma.beneficiaryEnrolment.create({
        data: {
          beneficiaryId: beneficiary.id,
          projectId: project.id,
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
    revalidatePath(`/beneficiaries/${beneficiary.id}`);
    revalidatePath(`/projects/${project.id}`);
    return { ok: true };
  });

export const exitEnrolment = safeAction
  .metadata({ requires: "beneficiary.manage" })
  .inputSchema(exitEnrolmentSchema)
  .action(async ({ parsedInput }) => {
    // The enrolment id is only ours if the beneficiary holding it is: reaching
    // the row through its scoped parent is what proves that, since the
    // enrolment itself has no organisationId for the extension to filter on.
    const beneficiary = await prisma.beneficiary.findFirstOrThrow({
      where: { enrolments: { some: { id: parsedInput.enrolmentId } } },
    });
    await prisma.beneficiaryEnrolment.update({
      where: { id: parsedInput.enrolmentId, beneficiaryId: beneficiary.id },
      data: { exitedOn: parsedInput.exitedOn, remarks: parsedInput.reason ?? undefined },
    });
    revalidatePath(`/beneficiaries/${beneficiary.id}`);
    return { ok: true };
  });

export const recordDisbursement = safeAction
  .metadata({ requires: "beneficiary.disbursement.create" })
  .inputSchema(disbursementSchema)
  .action(async ({ parsedInput }) => {
    // BeneficiaryDisbursement has no organisationId of its own, and the value
    // booked here is what /beneficiaries totals per beneficiary, so the
    // recipient is resolved through the scoped client before anything is
    // written against them.
    const beneficiary = await prisma.beneficiary.findUniqueOrThrow({
      where: { id: parsedInput.beneficiaryId },
    });

    // If an expenseId is provided, verify the beneficiary is enrolled in the
    // project that owns that expense. The scoped lookup also settles tenancy:
    // the voucher and the recipient must be the same organisation's.
    let expenseId: string | null = null;
    if (parsedInput.expenseId) {
      const expense = await prisma.expense.findUniqueOrThrow({
        where: { id: parsedInput.expenseId },
        select: { id: true, projectId: true },
      });
      if (!expense.projectId) {
        throw new Error("Linked expense is not tagged to a project.");
      }
      const enrolment = await prisma.beneficiaryEnrolment.findFirst({
        where: {
          beneficiaryId: beneficiary.id,
          projectId: expense.projectId,
        },
      });
      if (!enrolment) {
        throw new Error(
          "Cannot link disbursement to an expense from a project this beneficiary is not enrolled in.",
        );
      }
      expenseId = expense.id;
    }
    await prisma.beneficiaryDisbursement.create({
      data: {
        beneficiaryId: beneficiary.id,
        disbursementDate: parsedInput.disbursementDate,
        type: parsedInput.type,
        value: parsedInput.value.toString(),
        description: parsedInput.description,
        expenseId,
        ackUrl: parsedInput.ackUrl,
      },
    });
    revalidatePath(`/beneficiaries/${beneficiary.id}`);
    return { ok: true };
  });

export const recordImpactMetric = safeAction
  .metadata({ requires: "beneficiary.impact.create" })
  .inputSchema(impactRecordSchema)
  .action(async ({ parsedInput }) => {
    // ImpactRecord has no organisationId; the beneficiary it hangs off is
    // resolved through the scoped client so a foreign id cannot have a metric
    // filed against it.
    const beneficiary = await prisma.beneficiary.findUniqueOrThrow({
      where: { id: parsedInput.beneficiaryId },
    });
    await prisma.impactRecord.create({
      data: {
        beneficiaryId: beneficiary.id,
        recordDate: parsedInput.recordDate,
        metricName: parsedInput.metricName,
        metricValue: parsedInput.metricValue,
        notes: parsedInput.notes,
      },
    });
    revalidatePath(`/beneficiaries/${beneficiary.id}`);
    return { ok: true };
  });

void Decimal;
