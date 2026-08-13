import type { Metadata } from "next";
import { isRazorpayConfigured } from "@/lib/payments/razorpay";
import { CollectForm } from "./CollectForm";

export const metadata: Metadata = { title: "Collect a donation — Rakshana" };

export default function CollectPage() {
  const configured = isRazorpayConfigured();

  return (
    <div className="mx-auto max-w-md space-y-5">
      <header>
        <h1 className="font-display text-xl font-semibold tracking-tight text-ink">
          Collect a donation
        </h1>
        <p className="text-sm text-ink-muted">
          Enter the amount, share the link or hold up the QR. This screen watches for
          the payment and hands you the 80G receipt as soon as it clears.
        </p>
      </header>

      {!configured && (
        <p className="rounded-[14px] bg-surface-sunken p-3 text-sm text-ink-muted">
          Razorpay isn&apos;t configured yet. Set RAZORPAY_KEY_ID and
          RAZORPAY_KEY_SECRET to start collecting online.
        </p>
      )}

      <CollectForm disabled={!configured} />
    </div>
  );
}
