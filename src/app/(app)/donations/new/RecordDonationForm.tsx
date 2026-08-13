"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import {
  IconSearch,
  IconPlus,
  IconMinus,
  IconX,
  IconUser,
  IconShieldCheck,
  IconChevronDown,
} from "@tabler/icons-react";
import { Decimal } from "decimal.js";
import { recordDonation } from "../actions";
import { searchDonors } from "./donor-search";
import { DonorQuickCreate } from "./DonorQuickCreate";
import { Card, CardContent } from "@/components/ui/card";
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
import { FieldError } from "@/components/patterns/FieldError";
import { actionErrorMessage, actionFieldErrors } from "@/lib/actions/action-error";
import { formatINRWithSymbol, inrInWords } from "@/lib/format/inr";
import { formatIST } from "@/lib/format/date";
import { DONATION_MODES, DONATION_PURPOSES, IN_KIND_VALUATION_METHODS } from "@/lib/schemas/donation";
import { MANDATORY_PAN_THRESHOLD } from "@/lib/constants/tax";

type Donor = {
  /** null while the donor is only filled in, not yet written — see DonorQuickCreate. */
  id: string | null;
  name: string;
  donorType: string;
  pan: string | null;
  is80GEligible: boolean;
  isFcraEligible: boolean;
  isAnonymousBucket?: boolean;
  lastDonationDate: string | null;
  lifetime: string;
  /** Present only for a not-yet-saved donor; posted so recordDonation can
      create donor and donation in one transaction. */
  draft?: Record<string, unknown>;
};

type BankAcct = {
  id: string;
  bankName: string;
  accountNumber: string;
  purpose: string;
  isPrimary: boolean;
};

type ProjectItem = { id: string; code: string; name: string };

type SponsorshipItem = {
  id: string;
  category: string;
  label: string;
  amount: string;
  unitNoun: string;
  allowsQuantity: boolean;
};

/** A picked catalogue row. Amounts stay strings — Decimal does the maths. */
type PickedLine = { itemId: string; label: string; unitAmount: string; quantity: number };

const SPONSORSHIP_CATEGORY_LABELS: Record<string, string> = {
  CHILDREN_EDUCATION: "Children's education",
  COMMUNITY_TRAINING: "Community training",
};

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

/**
 * Fields that live behind the "More options" disclosure. A validation error on
 * any of them has to force the disclosure open, otherwise the user is told to
 * fix something they cannot see.
 */
