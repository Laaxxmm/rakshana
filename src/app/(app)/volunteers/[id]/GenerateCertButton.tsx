"use client";

import * as React from "react";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { IconCertificate } from "@tabler/icons-react";
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
import { generateVolCert } from "../actions";

export function GenerateCertButton({ volunteerId }: { volunteerId: string }) {
  const [open, setOpen] = React.useState(false);
  const fyStart = `${new Date().getFullYear() - 1}-04-01`;
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = React.useState(fyStart);
  const [to, setTo] = React.useState(today);

  const gen = useAction(generateVolCert, {
    onSuccess: ({ data }) => {
      if (!data?.ok) return;
      toast.success(`Certificate ${data.certificateNumber} (${data.totalHours} hours)`);
      setOpen(false);
    },
    onError: ({ error }) => toast.error(error.serverError ?? "Could not generate"),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button>
            <IconCertificate size={14} />
            Generate certificate
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Generate volunteer certificate</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Period from</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Period to</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            disabled={gen.isExecuting}
            onClick={() =>
              gen.execute({
                volunteerId,
                periodFrom: new Date(from),
                periodTo: new Date(to),
              })
            }
          >
            {gen.isExecuting ? "Generating…" : "Generate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
