import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatINRWithSymbol, inrInWords } from "@/lib/format/inr";
import { formatIST } from "@/lib/format/date";

export const metadata: Metadata = { title: "Design system — Rakshana" };

const COLOUR_TOKENS = [
  { name: "canvas", description: "Warm paper background" },
  { name: "surface", description: "Cards & panels" },
  { name: "surface-sunken", description: "Sidebar, secondary surfaces" },
  { name: "ink", description: "Primary text" },
  { name: "ink-muted", description: "Secondary text" },
  { name: "ink-subtle", description: "Tertiary text" },
  { name: "primary", description: "Trust green — actions, links" },
  { name: "primary-hover", description: "Primary hover state" },
  { name: "primary-soft", description: "Primary tinted bg" },
  { name: "accent", description: "Saffron — used sparingly" },
  { name: "accent-soft", description: "Accent tinted bg" },
  { name: "success", description: "Saved, approved" },
  { name: "warning", description: "Action needed" },
  { name: "danger", description: "Errors, destructive" },
  { name: "info", description: "Informational" },
  { name: "border", description: "Default border" },
  { name: "border-strong", description: "Heavy divider" },
];

const SAMPLE_DONATIONS = [
  { ref: "RKS/2025-26/0001", date: "2025-04-12", donor: "Ananya Iyer", mode: "UPI", amount: 11_000 },
  { ref: "RKS/2025-26/0002", date: "2025-05-03", donor: "Infosys Foundation", mode: "NEFT/RTGS", amount: 1_84_32_500 },
  { ref: "RKS-FC/2025-26/0001", date: "2025-05-15", donor: "Amit Patel (UK)", mode: "Cheque", amount: 25_000 },
  { ref: "RKS/2025-26/0003", date: "2025-05-18", donor: "Anonymous Donor", mode: "Cash", amount: 5_100 },
];

function ColourSwatch({ token, description }: { token: string; description: string }) {
  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <div
        className="h-14 rounded-sm border border-border/60"
        style={{ background: `var(--${token})` }}
      />
      <p className="mt-2 font-mono text-xs">--{token}</p>
      <p className="text-[11px] text-ink-muted">{description}</p>
    </div>
  );
}

