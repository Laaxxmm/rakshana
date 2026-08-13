import type { Metadata } from "next";
import { isRazorpayConfigured } from "@/lib/payments/razorpay";
import { CollectForm } from "./CollectForm";

export const metadata: Metadata = { title: "Collect a donation — Rakshana" };

export default function CollectPage() {
  const configured = isRazorpayConfigured();

  return (
    <div className="mx-auto max-w-md space-y-5">
      <header>
        <h1 className="text-xl font-semibold">Collect a donation</h1>
        <p className="text-sm text-muted-foreground">
          Enter the amount, share the link or hold up the QR. The 80G receipt goes
          out on its own once the payment clears.
        </p>
      </header>

      {!configured && (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          Razorpay isn&apos;t configured yet. Set RAZORPAY_KEY_ID and
          RAZORPAY_KEY_SECRET to start collecting online.
        </p>
      )}

      <CollectForm disabled={!configured} />
    </div>
  );
}
