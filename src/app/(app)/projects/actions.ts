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
    //
    // The scoped read is also the tenancy proof for the unscoped transaction
    // below: ProjectBudgetHead has no organisationId, so only the project it
    // hangs off can establish whose budget is being written.
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
          projectId: project.id,
          name: parsedInput.name,
          budgetedAmount: parsedInput.budgetedAmount.toString(),
        },
      });
      // If the total wasn't manually set (i.e. it's <= sum), bump it
      if (total.lt(proposed)) {
        await tx.project.update({
          where: { id: project.id },
          data: { totalBudget: proposed.toString() },
        });
      }
    });
    revalidatePath(`/projects/${project.id}`);
    return { ok: true };
  });

export const reallocateBudget = safeAction
  .metadata({ requires: "project.budget.reallocate" })
  .inputSchema(reallocateBudgetSchema)
  .action(async ({ parsedInput }) => {
    // ProjectBudgetHead has no organisationId, so the extension cannot scope it.
    // Reaching the heads through their owning project is what proves tenancy —
    // budgetedAmount is printed in the donor-facing breakup of every
    // utilisation certificate, so a foreign head must never be writable.
    const project = await prisma.project.findFirstOrThrow({
      where: { budgetHeads: { some: { id: parsedInput.fromHeadId } } },
    });
    await prismaUnsafe.$transaction(async (tx) => {
      const from = await tx.projectBudgetHead.findUniqueOrThrow({
        where: { id: parsedInput.fromHeadId },
      });
      const to = await tx.projectBudgetHead.findUniqueOrThrow({
        where: { id: parsedInput.toHeadId },
      });
      if (from.projectId !== project.id || to.projectId !== project.id) {
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
    // GrantAllocation has no organisationId, so the extension scopes neither
    // the project it funds nor the donor it credits. Both are resolved through
    // the scoped client first: a foreign projectId books planned funding into
    // another organisation's project, and a foreign donorId credits their
    // donor with money that never reached them.
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: parsedInput.projectId },
    });
    const donor = parsedInput.donorId
      ? await prisma.donor.findUniqueOrThrow({ where: { id: parsedInput.donorId } })
      : null;
    await prisma.grantAllocation.create({
      data: {
        projectId: project.id,
        donorId: donor?.id ?? null,
        description: parsedInput.description,
        amount: parsedInput.amount.toString(),
        receivedOn: parsedInput.receivedOn,
        remarks: parsedInput.remarks,
      },
    });
    revalidatePath(`/projects/${project.id}`);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Utilisation certificate
// ---------------------------------------------------------------------------

export const generateUtilCert = safeAction
  .metadata({ requires: "project.utilisationCertificate.generate" })
  .inputSchema(generateUtilCertSchema)
  .action(async ({ parsedInput, ctx }) => {
    // generateUtilisationCertificate runs entirely on prismaUnsafe, so it
    // resolves both ids without a tenancy filter. Prove ownership here first:
    // a foreign projectId would burn a number from that org's UTILISATION
    // series and file a certificate they never issued against their own
    // donation and expense totals.
    await prisma.project.findUniqueOrThrow({ where: { id: parsedInput.projectId } });
    await prisma.donor.findUniqueOrThrow({ where: { id: parsedInput.donorId } });
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
  .action(async ({ parsedInput, ctx }) => {
    // Unscoped transaction: every where clause carries organisationId by hand.
    // Without it a caller could repoint another org's donations at their own
    // project, silently shrinking the victim's project-utilisation report by
    // the moved amount. A partial match means at least one id was foreign, so
    // the whole migration aborts rather than moving a subset.
    //
    // The counts are compared against the DISTINCT ids: updateMany reports rows
    // touched, and a caller repeating an id in the list is a harmless duplicate,
    // not a tenancy fault. Comparing against the raw array length would abort a
    // legitimate migration and point the operator at a breach that never was.
    const organisationId = ctx.scope.organisationId;
    const donationIds = [...new Set(parsedInput.donationIds)];
    const expenseIds = [...new Set(parsedInput.expenseIds)];
    const result = await prismaUnsafe.$transaction(async (tx) => {
      const target = await tx.project.findUniqueOrThrow({
        where: { id: parsedInput.targetProjectId, organisationId },
      });
      const donationsUpdated = donationIds.length
        ? await tx.donation.updateMany({
            where: { id: { in: donationIds }, organisationId },
            data: { projectId: target.id },
          })
        : { count: 0 };
      if (donationsUpdated.count !== donationIds.length) {
        throw new Error("Some donations were not found in this organisation.");
      }
      const expensesUpdated = expenseIds.length
        ? await tx.expense.updateMany({
            where: { id: { in: expenseIds }, organisationId },
            data: { projectId: target.id },
          })
        : { count: 0 };
      if (expensesUpdated.count !== expenseIds.length) {
        throw new Error("Some expenses were not found in this organisation.");
      }
      return {
        donationsMoved: donationsUpdated.count,
        expensesMoved: expensesUpdated.count,
      };
    });
    revalidatePath("/projects");
    return { ok: true, ...result };
  });
