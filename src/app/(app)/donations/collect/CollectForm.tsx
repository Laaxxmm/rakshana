"use client";

import * as React from "react";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createCollectionLink } from "./actions";

export function CollectForm({ disabled }: { disabled: boolean }) {
  const [amount, setAmount] = React.useState("");
  const [donorName, setDonorName] = React.useState("");
  const [donorPhone, setDonorPhone] = React.useState("");

  const create = useAction(createCollectionLink, {
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not create the payment link"),
  });
  const result = create.result.data;

  if (result) {
    const shareText = `Namaste ${donorName}, please complete your donation of ₹${amount} here: ${result.paymentUrl}`;
    return (
      <Card>
        <CardContent className="space-y-4 py-5">
          <div>
            <p className="text-xs text-muted-foreground">Payment link</p>
            <p className="break-all font-medium">{result.paymentUrl}</p>
          </div>

          {result.qrImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- Razorpay-hosted QR, no loader needed
            <img
              src={result.qrImageUrl}
              alt="UPI QR code — scan to pay"
              className="mx-auto size-56 rounded-md border bg-white p-2"
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              UPI QR unavailable — share the link instead.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(result.paymentUrl);
                toast.success("Link copied");
              }}
            >
              Copy link
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                window.open(
                  `https://wa.me/${donorPhone.replace(/\D/g, "")}?text=${encodeURIComponent(shareText)}`,
                  "_blank",
                )
              }
            >
              Send on WhatsApp
            </Button>
            <Button
              onClick={() => {
                create.reset();
                setAmount("");
                setDonorName("");
                setDonorPhone("");
              }}
            >
              New collection
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            The receipt is generated and sent automatically the moment the payment
            is confirmed. Nothing else to do here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-3 py-5">
        <div>
          <Label className="text-xs">Amount (₹)</Label>
          <Input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="1000"
          />
        </div>
        <div>
          <Label className="text-xs">Donor name</Label>
          <Input
            value={donorName}
            onChange={(e) => setDonorName(e.target.value)}
            placeholder="Lakshmi Narayanan"
          />
        </div>
        <div>
          <Label className="text-xs">Phone</Label>
          <Input
            inputMode="tel"
            value={donorPhone}
            onChange={(e) => setDonorPhone(e.target.value)}
            placeholder="9876543210"
          />
        </div>
        <Button
          className="w-full"
          disabled={disabled || create.isExecuting || !amount || !donorName || !donorPhone}
          onClick={() => create.execute({ amount, donorName, donorPhone })}
        >
          {create.isExecuting ? "Creating…" : "Create payment link"}
        </Button>
      </CardContent>
    </Card>
  );
}
