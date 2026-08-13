"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { IconSearch, IconX, IconUser, IconFile } from "@tabler/icons-react";
import { Card, CardContent } from "@/components/ui/card";
import { FileUpload, humanSize } from "@/components/patterns/file-upload";
import { FieldError } from "@/components/patterns/FieldError";
import { actionErrorMessage, actionFieldErrors } from "@/lib/actions/action-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatINRWithSymbol, inrInWords } from "@/lib/format/inr";
import { TDS_SECTIONS, TDS_SECTION_KEYS, GST_RATES } from "@/lib/constants/tax";
import { PAYMENT_MODES } from "@/lib/schemas/expense";
import { submitExpense, uploadExpenseBill } from "../actions";
import { fileToActionPayload } from "@/app/(app)/settings/organisation/_upload";
import { searchVendors } from "./vendor-search";

const BILL_ACCEPT = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
const BILL_MAX_BYTES = 15 * 1024 * 1024;

type Vendor = {
  id: string;
  name: string;
  pan: string | null;
  gstin: string | null;
  defaultTdsSection: string | null;
  stateCode: string | null;
};
type BankAcct = {
  id: string;
  bankName: string;
  accountNumber: string;
  purpose: string;
  isPrimary: boolean;
};
type Category = {
  id: string;
  name: string;
  parentId: string | null;
  requiresProject: boolean;
  defaultItcEligible: boolean;
  fcraRestricted: boolean;
};
type ProjectItem = { id: string; code: string; name: string };
type Float = { id: string; name: string; currentBalance: string };

