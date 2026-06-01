"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import {
  IconSearch,
  IconPlus,
  IconX,
  IconUser,
  IconShieldCheck,
} from "@tabler/icons-react";
import { recordDonation } from "../actions";
import { createDonorMini } from "../../donors/actions";
import { searchDonors } from "./donor-search";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { formatINRWithSymbol, inrInWords } from "@/lib/format/inr";
import { formatIST } from "@/lib/format/date";
import { DONATION_MODES, DONATION_PURPOSES, IN_KIND_VALUATION_METHODS } from "@/lib/schemas/donation";
import { MANDATORY_PAN_THRESHOLD } from "@/lib/constants/tax";

type Donor = {
  id: string;
  name: string;
  donorType: string;
  pan: string | null;
  is80GEligible: boolean;
  isFcraEligible: boolean;
  isAnonymousBucket?: boolean;
  lastDonationDate: string | null;
  lifetime: string;
};

type BankAcct = {
  id: string;
  bankName: string;
  accountNumber: string;
  purpose: string;
  isPrimary: boolean;
};

type ProjectItem = { id: string; code: string; name: string };

type Anonymous = {
  donorId: string;
  fyTotal: string;
  limit: string;
};

const MODE_LABELS: Record<string, string> = {
  CASH: "Cash",
  CHEQUE: "Cheque",
  DD: "DD",
  NEFT: "NEFT",
  RTGS: "RTGS",
  IMPS: "IMPS",
  UPI: "UPI",
  CARD: "Card",
  ONLINE_GATEWAY: "Online",
  IN_KIND: "In-kind",
  OTHER: "Other",
};
const COMMON_MODES = ["CASH", "CHEQUE", "NEFT", "UPI", "IN_KIND"] as const;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function thisMondayIso(): string {
  const d = new Date();
  const dow = d.getDay();
  const diff = (dow + 6) % 7;
  d.setDate(d.getDate() - diff);
  return d.toISOString().slice(0, 10);
}

