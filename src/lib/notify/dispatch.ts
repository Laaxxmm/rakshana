import "server-only";
import { email, whatsapp } from "./index";
import { renderDonationReceiptEmail } from "./templates/donation-receipt-email";
import { prismaUnsafe } from "@/lib/db/prisma";
import { storage } from "@/lib/storage";

/**
 * Dispatch the receipt for a single donation. Reads everything fresh from
 * the DB so callers can fire-and-forget after the Donation row commits.
 *
 * Two Notification rows are created up-front (channel = EMAIL, WHATSAPP) so
 * the operator sees the queue even before the adapter fires; `sentAt` flips
 * on success, `errorMessage` on failure.
 *
 * Failure of one channel does NOT halt the other. Audit log captures both.
 */
export async function dispatchDonationReceipt(donationId: string): Promise<void> {
  const donation = await prismaUnsafe.donation.findUnique({
    where: { id: donationId },
    include: { donor: true, organisation: true },
  });
  if (!donation) return;
  const org = donation.organisation;
  const donor = donation.donor;

  // Build the artefacts. Attachment is the receipt PDF, loaded from storage.
  let attachmentBytes: Buffer | null = null;
  if (donation.receiptUrl) {
    const key = donation.receiptUrl.replace(/^\/api\/files\//, "");
    const obj = await storage.get(key);
    if (obj) {
      const reader = obj.stream.getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
      attachmentBytes = Buffer.concat(chunks);
    }
  }

  // ----- Email channel -----
  if (donor.email) {
    const notif = await prismaUnsafe.notification.create({
      data: {
        organisationId: org.id,
        channel: "EMAIL",
        title: `Donation receipt ${donation.receiptNumber}`,
        body: `Receipt for ${donor.name} (${donation.receiptNumber})`,
      },
    });
    try {
      const tpl = renderDonationReceiptEmail({
        orgName: org.name,
        orgEmail: org.email,
        donorName: donor.name,
        amount: donation.amount.toString(),
        receiptNumber: donation.receiptNumber,
        donationDate: donation.donationDate,
      });
      const res = await email.send({
        to: donor.email,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
        attachments: attachmentBytes
          ? [
              {
                filename: `${donation.receiptNumber.replace(/\//g, "-")}.pdf`,
                content: attachmentBytes,
                contentType: "application/pdf",
              },
            ]
          : undefined,
      });
      if (res.ok) {
        await prismaUnsafe.notification.update({
          where: { id: notif.id },
          data: { sentAt: new Date() },
        });
      } else {
        await prismaUnsafe.notification.update({
          where: { id: notif.id },
          data: { errorMessage: res.error },
        });
      }
    } catch (err) {
      await prismaUnsafe.notification.update({
        where: { id: notif.id },
        data: { errorMessage: (err as Error).message },
      });
    }
  }

  // ----- WhatsApp channel -----
  if (donor.whatsapp && donor.whatsappOptIn) {
    const notif = await prismaUnsafe.notification.create({
      data: {
        organisationId: org.id,
        channel: "WHATSAPP",
        title: `Donation receipt ${donation.receiptNumber}`,
        body: `Receipt for ${donor.name} (${donation.receiptNumber})`,
      },
    });
    try {
      const res = await whatsapp.send({
        to: donor.whatsapp,
        templateName: "donation_receipt",
        params: {
          donor_name: donor.name,
          amount: donation.amount.toString(),
          receipt_number: donation.receiptNumber,
        },
        mediaUrl: donation.receiptUrl ?? undefined,
      });
      if (res.ok) {
        await prismaUnsafe.notification.update({
          where: { id: notif.id },
          data: { sentAt: new Date() },
        });
      } else {
        await prismaUnsafe.notification.update({
          where: { id: notif.id },
          data: { errorMessage: res.error },
        });
      }
    } catch (err) {
      await prismaUnsafe.notification.update({
        where: { id: notif.id },
        data: { errorMessage: (err as Error).message },
      });
    }
  }
}
