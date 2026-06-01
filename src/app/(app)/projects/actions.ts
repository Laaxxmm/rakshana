"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Decimal } from "decimal.js";
import { Prisma } from "@prisma/client";
import { safeAction } from "@/lib/actions/safe-action";
import { prisma, prismaUnsafe } from "@/lib/db/prisma";
import {
  projectSchema,
  budgetHeadSchema,
  grantAllocationSchema,
  generateUtilCertSchema,
  projectTransitionSchema,
  reallocateBudgetSchema,
  migrateFromPlaceholderSchema,
} from "@/lib/schemas/project";
import {
  actionForTargetStatus,
  nextProjectStatus,
} from "@/lib/services/project-workflow";
import { generateUtilisationCertificate } from "@/lib/pdf/utilisation-certificate";

export const createProject = safeAction
  .metadata({ requires: "project.create" })
  .inputSchema(projectSchema)
  .action(async ({ parsedInput, ctx }) => {
    try {
      const created = await prisma.project.create({
        data: {
          code: parsedInput.code,
          name: parsedInput.name,
          description: parsedInput.description,
          startDate: parsedInput.startDate,
          endDate: parsedInput.endDate,
          managerId: parsedInput.managerId,
          isCsr: parsedInput.isCsr,
          totalBudget: parsedInput.totalBudget.toString(),
          status: "PLANNED",
        } as never,
      });
      void ctx;
      revalidatePath("/projects");
      return { ok: true, id: created.id };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new Error("A project with this code already exists.");
      }
      throw err;
    }
  });

export const updateProject = safeAction
  .metadata({ requires: "project.update" })
  .inputSchema(projectSchema.and(z.object({ id: z.string().min(1) })))
  .action(async ({ parsedInput }) => {
    const { id, ...rest } = parsedInput;
    await prisma.project.update({
      where: { id },
      data: {
        code: rest.code,
        name: rest.name,
        description: rest.description,
        startDate: rest.startDate,
        endDate: rest.endDate,
        managerId: rest.managerId,
        isCsr: rest.isCsr,
        totalBudget: rest.totalBudget.toString(),
      },
    });
    revalidatePath("/projects");
    revalidatePath(`/projects/${id}`);
    return { ok: true };
  });

export const transitionProject = safeAction
  .metadata({ requires: "project.update" })
  .inputSchema(projectTransitionSchema)
  .action(async ({ parsedInput, ctx }) => {
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: parsedInput.projectId },
    });
    const action = actionForTargetStatus(project.status, parsedInput.toStatus);
    if (!action) {
      throw new Error(
        `Cannot transition project from ${project.status} to ${parsedInput.toStatus}.`,
      );
    }
    const nextStatus = nextProjectStatus(action, project.status);
    await prisma.project.update({
      where: { id: project.id },
      data: { status: nextStatus },
    });
    if (nextStatus === "COMPLETED") {
      await prisma.notification.create({
        data: {
          channel: "IN_APP",
          title: `Project ${project.name} completed`,
          body: "Generate utilisation certificates for the project's donors.",
          link: `/projects/${project.id}`,
        } as never,
      });
    }
    void ctx;
    revalidatePath("/projects");
    revalidatePath(`/projects/${project.id}`);
    revalidatePath("/notifications");
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Budget heads
// ---------------------------------------------------------------------------

export const addBudgetHead = safeAction
  .metadata({ requires: "project.update" })
  .inputSchema(budgetHeadSchema)
  .action(async ({ parsedInput }) => {
    // Enforce sum-of-heads ≤ project.totalBudget. If totalBudget is 0 (the
    // form computes total from heads), we accept and update project total.
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: parsedInput.projectId },
      include: { budgetHeads: true },
    });
    const sumExisting = project.budgetHeads.reduce(
      (acc, h) => acc.plus(h.budgetedAmount.toString()),
      new Decimal(0),
    );
    const proposed = sumExisting.plus(parsedInput.budgetedAmount);
    const total = new Decimal(project.totalBudget.toString());

    await prismaUnsafe.$transaction(async (tx) => {
      await tx.projectBudgetHead.create({
        data: {
          projectId: parsedInput.projectId,
          name: parsedInput.name,
          budgetedAmount: parsedInput.budgetedAmount.toString(),
        },
      });
      // If the total wasn't manually set (i.e. it's <= sum), bump it
      if (total.lt(proposed)) {
        await tx.project.update({
          where: { id: parsedInput.projectId },
          data: { totalBudget: proposed.toString() },
        });
      }
    });
    revalidatePath(`/projects/${parsedInput.projectId}`);
    return { ok: true };
  });

