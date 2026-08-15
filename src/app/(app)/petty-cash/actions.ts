"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { safeAction } from "@/lib/actions/safe-action";
import { prisma, prismaUnsafe } from "@/lib/db/prisma";
import {
  pettyCashFloatSchema,
  pettyCashTopUpSchema,
} from "@/lib/schemas/expense";

export const createPettyCashFloat = safeAction
  .metadata({ requires: "pettyCash.float.manage" })
  .inputSchema(pettyCashFloatSchema)
  .action(async ({ parsedInput, ctx }) => {
    // The custodian answers for the cash box, so they have to be in this trust.
    // User and Membership are system models — the tenancy extension scopes
    // neither — so the organisation is named in the filter by hand, and the
    // membership's own userId is what gets written.
    const membership = await prismaUnsafe.membership.findFirstOrThrow({
      where: {
        userId: parsedInput.custodianId,
        organisationId: ctx.scope.organisationId,
        isActive: true,
      },
    });
    const created = await prisma.pettyCashFloat.create({
      data: {
        name: parsedInput.name,
        custodianId: membership.userId,
        floatAmount: parsedInput.floatAmount.toString(),
        currentBalance: parsedInput.floatAmount.toString(),
        isActive: true,
      } as never,
    });
    revalidatePath("/petty-cash");
    return { ok: true, id: created.id };
  });

export const deactivatePettyCashFloat = safeAction
  .metadata({ requires: "pettyCash.float.manage" })
  .inputSchema(z.object({ id: z.string().min(1) }))
  .action(async ({ parsedInput }) => {
    await prisma.pettyCashFloat.update({
      where: { id: parsedInput.id },
      data: { isActive: false },
    });
    revalidatePath("/petty-cash");
    return { ok: true };
  });

/**
 * Top-up flow: creates a `PettyCashTopUp` row, credits the float and writes
 * the AuditLog entry, all in one transaction. All-or-nothing.
 *
 * No Expense is written. A top-up only moves cash between two of the trust's
 * own pockets; booking it as an expense would count it as application of
 * income under section 11(1)(a) on top of the vouchers later spent out of the
 * float, overstating the 85% figure by the amount of every top-up. The bank
 * side of the movement is the `PettyCashTopUp` row's own bankAccountId, and
 * the signatory is its createdById.
 */
export const topUpPettyCash = safeAction
  .metadata({ requires: "pettyCash.topUp" })
  .inputSchema(pettyCashTopUpSchema)
  .action(async ({ parsedInput, ctx }) => {
    // Resolve both ids through the scoped client first: the transaction below
    // runs unscoped, so without this a caller could post another org's floatId
    // or bank account and have the credit land outside their tenant.
    const float = await prisma.pettyCashFloat.findUniqueOrThrow({
      where: { id: parsedInput.floatId },
    });
    const sourceBank = await prisma.bankAccount.findUniqueOrThrow({
      where: { id: parsedInput.sourceBankAccountId },
    });

    await prismaUnsafe.$transaction(async (tx) => {
      const topUp = await tx.pettyCashTopUp.create({
        data: {
          floatId: float.id,
          amount: parsedInput.amount.toString(),
          topUpDate: parsedInput.topUpDate,
          bankAccountId: sourceBank.id,
          remarks: parsedInput.remarks,
          createdById: ctx.scope.userId,
        },
      });
      await tx.pettyCashFloat.update({
        where: { id: float.id },
        data: { currentBalance: { increment: parsedInput.amount.toString() } },
      });
      // The tenancy extension writes the AuditLog row for scoped models, but
      // it sees neither of these writes: PettyCashTopUp is parent-scoped so
      // the extension returns early, and `prismaUnsafe` bypasses it entirely.
      // Written inside the transaction so the cash movement and the record of
      // who authorised it commit or roll back together — an unattributable
      // bank withdrawal is what an auditor treats as a missing voucher.
      await tx.auditLog.create({
        data: {
          organisationId: ctx.scope.organisationId,
          userId: ctx.scope.userId,
          action: "PettyCashTopUp.create",
          entityType: "PettyCashTopUp",
          entityId: topUp.id,
          after: {
            floatId: float.id,
            amount: parsedInput.amount.toString(),
            topUpDate: parsedInput.topUpDate.toISOString(),
            bankAccountId: sourceBank.id,
            remarks: parsedInput.remarks,
          },
        },
      });
    });
    revalidatePath("/petty-cash");
    revalidatePath("/banking");
    return { ok: true };
  });
