"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconPlus } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createAccumulationAction } from "./actions";

export function NewAccumulationButton({ defaultFy }: { defaultFy: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fy, setFy] = useState(defaultFy);
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState("");
  const [periodYears, setPeriodYears] = useState(5);
  const [pending, start] = useTransition();

  const submit = () => {
    start(async () => {
      const r = await createAccumulationAction({
        financialYear: fy,
        amount,
        purpose,
        periodYears,
      });
      if (r?.serverError) {
        toast.error(r.serverError);
        return;
      }
      toast.success("Accumulation added.");
      setOpen(false);
      setAmount("");
      setPurpose("");
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button>
            <IconPlus className="h-4 w-4" />
            New accumulation
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Sec 11(2) accumulation</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="fy">Financial year</Label>
            <Input id="fy" value={fy} onChange={(e) => setFy(e.target.value)} className="font-mono" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="amt">Amount</Label>
            <Input
              id="amt"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="purpose">Purpose</Label>
            <Textarea
              id="purpose"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="e.g. Construction of school building at Site B"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="yrs">Period (years)</Label>
            <Input
              id="yrs"
              type="number"
              min={1}
              max={5}
              value={periodYears}
              onChange={(e) => setPeriodYears(Number(e.target.value))}
              className="font-mono"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
