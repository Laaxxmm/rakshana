"use client";

import * as React from "react";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { IconBrandWhatsapp, IconDownload, IconMail } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  markWhatsAppSent,
  prepareReceiptDownload,
  prepareWhatsAppLink,
  resendReceipt,
} from "@/app/(app)/donations/actions";

/**
 * The three things anyone ever does with a receipt, in one row: Download,
 * Email, WhatsApp.
 *
 * Download asks the server for the URL rather than linking at
 * `Donation.receiptUrl`. `prepareReceiptDownload` rebuilds the PDF when
 * storage no longer holds the file, which a plain link surfaces as a 404 —
 * the state every receipt written before the storage volume existed is in.
 *
 * Email is outward-facing and cannot be recalled, so it commits on the second
 * click: the first arms the button. WhatsApp needs no arming — it opens a
 * prefilled click-to-chat message that the volunteer reads and sends from
 * their own WhatsApp, so the tab itself is the confirmation.
 */
export function DonationReceiptActions({
  donationId,
  donorEmail,
  donorWhatsApp,
  canSend = true,
  className,
}: {
  donationId: string;
  /**
   * `null` means the donor profile carries none, so the button is dead and
   * says why. `undefined` means the caller never looked it up: the button
   * still sends, and the address is named by the toast the send returns.
   */
  donorEmail?: string | null;
  donorWhatsApp?: string | null;
  /** False where the signed-in role may not send on the trust's behalf. */
  canSend?: boolean;
  className?: string;
}) {
  const [armed, setArmed] = React.useState(false);

  const download = useAction(prepareReceiptDownload, {
    onSuccess: ({ data }) => {
      if (!data) return;
      // Same-origin, so `download` is honoured and the PDF lands in the
      // volunteer's downloads instead of replacing the page.
      const a = document.createElement("a");
      a.href = data.url;
      a.download = data.filename;
      a.click();
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not prepare the receipt"),
  });

  const send = useAction(resendReceipt, {
    onSuccess: ({ data }) => {
      setArmed(false);
      if (!data) return;
      // `sent` names the address each channel actually reached, which is the
      // only proof the volunteer gets that it went where they meant.
      toast.success(`Sent — ${data.sent.join(" · ")}`);
      if (data.failed.length) toast.error(data.failed.join(" · "));
    },
    onError: ({ error }) => {
      setArmed(false);
      toast.error(error.serverError ?? "Could not send");
    },
  });

  const markSent = useAction(markWhatsAppSent, {});
  const whatsapp = useAction(prepareWhatsAppLink, {
    onSuccess: ({ data }) => {
      if (!data?.url) return;
      window.open(data.url, "_blank", "noopener,noreferrer");
      // The prefilled text promises no attachment, so the volunteer is told
      // what it does and does not carry rather than left to assume.
      toast.success(
        `WhatsApp opening for ${data.donorName} — text only, no PDF. Use Download to attach it.`,
      );
      void markSent.execute({ donationId });
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not build the WhatsApp link"),
  });

  const missing = [
    donorEmail === null && "an email address",
    donorWhatsApp === null && "a WhatsApp number",
  ].filter((v): v is string => typeof v === "string");

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => download.execute({ donationId })}
          disabled={download.isExecuting}
        >
          <IconDownload />
          {download.isExecuting ? "Preparing…" : "Download"}
        </Button>

        {canSend ? (
          <>
            <Button
              variant={armed ? "default" : "outline"}
              className="max-w-[16rem]"
              disabled={donorEmail === null || send.isExecuting}
              onClick={() => (armed ? send.execute({ donationId }) : setArmed(true))}
            >
              <IconMail />
              <span className="truncate">
                {send.isExecuting
                  ? "Sending…"
                  : armed
                    ? donorEmail
                      ? `Confirm · ${donorEmail}`
                      : "Confirm send"
                    : donorEmail
                      ? `Email ${donorEmail}`
                      : "Email"}
              </span>
            </Button>

            <Button
              variant="outline"
              className="max-w-[16rem]"
              disabled={donorWhatsApp === null || whatsapp.isExecuting}
              onClick={() => whatsapp.execute({ donationId })}
            >
              <IconBrandWhatsapp />
              <span className="truncate">
                {donorWhatsApp ? `WhatsApp ${donorWhatsApp}` : "WhatsApp"}
              </span>
            </Button>
          </>
        ) : null}
      </div>

      {canSend && missing.length > 0 ? (
        <p className="text-xs text-ink-subtle">
          This donor has no {missing.join(" and ")} on file — add one on the donor
          profile to enable that button.
        </p>
      ) : null}
    </div>
  );
}
