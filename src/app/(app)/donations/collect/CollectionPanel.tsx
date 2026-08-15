"use client";

import * as React from "react";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { IconBrandWhatsapp, IconCopy, IconRefresh } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DonationReceiptActions } from "@/components/patterns/DonationReceiptActions";
import { formatINRWithSymbol } from "@/lib/format/inr";
import { regenerateReceipt } from "../actions";
import { getCollectionStatus, type CollectionStatus } from "./actions";

const POLL_MS = 4_000;
// Five minutes is already a long time to stand at a stall holding a phone.
// Past that the volunteer checks by hand rather than us polling forever.
const POLL_LIMIT = 75;

export type Collection = {
  paymentIntentId: string;
  amount: string;
  paymentUrl: string;
  qrImageUrl: string | null;
  donorName: string;
  donorPhone: string;
};

/**
 * Everything after "Create payment link": the shareable link and QR while the
 * money is in flight, then the receipt hand-off once the webhook lands.
 */
export function CollectionPanel({
  collection,
  onReset,
}: {
  collection: Collection;
  onReset: () => void;
}) {
  const { paymentIntentId } = collection;
  const [exhausted, setExhausted] = React.useState(false);

  const check = useAction(getCollectionStatus, {
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not check the payment status"),
  });
  const status: CollectionStatus = check.result.data ?? { state: "AWAITING" };

  // next-safe-action does not promise a stable `execute`, and an unstable one
  // in the dep array would tear the interval down before it ever fires.
  const checkNow = React.useRef(check.execute);
  React.useEffect(() => {
    checkNow.current = check.execute;
  });

  React.useEffect(() => {
    if (status.state !== "AWAITING" || exhausted) return;
    checkNow.current({ paymentIntentId });

    let ticks = 0;
    const timer = setInterval(() => {
      if (++ticks >= POLL_LIMIT) {
        clearInterval(timer);
        setExhausted(true);
        return;
      }
      checkNow.current({ paymentIntentId });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [paymentIntentId, status.state, exhausted]);

  const regen = useAction(regenerateReceipt, {
    onSuccess: () => {
      toast.success("Receipt generated");
      checkNow.current({ paymentIntentId });
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not generate the receipt"),
  });

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-mono text-lg tabular-nums text-ink">
            {formatINRWithSymbol(collection.amount)}
          </span>
          <span className="truncate text-sm text-ink-muted">{collection.donorName}</span>
        </div>

        {status.state === "AWAITING" ? (
          <AwaitingPayment
            collection={collection}
            exhausted={exhausted}
            onCheckAgain={() => setExhausted(false)}
          />
        ) : null}

        {status.state === "FAILED" ? (
          <StatusBand
            tone="bad"
            title="Payment failed"
            detail="The donor cancelled, the link expired, or the bank declined it. Nothing was collected — start a new collection to try again."
          />
        ) : null}

        {status.state === "RECEIPT_PENDING" ? (
          <>
            <StatusBand
              tone="good"
              title="Payment received"
              detail={`Receipt no. ${status.receiptNumber} is booked.`}
            />
            <StatusBand
              tone="warn"
              title="Receipt PDF not ready"
              detail="The 80G PDF has not been generated yet. Give it a few seconds, then retry — there is nothing to download or send until it exists."
            />
            <Button
              variant="outline"
              disabled={regen.isExecuting}
              onClick={() => regen.execute({ donationId: status.donationId })}
            >
              <IconRefresh />
              {regen.isExecuting ? "Generating…" : "Retry receipt"}
            </Button>
          </>
        ) : null}

        {status.state === "RECEIPT_READY" ? (
          <>
            <StatusBand
              tone="good"
              title="Payment received"
              detail={`80G receipt no. ${status.receiptNumber} is ready for ${status.donorName}.`}
            />
            <DonationReceiptActions
              donationId={status.donationId}
              donorEmail={status.donorEmail}
              donorWhatsApp={status.donorWhatsApp}
            />
          </>
        ) : null}

        <Button variant={status.state === "AWAITING" ? "default" : "secondary"} onClick={onReset}>
          New collection
        </Button>
      </CardContent>
    </Card>
  );
}

function AwaitingPayment({
  collection,
  exhausted,
  onCheckAgain,
}: {
  collection: Collection;
  exhausted: boolean;
  onCheckAgain: () => void;
}) {
  const shareText = `Namaste ${collection.donorName}, please complete your donation of ${formatINRWithSymbol(collection.amount)} here: ${collection.paymentUrl}`;

  return (
    <>
      <div>
        <p className="text-xs text-ink-subtle">Payment link</p>
        <p className="break-all text-sm font-medium text-ink">{collection.paymentUrl}</p>
      </div>

      {collection.qrImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- Razorpay-hosted QR, no loader needed
        <img
          src={collection.qrImageUrl}
          alt="UPI QR code — scan to pay"
          className="mx-auto size-56 rounded-[14px] bg-white p-2 shadow-[var(--shadow-sm)]"
        />
      ) : (
        <p className="text-xs text-ink-subtle">UPI QR unavailable — share the link instead.</p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => {
            void navigator.clipboard.writeText(collection.paymentUrl);
            toast.success("Link copied");
          }}
        >
          <IconCopy />
          Copy link
        </Button>
        <Button
          variant="outline"
          render={
            <a
              href={`https://wa.me/${collection.donorPhone.replace(/\D/g, "")}?text=${encodeURIComponent(shareText)}`}
              target="_blank"
              rel="noreferrer"
            />
          }
        >
          <IconBrandWhatsapp />
          Send link on WhatsApp
        </Button>
      </div>

      {exhausted ? (
        <StatusBand
          tone="warn"
          title="Still not confirmed"
          detail="We stopped checking after five minutes. The link is still live — the receipt appears here whenever the payment clears."
          action={
            <Button variant="outline" size="sm" onClick={onCheckAgain}>
              <IconRefresh />
              Check again
            </Button>
          }
        />
      ) : (
        <StatusBand
          tone="waiting"
          title="Waiting for payment"
          detail="This screen updates on its own. The 80G receipt and the ways to send it appear here the moment the money clears."
        />
      )}
    </>
  );
}

const TONES = {
  waiting: "var(--primary)",
  good: "var(--success)",
  warn: "var(--warning)",
  bad: "var(--danger)",
} as const;

function StatusBand({
  tone,
  title,
  detail,
  action,
}: {
  tone: keyof typeof TONES;
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  const colour = TONES[tone];
  return (
    <div
      className="space-y-2 rounded-[14px] px-4 py-3"
      style={{ backgroundColor: `color-mix(in srgb, ${colour} 10%, transparent)` }}
    >
      <p className="flex items-center gap-2 text-sm font-medium" style={{ color: colour }}>
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${tone === "waiting" ? "animate-pulse" : ""}`}
          style={{ backgroundColor: colour }}
          aria-hidden
        />
        {title}
      </p>
      <p className="text-xs text-ink-muted">{detail}</p>
      {action}
    </div>
  );
}
