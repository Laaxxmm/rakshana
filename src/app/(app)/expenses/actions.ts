"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Decimal } from "decimal.js";
import { safeAction } from "@/lib/actions/safe-action";
import { prisma, prismaUnsafe } from "@/lib/db/prisma";
import {
  expenseDraftSchema,
  approveExpenseSchema,
  rejectExpenseSchema,
  markPaidSchema,
  cancelExpenseSchema,
} from "@/lib/schemas/expense";
import { allocateVoucherNumber } from "@/lib/services/voucher-number";
import { canAutoApprove, requiredApprovalRole } from "@/lib/services/approval-policy";
import { computeTds, computeGst } from "@/lib/services/tax-calc";
import { generateVoucherPdf } from "@/lib/pdf/voucher";
import { getFinancialYear } from "@/lib/format/date";
import { tdsQuarterForMonth } from "@/lib/constants/tax";
import { assertTransition } from "@/lib/services/expense-workflow";

// ---------------------------------------------------------------------------
// Draft (no voucher number yet)
// ---------------------------------------------------------------------------

export const createExpenseDraft = safeAction
  .metadata({ requires: "expense.create" })
  .inputSchema(expenseDraftSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { tdsResult, gstResult } = await derivedAmounts(parsedInput);

    const created = await prisma.expense.create({
      data: {
        organisationId: ctx.scope.organisationId,
        voucherNumber: pendingVoucherPlaceholder(),
        expenseDate: parsedInput.expenseDate,
        vendorId: parsedInput.vendorId,
        cashPayeeName: parsedInput.cashPayeeName,
        categoryId: parsedInput.categoryId,
        projectId: parsedInput.projectId,
        grossAmount: parsedInput.grossAmount.toString(),
        tdsAmount: tdsResult.amount.toString(),
        tdsSection: parsedInput.tdsApplicable ? parsedInput.tdsSection : null,
        tdsRate: parsedInput.tdsApplicable ? tdsResult.rate.toString() : null,
        netPayable: tdsResult.netPayable.toString(),
        gstApplicable: parsedInput.gstApplicable,
        cgst: gstResult.cgst.toString(),
        sgst: gstResult.sgst.toString(),
        igst: gstResult.igst.toString(),
        isItcEligible: parsedInput.isItcEligible,
        mode: parsedInput.mode,
        bankAccountId: parsedInput.bankAccountId,
        paymentRef: parsedInput.paymentRef,
        isPettyCash: parsedInput.isPettyCash,
        pettyCashFloatId: parsedInput.pettyCashFloatId,
        description: parsedInput.description,
        billUrl: parsedInput.billUrl,
        status: "DRAFT",
        createdById: ctx.scope.userId,
      } as never,
    });
    revalidatePath("/expenses");
    return { ok: true, id: created.id };
  });

// ---------------------------------------------------------------------------
// Submit — allocates the voucher number atomically, decides auto-approve,
// creates TdsEntry, generates the PDF, enqueues notifications.
// ---------------------------------------------------------------------------