export function RecordDonationForm({
  fy,
  bankAccounts,
  projects,
  anonymous,
  initialDonor,
}: {
  fy: string;
  bankAccounts: BankAcct[];
  projects: ProjectItem[];
  anonymous: Anonymous | null;
  initialDonor: Donor | null;
}) {
  const router = useRouter();

  // ----- Anonymous mode toggle -----
  const [isAnonymous, setIsAnonymous] = React.useState(false);

  // ----- Donor combobox state -----
  const [donor, setDonor] = React.useState<Donor | null>(initialDonor);
  const [donorQuery, setDonorQuery] = React.useState("");
  const [donorResults, setDonorResults] = React.useState<Donor[]>([]);
  const [donorOpen, setDonorOpen] = React.useState(false);
  const search = useAction(searchDonors);
  const searchTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  function onDonorQuery(q: string) {
    setDonorQuery(q);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (q.trim().length < 2) {
      setDonorResults([]);
      return;
    }
    searchTimer.current = setTimeout(() => {
      search.execute({ q });
    }, 200);
  }

  React.useEffect(() => {
    if (search.result?.data?.ok && Array.isArray(search.result.data.donors)) {
      setDonorResults(search.result.data.donors as Donor[]);
    }
  }, [search.result]);

  // ----- Mini-donor inline form -----
  const [miniOpen, setMiniOpen] = React.useState(false);
  const [miniName, setMiniName] = React.useState("");
  const [miniPan, setMiniPan] = React.useState("");
  const [miniPhone, setMiniPhone] = React.useState("");
  const [miniType, setMiniType] = React.useState("INDIVIDUAL");
  const createMini = useAction(createDonorMini, {
    onSuccess: ({ data }) => {
      if (data?.ok) {
        toast.success("Donor added");
        const created = data.donor;
        setDonor({
          id: created.id,
          name: created.name,
          donorType: created.donorType,
          pan: created.pan,
          is80GEligible: true,
          isFcraEligible: false,
          lastDonationDate: null,
          lifetime: "0",
        });
        setMiniOpen(false);
        setDonorOpen(false);
        setMiniName("");
        setMiniPan("");
        setMiniPhone("");
      }
    },
    onError: ({ error }) => toast.error(error.serverError ?? "Could not add donor"),
  });

  // ----- Form fields -----
  const [donationDate, setDonationDate] = React.useState(todayIso());
  const [amountStr, setAmountStr] = React.useState("");
  const amountNum = Number(amountStr) || 0;
  const [mode, setMode] = React.useState<(typeof DONATION_MODES)[number]>("UPI");
  const [paymentRef, setPaymentRef] = React.useState("");
  const [bankAccountId, setBankAccountId] = React.useState<string>(
    bankAccounts.find((b) => b.isPrimary)?.id ?? bankAccounts[0]?.id ?? "",
  );
  const [purpose, setPurpose] = React.useState<(typeof DONATION_PURPOSES)[number]>("GENERAL");
  const [projectId, setProjectId] = React.useState<string>("");
  const [csrCin, setCsrCin] = React.useState("");
  const [is80G, setIs80G] = React.useState(true);
  const [inKindDescription, setInKindDescription] = React.useState("");
  const [inKindValuation, setInKindValuation] = React.useState<string>("FAIR_MARKET_VALUE");
  const [remarks, setRemarks] = React.useState("");

  const effectiveDonor: Donor | null = isAnonymous
    ? anonymous
      ? {
          id: anonymous.donorId,
          name: "Anonymous Donations",
          donorType: "ANONYMOUS",
          pan: null,
          is80GEligible: false,
          isFcraEligible: false,
          lastDonationDate: null,
          lifetime: "0",
        }
      : null
    : donor;

  // ----- Bank filter for FCRA -----
  const showFcraNote =
    effectiveDonor?.isFcraEligible ||
    effectiveDonor?.donorType === "FOREIGN_SOURCE" ||
    effectiveDonor?.donorType === "NRI";
  const visibleBanks = showFcraNote
    ? bankAccounts.filter((b) => b.purpose === "FCRA_ONLY")
    : bankAccounts.filter((b) => b.purpose !== "FCRA_ONLY");
  const showBankField = mode !== "CASH" && mode !== "IN_KIND";
  const showRefField = mode !== "CASH" && mode !== "IN_KIND";

  // ----- 80G PAN warning -----
  const panWarning =
    effectiveDonor &&
    !effectiveDonor.isAnonymousBucket &&
    !effectiveDonor.pan &&
    amountNum > MANDATORY_PAN_THRESHOLD;

  // ----- Anonymous meter -----
  const anonTotal = Number(anonymous?.fyTotal ?? 0) + (isAnonymous ? amountNum : 0);
  const anonLimit = Number(anonymous?.limit ?? 0);
  const anonPct = anonLimit > 0 ? Math.min(100, (anonTotal / anonLimit) * 100) : 0;

  // ----- Submit -----
  const submit = useAction(recordDonation, {
    onSuccess: ({ data, input }) => {
      if (!data?.ok) return;
      toast.success(`Donation recorded · receipt ${data.receiptNumber}`, {
        action: {
          label: "View",
          onClick: () => router.push(`/donations?fy=${fy}&open=${data.donationId}`),
        },
      });
      // Reset for "Record another"; keep date + mode pre-filled.
      setAmountStr("");
      setPaymentRef("");
      setRemarks("");
      void input; // form state is local; reset above
    },
    onError: ({ error }) => {
      // Surface Zod field errors when present so the user sees WHICH field
      // is wrong (e.g. UPI/NEFT need a payment reference). Falling back to
      // a generic "Could not record donation" hides actionable detail.
      const v = error.validationErrors as Record<string, { _errors?: string[] }> | undefined;
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
      toast.error(error.serverError ?? "Could not record donation");
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!effectiveDonor) {
      toast.error("Pick a donor first");
      return;
    }
    if (!amountStr || amountNum <= 0) {
      toast.error("Enter an amount");
      return;
    }
    submit.execute({
      donorId: effectiveDonor.id,
      donationDate: new Date(donationDate),
      amount: amountStr,
      mode,
      bankAccountId: showBankField ? bankAccountId : null,
      paymentRef: showRefField ? paymentRef || null : null,
      paymentDate: null,
      isInKind: mode === "IN_KIND",
      inKindDescription: mode === "IN_KIND" ? inKindDescription : null,
      inKindValuationMethod:
        mode === "IN_KIND"
          ? (inKindValuation as (typeof IN_KIND_VALUATION_METHODS)[number])
          : null,
      purpose,
      projectId: purpose === "PROJECT_SPECIFIC" || purpose === "CSR" ? projectId : null,
      isCsr: purpose === "CSR",
      csrCompanyCin: purpose === "CSR" ? csrCin : null,
      isFcra: !!showFcraNote,
      is80GEligible: isAnonymous ? false : is80G,
      remarks: remarks || null,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-5 lg:grid-cols-[1fr_400px]">
      <div className="space-y-5">
        {/* Anonymous toggle */}
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Checkbox
              id="anon"
              checked={isAnonymous}
              onCheckedChange={(v) => setIsAnonymous(!!v)}
            />
            <div className="flex-1">
              <Label htmlFor="anon" className="font-medium">
                Anonymous donation
              </Label>
              <p className="text-xs text-ink-muted">
                Routes to the system Anonymous Donations bucket. PAN and 80G are skipped.
              </p>
            </div>
            {isAnonymous ? <AnonymousMeter total={anonTotal} limit={anonLimit} pct={anonPct} /> : null}
          </CardContent>
        </Card>

        {/* Donor */}
        {!isAnonymous ? (
          <Card>
            <CardHeader>
              <CardTitle>Donor</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {donor ? (
                <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-canvas p-3">
                  <div>
                    <p className="font-display text-lg">{donor.name}</p>
                    <p className="mt-1 flex items-center gap-2 text-xs text-ink-muted">
                      <Badge variant="outline" className="text-[10px]">
                        {donor.donorType}
                      </Badge>
                      {donor.pan ? <span className="font-mono">{donor.pan}</span> : <span>no PAN</span>}
                      {donor.is80GEligible ? <span>· 80G eligible</span> : null}
                    </p>
                    <p className="mt-1 text-xs text-ink-subtle">
                      Lifetime {formatINRWithSymbol(donor.lifetime, { paise: true })}
                      {donor.lastDonationDate
                        ? ` · last donation ${formatIST(donor.lastDonationDate)}`
                        : null}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Change donor"
                    onClick={() => setDonor(null)}
                  >
                    <IconX size={14} />
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="relative">
                    <IconSearch
                      size={14}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle"
                    />
                    <Input
                      placeholder="Search by name, PAN, or phone…"
                      value={donorQuery}
                      onChange={(e) => onDonorQuery(e.target.value)}
                      onFocus={() => setDonorOpen(true)}
                      className="pl-8"
                    />
                  </div>
                  {donorOpen && (donorResults.length > 0 || donorQuery.length >= 2) ? (
                    <div className="rounded-md border border-border bg-surface">
                      {donorResults.length === 0 ? (
                        <p className="px-3 py-4 text-sm text-ink-muted">
                          No donors match &ldquo;{donorQuery}&rdquo;
                        </p>
                      ) : (
                        <ul className="max-h-60 overflow-auto py-1">
                          {donorResults.map((d) => (
                            <li key={d.id}>
                              <button
                                type="button"
                                onClick={() => {
                                  setDonor(d);
                                  setDonorOpen(false);
                                  setDonorQuery("");
                                }}
                                className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-primary-soft/40"
                              >
                                <IconUser size={14} className="mt-0.5 shrink-0 text-ink-subtle" />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium">{d.name}</p>
                                  <p className="text-[11px] text-ink-subtle">
                                    <Badge variant="outline" className="mr-1 text-[9px]">
                                      {d.donorType}
                                    </Badge>
                                    {d.pan ? <span className="font-mono">{d.pan}</span> : "no PAN"}
                                  </p>
                                </div>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="border-t border-border">
                        <button
                          type="button"
                          onClick={() => {
                            setMiniOpen(true);
                            setDonorOpen(false);
                            setMiniName(donorQuery);
                          }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-sm text-primary hover:bg-primary-soft/40"
                        >
                          <IconPlus size={14} />
                          Add new donor
                          {donorQuery ? <span className="text-ink-subtle">&ldquo;{donorQuery}&rdquo;</span> : null}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}

              {miniOpen ? (
                <div className="rounded-md border border-primary/30 bg-primary-soft/30 p-4 space-y-3">
                  <p className="text-xs uppercase tracking-[0.16em] text-ink-subtle">
                    Add donor
                  </p>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <Label className="text-xs">Type</Label>
                      <Select value={miniType} onValueChange={(v) => v && setMiniType(v)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {["INDIVIDUAL", "CORPORATE", "TRUST", "HUF", "NRI"].map((t) => (
                            <SelectItem key={t} value={t}>
                              {t}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Name</Label>
                      <Input value={miniName} onChange={(e) => setMiniName(e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-xs">PAN</Label>
                      <Input value={miniPan} onChange={(e) => setMiniPan(e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-xs">Phone</Label>
                      <Input value={miniPhone} onChange={(e) => setMiniPhone(e.target.value)} />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="ghost" size="sm" onClick={() => setMiniOpen(false)}>
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={createMini.isExecuting || miniName.trim().length === 0}
                      onClick={() =>
                        createMini.execute({
                          donorType: miniType as never,
                          name: miniName.trim(),
                          pan: miniPan || null,
                          phone: miniPhone || null,
                          addressLine1: null,
                          city: null,
                          state: null,
                          pincode: null,
                        } as never)
                      }
                    >
                      Save donor
                    </Button>
                  </div>
                </div>
              ) : null}

              {panWarning ? (
                <p className="rounded-md border border-[color:var(--warning)]/30 bg-[color:var(--warning)]/8 px-3 py-2 text-xs text-[color:var(--warning)]">
                  PAN required for 80G eligibility above ₹{MANDATORY_PAN_THRESHOLD.toLocaleString("en-IN")}.
                </p>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {/* Date */}
        <Card>
          <CardHeader>
            <CardTitle>Date</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {[
                { label: "Today", value: todayIso() },
                { label: "Yesterday", value: yesterdayIso() },
                { label: "This Monday", value: thisMondayIso() },
              ].map((p) => (
                <Button
                  key={p.label}
                  type="button"
                  size="sm"
                  variant={donationDate === p.value ? "default" : "outline"}
                  onClick={() => setDonationDate(p.value)}
                >
                  {p.label}
                </Button>
              ))}
            </div>
            <Input
              type="date"
              value={donationDate}
              onChange={(e) => setDonationDate(e.target.value)}
              className="max-w-[200px]"
            />
          </CardContent>
        </Card>

        {/* Amount */}
        <Card>
          <CardHeader>
            <CardTitle>Amount</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-baseline gap-2">
              <span className="font-display text-3xl text-ink-subtle">₹</span>
              <Input
                inputMode="decimal"
                placeholder="0"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                className="font-display text-3xl h-14 max-w-[260px]"
              />
            </div>
            {amountNum > 0 ? (
              <p className="text-xs italic text-ink-muted">
                {inrInWords(amountStr)}
              </p>
            ) : null}
          </CardContent>
        </Card>

        {/* Mode */}
        <Card>
          <CardHeader>
            <CardTitle>Mode</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {COMMON_MODES.map((m) => (
                <Button
                  key={m}
                  type="button"
                  size="sm"
                  variant={mode === m ? "default" : "outline"}
                  onClick={() => setMode(m)}
                >
                  {MODE_LABELS[m]}
                </Button>
              ))}
              <Select value={mode} onValueChange={(v) => v && setMode(v as typeof mode)}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DONATION_MODES.map((m) => (
                    <SelectItem key={m} value={m}>
                      {MODE_LABELS[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {showRefField ? (
              <div>
                <Label className="text-xs">Reference</Label>
                <Input
                  placeholder={
                    mode === "CHEQUE" || mode === "DD"
                      ? "Cheque / DD number"
                      : mode === "UPI"
                        ? "UPI ref"
                        : "UTR / reference"
                  }
                  value={paymentRef}
                  onChange={(e) => setPaymentRef(e.target.value)}
                  className="font-mono max-w-[280px]"
                />
              </div>
            ) : null}

            {mode === "IN_KIND" ? (
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <Label className="text-xs">Goods description</Label>
                  <Textarea
                    rows={2}
                    value={inKindDescription}
                    onChange={(e) => setInKindDescription(e.target.value)}
                  />
                </div>
                <div>
                  <Label className="text-xs">Valuation method</Label>
                  <Select value={inKindValuation} onValueChange={(v) => v && setInKindValuation(v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {IN_KIND_VALUATION_METHODS.map((v) => (
                        <SelectItem key={v} value={v}>
                          {v.replace(/_/g, " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : null}

            {showBankField ? (
              <div>
                <Label className="text-xs">Bank account credited</Label>
                <Select value={bankAccountId} onValueChange={(v) => v && setBankAccountId(v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select bank account…">
                      {(val) => {
                        const b = visibleBanks.find((x) => x.id === val);
                        if (!b) return "Select bank account…";
                        return `${b.bankName} · a/c ending ${b.accountNumber.slice(-4)}`;
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {visibleBanks.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.bankName} · a/c ending {b.accountNumber.slice(-4)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {showFcraNote ? (
                  <p className="mt-1 text-[11px] text-[color:var(--info)]">
                    Filtered to FCRA accounts (foreign-source donor).
                  </p>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* Purpose */}
        <Card>
          <CardHeader>
            <CardTitle>Purpose</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {(["GENERAL", "CORPUS", "PROJECT_SPECIFIC", "CSR"] as const).map((p) => (
                <Button
                  key={p}
                  type="button"
                  size="sm"
                  variant={purpose === p ? "default" : "outline"}
                  onClick={() => setPurpose(p)}
                >
                  {p.replace(/_/g, " ")}
                </Button>
              ))}
            </div>
            {purpose === "PROJECT_SPECIFIC" || purpose === "CSR" ? (
              <div>
                <Label className="text-xs">Project</Label>
                <Select value={projectId} onValueChange={(v) => v && setProjectId(v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select project…">
                      {(val) => {
                        const p = projects.find((x) => x.id === val);
                        if (!p) return "Select project…";
                        return `${p.name} (${p.code})`;
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
                {projects.length === 0 ? (
                  <p className="mt-1 text-[11px] text-ink-subtle">
                    No active projects yet. Create one under{" "}
                    <a href="/projects/new" className="text-primary hover:underline">
                      Projects
                    </a>{" "}
                    first.
                  </p>
                ) : null}
              </div>
            ) : null}
            {purpose === "CSR" ? (
              <div>
                <Label className="text-xs">CSR company CIN</Label>
                <Input
                  className="font-mono max-w-[280px]"
                  value={csrCin}
                  onChange={(e) => setCsrCin(e.target.value.toUpperCase())}
                  placeholder="U85100KA2024NPL123456"
                />
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* 80G + remarks */}
        {!isAnonymous ? (
          <Card>
            <CardContent className="grid gap-4 p-5 md:grid-cols-2">
              <div className="flex items-center gap-2">
                <Checkbox id="is80g" checked={is80G} onCheckedChange={(v) => setIs80G(!!v)} />
                <Label htmlFor="is80g" className="text-sm flex items-center gap-1">
                  <IconShieldCheck size={14} /> 80G eligible
                </Label>
              </div>
              <div>
                <Label className="text-xs">Remarks</Label>
                <Textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>

      {/* Right column — preview + sticky submit */}
      <aside className="lg:sticky lg:top-4 self-start space-y-3">
        <Card>
          <CardHeader>
            <CardTitle>Preview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <p className="text-[10px] uppercase tracking-[0.16em] text-ink-subtle">Donor</p>
              <p className="font-display text-lg">
                {effectiveDonor?.name ?? <span className="italic text-ink-subtle">—</span>}
              </p>
              {effectiveDonor?.pan ? (
                <p className="font-mono text-xs text-ink-muted">{effectiveDonor.pan}</p>
              ) : null}
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.16em] text-ink-subtle">Amount</p>
              <p className="font-display text-3xl">
                {amountNum > 0 ? formatINRWithSymbol(amountStr, { paise: true }) : "—"}
              </p>
              {amountNum > 0 ? (
                <p className="text-xs italic text-ink-muted">{inrInWords(amountStr)}</p>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <span className="text-ink-subtle">Date</span>
              <span className="text-right font-mono">{formatIST(donationDate)}</span>
              <span className="text-ink-subtle">Mode</span>
              <span className="text-right">{MODE_LABELS[mode]}</span>
              <span className="text-ink-subtle">Purpose</span>
              <span className="text-right">{purpose}</span>
              <span className="text-ink-subtle">80G</span>
              <span className="text-right">{isAnonymous ? "—" : is80G ? "Yes" : "No"}</span>
            </div>
            <p className="text-[10px] text-ink-subtle">Receipt assigned on save.</p>
          </CardContent>
        </Card>

        <div className="rounded-md border border-border bg-surface p-3 flex items-center justify-between gap-2">
          <p className="text-[11px] text-ink-subtle">FY {fy} · receipt assigned on save</p>
          <Button type="submit" disabled={submit.isExecuting}>
            {submit.isExecuting ? "Saving…" : "Save & generate receipt"}
          </Button>
        </div>
      </aside>
    </form>
  );
}

function AnonymousMeter({
  total,
  limit,
  pct,
}: {
  total: number;
  limit: number;
  pct: number;
}) {
  const tone =
    pct >= 100
      ? "bg-[color:var(--danger)]"
      : pct >= 80
        ? "bg-[color:var(--warning)]"
        : "bg-primary";
  return (
    <div className="w-48 shrink-0">
      <p className="text-[10px] text-ink-subtle">
        {formatINRWithSymbol(String(total), { paise: false })} of{" "}
        {formatINRWithSymbol(String(limit), { paise: false })}
      </p>
      <div className="mt-1 h-1.5 rounded-full bg-surface-sunken overflow-hidden">
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-[10px] text-ink-subtle">Section 115BBC limit</p>
    </div>
  );
}
