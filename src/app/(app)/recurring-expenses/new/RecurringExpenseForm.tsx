"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatINRWithSymbol, inrInWords } from "@/lib/format/inr";
import { createRecurringExpense } from "../actions";

type VendorOpt = { id: string; name: string };
type CategoryOpt = { id: string; name: string };
type ProjectOpt = { id: string; name: string; code: string };

const FREQUENCIES = [
  { value: "MONTHLY", label: "Monthly", help: "Fires every month" },
  { value: "QUARTERLY", label: "Quarterly", help: "Fires every 3 months" },
  { value: "HALF_YEARLY", label: "Half-yearly", help: "Fires every 6 months" },
  { value: "YEARLY", label: "Yearly", help: "Fires once a year (e.g. AMCs)" },
] as const;

export function RecurringExpenseForm({
  vendors,
  categories,
  projects,
  defaultNextDue,
}: {
  vendors: VendorOpt[];
  categories: CategoryOpt[];
  projects: ProjectOpt[];
  defaultNextDue: string;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [vendorId, setVendorId] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [projectId, setProjectId] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState<
    "MONTHLY" | "QUARTERLY" | "HALF_YEARLY" | "YEARLY"
  >("MONTHLY");
  const [nextDueDate, setNextDueDate] = useState(defaultNextDue);
  const [endDate, setEndDate] = useState("");
  const [remarks, setRemarks] = useState("");
  const [pending, start] = useTransition();

  const amountNum = Number(amount.replace(/,/g, "")) || 0;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return toast.error("Give the template a name");
    if (amountNum <= 0) return toast.error("Enter an amount");

    start(async () => {
      const r = await createRecurringExpense({
        name: name.trim(),
        vendorId: vendorId || null,
        categoryId: categoryId || null,
        projectId: projectId || null,
        amount: amountNum.toString(),
        frequency,
        nextDueDate: new Date(nextDueDate),
        endDate: endDate ? new Date(endDate) : null,
        remarks: remarks.trim() || null,
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
      toast.success("Template created. Drafts will appear on /expenses.");
      router.push("/recurring-expenses");
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Identity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="name">Template name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Office rent · Lavelle Road"
              required
            />
            <p className="mt-1 text-xs text-ink-subtle">
              Shown on the templates list. The materialised expense voucher
              uses the vendor name + frequency.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payee &amp; classification</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>Vendor (optional)</Label>
            <Select value={vendorId} onValueChange={(v) => v && setVendorId(v)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Cash payee (no vendor master)">
                  {(val) => {
                    const v = vendors.find((x) => x.id === val);
                    return v?.name ?? "Cash payee (no vendor master)";
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {vendors.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {vendors.length === 0 ? (
              <p className="mt-1 text-xs text-ink-subtle">
                No vendors yet — leave blank or{" "}
                <a href="/vendors/new" className="text-primary hover:underline">
                  add one
                </a>
                .
              </p>
            ) : null}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label>Expense category (optional)</Label>
              <Select
                value={categoryId}
                onValueChange={(v) => v && setCategoryId(v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Uncategorised">
                    {(val) => {
                      const c = categories.find((x) => x.id === val);
                      return c?.name ?? "Uncategorised";
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Project (optional)</Label>
              <Select
                value={projectId}
                onValueChange={(v) => v && setProjectId(v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Not tied to a project">
                    {(val) => {
                      const p = projects.find((x) => x.id === val);
                      return p ? `${p.name} (${p.code})` : "Not tied to a project";
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} ({p.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Amount &amp; schedule</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="amt">Amount per run</Label>
            <div className="flex items-center gap-2">
              <span className="text-lg text-ink-muted">₹</span>
              <Input
                id="amt"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder="50000"
                className="font-mono"
                required
              />
            </div>
            {amountNum > 0 ? (
              <p className="mt-1 text-xs text-ink-muted italic">
                {formatINRWithSymbol(amountNum.toString())} ·{" "}
                {inrInWords(amountNum.toString())}
              </p>
            ) : null}
          </div>

          <div>
            <Label>Frequency</Label>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {FREQUENCIES.map((f) => (
                <Button
                  key={f.value}
                  type="button"
                  variant={frequency === f.value ? "default" : "outline"}
                  size="sm"
                  className="w-full"
                  onClick={() => setFrequency(f.value)}
                >
                  {f.label}
                </Button>
              ))}
            </div>
            <p className="mt-1 text-xs text-ink-subtle">
              {FREQUENCIES.find((f) => f.value === frequency)?.help}
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label htmlFor="next">Next due date</Label>
              <Input
                id="next"
                type="date"
                value={nextDueDate}
                onChange={(e) => setNextDueDate(e.target.value)}
                required
              />
              <p className="mt-1 text-xs text-ink-subtle">
                First draft fires on or after this date.
              </p>
            </div>
            <div>
              <Label htmlFor="end">End date (optional)</Label>
              <Input
                id="end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
              <p className="mt-1 text-xs text-ink-subtle">
                Leave blank to run indefinitely.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Remarks</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="e.g. Rent agreement #LR-2024-15 valid until Mar 2027"
            rows={3}
          />
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2 pt-1">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/recurring-expenses")}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create template"}
        </Button>
      </div>
    </form>
  );
}
