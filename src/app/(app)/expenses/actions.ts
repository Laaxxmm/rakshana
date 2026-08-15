"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Decimal } from "decimal.js";
import type { Expense, PaymentMode, Prisma } from "@prisma/client";
import { safeAction, UserFacingError } from "@/lib/actions/safe-action";
import { prisma, prismaUnsafe } from "@/lib/db/prisma";
import {
  expenseDraftSchema,
  approveExpenseSchema,
  rejectExpenseSchema,
  markPaidSchema,
  cancelExpenseSchema,
} from "@/lib/schemas/expense";
import { storage, storageKey } from "@/lib/storage";
import { validateUpload, type AllowedMime } from "@/lib/storage/validate";
import { compressBill } from "@/lib/images/compress";
import { allocateVoucherNumber } from "@/lib/services/voucher-number";
import {
  canAutoApprove,
  requiredApprovalRole,
  roleAtLeast,
} from "@/lib/services/approval-policy";
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
    const refs = await resolveExpenseRefs({
      vendorId: parsedInput.vendorId,
      categoryId: parsedInput.categoryId,
      projectId: parsedInput.projectId,
      bankAccountId: parsedInput.bankAccountId,
      pettyCashFloatId: parsedInput.pettyCashFloatId,
      ldcCertificateId: parsedInput.ldcCertificateId,
    });
    assertFcraPaymentRoute(refs, parsedInput);
    const { tdsResult, gstResult } = derivedAmounts(parsedInput, refs.ldcCertificate);

    const created = await prisma.expense.create({
      data: {
        organisationId: ctx.scope.organisationId,
        voucherNumber: pendingVoucherPlaceholder(),
        expenseDate: parsedInput.expenseDate,
        vendorId: refs.vendor?.id ?? null,
        cashPayeeName: parsedInput.cashPayeeName,
        categoryId: refs.category?.id ?? null,
        projectId: refs.project?.id ?? null,
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
        bankAccountId: refs.bankAccount?.id ?? null,
        paymentRef: parsedInput.paymentRef,
        isPettyCash: parsedInput.isPettyCash,
        pettyCashFloatId: refs.pettyCashFloat?.id ?? null,
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
  .inputSchema(expenseDraftSchema)
  .action(async ({ parsedInput, ctx }) => {
    // Resolved before the transaction, because the transaction below runs on
    // `prismaUnsafe` and the tenancy extension does not reach inside it: every
    // id it writes has to have been proven out here.
    const refs = await resolveExpenseRefs({
      vendorId: parsedInput.vendorId,
      categoryId: parsedInput.categoryId,
      projectId: parsedInput.projectId,
      bankAccountId: parsedInput.bankAccountId,
      pettyCashFloatId: parsedInput.pettyCashFloatId,
      ldcCertificateId: parsedInput.ldcCertificateId,
    });
    assertFcraPaymentRoute(refs, parsedInput);
    const { tdsResult, gstResult } = derivedAmounts(parsedInput, refs.ldcCertificate);
    const fy = getFinancialYear(parsedInput.expenseDate);
    const kind = parsedInput.isPettyCash ? "PETTY_CASH" : "GENERAL";

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
          vendorId: refs.vendor?.id ?? null,
          cashPayeeName: parsedInput.cashPayeeName,
          categoryId: refs.category?.id ?? null,
          projectId: refs.project?.id ?? null,
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
          bankAccountId: refs.bankAccount?.id ?? null,
          paymentRef: parsedInput.paymentRef,
          isPettyCash: parsedInput.isPettyCash,
          pettyCashFloatId: refs.pettyCashFloat?.id ?? null,
          description: parsedInput.description,
          billUrl: parsedInput.billUrl,
          status: autoApprove ? "APPROVED" : "PENDING_APPROVAL",
          createdById: ctx.scope.userId,
        },
      });

      // Petty cash balance enforcement. Keyed on the float resolved above, and
      // re-read here so the balance the check reads is the one inside the
      // transaction that is about to debit it.
      if (parsedInput.isPettyCash && refs.pettyCashFloat) {
        const float = await tx.pettyCashFloat.findUniqueOrThrow({
          where: { id: refs.pettyCashFloat.id },
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
            // The deductee named here is filed in this organisation's Form 26Q
            // (`aggregateTdsReturn` reads these rows), so the name and PAN come
            // off the vendor the scoped resolve proved, never off a vendor id
            // looked up on the unscoped transaction client.
            deducteeName: refs.vendor?.name ?? parsedInput.cashPayeeName ?? "Unspecified",
            deducteePan: refs.vendor?.pan ?? null,
            section: parsedInput.tdsSection,
            amountPaid: parsedInput.grossAmount.toString(),
            tdsRate: tdsResult.rate.toString(),
            tdsAmount: tdsResult.amount.toString(),
            deductionDate: parsedInput.expenseDate,
            quarter: tdsQuarterForMonth(parsedInput.expenseDate.getMonth() + 1),
            financialYear: fy,
            ldcCertificateId: refs.ldcCertificate?.id ?? null,
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
// Supporting bills — an expense can carry several (invoice + delivery note +
// quotation). Uploaded one call at a time so a 6 MB photo never has to share
// a request body with its siblings.
// ---------------------------------------------------------------------------

const BILL_ALLOWED: AllowedMime[] = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
];
// Pre-compression ceiling: raw phone photos land at 3-6 MB, compressBill takes
// them down to a few hundred KB before anything is written to storage.
const BILL_MAX = 15 * 1024 * 1024;

export const uploadExpenseBill = safeAction
  .metadata({ requires: "expense.create" })
  .inputSchema(
    z.object({
      expenseId: z.string().min(1),
      filename: z.string().trim().min(1).max(200),
      claimedMime: z.string(),
      fileBytes: z.string(),
      /** Free text for the auditor, e.g. "Bill 1 of 3". */
      pageLabel: z.string().trim().max(60).nullable().default(null),
    }),
  )
  .action(async ({ parsedInput, ctx }) => {
    // Scoped read first: ExpenseAttachment is parent-scoped, so the expense
    // lookup is what proves the caller's org owns this voucher.
    const expense = await prisma.expense.findUniqueOrThrow({
      where: { id: parsedInput.expenseId },
      select: { id: true, expenseDate: true },
    });

    const raw = Buffer.from(parsedInput.fileBytes, "base64");
    const v = validateUpload(raw, {
      allowed: BILL_ALLOWED,
      maxSize: BILL_MAX,
      claimedMime: parsedInput.claimedMime,
    });
    // validateUpload's refusals name the size and the ceiling, so they are
    // written for the uploader — thrown as UserFacingError they survive
    // production masking in `handleServerError`.
    if (!v.ok) throw new UserFacingError(v.error);

    const bill = await compressBill(raw);

    // Two-step: the row's id is part of the storage key.
    const created = await prisma.expenseAttachment.create({
      data: {
        expenseId: expense.id,
        fileUrl: "",
        storageKey: "",
        originalName: parsedInput.filename,
        contentType: bill.contentType,
        sizeBytes: bill.compressedSize,
        pageLabel: parsedInput.pageLabel,
        uploadedById: ctx.scope.userId,
      },
    });
    const key = storageKey.expenseBill(
      ctx.scope.organisationId,
      expense.expenseDate,
      created.id,
      bill.contentType,
    );
    const put = await storage.put(key, bill.buffer, {
      contentType: bill.contentType,
      size: bill.compressedSize,
    });
    const attachment = await prisma.expenseAttachment.update({
      where: { id: created.id },
      data: { fileUrl: put.url, storageKey: key },
    });

    console.info(
      `[bill-upload] ${parsedInput.filename} ${bill.originalSize} → ${bill.compressedSize} bytes (${key})`,
    );

    // The voucher lists its bills, so it is stale the moment one lands.
    await generateVoucherPdf(expense.id);
    revalidatePath("/expenses");
    return { ok: true, id: attachment.id, url: attachment.fileUrl };
  });

export const listExpenseAttachments = safeAction
  .metadata({ requires: "expense.view" })
  .inputSchema(z.object({ expenseId: z.string().min(1) }))
  .action(async ({ parsedInput }) => {
    const expense = await prisma.expense.findUniqueOrThrow({
      where: { id: parsedInput.expenseId },
      select: {
        billUrl: true,
        attachments: {
          orderBy: { uploadedAt: "asc" },
          select: {
            id: true,
            fileUrl: true,
            originalName: true,
            contentType: true,
            sizeBytes: true,
            pageLabel: true,
          },
        },
      },
    });
    return {
      ok: true,
      attachments: expense.attachments,
      // Pre-ExpenseAttachment vouchers still have their one bill here.
      legacyBillUrl: expense.attachments.length === 0 ? expense.billUrl : null,
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

    // The metadata permission is only a coarse gate — every role that may
    // approve at all passes it. The org's ApprovalPolicy bands (PRD §7.3)
    // decide who may clear THIS amount, read off the stored gross so a
    // tampered client payload can't buy a cheaper tier.
    const required = await requiredApprovalRole(
      ctx.scope.organisationId,
      expense.grossAmount.toString(),
    );
    if (!required) {
      throw new Error(
        `No approval policy covers ₹${expense.grossAmount.toString()}. Configure the expense approval tiers first.`,
      );
    }
    if (!roleAtLeast(ctx.scope.role, required)) {
      throw new Error(
        `Vouchers of ₹${expense.grossAmount.toString()} need ${required} approval — your role (${ctx.scope.role}) is below that tier.`,
      );
    }

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
    // Only the float, because that is the one row the reversal writes to. The
    // voucher's other ids are left unresolved on purpose: voiding a voucher is
    // the way out of a bad one, and it must not be blocked by them.
    const { pettyCashFloat } = await resolveExpenseRefs({
      pettyCashFloatId: expense.pettyCashFloatId,
    });
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
      await reverseExpensePostings(tx, expense, pettyCashFloat?.id ?? null);
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
    // This is the write that settles the money, and `modeOverride` can re-route
    // it away from the mode the voucher was approved on — a Server Action is a
    // public endpoint, so the override arrives untrusted. The FCRA route is
    // therefore re-asserted against the mode about to be persisted.
    const mode = parsedInput.modeOverride ?? expense.mode;
    // The voucher's own stored ids, put back through the scoped client. A row
    // pointing at another organisation's project, bank account, vendor,
    // category or float is refused rather than settled.
    const refs = await resolveExpenseRefs(expense);
    assertFcraPaymentRoute(refs, { ...expense, mode });
    await prisma.expense.update({
      where: { id: expense.id },
      data: {
        status: "PAID",
        paidAt: parsedInput.paidAt,
        mode,
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
    // See rejectExpense: the float is resolved because the reversal credits it,
    // and nothing else is, because this is the way out of a bad voucher.
    const { pettyCashFloat } = await resolveExpenseRefs({
      pettyCashFloatId: expense.pettyCashFloatId,
    });
    await prismaUnsafe.$transaction(async (tx) => {
      await tx.expense.update({
        where: { id: expense.id },
        data: { status: "CANCELLED" },
      });
      await reverseExpensePostings(tx, expense, pettyCashFloat?.id ?? null);
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

/**
 * Every id `expenseDraftSchema` takes off the client, read back through the
 * scoped `prisma`. Each read throws P2025 for a row belonging to another
 * organisation, and the callers write the returned rows' own ids — including
 * inside `prismaUnsafe.$transaction`, which the tenancy extension never
 * reaches, so a raw `parsedInput` id would be honoured verbatim there.
 *
 * All six are nullable on the schema; a null stays null and is not a lookup.
 */
type ExpenseRefIds = {
  vendorId?: string | null;
  categoryId?: string | null;
  projectId?: string | null;
  bankAccountId?: string | null;
  pettyCashFloatId?: string | null;
  ldcCertificateId?: string | null;
};

async function resolveExpenseRefs(ids: ExpenseRefIds) {
  const [vendor, category, project, bankAccount, pettyCashFloat, ldcCertificate] =
    await Promise.all([
      ids.vendorId
        ? prisma.vendor.findUniqueOrThrow({
            where: { id: ids.vendorId },
            select: { id: true, name: true, pan: true },
          })
        : null,
      ids.categoryId
        ? prisma.expenseCategory.findUniqueOrThrow({
            where: { id: ids.categoryId },
            select: { id: true },
          })
        : null,
      ids.projectId
        ? prisma.project.findUniqueOrThrow({
            where: { id: ids.projectId },
            select: { id: true, isFcra: true },
          })
        : null,
      ids.bankAccountId
        ? prisma.bankAccount.findUniqueOrThrow({
            where: { id: ids.bankAccountId },
            select: { id: true, purpose: true },
          })
        : null,
      ids.pettyCashFloatId
        ? prisma.pettyCashFloat.findUniqueOrThrow({
            where: { id: ids.pettyCashFloatId },
            select: { id: true },
          })
        : null,
      ids.ldcCertificateId
        ? prisma.ldcCertificate.findUniqueOrThrow({
            where: { id: ids.ldcCertificateId },
            select: { id: true, lowerRate: true },
          })
        : null,
    ]);
  return { vendor, category, project, bankAccount, pettyCashFloat, ldcCertificate };
}

type ExpenseRefs = Awaited<ReturnType<typeof resolveExpenseRefs>>;

/**
 * FCRA section 17: a foreign-contribution project may only be spent from the
 * organisation's designated FCRA bank account, so every cash route — petty
 * cash, a CASH/OTHER payment mode, or simply no bank account named — is
 * barred, not just the wrong bank account. Checked on every write that can set
 * the payment route — draft, submit and the mark-paid override — so a voucher
 * can neither be built into a state submit will refuse nor be diverted to cash
 * after approval.
 *
 * It reads the project and the bank account off `refs`, never off the payload:
 * `resolveExpenseRefs` has already refused a foreign id by then, so there is no
 * lookup here that can come back empty and let an unreadable project decide the
 * route is unrestricted.
 */
function assertFcraPaymentRoute(
  refs: Pick<ExpenseRefs, "project" | "bankAccount">,
  p: { mode: PaymentMode; isPettyCash: boolean },
) {
  if (!refs.project?.isFcra) return;

  if (p.isPettyCash) {
    throw new Error("FCRA-tagged projects cannot be paid via petty cash.");
  }
  if (p.mode === "CASH" || p.mode === "OTHER") {
    throw new Error("FCRA-tagged projects cannot be paid in cash.");
  }
  if (refs.bankAccount?.purpose !== "FCRA_ONLY") {
    throw new Error("FCRA-tagged projects must be paid from an FCRA-only bank account.");
  }
}

/**
 * Unwinds what `submit` posted, for the two terminal exits (reject, cancel).
 * `expense` is the row as it was read before the status write, so
 * `expense.status` is the state being left.
 *
 * The TdsEntry sweep is unconditional: a voucher that ends rejected or void
 * must not be filed in that deductee's quarterly 26Q. Only `submit` writes an
 * entry, so a voucher that never reached it has nothing to sweep.
 *
 * The petty cash float is a different matter. `submit` debits it when the
 * voucher is raised and `markPaid` never touches it again, so `currentBalance`
 * runs one step ahead of the cash box and only two of the four states cancel
 * is legal from (expense-workflow.ts `TRANSITIONS.cancel`) owe a credit back:
 *
 *   DRAFT               never reached submit, so nothing was debited.
 *   PENDING_APPROVAL,   debited, but the custodian has not handed the cash
 *   APPROVED            over — the box still holds it, so the register must
 *                       show it again. `reject` only ever arrives here.
 *   PAID                debited, and the cash has left the box. The register
 *                       already matches what is physically there. Crediting it
 *                       would claim rupees nobody can hand over, and the next
 *                       voucher would clear submit's balance check against
 *                       them. Cash coming back later — a refund, or a payment
 *                       recorded in error — belongs in the float as a fresh
 *                       credit dated the day it lands, not as an unwind of a
 *                       debit the box has already honoured.
 *
 * `floatId` is the caller's already-resolved float, not `expense.pettyCashFloatId`.
 * `tx` is the unscoped client, and a voucher raised before this file resolved
 * its ids can carry a floatId belonging to another trust; crediting that one
 * would put rupees into a cash register in a different organisation's books.
 */
async function reverseExpensePostings(
  tx: Prisma.TransactionClient,
  expense: Pick<Expense, "id" | "status" | "isPettyCash" | "grossAmount">,
  floatId: string | null,
) {
  const debitedButUnspent =
    expense.status === "PENDING_APPROVAL" || expense.status === "APPROVED";
  if (debitedButUnspent && expense.isPettyCash && floatId) {
    const float = await tx.pettyCashFloat.findUniqueOrThrow({
      where: { id: floatId },
    });
    const next = new Decimal(float.currentBalance.toString()).plus(
      expense.grossAmount.toString(),
    );
    await tx.pettyCashFloat.update({
      where: { id: float.id },
      data: { currentBalance: next.toString() },
    });
  }
  await tx.tdsEntry.updateMany({
    where: { expenseId: expense.id },
    data: { status: "CANCELLED" },
  });
}

let pendingCounter = 0;
function pendingVoucherPlaceholder(): string {
  // Drafts get a temporary number until `submit` allocates the real one.
  // Using a unique placeholder so the `@@unique` constraint doesn't bite.
  return `DRAFT/${Date.now()}/${++pendingCounter}`;
}

function derivedAmounts(
  p: z.infer<typeof expenseDraftSchema>,
  ldc: ExpenseRefs["ldcCertificate"],
) {
  // The certificate is resolved by `resolveExpenseRefs`, so a lower rate here
  // is one this organisation holds. An id it could not read never reaches this
  // point to be quietly dropped back to the statutory rate.
  const ldcRate = ldc ? new Decimal(ldc.lowerRate.toString()) : null;
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
