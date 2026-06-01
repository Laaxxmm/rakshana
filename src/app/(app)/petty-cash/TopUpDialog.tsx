"use client";

import * as React from "react";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { topUpPettyCash } from "./actions";

export function TopUpDialog({
  floatId,
  floatName,
  banks,
}: {
  floatId: string;
  floatName: string;
  banks: { id: string; bankName: string; accountNumber: string; isPrimary: boolean }[];
}) {
  const [open, setOpen] = React.useState(false);
  const [amount, setAmount] = React.useState("");
  const [bankId, setBankId] = React.useState(banks.find((b) => b.isPrimary)?.id ?? banks[0]?.id ?? "");
  const [remarks, setRemarks] = React.useState("");
  const topUp = useAction(topUpPettyCash, {
    onSuccess: () => {
      toast.success("Float topped up");
      setOpen(false);
      setAmount("");
      setRemarks("");
    },
    onError: ({ error }) => toast.error(error.serverError ?? "Could not top up"),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline">Top up</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Top up — {floatName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Amount (₹)</Label>
            <Input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="2000"
            />
          </div>
          <div>
            <Label className="text-xs">Source bank account</Label>
            <Select value={bankId} onValueChange={(v) => v && setBankId(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {banks.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.bankName} · ending {b.accountNumber.slice(-4)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Remarks</Label>
            <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            disabled={topUp.isExecuting || !amount || !bankId}
            onClick={() =>
              topUp.execute({
                floatId,
                amount,
                topUpDate: new Date(),
                sourceBankAccountId: bankId,
                remarks: remarks || null,
              } as never)
            }
          >
            Top up
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
