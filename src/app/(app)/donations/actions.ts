"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { safeAction } from "@/lib/actions/safe-action";
import { prisma, prismaUnsafe } from "@/lib/db/prisma";
import { recordDonationSchema, cancelDonationSchema } from "@/lib/schemas/donation";
import { allocateReceiptNumber } from "@/lib/services/receipt-number";
import { getFinancialYear } from "@/lib/format/date";
import { generate80GReceipt } from "@/lib/pdf/receipt-80g";
import { dispatchDonationReceipt } from "@/lib/notify";
import { storage, storageKey } from "@/lib/storage";

const ANONYMOUS_PAN = "__ANONYMOUS__";

export const recordDonation = safeAction
  .metadata({ requires: "donation.create" })
  .inputSchema(recordDonationSchema)
  .action(async ({ parsedInput, ctx }) => {
    const fy = getFinancialYear(parsedInput.donationDate);

    // Look up the donor's anonymity + 80G rules BEFORE entering the tx.
    const donor = await prisma.donor.findUniqueOrThrow({
      where: { id: parsedInput.donorId },
    });
    if (parsedInput.is80GEligible && donor.donorType === "ANONYMOUS") {
      throw new Error("Anonymous donations are never 80G-eligible.");
    }

    // Force isFcra true for FCRA-eligible donors so the FCRA series is used.
    const isFcra =
      parsedInput.isFcra ||
      donor.isFcraEligible ||
      donor.donorType === "FOREIGN_SOURCE" ||
      donor.donorType === "NRI";

    // Atomic counter + create.
    const created = await prismaUnsafe.$transaction(async (tx) => {
      const allocated = await allocateReceiptNumber(tx, {
        organisationId: ctx.scope.organisationId,
        isFcra,
        financialYear: fy,
      });

      const donation = await tx.donation.create({
        data: {
          organisationId: ctx.scope.organisationId,
          donorId: parsedInput.donorId,
          receiptNumber: allocated.receiptNumber,
          receiptSeriesId: allocated.seriesId,
          donationDate: parsedInput.donationDate,
          amount: parsedInput.amount.toString(),
          mode: parsedInput.mode,
          bankAccountId: parsedInput.bankAccountId,
          paymentRef: parsedInput.paymentRef,
          paymentDate: parsedInput.paymentDate,
          isInKind: parsedInput.mode === "IN_KIND" || parsedInput.isInKind,
          inKindDescription: parsedInput.inKindDescription,
          inKindValuationMethod: parsedInput.inKindValuationMethod,
          purpose: parsedInput.purpose,
          projectId: parsedInput.projectId,
          isCsr: parsedInput.isCsr || parsedInput.purpose === "CSR",
          csrCompanyCin: parsedInput.csrCompanyCin,
          isFcra,
          is80GEligible: parsedInput.is80GEligible && donor.donorType !== "ANONYMOUS",
          remarks: parsedInput.remarks,
          status: "RECEIVED",
          createdById: ctx.scope.userId,
        },
      });

      // Bump denormalised donor stats in the same tx so the list/profile are always consistent.
      await tx.donor.update({
        where: { id: donor.id },
        data: {
          totalDonatedLifetime: {
            increment: new Prisma.Decimal(parsedInput.amount.toString()),
          },
          lastDonationDate:
            !donor.lastDonationDate || donor.lastDonationDate < parsedInput.donationDate
              ? parsedInput.donationDate
              : donor.lastDonationDate,
        },
      });

      return donation;
    });

    // FCRA propagation (Phase 4): if this donation is FCRA and the project
    // isn't yet flagged, set Project.isFcra = true. Any future expense
    // tagged to this project will then be restricted to FCRA-only banks.
    if (isFcra && created.projectId) {
      const project = await prisma.project.findUnique({
        where: { id: created.projectId },
        select: { isFcra: true },
      });
      if (project && !project.isFcra) {
        await prisma.project.update({
          where: { id: created.projectId },
          data: { isFcra: true },
        });
      }
    }

    // Generate PDF + dispatch — outside the transaction. Failure here doesn't
    // roll back the donation (it's already saved), but we surface the error.
    await generate80GReceipt(created.id);
    queueMicrotask(() => {
      dispatchDonationReceipt(created.id).catch((err) => {
        console.error("[recordDonation] dispatch failed", err);
      });
    });

    revalidatePath("/donations");
    revalidatePath("/donors");
    revalidatePath(`/donors/${created.donorId}`);
    revalidatePath("/projects");
    revalidatePath("/");

    return {
      ok: true,
      donationId: created.id,
      receiptNumber: created.receiptNumber,
    };
  });