const ADVANCED_FIELDS = new Set([
  "donationDate",
  "mode",
  "paymentRef",
  "paymentDate",
  "bankAccountId",
  "purpose",
  "projectId",
  "isCsr",
  "csrCompanyCin",
  "isFcra",
  "is80GEligible",
  "isInKind",
  "inKindDescription",
  "inKindValuationMethod",
  "remarks",
]);

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
  sponsorshipItems,
  anonymous,
  initialDonor,
}: {
  fy: string;
  bankAccounts: BankAcct[];
  projects: ProjectItem[];
  sponsorshipItems: SponsorshipItem[];
  anonymous: Anonymous | null;
  initialDonor: Donor | null;
}) {
  const router = useRouter();

  const [isAnonymous, setIsAnonymous] = React.useState(false);
  const [moreOpen, setMoreOpen] = React.useState(false);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

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

  // ----- Quick-create panel -----
  const [quickOpen, setQuickOpen] = React.useState(false);
  const [quickName, setQuickName] = React.useState("");

  // ----- Form fields — defaults make the collapsed path valid on its own -----
  const [donationDate, setDonationDate] = React.useState(todayIso());
  const [amountStr, setAmountStr] = React.useState("");

  // ----- Sponsorship quick-select -----
  const [lines, setLines] = React.useState<PickedLine[]>([]);
  const linesTotal = lines.reduce(
    (sum, l) => sum.plus(new Decimal(l.unitAmount).times(l.quantity)),
    new Decimal(0),
  );
  // Picked items own the amount; with none, free entry is untouched.
  const amount = lines.length > 0 ? linesTotal.toFixed(2) : amountStr;
  const amountNum = Number(amount) || 0;

  function addLine(item: SponsorshipItem) {
    setLines((prev) => {
      const existing = prev.find((l) => l.itemId === item.id);
      if (existing) {
        if (!item.allowsQuantity) return prev;
        return prev.map((l) => (l.itemId === item.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [
        ...prev,
        { itemId: item.id, label: item.label, unitAmount: item.amount, quantity: 1 },
      ];
    });
  }

  function setQuantity(itemId: string, quantity: number) {
    setLines((prev) =>
      prev.map((l) => (l.itemId === itemId ? { ...l, quantity: Math.max(1, quantity) } : l)),
    );
  }
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

  // Picking a foreign-source donor re-filters the bank list, which can strand
  // the current selection outside it. Fall back to the primary of whatever is
  // visible so the collapsed path still submits a creditable account.
  const effectiveBankId = visibleBanks.some((b) => b.id === bankAccountId)
    ? bankAccountId
    : (visibleBanks.find((b) => b.isPrimary)?.id ?? visibleBanks[0]?.id ?? "");

  const panWarning =
    effectiveDonor &&
    !effectiveDonor.isAnonymousBucket &&
    !effectiveDonor.pan &&
    amountNum > MANDATORY_PAN_THRESHOLD;

  // ----- Anonymous meter -----
  const anonTotal = Number(anonymous?.fyTotal ?? 0) + (isAnonymous ? amountNum : 0);
  const anonLimit = Number(anonymous?.limit ?? 0);
  const anonPct = anonLimit > 0 ? Math.min(100, (anonTotal / anonLimit) * 100) : 0;

  function reportErrors(errors: Record<string, string>) {
    setFieldErrors(errors);
    const fields = Object.keys(errors);
    if (fields.length === 0) return;
    if (fields.some((f) => ADVANCED_FIELDS.has(f))) setMoreOpen(true);
    toast.error(errors[fields[0]]);
  }

  const submit = useAction(recordDonation, {
    onSuccess: ({ data }) => {
      if (!data?.ok) return;
      toast.success(`Donation recorded · receipt ${data.receiptNumber}`, {
        action: {
          label: "View",
          onClick: () => router.push(`/donations?fy=${fy}&open=${data.donationId}`),
        },
      });
      // Reset for "Record another"; keep date + mode pre-filled.
      setAmountStr("");
      setLines([]);
      setPaymentRef("");
      setRemarks("");
      setFieldErrors({});
    },
    onError: ({ error }) => {
      // Zod field errors are surfaced in place (and the disclosure is opened)
      // so the user sees WHICH field is wrong — e.g. UPI/NEFT need a payment
      // reference. A generic "Could not record donation" hides that.
      const errors = actionFieldErrors(error);
      if (Object.keys(errors).length > 0) {
        reportErrors(errors);
        return;
      }
      setFieldErrors({});
      toast.error(actionErrorMessage(error, "Could not record donation"));
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!effectiveDonor) {
      reportErrors({ donorId: "Pick a donor" });
      return;
    }
    if (amountNum <= 0) {
      reportErrors({ amount: "Enter an amount" });
      return;
    }
    setFieldErrors({});
    submit.execute({
      // An unsaved donor travels as a payload, not an id — the server
      // creates it inside the donation transaction so an abandoned form
      // never leaves a donor behind.
      ...(effectiveDonor.id
        ? { donorId: effectiveDonor.id }
        : { newDonor: effectiveDonor.draft as never }),
      donationDate: new Date(donationDate),
      amount,
      lineItems: lines.map((l) => ({
        sponsorshipItemId: l.itemId,
        label: l.label,
        unitAmount: l.unitAmount,
        quantity: l.quantity,
      })),
      mode,
      bankAccountId: showBankField ? effectiveBankId : null,
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

  // Standing in for the old preview panel: the settings hidden by the collapse,
  // in one line, so nothing about the donation is invisible while collapsed.
  const collapsedSummary = [
    donationDate === todayIso() ? "Today" : formatIST(donationDate),
    MODE_LABELS[mode],
    purpose.replace(/_/g, " "),
    isAnonymous ? "anonymous" : is80G ? "80G" : "no 80G",
    showFcraNote ? "FCRA" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-2xl space-y-4">
      <Card>
        <CardContent className="space-y-6 p-5">
          {/* Donor */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-[0.16em] text-ink-subtle">Donor</Label>
            {isAnonymous ? (
              <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-canvas p-3">
                <div>
                  <p className="font-display text-lg">Anonymous Donations</p>
                  <p className="mt-1 text-xs text-ink-muted">
                    {anonymous
                      ? "Routes to the system Anonymous bucket. PAN and 80G are skipped."
                      : "No Anonymous Donations bucket exists yet — seed one first."}
                  </p>
                </div>
                <AnonymousMeter total={anonTotal} limit={anonLimit} pct={anonPct} />
              </div>
            ) : donor ? (
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
                          setQuickOpen(true);
                          setDonorOpen(false);
                          setQuickName(donorQuery);
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
            <FieldError msg={fieldErrors.donorId} />

            {quickOpen && !isAnonymous ? (
              <DonorQuickCreate
                initialName={quickName}
                onCancel={() => setQuickOpen(false)}
                onCreated={(created) => {
                  setDonor({
                    ...created,
                    is80GEligible: true,
                    isFcraEligible: false,
                    lastDonationDate: null,
                    lifetime: "0",
                  });
                  setQuickOpen(false);
                  setDonorOpen(false);
                  setQuickName("");
                }}
              />
            ) : null}
          </div>

          {/* Sponsorship menu — the fast path. Free entry stays below. */}
          <SponsorshipPicker
            items={sponsorshipItems}
            lines={lines}
            onAdd={addLine}
            onQuantity={setQuantity}
            onRemove={(itemId) => setLines((prev) => prev.filter((l) => l.itemId !== itemId))}
            onClear={() => setLines([])}
          />

          {/* Amount */}
          <div className="space-y-1">
            <Label
              htmlFor="amount"
              className="text-xs uppercase tracking-[0.16em] text-ink-subtle"
            >
              Amount
            </Label>
            <div className="flex items-baseline gap-2">
              <span className="font-display text-3xl text-ink-subtle">₹</span>
              <Input
                id="amount"
                inputMode="decimal"
                placeholder="0"
                value={amount}
                readOnly={lines.length > 0}
                onChange={(e) => setAmountStr(e.target.value)}
                className={`font-display text-3xl h-14 max-w-[260px] ${
                  lines.length > 0 ? "bg-surface-sunken text-ink-muted" : ""
                }`}
              />
            </div>
            {amountNum > 0 ? (
              <p className="text-xs italic text-ink-muted">{inrInWords(amount)}</p>
            ) : null}
            <FieldError msg={fieldErrors.amount} />
            {panWarning ? (
              <p className="rounded-md border border-[color:var(--warning)]/30 bg-[color:var(--warning)]/8 px-3 py-2 text-xs text-[color:var(--warning)]">
                PAN required for 80G eligibility above ₹
                {MANDATORY_PAN_THRESHOLD.toLocaleString("en-IN")}.
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* Everything else. Defaults (today · UPI · General · 80G · primary bank)
          keep the collapsed path valid with zero extra input. */}
      <details
        open={moreOpen}
        onToggle={(e) => setMoreOpen(e.currentTarget.open)}
        className="group rounded-md border border-border bg-surface"
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
          <span className="text-sm font-medium">More options</span>
          <span className="flex items-center gap-2 text-xs text-ink-subtle">
            {collapsedSummary}
            <IconChevronDown size={14} className="transition-transform group-open:rotate-180" />
          </span>
        </summary>

        <div className="space-y-5 border-t border-border p-4">
          {/* Anonymous */}
          <div className="flex items-center gap-3">
            <Checkbox
              id="anon"
              checked={isAnonymous}
              onCheckedChange={(v) => setIsAnonymous(!!v)}
            />
            <Label htmlFor="anon" className="text-sm">
              Anonymous donation
              <span className="ml-1 font-normal text-ink-subtle">
                — routes to the Anonymous bucket, skips PAN and 80G
              </span>
            </Label>
          </div>

          {/* Date */}
          <div>
            <Label className="text-xs">Date</Label>
            <div className="mt-1 flex flex-wrap items-center gap-2">
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
              <Input
                type="date"
                value={donationDate}
                onChange={(e) => setDonationDate(e.target.value)}
                className="max-w-[180px]"
              />
            </div>
            <FieldError msg={fieldErrors.donationDate} />
          </div>

          {/* Mode */}
          <div>
            <Label className="text-xs">Mode</Label>
            <div className="mt-1 flex flex-wrap gap-2">
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
            <FieldError msg={fieldErrors.mode} />
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
              <FieldError msg={fieldErrors.paymentRef} />
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
                <FieldError msg={fieldErrors.inKindDescription} />
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
                <FieldError msg={fieldErrors.inKindValuationMethod} />
              </div>
            </div>
          ) : null}

          {showBankField ? (
            <div>
              <Label className="text-xs">Bank account credited</Label>
              <Select value={effectiveBankId} onValueChange={(v) => v && setBankAccountId(v)}>
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
              <FieldError msg={fieldErrors.bankAccountId} />
            </div>
          ) : null}

          {showFcraNote ? (
            <p className="text-[11px] text-[color:var(--info)]">
              Foreign-source donor — recorded as FCRA, bank list filtered to FCRA accounts.
            </p>
          ) : null}

          {/* Purpose */}
          <div>
            <Label className="text-xs">Purpose</Label>
            <div className="mt-1 flex flex-wrap gap-2">
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
            <FieldError msg={fieldErrors.purpose} />
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
                  <Link href="/projects/new" className="text-primary hover:underline">
                    Projects
                  </Link>{" "}
                  first.
                </p>
              ) : null}
              <FieldError msg={fieldErrors.projectId} />
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
              <FieldError msg={fieldErrors.csrCompanyCin} />
            </div>
          ) : null}

          {/* 80G + remarks */}
          <div className="grid gap-4 md:grid-cols-2">
            {!isAnonymous ? (
              <div className="flex items-center gap-2">
                <Checkbox id="is80g" checked={is80G} onCheckedChange={(v) => setIs80G(!!v)} />
                <Label htmlFor="is80g" className="text-sm flex items-center gap-1">
                  <IconShieldCheck size={14} /> 80G eligible
                </Label>
                <FieldError msg={fieldErrors.is80GEligible} />
              </div>
            ) : null}
            <div>
              <Label className="text-xs">Remarks</Label>
              <Textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
              <FieldError msg={fieldErrors.remarks} />
            </div>
          </div>
        </div>
      </details>

      <div className="sticky bottom-0 flex items-center justify-between gap-2 rounded-md border border-border bg-surface p-3">
        <p className="text-[11px] text-ink-subtle">
          FY {fy} · {amountNum > 0 ? formatINRWithSymbol(amount, { paise: true }) : "—"} · receipt
          assigned on save
        </p>
        <Button type="submit" disabled={submit.isExecuting}>
          {submit.isExecuting ? "Saving…" : "Save & generate receipt"}
        </Button>
      </div>
    </form>
  );
}

/**
 * The trust's fixed menu. Tapping a row adds a line; the lines drive the
 * Amount field above, which is why every total here is Decimal maths and not
 * arithmetic on floats.
 */
function SponsorshipPicker({
  items,
  lines,
  onAdd,
  onQuantity,
  onRemove,
  onClear,
}: {
  items: SponsorshipItem[];
  lines: PickedLine[];
  onAdd: (item: SponsorshipItem) => void;
  onQuantity: (itemId: string, quantity: number) => void;
  onRemove: (itemId: string) => void;
  onClear: () => void;
}) {
  if (items.length === 0) return null;

  const categories = new Map<string, SponsorshipItem[]>();
  for (const item of items) {
    const bucket = categories.get(item.category);
    if (bucket) bucket.push(item);
    else categories.set(item.category, [item]);
  }
  const byId = new Map(items.map((i) => [i.id, i]));
  const pickedIds = new Set(lines.map((l) => l.itemId));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <Label className="text-xs uppercase tracking-[0.16em] text-ink-subtle">Sponsorships</Label>
        {lines.length > 0 ? (
          <button
            type="button"
            onClick={onClear}
            className="text-[11px] text-primary hover:underline"
          >
            Clear items
          </button>
        ) : null}
      </div>

      {lines.length > 0 ? (
        <ul className="space-y-2 rounded-[14px] bg-surface-sunken p-2.5">
          {lines.map((line) => {
            const unitNoun = byId.get(line.itemId)?.unitNoun;
            const allowsQuantity = byId.get(line.itemId)?.allowsQuantity ?? true;
            return (
              <li key={line.itemId} className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{line.label}</span>
                {allowsQuantity ? (
                  <QuantityStepper
                    label={line.label}
                    quantity={line.quantity}
                    unitNoun={unitNoun}
                    onChange={(q) => onQuantity(line.itemId, q)}
                  />
                ) : null}
                <span className="w-24 shrink-0 text-right font-mono text-sm tabular-nums text-ink">
                  {formatINRWithSymbol(new Decimal(line.unitAmount).times(line.quantity), {
                    paise: false,
                  })}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${line.label}`}
                  onClick={() => onRemove(line.itemId)}
                >
                  <IconX size={14} />
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}

      <div className="space-y-3">
        {[...categories].map(([category, categoryItems]) => (
          <div key={category} className="space-y-1.5">
            <p className="text-[11px] uppercase tracking-[0.14em] text-ink-subtle">
              {SPONSORSHIP_CATEGORY_LABELS[category] ?? category.replace(/_/g, " ")}
            </p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {categoryItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onAdd(item)}
                  className={`flex items-center justify-between gap-3 rounded-[12px] px-3 py-2.5 text-left transition-colors ${
                    pickedIds.has(item.id)
                      ? "bg-primary-soft text-primary"
                      : "bg-surface-sunken text-ink hover:bg-primary-soft hover:text-primary"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate text-sm">{item.label}</span>
                  <span className="shrink-0 font-mono text-xs tabular-nums">
                    {formatINRWithSymbol(item.amount, { paise: false })}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function QuantityStepper({
  label,
  quantity,
  unitNoun,
  onChange,
}: {
  label: string;
  quantity: number;
  unitNoun?: string;
  onChange: (quantity: number) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <div className="flex items-center rounded-full bg-surface shadow-[var(--shadow-sm)]">
        <StepperButton
          ariaLabel={`Decrease ${label}`}
          disabled={quantity <= 1}
          onClick={() => onChange(quantity - 1)}
        >
          <IconMinus size={13} />
        </StepperButton>
        <input
          inputMode="numeric"
          aria-label={`Quantity for ${label}`}
          value={quantity}
          // Selecting on focus keeps direct typing working: the first keystroke
          // replaces the value instead of appending to it.
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => onChange(parseInt(e.target.value, 10) || 1)}
          className="w-9 bg-transparent text-center font-mono text-sm tabular-nums text-ink outline-none"
        />
        <StepperButton ariaLabel={`Increase ${label}`} onClick={() => onChange(quantity + 1)}>
          <IconPlus size={13} />
        </StepperButton>
      </div>
      {unitNoun ? (
        <span className="hidden text-[11px] text-ink-subtle sm:inline">
          {quantity === 1 ? unitNoun : `${unitNoun}s`}
        </span>
      ) : null}
    </div>
  );
}

function StepperButton({
  ariaLabel,
  disabled,
  onClick,
  children,
}: {
  ariaLabel: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-full text-ink-muted hover:text-primary disabled:opacity-30"
    >
      {children}
    </button>
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
