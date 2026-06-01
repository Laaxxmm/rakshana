"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconCertificate, IconDownload } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { generateUtilCert } from "../actions";

type DonorOpt = { id: string; name: string; totalGiven: string };

export function GenerateUtilCertButton({
  projectId,
  donors,
  defaultFrom,
  defaultTo,
}: {
  projectId: string;
  donors: DonorOpt[];
  defaultFrom: string;
  defaultTo: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [donorId, setDonorId] = useState<string>(donors[0]?.id ?? "");
  const [periodFrom, setPeriodFrom] = useState(defaultFrom);
  const [periodTo, setPeriodTo] = useState(defaultTo);
  const [result, setResult] = useState<{
    certificateNumber: string;
    url: string;
  } | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    if (!donorId) {
      toast.error("Pick a donor");
      return;
    }
    if (new Date(periodFrom) > new Date(periodTo)) {
      toast.error("Period start must be on or before the end");
      return;
    }
    start(async () => {
      const r = await generateUtilCert({
        projectId,
        donorId,
        periodFrom: new Date(periodFrom),
        periodTo: new Date(periodTo),
      });
      if (r?.serverError) {
        toast.error(r.serverError);
        return;
      }
      const v = r?.validationErrors as
        | Record<string, { _errors?: string[] }>
        | undefined;
      if (v) {
        for (const [field, issue] of Object.entries(v)) {
          if (field === "_errors") continue;
          const msg = issue?._errors?.[0];
          if (msg) {
            toast.error(`${field}: ${msg}`);
            return;
          }
        }
      }
      if (r?.data?.certificateNumber && r.data.url) {
        setResult({
          certificateNumber: r.data.certificateNumber,
          url: r.data.url,
        });
        toast.success(`${r.data.certificateNumber} generated`);
        router.refresh();
      }
    });
  }

  function reset() {
    setResult(null);
    setOpen(false);
  }

  if (donors.length === 0) {
    return (
      <Button variant="outline" disabled>
        <IconCertificate className="h-4 w-4" />
        No project-specific donors yet
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : reset())}>
      <DialogTrigger
        render={
          <Button>
            <IconCertificate className="h-4 w-4" />
            Generate certificate
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Generate utilisation certificate</DialogTitle>
        </DialogHeader>
        {result ? (
          <div className="space-y-4">
            <div className="rounded-md border border-primary/30 bg-primary-soft p-4 text-sm">
              <p className="font-medium text-primary">
                Certificate {result.certificateNumber} generated
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                Stored under the project's Reports tab. Download below or
                share the URL with the donor.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={reset}>
                Close
              </Button>
              <a
                href={result.url}
                target="_blank"
                rel="noopener"
                className={buttonVariants({})}
                download
              >
                <IconDownload className="h-4 w-4" />
                Download PDF
              </a>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <div>
                <Label>Donor</Label>
                <Select
                  value={donorId}
                  onValueChange={(v) => v && setDonorId(v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Pick a project-specific donor">
                      {(val) => {
                        const d = donors.find((x) => x.id === val);
                        if (!d) return "Pick a project-specific donor";
                        return `${d.name} · gave ₹${d.totalGiven}`;
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {donors.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name} · gave ₹{d.totalGiven}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-xs text-ink-subtle">
                  Only donors with project-specific donations to this project
                  appear here.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="from">Period from</Label>
                  <Input
                    id="from"
                    type="date"
                    value={periodFrom}
                    onChange={(e) => setPeriodFrom(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="to">Period to</Label>
                  <Input
                    id="to"
                    type="date"
                    value={periodTo}
                    onChange={(e) => setPeriodTo(e.target.value)}
                  />
                </div>
              </div>
              <p className="text-xs text-ink-muted">
                The certificate aggregates the donor's contributions and the
                project's expenditure within this window, then computes the
                donor's pro-rata share of utilisation.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={reset} disabled={pending}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={pending}>
                {pending ? "Generating…" : "Generate PDF"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
