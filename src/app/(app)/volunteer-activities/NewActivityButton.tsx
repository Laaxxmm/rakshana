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
import { createActivity } from "./actions";

export function NewActivityButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  // Default to tomorrow 09:00 — typical volunteer-event time
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  const [startsAt, setStartsAt] = useState(
    `${tomorrow.toISOString().slice(0, 10)}T09:00`,
  );
  const [endsAt, setEndsAt] = useState("");
  const [requiredVolunteers, setRequiredVolunteers] = useState(5);
  const [pending, start] = useTransition();

  function submit() {
    if (!name.trim()) {
      toast.error("Give the activity a name");
      return;
    }
    start(async () => {
      const r = await createActivity({
        name: name.trim(),
        description: description.trim() || null,
        location: location.trim() || null,
        startsAt: new Date(startsAt),
        endsAt: endsAt ? new Date(endsAt) : null,
        requiredVolunteers,
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
      toast.success("Activity created");
      setOpen(false);
      setName("");
      setDescription("");
      setLocation("");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button>
            <IconPlus className="h-4 w-4" />
            New activity
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New volunteer activity</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Health camp · Whitefield"
            />
          </div>
          <div>
            <Label htmlFor="desc">Description</Label>
            <Textarea
              id="desc"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional context: what volunteers will do"
            />
          </div>
          <div>
            <Label htmlFor="loc">Location</Label>
            <Input
              id="loc"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Whitefield Community Hall"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="starts">Starts at</Label>
              <Input
                id="starts"
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="ends">Ends at (optional)</Label>
              <Input
                id="ends"
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="req">Required volunteers</Label>
            <Input
              id="req"
              type="number"
              min={1}
              value={requiredVolunteers}
              onChange={(e) =>
                setRequiredVolunteers(Number(e.target.value) || 1)
              }
              className="font-mono"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? "Saving…" : "Create activity"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
