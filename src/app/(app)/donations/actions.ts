"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { Decimal } from "decimal.js";
import { safeAction } from "@/lib/actions/safe-action";
import { prisma, prismaUnsafe } from "@/lib/db/prisma";
import {
  recordDonationSchema,
  cancelDonationSchema,
  type DonationLineItemInput,
} from "@/lib/schemas/donation";
import { formatINRWithSymbol } from "@/lib/format/inr";
import { allocateReceiptNumber } from "@/lib/services/receipt-number";
import { getFinancialYear } from "@/lib/format/date";
import { generate80GReceipt } from "@/lib/pdf/receipt-80g";
import {
  dispatchDonationReceipt,
  ensureReceiptPdf,
  normalisePhone,
  renderDonationReceiptWhatsApp,
} from "@/lib/notify";
import { storage, storageKey } from "@/lib/storage";

/**
 * Re-price the picked catalogue rows against the database. The browser posts
 * a label and a unit price, but neither is trusted: a stale tab or a tampered
 * payload must never decide what a donor is receipted for. The values written
 * are snapshots, so revising the catalogue later can't rewrite this receipt.
 */
async function priceLineItems(picked: DonationLineItemInput[]) {
  const items = await prisma.sponsorshipItem.findMany({
    where: { id: { in: picked.map((p) => p.sponsorshipItemId) }, isActive: true },
  });
  const byId = new Map(items.map((i) => [i.id, i]));

  const lines = picked.map((p) => {
    const item = byId.get(p.sponsorshipItemId);
    if (!item) {
      throw new Error(
        `"${p.label}" is no longer on the sponsorship menu. Remove it and try again.`,
      );
    }
    const unitAmount = new Decimal(item.amount.toString());
    return {
      sponsorshipItemId: item.id,
      label: item.label,
      unitAmount: unitAmount.toFixed(2),
      quantity: p.quantity,
      lineTotal: unitAmount.times(p.quantity).toFixed(2),
    };
  });

  const total = lines.reduce((sum, l) => sum.plus(l.lineTotal), new Decimal(0));
  return { lines, total };
}

