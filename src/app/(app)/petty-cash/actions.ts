"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Decimal } from "decimal.js";
import { safeAction } from "@/lib/actions/safe-action";
import { prisma, prismaUnsafe } from "@/lib/db/prisma";
import {
  pettyCashFloatSchema,
  pettyCashTopUpSchema,
} from "@/lib/schemas/expense";

export const createPettyCashFloat = safeAction
  .metadata({ requires: "pettyCash.float.manage" })
  .inputSchema(pettyCashFloatSchema)
  .action(async ({ parsedInput }) => {
    const created = await prisma.pettyCashFloat.create({
      data: {
        name: parsedInput.name,
        custodianId: parsedInput.custodianId,
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
 * Top-up flow: creates a `PettyCashTopUp` row AND debits the source bank
 * via an `Expense` row in the same transaction. All-or-nothing.
 */
export const topUpPettyCash = safeAction
  .metadata({ requires: "pettyCash.topUp" })
  .inputSchema(pettyCashTopUpSchema)
  .action(async ({ parsedInput, ctx }) => {
    await prismaUnsafe.$transaction(async (tx) => {
      const float = await tx.pettyCashFloat.findUniqueOrThrow({
        where: { id: parsedInput.floatId },
      });
      await tx.pettyCashTopUp.create({
        data: {
          floatId: float.id,
          amount: parsedInput.amount.toString(),
          topUpDate: parsedInput.topUpDate,
          bankAccountId: parsedInput.sourceBankAccountId,
          remarks: parsedInput.remarks,
        },
      });
      const next = new Decimal(float.currentBalance.toString()).plus(parsedInput.amount);
      await tx.pettyCashFloat.update({
        where: { id: float.id },
        data: { currentBalance: next.toString() },
      });
      // Audit-trail: also record an Expense row for the bank-side debit so
      // the bank reconciliation in Phase 5 sees the outflow.
      await tx.expense.create({
        data: {
          organisationId: ctx.scope.organisationId,
          voucherNumber: `PCV-TOPUP/${Date.now()}`,
          expenseDate: parsedInput.topUpDate,
          grossAmount: parsedInput.amount.toString(),
          tdsAmount: "0",
          netPayable: parsedInput.amount.toString(),
          mode: "OTHER",
          bankAccountId: parsedInput.sourceBankAccountId,
          isPettyCash: false,
          description: `Petty cash top-up: ${float.name}${parsedInput.remarks ? ` — ${parsedInput.remarks}` : ""}`,
          status: "APPROVED",
          createdById: ctx.scope.userId,
        },
      });
    });
    revalidatePath("/petty-cash");
    revalidatePath("/expenses");
    return { ok: true };
  });