export const cancelDonation = safeAction
  .metadata({ requires: "donation.cancel" })
  .inputSchema(cancelDonationSchema)
  .action(async ({ parsedInput, ctx }) => {
    const existing = await prisma.donation.findUniqueOrThrow({
      where: { id: parsedInput.donationId },
    });
    if (existing.status === "CANCELLED") {
      throw new Error("Donation is already cancelled.");
    }

    // Archive the current receipt PDF before regenerating with watermark.
    if (existing.receiptUrl) {
      const key = existing.receiptUrl.replace(/^\/api\/files\//, "");
      const current = await storage.get(key);
      if (current) {
        const chunks: Uint8Array[] = [];
        const reader = current.stream.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) chunks.push(value);
        }
        const archive = storageKey.donationReceiptArchive(
          ctx.scope.organisationId,
          existing.id,
          1,
        );
        await storage.put(archive, Buffer.concat(chunks), {
          contentType: "application/pdf",
        });
      }
    }

    await prisma.donation.update({
      where: { id: existing.id },
      data: {
        status: "CANCELLED",
        cancellationReason: parsedInput.reason,
        cancelledAt: new Date(),
        cancelledById: ctx.scope.userId,
      },
    });

    // Adjust donor stats — subtract the cancelled amount.
    await prisma.donor.update({
      where: { id: existing.donorId },
      data: {
        totalDonatedLifetime: {
          decrement: existing.amount,
        },
      },
    });

    await generate80GReceipt(existing.id);
    queueMicrotask(() => {
      dispatchDonationReceipt(existing.id).catch((err) => {
        console.error("[cancelDonation] dispatch failed", err);
      });
    });

    revalidatePath("/donations");
    revalidatePath(`/donors/${existing.donorId}`);
    return { ok: true };
  });

export const regenerateReceipt = safeAction
  .metadata({ requires: "donation.regenerate" })
  .inputSchema(z.object({ donationId: z.string().min(1) }))
  .action(async ({ parsedInput }) => {
    await generate80GReceipt(parsedInput.donationId);
    revalidatePath("/donations");
    return { ok: true };
  });

export const resendReceipt = safeAction
  .metadata({ requires: "donation.resendReceipt" })
  .inputSchema(z.object({ donationId: z.string().min(1) }))
  .action(async ({ parsedInput }) => {
    await dispatchDonationReceipt(parsedInput.donationId);
    revalidatePath("/notifications");
    return { ok: true };
  });

/**
 * Build a `wa.me` click-to-chat URL for a donation's receipt. Returns the
 * URL so the client can `window.open()` it. Doesn't mark the donation as
 * sent until the user explicitly clicks through — that's done by
 * `markWhatsAppSent` below.
 */
export const prepareWhatsAppLink = safeAction
  .metadata({ requires: "donation.resendReceipt" })
  .inputSchema(z.object({ donationId: z.string().min(1) }))
  .action(async ({ parsedInput }) => {
    const donation = await prisma.donation.findUniqueOrThrow({
      where: { id: parsedInput.donationId },
      include: { donor: true, organisation: true },
    });
    if (!donation.donor.whatsapp) {
      throw new Error(
        `${donation.donor.name} has no WhatsApp number on file. Add one to the donor profile first.`,
      );
    }
    const body =
      `Namaste ${donation.donor.name},\n\n` +
      `Thank you for your donation of ₹${donation.amount.toString()} to ${donation.organisation.name} on ${donation.donationDate.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}.\n\n` +
      `Your 80G receipt no. ${donation.receiptNumber} is attached.${donation.receiptUrl ? `\n\n📎 Download: ${process.env["AUTH_URL"] ?? "http://localhost:3000"}${donation.receiptUrl}` : ""}\n\n` +
      `For any clarification, reply to this message.\n\n` +
      `— ${donation.organisation.name}`;
    const digits = donation.donor.whatsapp.replace(/[^\d]/g, "");
    const e164 =
      digits.length === 10
        ? `91${digits}`
        : digits.length === 11 && digits.startsWith("0")
          ? `91${digits.slice(1)}`
          : digits;
    const url = `https://wa.me/${e164}?text=${encodeURIComponent(body)}`;
    return { url, donorName: donation.donor.name };
  });

/**
 * Stamp `whatsappedAt` on the Notification + Donation rows so the
 * audit trail records the dispatch — fired by the client after the
 * wa.me tab is opened.
 */
export const markWhatsAppSent = safeAction
  .metadata({ requires: "donation.resendReceipt" })
  .inputSchema(z.object({ donationId: z.string().min(1) }))
  .action(async ({ parsedInput, ctx }) => {
    const donation = await prisma.donation.findUniqueOrThrow({
      where: { id: parsedInput.donationId },
    });
    // Record a Notification row (visible in /notifications) marked as sent
    await prisma.notification.create({
      data: {
        organisationId: ctx.scope.organisationId,
        channel: "WHATSAPP",
        title: `WhatsApp receipt ${donation.receiptNumber}`,
        body: `Click-to-chat link opened by ${ctx.scope.userId}`,
        sentAt: new Date(),
      },
    });
    revalidatePath("/notifications");
    revalidatePath("/donations");
    return { ok: true };
  });

void ANONYMOUS_PAN; // kept for future use when the inline anonymous-bucket lookup needs it