export const recordDonation = safeAction
  .metadata({ requires: "donation.create" })
  .inputSchema(recordDonationSchema)
  .action(async ({ parsedInput, ctx }) => {
    const fy = getFinancialYear(parsedInput.donationDate);

    // A brand-new donor is not written until the donation itself commits.
    // Persisting on "Save donor" left a zero-lifetime orphan behind every
    // time somebody closed the form without finishing, so the donor list
    // filled up with people who never gave anything.
    const existingDonor = parsedInput.donorId
      ? await prisma.donor.findUniqueOrThrow({ where: { id: parsedInput.donorId } })
      : null;
    const donor = existingDonor ?? {
      ...parsedInput.newDonor!,
      isFcraEligible: false,
      isAnonymousBucket: false,
    };
    if (parsedInput.is80GEligible && donor.donorType === "ANONYMOUS") {
      throw new Error("Anonymous donations are never 80G-eligible.");
    }

    // Force isFcra true for FCRA-eligible donors so the FCRA series is used.
    const isFcra =
      parsedInput.isFcra ||
      donor.isFcraEligible ||
      donor.donorType === "FOREIGN_SOURCE" ||
      donor.donorType === "NRI";

    const priced = parsedInput.lineItems.length
      ? await priceLineItems(parsedInput.lineItems)
      : null;
    if (priced && !priced.total.eq(parsedInput.amount)) {
      throw new Error(
        `The sponsorship items add up to ${formatINRWithSymbol(priced.total, { paise: true })}, ` +
          `but the amount submitted was ${formatINRWithSymbol(parsedInput.amount, { paise: true })}. ` +
          `Reload the page — a catalogue price may have changed.`,
      );
    }
    const amount = priced ? priced.total : parsedInput.amount;

    // The remaining caller-supplied ids, resolved through the scoped client
    // before anything is written. Donation carries its own organisationId, so
    // the row itself lands in the caller's tenant — but the transaction below
    // runs on `prismaUnsafe`, which the tenancy extension never sees, and
    // neither column would be filtered even if it did. Unresolved, a foreign
    // id becomes a donation in this trust's books pointing at another's
    // project or bank account.
    const project = parsedInput.projectId
      ? await prisma.project.findUniqueOrThrow({
          where: { id: parsedInput.projectId },
          select: { id: true, isFcra: true },
        })
      : null;
    const bankAccount = parsedInput.bankAccountId
      ? await prisma.bankAccount.findUniqueOrThrow({
          where: { id: parsedInput.bankAccountId },
          select: { id: true },
        })
      : null;

    // Atomic counter + create.
    const created = await prismaUnsafe.$transaction(async (tx) => {
      // Donor first, same transaction: if anything below fails, the donor
      // is rolled back with it rather than being left stranded.
      const donorId = existingDonor
        ? existingDonor.id
        : (
            await tx.donor.create({
              data: {
                ...parsedInput.newDonor!,
                organisationId: ctx.scope.organisationId,
                createdById: ctx.scope.userId,
              } as never,
            })
          ).id;

      const allocated = await allocateReceiptNumber(tx, {
        organisationId: ctx.scope.organisationId,
        isFcra,
        financialYear: fy,
      });

      const donation = await tx.donation.create({
        data: {
          organisationId: ctx.scope.organisationId,
          donorId,
          receiptNumber: allocated.receiptNumber,
          receiptSeriesId: allocated.seriesId,
          donationDate: parsedInput.donationDate,
          amount: amount.toString(),
          ...(priced ? { lineItems: { create: priced.lines } } : {}),
          mode: parsedInput.mode,
          bankAccountId: bankAccount?.id ?? null,
          paymentRef: parsedInput.paymentRef,
          paymentDate: parsedInput.paymentDate,
          isInKind: parsedInput.mode === "IN_KIND" || parsedInput.isInKind,
          inKindDescription: parsedInput.inKindDescription,
          inKindValuationMethod: parsedInput.inKindValuationMethod,
          purpose: parsedInput.purpose,
          projectId: project?.id ?? null,
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
      // A donor created moments ago has no prior donation, so its
      // lastDonationDate is simply this one.
      const priorLast = existingDonor?.lastDonationDate ?? null;
      await tx.donor.update({
        where: { id: donorId },
        data: {
          totalDonatedLifetime: {
            increment: new Prisma.Decimal(amount.toString()),
          },
          lastDonationDate:
            !priorLast || priorLast < parsedInput.donationDate
              ? parsedInput.donationDate
              : priorLast,
        },
      });

      return donation;
    });

    // FCRA propagation (Phase 4): if this donation is FCRA and the project
    // isn't yet flagged, set Project.isFcra = true. Any future expense
    // tagged to this project will then be restricted to FCRA-only banks.
    if (isFcra && project && !project.isFcra) {
      await prisma.project.update({
        where: { id: project.id },
        data: { isFcra: true },
      });
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
    // Resolve through the scoped client first: `generate80GReceipt` reads and
    // writes unscoped, so an id from another organisation would otherwise
    // rewrite that organisation's receipt.
    const donation = await prisma.donation.findUniqueOrThrow({
      where: { id: parsedInput.donationId },
      select: { id: true, donorId: true },
    });
    await generate80GReceipt(donation.id);
    revalidatePath("/donations");
    revalidatePath(`/donors/${donation.donorId}`);
    return { ok: true };
  });

/**
 * The URL the browser can pull the 80G receipt PDF from, materialising the
 * file first if storage has lost it. `/api/files` re-checks the organisation
 * before it streams a byte, so the URL is safe to hand to the client.
 */
export const prepareReceiptDownload = safeAction
  .metadata({ requires: "donation.view" })
  .inputSchema(z.object({ donationId: z.string().min(1) }))
  .action(async ({ parsedInput }) => {
    const donation = await prisma.donation.findUniqueOrThrow({
      where: { id: parsedInput.donationId },
      select: { id: true, receiptNumber: true },
    });
    const receipt = await ensureReceiptPdf(donation.id);
    return {
      url: receipt.url,
      filename: `${donation.receiptNumber.replace(/\//g, "-")}.pdf`,
    };
  });

/**
 * Send the receipt over every channel the donor has a destination for.
 *
 * Throws when nothing was delivered — a donor with no email address on file
 * is the common case, and an action that returned `ok` there would have the
 * UI reporting a send that never happened.
 */
export const resendReceipt = safeAction
  .metadata({ requires: "donation.resendReceipt" })
  .inputSchema(z.object({ donationId: z.string().min(1) }))
  .action(async ({ parsedInput }) => {
    const donation = await prisma.donation.findUniqueOrThrow({
      where: { id: parsedInput.donationId },
      select: { id: true, donorId: true },
    });
    const result = await dispatchDonationReceipt(donation.id);
    revalidatePath("/notifications");
    revalidatePath(`/donors/${donation.donorId}`);

    // `prepared` is not delivery. Under the click-to-chat driver the message
    // is a wa.me URL somebody still has to open, so it is reported apart from
    // `sent` rather than counted as a receipt the donor now holds.
    if (result.sent.length === 0 && result.prepared.length === 0) {
      throw new Error(
        `Nothing was sent. ${[...result.failed, ...result.skipped].join("; ")}`,
      );
    }
    return {
      ok: true,
      sent: result.sent,
      prepared: result.prepared,
      failed: result.failed,
    };
  });

/**
 * Build a `wa.me` click-to-chat URL for a donation's receipt. Returns the
 * URL so the client can `window.open()` it. Doesn't mark the donation as
 * sent until the user explicitly clicks through — that's done by
 * `markWhatsAppSent` below.
 *
 * The words are `renderDonationReceiptWhatsApp`, the same text the dispatch
 * layer sends, so a donor reached either way reads the same thing. It promises
 * no attachment and carries no link, because a `wa.me` URL holds `?text=` and
 * nothing else, and the only receipt URL this app can mint is `/api/files`,
 * which answers 401 to anyone without a session in the owning organisation —
 * which a donor is not. The message names the receipt number and tells the
 * donor to reply for the PDF; the volunteer attaches it by hand.
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
    const e164 = normalisePhone(donation.donor.whatsapp);
    if (!e164) {
      throw new Error(
        `"${donation.donor.whatsapp}" is not a phone number WhatsApp will accept. Fix it on the donor profile first.`,
      );
    }
    const body = renderDonationReceiptWhatsApp({
      orgName: donation.organisation.name,
      donorName: donation.donor.name,
      amount: donation.amount.toString(),
      receiptNumber: donation.receiptNumber,
      donationDate: donation.donationDate,
    });
    const url = `https://wa.me/${e164}?text=${encodeURIComponent(body)}`;
    return { url, donorName: donation.donor.name, whatsapp: donation.donor.whatsapp };
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