export const submitExpense = safeAction
  .metadata({ requires: "expense.submit" })
  .inputSchema(expenseDraftSchema.extend({ expenseId: z.string().optional() }))
  .action(async ({ parsedInput, ctx }) => {
    const { tdsResult, gstResult } = await derivedAmounts(parsedInput);
    const fy = getFinancialYear(parsedInput.expenseDate);
    const kind = parsedInput.isPettyCash ? "PETTY_CASH" : "GENERAL";

    // FCRA enforcement (Phase 4): if the tagged project is FCRA-flagged,
    // the expense must be paid from an FCRA-only bank account. Cash and
    // petty cash are not permitted for FCRA project spends.
    if (parsedInput.projectId) {
      const project = await prisma.project.findUnique({
        where: { id: parsedInput.projectId },
        select: { isFcra: true },
      });
      if (project?.isFcra) {
        if (parsedInput.isPettyCash) {
          throw new Error("FCRA-tagged projects cannot be paid via petty cash.");
        }
        if (parsedInput.bankAccountId) {
          const bank = await prisma.bankAccount.findUnique({
            where: { id: parsedInput.bankAccountId },
            select: { purpose: true },
          });
          if (bank?.purpose !== "FCRA_ONLY") {
            throw new Error(
              "FCRA-tagged projects must be paid from an FCRA-only bank account.",
            );
          }
        }
      }
    }

    // Petty-cash auto-approval threshold check
    const org = await prismaUnsafe.organisation.findUniqueOrThrow({
      where: { id: ctx.scope.organisationId },
    });
    const pettyThreshold = new Decimal(org.pettyCashThreshold.toString());
    const autoApprovePetty =
      parsedInput.isPettyCash && parsedInput.grossAmount.lte(pettyThreshold);

    // Policy auto-approve for the actor's role
    const autoApprovePolicy = await canAutoApprove(
      ctx.scope.organisationId,
      ctx.scope.role,
      parsedInput.grossAmount,
    );
    const autoApprove = autoApprovePetty || autoApprovePolicy;

    const created = await prismaUnsafe.$transaction(async (tx) => {
      const allocated = await allocateVoucherNumber(tx, {
        organisationId: ctx.scope.organisationId,
        kind,
        financialYear: fy,
      });

      const expense = await tx.expense.create({
        data: {
          organisationId: ctx.scope.organisationId,
          voucherNumber: allocated.voucherNumber,
          voucherSeriesId: allocated.seriesId,
          expenseDate: parsedInput.expenseDate,
          vendorId: parsedInput.vendorId,
          cashPayeeName: parsedInput.cashPayeeName,
          categoryId: parsedInput.categoryId,
          projectId: parsedInput.projectId,
          grossAmount: parsedInput.grossAmount.toString(),
          tdsAmount: tdsResult.amount.toString(),
          tdsSection: parsedInput.tdsApplicable ? parsedInput.tdsSection : null,
          tdsRate: parsedInput.tdsApplicable ? tdsResult.rate.toString() : null,
          netPayable: tdsResult.netPayable.toString(),
          gstApplicable: parsedInput.gstApplicable,
          cgst: gstResult.cgst.toString(),
          sgst: gstResult.sgst.toString(),
          igst: gstResult.igst.toString(),
          isItcEligible: parsedInput.isItcEligible,
          mode: parsedInput.mode,
          bankAccountId: parsedInput.bankAccountId,
          paymentRef: parsedInput.paymentRef,
          isPettyCash: parsedInput.isPettyCash,
          pettyCashFloatId: parsedInput.pettyCashFloatId,
          description: parsedInput.description,
          billUrl: parsedInput.billUrl,
          status: autoApprove ? "APPROVED" : "PENDING_APPROVAL",
          createdById: ctx.scope.userId,
        },
      });

      // Petty cash balance enforcement
      if (parsedInput.isPettyCash && parsedInput.pettyCashFloatId) {
        const float = await tx.pettyCashFloat.findUniqueOrThrow({
          where: { id: parsedInput.pettyCashFloatId },
        });
        const next = new Decimal(float.currentBalance.toString()).minus(
          parsedInput.grossAmount,
        );
        if (next.lt(0)) {
          throw new Error(
            `Insufficient balance in ${float.name} (₹${float.currentBalance.toString()} available). Top up the float first.`,
          );
        }
        await tx.pettyCashFloat.update({
          where: { id: float.id },
          data: { currentBalance: next.toString() },
        });
      }

      // If the actor's own role auto-clears, record their approval row.
      if (autoApprove) {
        await tx.expenseApproval.create({
          data: {
            expenseId: expense.id,
            approverId: ctx.scope.userId,
            decision: "APPROVED",
            level: 1,
            notes: parsedInput.isPettyCash
              ? "Auto-approved (within petty cash threshold)"
              : "Auto-approved (within approver's policy tier)",
          },
        });
      }

      // TDS feed — Phase 5 reads these
      if (parsedInput.tdsApplicable && parsedInput.tdsSection && tdsResult.amount.gt(0)) {
        await tx.tdsEntry.create({
          data: {
            organisationId: ctx.scope.organisationId,
            expenseId: expense.id,
            deducteeName: parsedInput.vendorId
              ? (await tx.vendor.findUniqueOrThrow({ where: { id: parsedInput.vendorId } })).name
              : parsedInput.cashPayeeName ?? "Unspecified",
            deducteePan: parsedInput.vendorId
              ? (await tx.vendor.findUnique({ where: { id: parsedInput.vendorId } }))?.pan ?? null
              : null,
            section: parsedInput.tdsSection,
            amountPaid: parsedInput.grossAmount.toString(),
            tdsRate: tdsResult.rate.toString(),
            tdsAmount: tdsResult.amount.toString(),
            deductionDate: parsedInput.expenseDate,
            quarter: tdsQuarterForMonth(parsedInput.expenseDate.getMonth() + 1),
            financialYear: fy,
            ldcCertificateId: parsedInput.ldcCertificateId,
            status: "ACTIVE",
          },
        });
      }

      return expense;
    });

    // Generate the voucher PDF after the transaction lands.
    await generateVoucherPdf(created.id);

    // Inline dispatch — notify the next approver (or creator on auto-approve).
    if (!autoApprove) {
      const required = await requiredApprovalRole(
        ctx.scope.organisationId,
        parsedInput.grossAmount,
      );
      await prisma.notification.create({
        data: {
          channel: "IN_APP",
          title: `Approval needed: ${created.voucherNumber}`,
          body: `Expense ₹${parsedInput.grossAmount.toString()} awaiting ${required ?? "approver"} review.`,
          link: `/approvals?focus=${created.id}`,
        } as never,
      });
    }

    revalidatePath("/expenses");
    revalidatePath("/approvals");
    revalidatePath("/notifications");
    revalidatePath("/");
    return {
      ok: true,
      expenseId: created.id,
      voucherNumber: created.voucherNumber,
      autoApprove,
    };
  });

