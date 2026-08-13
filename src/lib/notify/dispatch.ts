import "server-only";
import type { NotificationChannel } from "@prisma/client";
import { email, whatsapp } from "./index";
import { renderDonationReceiptEmail } from "./templates/donation-receipt-email";
import { prismaUnsafe } from "@/lib/db/prisma";
import { storage } from "@/lib/storage";

type SendResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * Dispatch the receipt for a single donation. Reads everything fresh from
 * the DB so callers can fire-and-forget after the Donation row commits.
 *
 * A Notification row is created up-front per channel so the operator sees
 * the queue even before the adapter fires; `sentAt` flips on success,
 * `errorMessage` on failure. Failure of one channel does NOT halt the other.
 *
 * Throws when the receipt PDF is missing from storage. Every caller runs
 * `generate80GReceipt` first, so a miss means generation failed — and a mail
 * that says "your 80G receipt is attached" with nothing attached is worse
 * than no mail at all. The caller regenerates and dispatches again.
 */
export async function dispatchDonationReceipt(donationId: string): Promise<void> {
  const donation = await prismaUnsafe.donation.findUnique({
    where: { id: donationId },
    include: { donor: true, organisation: true },
  });
  if (!donation) return;
  const { organisation: org, donor } = donation;

  const attachment = await loadReceiptPdf(donation.receiptUrl);
  if (!attachment) {
    throw new Error(
      `The 80G receipt PDF for ${donation.receiptNumber} has not been generated yet.`,
    );
  }

  const audit = {
    organisationId: org.id,
    title: `Donation receipt ${donation.receiptNumber}`,
    body: `Receipt for ${donor.name} (${donation.receiptNumber})`,
  };

  const donorEmail = donor.email;
  if (donorEmail) {
    await deliver({ ...audit, channel: "EMAIL" }, () => {
      const tpl = renderDonationReceiptEmail({
        orgName: org.name,
        orgEmail: org.email,
        donorName: donor.name,
        amount: donation.amount.toString(),
        receiptNumber: donation.receiptNumber,
        donationDate: donation.donationDate,
      });
      return email.send({
        to: donorEmail,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
        attachments: [
          {
            filename: `${donation.receiptNumber.replace(/\//g, "-")}.pdf`,
            content: attachment,
            contentType: "application/pdf",
          },
        ],
      });
    });
  }

  const donorWhatsApp = donor.whatsapp;
  if (donorWhatsApp && donor.whatsappOptIn) {
    await deliver({ ...audit, channel: "WHATSAPP" }, () =>
      whatsapp.send({
        to: donorWhatsApp,
        templateName: "donation_receipt",
        params: {
          donor_name: donor.name,
          amount: donation.amount.toString(),
          receipt_number: donation.receiptNumber,
        },
        mediaUrl: donation.receiptUrl ?? undefined,
      }),
    );
  }
}

/**
 * Queue the Notification row, run the adapter, stamp the outcome. Never
 * throws — one dead channel must not take the other down with it.
 */
async function deliver(
  row: { organisationId: string; channel: NotificationChannel; title: string; body: string },
  send: () => Promise<SendResult>,
): Promise<void> {
  const notif = await prismaUnsafe.notification.create({ data: row });
  let errorMessage: string | null = null;
  try {
    const res = await send();
    if (!res.ok) errorMessage = res.error;
  } catch (err) {
    errorMessage = (err as Error).message;
  }
  await prismaUnsafe.notification.update({
    where: { id: notif.id },
    data: errorMessage ? { errorMessage } : { sentAt: new Date() },
  });
}

/** Pull the stored receipt PDF back into memory for the email attachment. */
async function loadReceiptPdf(receiptUrl: string | null): Promise<Buffer | null> {
  if (!receiptUrl) return null;
  const obj = await storage.get(receiptUrl.replace(/^\/api\/files\//, ""));
  if (!obj) return null;

  const reader = obj.stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks);
}
