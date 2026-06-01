"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import {
  IconStar,
  IconStarFilled,
  IconPencil,
  IconArchive,
  IconPlus,
} from "@tabler/icons-react";
import { bankAccountSchema, type BankAccountInput } from "@/lib/schemas/organisation";
import {
  createBankAccount,
  updateBankAccount,
  setPrimaryBank,
  deactivateBankAccount,
} from "./actions";
import { EditableField, EditableFieldShell } from "@/components/patterns/EditableField";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatINRWithSymbol } from "@/lib/format/inr";

type BankRow = {
  id: string;
  bankName: string;
  branch: string;
  accountNumber: string;
  accountHolder: string;
  ifsc: string;
  accountType: "SAVINGS" | "CURRENT" | "OD" | "CC";
  purpose: "GENERAL" | "FCRA_ONLY" | "CORPUS" | "PROJECT_SPECIFIC";
  openingBalance: string;
  isPrimary: boolean;
};

const ACCOUNT_TYPES = ["SAVINGS", "CURRENT", "OD", "CC"] as const;
const PURPOSES = ["GENERAL", "FCRA_ONLY", "CORPUS", "PROJECT_SPECIFIC"] as const;

export function BankingPanel({
  canEdit,
  accounts,
  fcraActive,
}: {
  canEdit: boolean;
  accounts: BankRow[];
  fcraActive: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle>Bank accounts</CardTitle>
        {canEdit ? <BankDialog mode="create" fcraActive={fcraActive} /> : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {accounts.length === 0 ? (
          <p className="text-sm text-ink-muted">No active accounts.</p>
        ) : (
          accounts.map((a) => (
            <BankRowItem key={a.id} acct={a} canEdit={canEdit} fcraActive={fcraActive} />
          ))
        )}
      </CardContent>
    </Card>
  );
}

function BankRowItem({
  acct,
  canEdit,
  fcraActive,
}: {
  acct: BankRow;
  canEdit: boolean;
  fcraActive: boolean;
}) {
  const primary = useAction(setPrimaryBank, {
    onSuccess: () => toast.success("Primary account updated"),
    onError: ({ error }) => toast.error(error.serverError ?? "Could not update"),
  });
  const deactivate = useAction(deactivateBankAccount, {
    onSuccess: () => toast.success("Account deactivated"),
    onError: ({ error }) => toast.error(error.serverError ?? "Could not deactivate"),
  });

  return (
    <div className="rounded-md border border-border bg-canvas p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-medium text-ink">{acct.bankName}</p>
          <p className="text-xs text-ink-muted">{acct.branch || "—"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {acct.isPrimary ? (
            <Badge>Primary</Badge>
          ) : canEdit ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => primary.execute({ id: acct.id })}
              disabled={primary.isExecuting}
            >
              <IconStar size={14} />
              Set primary
            </Button>
          ) : null}
          <Badge variant="outline">{acct.purpose}</Badge>
          <Badge variant="outline">{acct.accountType}</Badge>
          {canEdit ? (
            <BankDialog mode="edit" acct={acct} fcraActive={fcraActive} />
          ) : null}
          {canEdit && !acct.isPrimary ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Deactivate"
              disabled={deactivate.isExecuting}
              onClick={() => deactivate.execute({ id: acct.id })}
            >
              <IconArchive size={14} />
            </Button>
          ) : null}
        </div>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-3 text-xs">
        <Field label="Account number" value={acct.accountNumber} mono />
        <Field label="IFSC" value={acct.ifsc} mono />
        <Field label="Opening balance" value={formatINRWithSymbol(acct.openingBalance, { paise: true })} mono />
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.16em] text-ink-subtle">{label}</p>
      <p className={mono ? "font-mono tabular-nums text-sm" : "text-sm"}>{value || "—"}</p>
    </div>
  );
}

function BankDialog({
  mode,
  acct,
  fcraActive,
}: {
  mode: "create" | "edit";
  acct?: BankRow;
  fcraActive: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const form = useForm<BankAccountInput>({
    resolver: zodResolver(bankAccountSchema) as unknown as never,
    defaultValues: acct
      ? {
          bankName: acct.bankName,
          branch: acct.branch,
          accountNumber: acct.accountNumber,
          accountHolder: acct.accountHolder,
          ifsc: acct.ifsc,
          accountType: acct.accountType,
          purpose: acct.purpose,
          openingBalance: Number(acct.openingBalance),
          isPrimary: acct.isPrimary,
        }
      : {
          bankName: "",
          branch: "",
          accountNumber: "",
          accountHolder: "",
          ifsc: "",
          accountType: "CURRENT",
          purpose: fcraActive ? "FCRA_ONLY" : "GENERAL",
          openingBalance: 0,
          isPrimary: false,
        },
  });
  const { register, handleSubmit, formState: { errors }, control, reset } = form;
  const create = useAction(createBankAccount, {
    onSuccess: () => {
      toast.success("Account added");
      reset();
      setOpen(false);
    },
    onError: ({ error }) => toast.error(error.serverError ?? "Could not add"),
  });
  const update = useAction(updateBankAccount, {
    onSuccess: () => {
      toast.success("Account updated");
      setOpen(false);
    },
    onError: ({ error }) => toast.error(error.serverError ?? "Could not update"),
  });
  const isPending = create.isExecuting || update.isExecuting;

  function submit(vals: BankAccountInput) {
    if (mode === "create") create.execute(vals);
    else if (acct) update.execute({ ...vals, id: acct.id });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          mode === "create" ? (
            <Button size="sm">
              <IconPlus size={14} />
              Add account
            </Button>
          ) : (
            <Button variant="ghost" size="icon" aria-label="Edit account">
              <IconPencil size={14} />
            </Button>
          )
        }
      />
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Add bank account" : "Edit bank account"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(submit)} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <EditableField
              label="Bank name"
              required
              error={errors.bankName?.message}
              {...register("bankName")}
            />
            <EditableField label="Branch" {...register("branch")} />
            <EditableField label="Account holder" {...register("accountHolder")} />
            <EditableField
              label="Account number"
              required
              hint="9–18 digits"
              error={errors.accountNumber?.message}
              {...register("accountNumber")}
            />
            <EditableField
              label="IFSC"
              required
              hint="11 chars"
              error={errors.ifsc?.message}
              {...register("ifsc")}
            />
            <EditableFieldShell label="Account type" required>
              <select
                {...register("accountType")}
                className="h-9 rounded-md border border-border bg-surface px-3 text-sm"
              >
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </EditableFieldShell>
            <EditableFieldShell label="Purpose" required>
              <select
                {...register("purpose")}
                className="h-9 rounded-md border border-border bg-surface px-3 text-sm"
              >
                {PURPOSES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </EditableFieldShell>
            <EditableField
              label="Opening balance (₹)"
              type="number"
              step="0.01"
              {...register("openingBalance", { valueAsNumber: true })}
            />
            <EditableFieldShell label="Primary" className="md:col-span-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox {...register("isPrimary")} />
                Mark as primary account
              </label>
            </EditableFieldShell>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
