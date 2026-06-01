"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import {
  IconDownload,
  IconMail,
  IconBrandWhatsapp,
  IconRefresh,
  IconBan,
  IconExternalLink,
} from "@tabler/icons-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { formatINRWithSymbol, inrInWords } from "@/lib/format/inr";
import { formatIST } from "@/lib/format/date";
import {
  cancelDonation,
  regenerateReceipt,
  resendReceipt,
  prepareWhatsAppLink,
  markWhatsAppSent,
} from "./actions";

export type DonationDrawerData = {
  id: string;
  receiptNumber: string;
  receiptUrl: string | null;
  donationDate: string;
  amount: string;
  mode: string;
  paymentRef: string | null;
  is80GEligible: boolean;
  status: string;
  cancellationReason: string | null;
  donor: { id: string; name: string; pan: string | null; isAnonymousBucket: boolean };
};

export function DonationDrawer({
  donation,
  fy,
}: {
  donation: DonationDrawerData;
  fy: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(true);
  const [reason, setReason] = React.useState("");
  const [showCancelInput, setShowCancelInput] = React.useState(false);

  const cancel = useAction(cancelDonation, {
    onSuccess: () => {
      toast.success("Donation cancelled");
      router.replace(`/donations?fy=${fy}`);
    },
    onError: ({ error }) => toast.error(error.serverError ?? "Could not cancel"),
  });
  const regen = useAction(regenerateReceipt, {
    onSuccess: () => toast.success("Receipt regenerated"),
    onError: ({ error }) => toast.error(error.serverError ?? "Could not regenerate"),
  });
  const resend = useAction(resendReceipt, {
    onSuccess: () => toast.success("Receipt emailed"),
    onError: ({ error }) => toast.error(error.serverError ?? "Could not resend"),
  });
  const prepWA = useAction(prepareWhatsAppLink, {
    onSuccess: ({ data }) => {
      if (!data?.url) return;
      // Open the wa.me URL in a new tab. The user reviews the message,
      // adds the receipt attachment manually, and taps Send in WhatsApp.
      window.open(data.url, "_blank", "noopener,noreferrer");
      toast.success(`WhatsApp opening for ${data.donorName}…`);
      // Audit-log the dispatch
      void markWA.execute({ donationId: donation.id });
    },
    onError: ({ error }) => toast.error(error.serverError ?? "Could not build link"),
  });
  const markWA = useAction(markWhatsAppSent, {});

  function dismiss(v: boolean) {
    setOpen(v);
    if (!v) router.replace(`/donations?fy=${fy}`);
  }

  return (
    <Sheet open={open} onOpenChange={dismiss}>
      <SheetContent className="w-full sm:max-w-xl flex flex-col gap-0 p-0">
        {/* Header — fixed top with breathing room. pr-12 clears the absolute close-X. */}
        <SheetHeader className="border-b border-border px-6 pt-6 pb-5 space-y-3 pr-12">
          <div className="flex items-center justify-between gap-3">
            <SheetTitle className="font-mono text-sm text-ink-muted font-normal">
              {donation.receiptNumber}
            </SheetTitle>
          </div>
          <SheetDescription className="sr-only">
            Donation receipt {donation.receiptNumber}
          </SheetDescription>
          <div className="space-y-1.5">
            <div
              className="font-display text-3xl leading-tight text-ink"
              style={{ fontVariationSettings: "'opsz' 28" }}
            >
              {formatINRWithSymbol(donation.amount, { paise: true })}
            </div>
            <p className="text-sm text-ink-muted italic">
              {inrInWords(donation.amount)}
            </p>
            <p className="text-sm text-ink-muted">
              from{" "}
              <Link
                href={`/donors/${donation.donor.id}`}
                className="text-primary hover:underline"
              >
                {donation.donor.name}
              </Link>{" "}
              on {formatIST(donation.donationDate)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Badge
              variant={
                donation.status === "RECEIVED" || donation.status === "REALISED"
                  ? "default"
                  : donation.status === "CANCELLED"
                    ? "destructive"
                    : "outline"
              }
              className="text-[10px]"
            >
              {donation.status}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {donation.mode}
            </Badge>
            {donation.is80GEligible ? (
              <Badge variant="outline" className="text-[10px]">
                80G eligible
              </Badge>
            ) : null}
            {donation.paymentRef ? (
              <span className="font-mono text-[11px] text-ink-subtle">
                Ref · {donation.paymentRef}
              </span>
            ) : null}
          </div>
          {donation.status === "CANCELLED" && donation.cancellationReason ? (
            <p className="rounded-md border border-[color:var(--danger)]/30 bg-[color:var(--danger)]/8 px-3 py-2 text-xs text-[color:var(--danger)]">
              Cancellation reason: {donation.cancellationReason}
            </p>
          ) : null}
        </SheetHeader>

        {/* PDF preview — fills the middle */}
        <div className="flex-1 overflow-hidden bg-surface-sunken/30 px-6 py-5">
          {donation.receiptUrl ? (
            <div className="h-full overflow-hidden rounded-md border border-border shadow-sm">
              <iframe
                src={donation.receiptUrl}
                title={`Receipt ${donation.receiptNumber}`}
                className="h-full w-full bg-canvas"
              />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center rounded-md border border-dashed border-border bg-surface p-4 text-center text-sm text-ink-muted">
              Receipt PDF not yet generated.
            </div>
          )}
        </div>

        {/* Footer actions — uniform 2-column grid so buttons never overlap regardless of drawer width */}
        <div className="border-t border-border bg-surface px-6 py-4 space-y-3">
          {donation.receiptUrl ? (
            <div className="grid grid-cols-2 gap-2">
              <a
                href={donation.receiptUrl}
                download
                className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm hover:bg-surface-sunken"
              >
                <IconDownload size={14} />
                Download
              </a>
              <a
                href={donation.receiptUrl}
                target="_blank"
                rel="noopener"
                className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm hover:bg-surface-sunken"
              >
                <IconExternalLink size={14} />
                Open
              </a>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() => resend.execute({ donationId: donation.id })}
              disabled={resend.isExecuting}
            >
              <IconMail size={14} />
              Email
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() => prepWA.execute({ donationId: donation.id })}
              disabled={prepWA.isExecuting}
            >
              <IconBrandWhatsapp size={14} />
              WhatsApp
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="w-full"
              onClick={() => regen.execute({ donationId: donation.id })}
              disabled={regen.isExecuting}
            >
              <IconRefresh size={14} />
              Regenerate
            </Button>
            {donation.status !== "CANCELLED" ? (
              <Button
                size="sm"
                variant="destructive"
                className="w-full"
                onClick={() => setShowCancelInput((v) => !v)}
              >
                <IconBan size={14} />
                Cancel
              </Button>
            ) : null}
          </div>

          {showCancelInput ? (
            <div className="space-y-2 rounded-md border border-[color:var(--danger)]/30 bg-[color:var(--danger)]/5 p-3">
              <p className="text-xs text-[color:var(--danger)]">
                Cancellation is permanent — the receipt regenerates with a watermark and the donor is notified.
              </p>
              <Textarea
                rows={2}
                placeholder="Reason for cancellation (visible on the audit log)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setShowCancelInput(false)}>
                  Keep donation
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={reason.trim().length < 3 || cancel.isExecuting}
                  onClick={() =>
                    cancel.execute({ donationId: donation.id, reason: reason.trim() })
                  }
                >
                  Confirm cancellation
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
