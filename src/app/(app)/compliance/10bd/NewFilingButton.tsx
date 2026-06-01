"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconPlus } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { createFilingAction } from "./actions";

export function NewFilingButton({ suggestedFy }: { suggestedFy: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [fy, setFy] = useState(suggestedFy);
  const [isRevision, setIsRevision] = useState(false);
  const [originalArn, setOriginalArn] = useState("");

  const submit = () => {
    startTransition(async () => {
      const result = await createFilingAction({
        financialYear: fy,
        isRevision,
        originalFilingArn: isRevision ? originalArn : undefined,
      });
      if (result?.serverError) {
        toast.error(result.serverError);
        return;
      }
      const id = result?.data?.id;
      if (!id) {
        toast.error("Could not create filing.");
        return;
      }
      if (result.data?.resumed) {
        toast.info(`A draft 10BD for FY ${fy} already exists — resuming.`);
      } else {
        toast.success(`Started 10BD for FY ${fy}.`);
      }
      setOpen(false);
      router.push(`/compliance/10bd/${id}`);
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button>
            <IconPlus className="h-4 w-4" />
            New filing
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Form 10BD filing</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="fy">Financial year</Label>
            <Input
              id="fy"
              value={fy}
              onChange={(e) => setFy(e.target.value)}
              placeholder="2024-25"
              className="font-mono"
            />
            <p className="text-xs text-ink-muted">
              Format: YYYY-YY (e.g. 2024-25 for 1 Apr 2024 – 31 Mar 2025).
            </p>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="rev">Mark as revision</Label>
              <p className="text-xs text-ink-muted">
                Use when you've already filed once and need to correct it.
              </p>
            </div>
            <Switch id="rev" checked={isRevision} onCheckedChange={setIsRevision} />
          </div>
          {isRevision && (
            <div className="space-y-2">
              <Label htmlFor="arn">Original filing ARN</Label>
              <Input
                id="arn"
                value={originalArn}
                onChange={(e) => setOriginalArn(e.target.value)}
                placeholder="Acknowledgement Number from the original filing"
                className="font-mono"
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? "Creating…" : "Create draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