// ---------------------------------------------------------------------------
// Approval transitions
// ---------------------------------------------------------------------------

export const approveExpense = safeAction
  .metadata({ requires: "expense.approve.upto10k" })
  .inputSchema(approveExpenseSchema)
  .action(async ({ parsedInput, ctx }) => {
    const expense = await prisma.expense.findUniqueOrThrow({
      where: { id: parsedInput.expenseId },
    });
    assertTransition("approve", expense.status);
    await prismaUnsafe.$transaction(async (tx) => {
      await tx.expense.update({ where: { id: expense.id }, data: { status: "APPROVED" } });
      await tx.expenseApproval.create({
        data: {
          expenseId: expense.id,
          approverId: ctx.scope.userId,
          decision: "APPROVED",
          level: 1,
          notes: parsedInput.notes,
        },
      });
      await tx.notification.create({
        data: {
          organisationId: ctx.scope.organisationId,
          channel: "IN_APP",
          title: `Voucher ${expense.voucherNumber} approved`,
          body: `Approved by ${ctx.scope.userId}`,
          link: `/expenses?open=${expense.id}`,
        },
      });
    });
    await generateVoucherPdf(expense.id);
    revalidatePath("/expenses");
    revalidatePath("/approvals");
    return { ok: true };
  });

export const rejectExpense = safeAction
  .metadata({ requires: "expense.reject" })
  .inputSchema(rejectExpenseSchema)
  .action(async ({ parsedInput, ctx }) => {
    const expense = await prisma.expense.findUniqueOrThrow({
      where: { id: parsedInput.expenseId },
    });
    assertTransition("reject", expense.status);
    await prismaUnsafe.$transaction(async (tx) => {
      await tx.expense.update({ where: { id: expense.id }, data: { status: "REJECTED" } });
      await tx.expenseApproval.create({
        data: {
          expenseId: expense.id,
          approverId: ctx.scope.userId,
          decision: "REJECTED",
          level: 1,
          notes: parsedInput.notes,
        },
      });
      await tx.notification.create({
        data: {
          organisationId: ctx.scope.organisationId,
          channel: "IN_APP",
          title: `Voucher ${expense.voucherNumber} rejected`,
          body: parsedInput.notes,
          link: `/expenses?open=${expense.id}`,
        },
      });
    });
    revalidatePath("/expenses");
    revalidatePath("/approvals");
    return { ok: true };
  });