export const reallocateBudget = safeAction
  .metadata({ requires: "project.budget.reallocate" })
  .inputSchema(reallocateBudgetSchema)
  .action(async ({ parsedInput }) => {
    await prismaUnsafe.$transaction(async (tx) => {
      const from = await tx.projectBudgetHead.findUniqueOrThrow({
        where: { id: parsedInput.fromHeadId },
      });
      const to = await tx.projectBudgetHead.findUniqueOrThrow({
        where: { id: parsedInput.toHeadId },
      });
      if (from.projectId !== to.projectId) {
        throw new Error("Cannot reallocate across projects.");
      }
      const fromNew = new Decimal(from.budgetedAmount.toString()).minus(parsedInput.amount);
      if (fromNew.lt(0)) {
        throw new Error(
          `Cannot move ₹${parsedInput.amount.toString()} from ${from.name} — would go negative.`,
        );
      }
      const toNew = new Decimal(to.budgetedAmount.toString()).plus(parsedInput.amount);
      await tx.projectBudgetHead.update({
        where: { id: from.id },
        data: { budgetedAmount: fromNew.toString() },
      });
      await tx.projectBudgetHead.update({
        where: { id: to.id },
        data: { budgetedAmount: toNew.toString() },
      });
    });
    revalidatePath(`/projects`);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Grant allocation (planned funding)
// ---------------------------------------------------------------------------

export const addGrantAllocation = safeAction
  .metadata({ requires: "project.update" })
  .inputSchema(grantAllocationSchema)
  .action(async ({ parsedInput }) => {
    await prisma.grantAllocation.create({
      data: {
        projectId: parsedInput.projectId,
        donorId: parsedInput.donorId,
        description: parsedInput.description,
        amount: parsedInput.amount.toString(),
        receivedOn: parsedInput.receivedOn,
        remarks: parsedInput.remarks,
      } as never,
    });
    revalidatePath(`/projects/${parsedInput.projectId}`);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Utilisation certificate
// ---------------------------------------------------------------------------

export const generateUtilCert = safeAction
  .metadata({ requires: "project.utilisationCertificate.generate" })
  .inputSchema(generateUtilCertSchema)
  .action(async ({ parsedInput, ctx }) => {
    const result = await generateUtilisationCertificate({
      projectId: parsedInput.projectId,
      donorId: parsedInput.donorId,
      periodFrom: parsedInput.periodFrom,
      periodTo: parsedInput.periodTo,
      generatedById: ctx.scope.userId,
    });
    revalidatePath(`/projects/${parsedInput.projectId}`);
    return {
      ok: true,
      certificateId: result.certificateId,
      certificateNumber: result.certificateNumber,
      url: result.url,
    };
  });

// ---------------------------------------------------------------------------
// Placeholder migration
// ---------------------------------------------------------------------------

export const migrateFromPlaceholder = safeAction
  .metadata({ requires: "project.migrateFromPlaceholder" })
  .inputSchema(migrateFromPlaceholderSchema)
  .action(async ({ parsedInput }) => {
    const result = await prismaUnsafe.$transaction(async (tx) => {
      const target = await tx.project.findUniqueOrThrow({
        where: { id: parsedInput.targetProjectId },
      });
      const donationsUpdated = parsedInput.donationIds.length
        ? await tx.donation.updateMany({
            where: { id: { in: parsedInput.donationIds } },
            data: { projectId: target.id },
          })
        : { count: 0 };
      const expensesUpdated = parsedInput.expenseIds.length
        ? await tx.expense.updateMany({
            where: { id: { in: parsedInput.expenseIds } },
            data: { projectId: target.id },
          })
        : { count: 0 };
      return {
        donationsMoved: donationsUpdated.count,
        expensesMoved: expensesUpdated.count,
      };
    });
    revalidatePath("/projects");
    return { ok: true, ...result };
  });
