"use client";

import * as React from "react";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { IconPlus } from "@tabler/icons-react";
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
import { createPettyCashFloat } from "./actions";

export function NewFloatDialog({
  users,
}: {
  users: { id: string; name: string; email: string }[];
}) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [custodianId, setCustodianId] = React.useState(users[0]?.id ?? "");
  const [amount, setAmount] = React.useState("");
  const create = useAction(createPettyCashFloat, {
    onSuccess: () => {
      toast.success("Float created");
      setOpen(false);
      setName("");
      setAmount("");
    },
    onError: ({ error }) => toast.error(error.serverError ?? "Could not create"),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm">
            <IconPlus size={14} />
            New float
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New petty cash float</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Office petty cash" />
          </div>
          <div>
            <Label className="text-xs">Custodian</Label>
            <Select value={custodianId} onValueChange={(v) => v && setCustodianId(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name} · {u.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Float amount (₹)</Label>
            <Input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="5000"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            disabled={create.isExecuting || !name || !amount || !custodianId}
            onClick={() =>
              create.execute({
                name: name.trim(),
                custodianId,
                floatAmount: amount,
              } as never)
            }
          >
            Create float
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