export const markExpensePaid = safeAction
  .metadata({ requires: "expense.markPaid" })
  .inputSchema(markPaidSchema)
  .action(async ({ parsedInput }) => {
    const expense = await prisma.expense.findUniqueOrThrow({
      where: { id: parsedInput.expenseId },
    });
    assertTransition("markPaid", expense.status);
    await prisma.expense.update({
      where: { id: expense.id },
      data: {
        status: "PAID",
        paidAt: parsedInput.paidAt,
        mode: parsedInput.modeOverride ?? expense.mode,
        paymentRef: parsedInput.paymentRef ?? expense.paymentRef,
      },
    });
    await generateVoucherPdf(expense.id);
    revalidatePath("/expenses");
    return { ok: true };
  });

export const cancelExpense = safeAction
  .metadata({ requires: "expense.cancel" })
  .inputSchema(cancelExpenseSchema)
  .action(async ({ parsedInput }) => {
    const expense = await prisma.expense.findUniqueOrThrow({
      where: { id: parsedInput.expenseId },
    });
    assertTransition("cancel", expense.status);
    await prismaUnsafe.$transaction(async (tx) => {
      await tx.expense.update({
        where: { id: expense.id },
        data: { status: "CANCELLED" },
      });
      // Refund petty cash float if applicable
      if (expense.isPettyCash && expense.pettyCashFloatId) {
        const float = await tx.pettyCashFloat.findUniqueOrThrow({
          where: { id: expense.pettyCashFloatId },
        });
        const next = new Decimal(float.currentBalance.toString()).plus(
          expense.grossAmount.toString(),
        );
        await tx.pettyCashFloat.update({
          where: { id: float.id },
          data: { currentBalance: next.toString() },
        });
      }
      // Mark the TDS entry cancelled so Phase 5 returns can exclude it
      await tx.tdsEntry.updateMany({
        where: { expenseId: expense.id },
        data: { status: "CANCELLED" },
      });
    });
    await generateVoucherPdf(expense.id);
    revalidatePath("/expenses");
    return { ok: true };
  });

export const reopenExpense = safeAction
  .metadata({ requires: "expense.reopen" })
  .inputSchema(z.object({ expenseId: z.string().min(1) }))
  .action(async ({ parsedInput }) => {
    const expense = await prisma.expense.findUniqueOrThrow({
      where: { id: parsedInput.expenseId },
    });
    assertTransition("reopen", expense.status);
    await prisma.expense.update({
      where: { id: expense.id },
      data: { status: "DRAFT" },
    });
    revalidatePath("/expenses");
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let pendingCounter = 0;
function pendingVoucherPlaceholder(): string {
  // Drafts get a temporary number until `submit` allocates the real one.
  // Using a unique placeholder so the `@@unique` constraint doesn't bite.
  return `DRAFT/${Date.now()}/${++pendingCounter}`;
}

async function derivedAmounts(p: z.infer<typeof expenseDraftSchema>) {
  // Resolve TDS context
  let ldcRate: Decimal | null = null;
  if (p.ldcCertificateId) {
    const ldc = await prisma.ldcCertificate.findUnique({
      where: { id: p.ldcCertificateId },
    });
    if (ldc) ldcRate = new Decimal(ldc.lowerRate.toString());
  }
  const tdsResult = p.tdsApplicable
    ? computeTds({
        grossAmount: p.grossAmount,
        section: p.tdsSection as Parameters<typeof computeTds>[0]["section"],
        ldcRate,
      })
    : { rate: new Decimal(0), amount: new Decimal(0), netPayable: p.grossAmount, applicable: false, sectionMeta: null, warnings: [] };

  const gstResult = p.gstApplicable && p.gstRate !== undefined && p.gstRate !== null
    ? computeGst({
        taxableValue: p.grossAmount,
        rate: p.gstRate,
        isInterState: p.isInterState,
      })
    : {
        taxableValue: new Decimal(0),
        rate: new Decimal(0),
        cgst: new Decimal(0),
        sgst: new Decimal(0),
        igst: new Decimal(0),
        total: new Decimal(p.grossAmount.toString()),
      };

  return { tdsResult, gstResult };
}