// Fields that live inside the collapsed "More options" disclosure — an error on
// any of these has to force the disclosure open or the message is invisible.
const ADVANCED_FIELDS = new Set([
  "expenseDate",
  "projectId",
  "tdsSection",
  "tdsRate",
  "gstRate",
  "mode",
  "paymentRef",
  "bankAccountId",
  "pettyCashFloatId",
  "description",
]);

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function RecordExpenseForm({
  orgStateCode,
  bankAccounts,
  categories,
  projects,
  floats,
  initialVendor,
  billRequiredThreshold,
}: {
  orgStateCode: string | null;
  bankAccounts: BankAcct[];
  categories: Category[];
  projects: ProjectItem[];
  floats: Float[];
  initialVendor: Vendor | null;
  billRequiredThreshold: string;
}) {
  const router = useRouter();

  // ----- Vendor combobox -----
  const [vendor, setVendor] = React.useState<Vendor | null>(initialVendor);
  const [cashPayee, setCashPayee] = React.useState("");
  const [vendorQuery, setVendorQuery] = React.useState("");
  const [vendorResults, setVendorResults] = React.useState<Vendor[]>([]);
  const [vendorOpen, setVendorOpen] = React.useState(false);
  const search = useAction(searchVendors);
  const searchTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  function onVendorQuery(q: string) {
    setVendorQuery(q);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (q.trim().length < 2) {
      setVendorResults([]);
      return;
    }
    searchTimer.current = setTimeout(() => search.execute({ q }), 200);
  }

  React.useEffect(() => {
    if (search.result?.data?.ok && Array.isArray(search.result.data.vendors)) {
      setVendorResults(search.result.data.vendors as Vendor[]);
    }
  }, [search.result]);

  // ----- Form fields -----
  const [expenseDate, setExpenseDate] = React.useState(todayIso());
  const [categoryId, setCategoryId] = React.useState<string>("");
  const [projectId, setProjectId] = React.useState<string>("");
  const [grossAmount, setGrossAmount] = React.useState("");
  const gross = Number(grossAmount) || 0;

  const [gstApplicable, setGstApplicable] = React.useState(false);
  const [gstRate, setGstRate] = React.useState<number>(18);
  const [itcEligible, setItcEligible] = React.useState(true);

  const [tdsApplicable, setTdsApplicable] = React.useState(false);
  const [tdsSection, setTdsSection] = React.useState<string>("");

  const [mode, setMode] = React.useState<(typeof PAYMENT_MODES)[number]>("NEFT");
  const [paymentRef, setPaymentRef] = React.useState("");
  const [bankAccountId, setBankAccountId] = React.useState<string>(
    bankAccounts.find((b) => b.isPrimary)?.id ?? bankAccounts[0]?.id ?? "",
  );
  const [isPettyCash, setIsPettyCash] = React.useState(false);
  const [pettyCashFloatId, setPettyCashFloatId] = React.useState<string>(floats[0]?.id ?? "");
  const [description, setDescription] = React.useState("");

  // Bills stay in the browser until the voucher exists — an ExpenseAttachment
  // row needs an expenseId, and a half-uploaded bill on an abandoned form is
  // an orphan nobody cleans up.
  const [bills, setBills] = React.useState<File[]>([]);
  const [uploading, setUploading] = React.useState(false);

  const [moreOpen, setMoreOpen] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  function showErrors(next: Record<string, string>) {
    setErrors(next);
    if (Object.keys(next).some((f) => ADVANCED_FIELDS.has(f))) setMoreOpen(true);
  }

  // ----- Auto-suggest TDS section from vendor default -----
  React.useEffect(() => {
    if (vendor?.defaultTdsSection && !tdsSection) {
      setTdsSection(vendor.defaultTdsSection);
      setTdsApplicable(true);
    }
  }, [vendor, tdsSection]);

  // ----- Live derived amounts -----
  const tdsMeta = tdsSection ? TDS_SECTIONS[tdsSection as keyof typeof TDS_SECTIONS] : null;
  const tdsRate = tdsApplicable && tdsMeta?.defaultRate !== null && tdsMeta?.defaultRate !== undefined
    ? tdsMeta.defaultRate
    : 0;
  const tdsAmount = tdsApplicable && tdsRate ? Number(((gross * tdsRate) / 100).toFixed(2)) : 0;
  const netPayable = Number((gross - tdsAmount).toFixed(2));

  const isInterState = !!(vendor?.stateCode && orgStateCode && vendor.stateCode !== orgStateCode);
  const gstTotal = gstApplicable ? Number(((gross * gstRate) / 100).toFixed(2)) : 0;
  const cgst = gstApplicable && !isInterState ? Number((gstTotal / 2).toFixed(2)) : 0;
  const sgst = gstApplicable && !isInterState ? gstTotal - cgst : 0;
  const igst = gstApplicable && isInterState ? gstTotal : 0;

  // ----- Category-driven defaults -----
  const selectedCategory = categories.find((c) => c.id === categoryId);
  React.useEffect(() => {
    if (selectedCategory) {
      setItcEligible(selectedCategory.defaultItcEligible);
    }
  }, [selectedCategory]);

  const projectRequired = !!selectedCategory?.requiresProject;
  const billRequired = gross > Number(billRequiredThreshold);

  // ----- Submit -----
  // One call per bill: a single request carrying five phone photos would blow
  // past the Server Action body limit long before the server could compress
  // them. Failures are reported by name so the user knows what to re-attach.
  async function uploadBills(expenseId: string): Promise<string[]> {
    const failed: string[] = [];
    for (const [i, file] of bills.entries()) {
      const payload = await fileToActionPayload(file);
      const res = await uploadExpenseBill({
        expenseId,
        ...payload,
        pageLabel: `Bill ${i + 1} of ${bills.length}`,
      });
      if (!res?.data?.ok) failed.push(file.name);
    }
    return failed;
  }

  const submit = useAction(submitExpense, {
    onSuccess: async ({ data }) => {
      if (!data?.ok) return;
      setUploading(true);
      const failed = await uploadBills(data.expenseId).finally(() => setUploading(false));
      toast.success(
        data.autoApprove
          ? `Voucher ${data.voucherNumber} approved`
          : `Voucher ${data.voucherNumber} submitted for approval`,
      );
      if (failed.length > 0) {
        toast.error(`Voucher saved, but ${failed.join(", ")} could not be attached.`);
      }
      router.push(`/expenses?open=${data.expenseId}`);
    },
    onError: ({ error }) => {
      // Map Zod field errors onto the fields themselves so a rule that fires
      // inside "More options" (payment ref, bank, description) opens it.
      const next = actionFieldErrors(error);
      if (Object.keys(next).length > 0) {
        showErrors(next);
        toast.error(Object.values(next)[0]);
        return;
      }
      toast.error(actionErrorMessage(error, "Could not save"));
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!vendor && !cashPayee.trim()) {
      next.vendorId = "Pick a vendor — or enter a one-off cash payee name";
    }
    if (gross <= 0) next.grossAmount = "Enter an amount";
    if (description.trim().length < 5) next.description = "Description (5–500 chars)";
    if (projectRequired && !projectId) next.projectId = "This category requires a project";
    if (tdsApplicable && !tdsSection) next.tdsSection = "Pick a TDS section";
    if (Object.keys(next).length > 0) {
      showErrors(next);
      toast.error(Object.values(next)[0]);
      return;
    }
    setErrors({});
    submit.execute({
      vendorId: vendor?.id ?? null,
      cashPayeeName: vendor ? null : cashPayee.trim() || null,
      expenseDate: new Date(expenseDate),
      categoryId: categoryId || null,
      projectId: projectId || null,
      grossAmount,
      gstApplicable,
      gstRate: gstApplicable ? gstRate : undefined,
      isInterState,
      isItcEligible: itcEligible,
      tdsApplicable,
      tdsSection: tdsApplicable ? (tdsSection as never) : null,
      tdsRate: null,
      ldcCertificateId: null,
      mode,
      bankAccountId: isPettyCash ? null : bankAccountId || null,
      paymentRef: paymentRef || null,
      isPettyCash,
      pettyCashFloatId: isPettyCash ? pettyCashFloatId || null : null,
      description: description.trim(),
      billUrl: null,
      billMimeType: null,
      billSize: null,
    } as never);
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-4">
      {/* Paid to */}
      <Card>
        <CardContent className="space-y-3 p-5">
          <Label className="text-xs">Paid to</Label>
          {vendor ? (
            <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-canvas p-3">
              <div>
                <p className="font-display text-lg">{vendor.name}</p>
                <p className="mt-1 flex items-center gap-2 text-xs text-ink-muted">
                  {vendor.defaultTdsSection ? (
                    <Badge variant="outline" className="font-mono text-[10px]">
                      TDS {vendor.defaultTdsSection}
                    </Badge>
                  ) : null}
                  {vendor.pan ? (
                    <span className="font-mono">{vendor.pan}</span>
                  ) : (
                    <span className="text-[color:var(--warning)]">no PAN</span>
                  )}
                  {vendor.gstin ? (
                    <span className="font-mono text-xs">{vendor.gstin}</span>
                  ) : null}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Change vendor"
                onClick={() => setVendor(null)}
              >
                <IconX size={14} />
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="relative">
                <IconSearch
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle"
                />
                <Input
                  placeholder="Search vendor by name, PAN, or GSTIN…"
                  value={vendorQuery}
                  onChange={(e) => onVendorQuery(e.target.value)}
                  onFocus={() => setVendorOpen(true)}
                  className="pl-8"
                />
              </div>
              {vendorOpen && (vendorResults.length > 0 || vendorQuery.length >= 2) ? (
                <div className="rounded-md border border-border bg-surface">
                  {vendorResults.length === 0 ? (
                    <p className="px-3 py-4 text-sm text-ink-muted">
                      No vendors match &ldquo;{vendorQuery}&rdquo;
                    </p>
                  ) : (
                    <ul className="max-h-60 overflow-auto py-1">
                      {vendorResults.map((v) => (
                        <li key={v.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setVendor(v);
                              setVendorOpen(false);
                              setVendorQuery("");
                            }}
                            className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-primary-soft/40"
                          >
                            <IconUser size={14} className="mt-0.5 shrink-0 text-ink-subtle" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium">{v.name}</p>
                              <p className="text-[11px] text-ink-subtle">
                                {v.defaultTdsSection ? `TDS ${v.defaultTdsSection} · ` : ""}
                                {v.pan ? <span className="font-mono">{v.pan}</span> : "no PAN"}
                              </p>
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
              <div className="rounded-md border border-border bg-surface-sunken/40 p-3">
                <Label className="text-xs">Or one-off cash payee (no master record)</Label>
                <Input
                  placeholder="e.g. Chai shop on 80 ft Road"
                  value={cashPayee}
                  onChange={(e) => setCashPayee(e.target.value)}
                />
                {cashPayee ? (
                  <p className="mt-1 text-[11px] text-[color:var(--warning)]">
                    Cash payee mode bypasses vendor TDS tracking — auditor may ask for supporting bill.
                  </p>
                ) : null}
              </div>
            </div>
          )}
          <FieldError msg={errors.vendorId ?? errors.cashPayeeName} />
        </CardContent>
      </Card>

      {/* Amount + live summary + category */}
      <Card>
        <CardContent className="space-y-4 p-5">
          <div>
            <Label className="text-xs">Amount</Label>
            <div className="flex items-baseline gap-2">
              <span className="font-display text-3xl text-ink-subtle">₹</span>
              <Input
                inputMode="decimal"
                placeholder="0"
                value={grossAmount}
                onChange={(e) => setGrossAmount(e.target.value)}
                className="font-display text-3xl h-14 max-w-[260px]"
              />
            </div>
            {gross > 0 ? (
              <p className="mt-1 text-xs italic text-ink-muted">{inrInWords(grossAmount)}</p>
            ) : null}
            <FieldError msg={errors.grossAmount} />
            {billRequired && bills.length === 0 ? (
              <p className="mt-1 text-[11px] text-[color:var(--warning)]">
                Attach the bill below — required above ₹
                {Number(billRequiredThreshold).toLocaleString("en-IN")}.
              </p>
            ) : null}
          </div>

          {/* The gross/TDS/net line is the point of this screen — never collapsed */}
          <div className="grid grid-cols-3 gap-3 rounded-md border border-border bg-surface-sunken/40 p-3 text-sm">
            <div>
              <p className="text-[10px] uppercase tracking-[0.16em] text-ink-subtle">Gross</p>
              <p className="font-mono">
                {gross > 0 ? formatINRWithSymbol(grossAmount, { paise: true }) : "—"}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.16em] text-ink-subtle">
                TDS{tdsApplicable && tdsSection ? ` ${tdsSection} @ ${tdsRate}%` : ""}
              </p>
              <p className="font-mono">
                {tdsAmount > 0 ? `−${formatINRWithSymbol(String(tdsAmount), { paise: true })}` : "—"}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.16em] text-ink-subtle">Net payable</p>
              <p className="font-display text-lg">
                {gross > 0 ? formatINRWithSymbol(String(netPayable), { paise: true }) : "—"}
              </p>
            </div>
          </div>

          <div>
            <Label className="text-xs">Category</Label>
            <Select value={categoryId} onValueChange={(v) => v && setCategoryId(v)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Pick a category…" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.parentId ? "↳ " : ""}
                    {c.name}
                    {c.requiresProject ? " · project required" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError msg={errors.categoryId} />
          </div>
        </CardContent>
      </Card>

      {/* Supporting bills — audit wants every page of paper behind the payment */}
      <Card>
        <CardContent className="space-y-3 p-5">
          <FileUpload
            multiple
            label="Supporting bills"
            onSelect={(file) => setBills((prev) => [...prev, file])}
            accept={BILL_ACCEPT}
            maxBytes={BILL_MAX_BYTES}
            pending={uploading}
            hint="Invoice, delivery note, quotation — attach every page. Photos are compressed on upload."
          />
          {bills.length > 0 ? (
            <ul className="space-y-1.5">
              {bills.map((file, i) => (
                <li
                  key={`${file.name}-${file.lastModified}-${i}`}
                  className="flex items-center gap-3 rounded-[14px] bg-surface-sunken px-3 py-2"
                >
                  <IconFile size={16} className="shrink-0 text-ink-subtle" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{file.name}</p>
                    <p className="text-[11px] text-ink-subtle">
                      Bill {i + 1} of {bills.length} · {humanSize(file.size)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${file.name}`}
                    disabled={uploading}
                    onClick={() => setBills((prev) => prev.filter((_, j) => j !== i))}
                  >
                    <IconX size={14} />
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>

      {/* Everything else */}
      <Card>
        <CardContent className="p-5">
          <details
            open={moreOpen}
            onToggle={(e) => setMoreOpen(e.currentTarget.open)}
          >
            <summary className="cursor-pointer text-sm text-ink">
              More options
              <span className="ml-2 text-xs text-ink-subtle">
                date, project, TDS, GST, payment, description
              </span>
            </summary>

            <div className="mt-4 space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label className="text-xs">Date</Label>
                  <Input
                    type="date"
                    value={expenseDate}
                    onChange={(e) => setExpenseDate(e.target.value)}
                  />
                  <FieldError msg={errors.expenseDate} />
                </div>
                <div>
                  <Label className="text-xs">
                    Project{" "}
                    {projectRequired ? <span className="text-[color:var(--danger)]">*</span> : null}
                  </Label>
                  <Select value={projectId} onValueChange={(v) => v && setProjectId(v)}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Pick a project…" />
                    </SelectTrigger>
                    <SelectContent>
                      {projects.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name} ({p.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldError msg={errors.projectId} />
                </div>
              </div>

              {/* TDS */}
              <div className="space-y-2 border-t border-border pt-4">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={tdsApplicable} onCheckedChange={(v) => setTdsApplicable(!!v)} />
                  TDS applicable
                </label>
                {tdsApplicable ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <Label className="text-xs">Section</Label>
                      <Select value={tdsSection} onValueChange={(v) => v && setTdsSection(v)}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Pick a section…" />
                        </SelectTrigger>
                        <SelectContent>
                          {TDS_SECTION_KEYS.map((k) => (
                            <SelectItem key={k} value={k}>
                              <span className="font-mono text-xs mr-2">{k}</span>
                              {TDS_SECTIONS[k].name}
                              {TDS_SECTIONS[k].defaultRate !== null
                                ? ` · ${TDS_SECTIONS[k].defaultRate}%`
                                : null}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FieldError msg={errors.tdsSection ?? errors.tdsRate} />
                    </div>
                    <div className="flex items-end">
                      <div className="text-xs">
                        <p className="text-ink-subtle">TDS computed</p>
                        <p className="font-mono text-sm">
                          {formatINRWithSymbol(String(tdsAmount), { paise: true })} at {tdsRate}%
                        </p>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              {/* GST */}
              <div className="space-y-2 border-t border-border pt-4">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={gstApplicable} onCheckedChange={(v) => setGstApplicable(!!v)} />
                  GST applicable
                </label>
                {gstApplicable ? (
                  <div className="space-y-2">
                    <div className="grid gap-3 md:grid-cols-2">
                      <div>
                        <Label className="text-xs">Rate</Label>
                        <Select
                          value={String(gstRate)}
                          onValueChange={(v) => v && setGstRate(Number(v))}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {GST_RATES.map((r) => (
                              <SelectItem key={r} value={String(r)}>
                                {r}%
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FieldError msg={errors.gstRate} />
                      </div>
                      <div className="flex items-end">
                        <label className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={itcEligible}
                            onCheckedChange={(v) => setItcEligible(!!v)}
                          />
                          ITC eligible
                        </label>
                      </div>
                    </div>
                    <p className="text-xs text-ink-muted">
                      {isInterState
                        ? `IGST ${formatINRWithSymbol(String(igst), { paise: true })}`
                        : `CGST ${formatINRWithSymbol(String(cgst), { paise: true })} · SGST ${formatINRWithSymbol(String(sgst), { paise: true })}`}
                    </p>
                  </div>
                ) : null}
              </div>

              {/* Payment */}
              <div className="space-y-3 border-t border-border pt-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <Label className="text-xs">Mode</Label>
                    <Select value={mode} onValueChange={(v) => v && setMode(v as typeof mode)}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PAYMENT_MODES.map((m) => (
                          <SelectItem key={m} value={m}>
                            {m}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldError msg={errors.mode} />
                  </div>
                  {mode !== "CASH" ? (
                    <div>
                      <Label className="text-xs">Reference</Label>
                      <Input
                        value={paymentRef}
                        onChange={(e) => setPaymentRef(e.target.value)}
                        className="font-mono"
                      />
                      <FieldError msg={errors.paymentRef} />
                    </div>
                  ) : null}
                </div>
                {floats.length > 0 ? (
                  <div className="space-y-2 rounded-md border border-border bg-surface-sunken/40 p-3">
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox checked={isPettyCash} onCheckedChange={(v) => setIsPettyCash(!!v)} />
                      Pay from petty cash
                    </label>
                    {isPettyCash ? (
                      <>
                        <Select
                          value={pettyCashFloatId}
                          onValueChange={(v) => v && setPettyCashFloatId(v)}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {floats.map((f) => (
                              <SelectItem key={f.id} value={f.id}>
                                {f.name} · balance{" "}
                                {formatINRWithSymbol(f.currentBalance, { paise: true })}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FieldError msg={errors.pettyCashFloatId} />
                      </>
                    ) : null}
                  </div>
                ) : null}
                {!isPettyCash ? (
                  <div>
                    <Label className="text-xs">Bank account debited</Label>
                    <Select value={bankAccountId} onValueChange={(v) => v && setBankAccountId(v)}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {bankAccounts.map((b) => (
                          <SelectItem key={b.id} value={b.id}>
                            {b.bankName} · ending {b.accountNumber.slice(-4)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldError msg={errors.bankAccountId} />
                  </div>
                ) : null}
              </div>

              {/* Description */}
              <div className="border-t border-border pt-4">
                <Label className="text-xs">Description</Label>
                <Textarea
                  rows={3}
                  placeholder="What is this expense for?"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
                <FieldError msg={errors.description} />
              </div>
            </div>
          </details>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface p-3">
        <p className="text-[11px] text-ink-subtle">
          Voucher assigned on save
          {bills.length > 0
            ? ` · ${bills.length} bill${bills.length === 1 ? "" : "s"} attached`
            : ""}
        </p>
        <Button type="submit" disabled={submit.isExecuting || uploading}>
          {uploading ? "Attaching bills…" : submit.isExecuting ? "Saving…" : "Submit"}
        </Button>
      </div>
    </form>
  );
}
