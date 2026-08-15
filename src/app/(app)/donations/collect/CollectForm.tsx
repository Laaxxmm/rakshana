"use client";

import * as React from "react";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createCollectionLink } from "./actions";
import { CollectionPanel } from "./CollectionPanel";

export function CollectForm({ disabled }: { disabled: boolean }) {
  const [amount, setAmount] = React.useState("");
  const [donorName, setDonorName] = React.useState("");
  const [donorPhone, setDonorPhone] = React.useState("");
  const [donorEmail, setDonorEmail] = React.useState("");

  const create = useAction(createCollectionLink, {
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not create the payment link"),
  });
  const created = create.result.data;

  if (created) {
    return (
      <CollectionPanel
        collection={{ ...created, donorName, donorPhone }}
        onReset={() => {
          create.reset();
          setAmount("");
          setDonorName("");
          setDonorPhone("");
          setDonorEmail("");
        }}
      />
    );
  }

  return (
    <Card>
      <CardContent className="space-y-3 [&_input]:h-11 sm:[&_input]:h-8">
        <div>
          <Label className="text-xs">Amount (₹)</Label>
          <Input
            type="text"
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
            autoCapitalize="words"
            placeholder="Lakshmi Narayanan"
          />
        </div>
        <div>
          <Label className="text-xs">Phone</Label>
          <Input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={donorPhone}
            onChange={(e) => setDonorPhone(e.target.value)}
            placeholder="9876543210"
          />
        </div>
        <div>
          {/* Optional, but it is the only thing that lets the 80G receipt be
              emailed — without it the donor gets WhatsApp or nothing. */}
          <Label className="text-xs">Email (optional)</Label>
          <Input
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="off"
            value={donorEmail}
            onChange={(e) => setDonorEmail(e.target.value)}
            placeholder="donor@example.com"
          />
        </div>
        <Button
          className="h-11 w-full sm:h-8"
          disabled={disabled || create.isExecuting || !amount || !donorName || !donorPhone}
          onClick={() => create.execute({ amount, donorName, donorPhone, donorEmail })}
        >
          {create.isExecuting ? "Creating…" : "Create payment link"}
        </Button>
      </CardContent>
    </Card>
  );
}