function ModeChip({ mode }: { mode: "Cash" | "Cheque" | "NEFT/RTGS" | "UPI" | "In-kind" }) {
  const tone = {
    Cash:       "bg-[color:var(--warning)]/12 text-[color:var(--warning)]",
    Cheque:     "bg-[color:var(--info)]/12 text-[color:var(--info)]",
    "NEFT/RTGS": "bg-[color:var(--success)]/14 text-[color:var(--success)]",
    UPI:        "bg-primary-soft text-primary",
    "In-kind":  "bg-accent-soft text-accent",
  }[mode];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${tone}`}
    >
      {mode}
    </span>
  );
}

export default function DesignSystemPage() {
  return (
    <main className="min-h-dvh bg-canvas px-8 py-12">
    <div className="mx-auto max-w-6xl space-y-12">
      <header>
        <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">
          Internal · visual contract
        </p>
        <h1
          className="mt-1 font-display text-4xl text-ink"
          style={{ fontVariationSettings: "'opsz' 36" }}
        >
          Rakshana design system
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-ink-muted">
          Every component must appear on this page before it ships elsewhere.
          If you find a colour, font, or chip in the app that&apos;s not here,
          either delete it or add it here first.
        </p>
      </header>

      {/* ---------- Colour ---------- */}
      <section>
        <h2 className="font-display text-2xl">Colour tokens</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Toggle the theme in the topbar to see the dark palette. Tokens are
          declared in <code className="font-mono text-xs">src/app/globals.css</code>.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">
          {COLOUR_TOKENS.map((t) => (
            <ColourSwatch key={t.name} token={t.name} description={t.description} />
          ))}
        </div>
      </section>

      <Separator />

      {/* ---------- Typography ---------- */}
      <section>
        <h2 className="font-display text-2xl">Typography</h2>
        <div className="mt-5 space-y-4 rounded-lg border border-border bg-surface p-6">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">H1 · Fraunces display</p>
            <p className="font-display text-5xl text-ink" style={{ fontVariationSettings: "'opsz' 48" }}>
              For trusts that mean business.
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">H2 · Fraunces display</p>
            <p className="font-display text-3xl text-ink">
              Donations, compliance, calm.
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">H3 · Inter Tight</p>
            <p className="text-2xl font-semibold text-ink">Inter Tight handles UI headings.</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">Body · Inter Tight</p>
            <p className="text-base text-ink-muted">
              The quick brown fox jumps over the lazy dog. ₹1,84,32,500 received from
              Infosys Foundation on 03/05/2025 (FY 2025–26).
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">Mono · JetBrains Mono — for money & codes</p>
            <p className="font-mono text-base tabular-nums">
              RKS/2025-26/0042 &nbsp; ₹1,23,45,678.00 &nbsp; PAN ABCDE1234F
            </p>
          </div>
        </div>
      </section>

      <Separator />

      {/* ---------- Buttons ---------- */}
      <section>
        <h2 className="font-display text-2xl">Buttons</h2>
        <div className="mt-5 flex flex-wrap gap-3 rounded-lg border border-border bg-surface p-6">
          <Button>Record donation</Button>
          <Button variant="secondary">Save draft</Button>
          <Button variant="outline">Cancel</Button>
          <Button variant="ghost">Filter</Button>
          <Button variant="destructive">Cancel donation</Button>
          <Button disabled>Disabled</Button>
          <Button size="sm" variant="outline">Small</Button>
        </div>
      </section>

      {/* ---------- Inputs ---------- */}
      <section>
        <h2 className="font-display text-2xl">Inputs</h2>
        <div className="mt-5 grid gap-5 rounded-lg border border-border bg-surface p-6 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="ds-default">Default</Label>
            <Input id="ds-default" placeholder="Donor name" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ds-focus">Focused (click in)</Label>
            <Input id="ds-focus" placeholder="Try clicking" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ds-error">Error</Label>
            <Input
              id="ds-error"
              defaultValue="invalid@"
              aria-invalid
              className="border-[color:var(--danger)] focus-visible:ring-[color:var(--danger)]/40"
            />
            <p className="text-xs text-[color:var(--danger)]">
              Email looks incomplete.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ds-disabled">Disabled</Label>
            <Input id="ds-disabled" disabled defaultValue="locked" />
          </div>
        </div>
      </section>

      <Separator />

      {/* ---------- Mode chips ---------- */}
      <section>
        <h2 className="font-display text-2xl">Donation mode chips</h2>
        <p className="mt-1 text-sm text-ink-muted">
          One chip per payment mode, used on the donations table and receipts.
        </p>
        <div className="mt-5 flex flex-wrap gap-3 rounded-lg border border-border bg-surface p-6">
          <ModeChip mode="Cash" />
          <ModeChip mode="Cheque" />
          <ModeChip mode="NEFT/RTGS" />
          <ModeChip mode="UPI" />
          <ModeChip mode="In-kind" />
        </div>
      </section>

      {/* ---------- Receipt card ---------- */}
      <section>
        <h2 className="font-display text-2xl">Receipt card</h2>
        <p className="mt-1 text-sm text-ink-muted">
          The print-friendly receipt template. Sample data — not from the database.
        </p>
        <div className="mt-5 rounded-lg border border-border-strong bg-surface p-8 shadow-[var(--shadow-md)]">
          <div className="flex items-start justify-between border-b border-dashed border-border pb-4">
            <div>
              <p className="font-display text-2xl text-ink">Rakshana Trust</p>
              <p className="text-xs text-ink-muted">
                123 Lavelle Road, Bengaluru 560001 · PAN AAATR1234F
              </p>
              <p className="text-xs text-ink-muted">
                80G Reg AABCD/2024-25 · 12A AABCD/2024-25
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-[0.18em] text-ink-subtle">
                Receipt
              </p>
              <p className="font-mono text-base">RKS/2025-26/0042</p>
              <p className="font-mono text-xs text-ink-muted">
                {formatIST(new Date(), "dd MMM yyyy")}
              </p>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-ink-subtle">
                Received from
              </p>
              <p className="text-ink">Ananya Iyer</p>
              <p className="text-xs text-ink-muted">PAN ABCDE1234F</p>
              <p className="text-xs text-ink-muted">
                12-A Indiranagar, Bengaluru, Karnataka 560038
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-ink-subtle">Mode</p>
              <ModeChip mode="UPI" />
              <p className="mt-1 font-mono text-xs text-ink-muted">UTR 432589127643</p>
            </div>
            <div className="col-span-2">
              <p className="text-[10px] uppercase tracking-[0.18em] text-ink-subtle">
                Amount
              </p>
              <p className="font-mono text-3xl tabular-nums text-ink">
                {formatINRWithSymbol(11_000)}
              </p>
              <p className="text-xs italic text-ink-muted">
                {inrInWords(11_000)}
              </p>
            </div>
          </div>

          <p className="mt-6 text-xs text-ink-muted">
            Eligible for deduction under Section 80G(5)(iii) of the Income Tax
            Act, 1961.
          </p>
        </div>
      </section>

      <Separator />

      {/* ---------- Table ---------- */}
      <section>
        <h2 className="font-display text-2xl">Tabular data</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Numbers use JetBrains Mono with tabular-nums so columns align.
        </p>
        <div className="mt-5 overflow-hidden rounded-lg border border-border bg-surface">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Receipt</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Donor</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {SAMPLE_DONATIONS.map((d) => (
                <TableRow key={d.ref}>
                  <TableCell className="font-mono text-xs">{d.ref}</TableCell>
                  <TableCell className="text-sm">{formatIST(d.date)}</TableCell>
                  <TableCell className="text-sm">{d.donor}</TableCell>
                  <TableCell>
                    <ModeChip mode={d.mode as Parameters<typeof ModeChip>[0]["mode"]} />
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatINRWithSymbol(d.amount)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
    </main>
  );
}
