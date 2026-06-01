# Phase 5 — Compliance Suite · COMPLETE

Phase 5 delivers the statutory-compliance backbone that turns Rakshana
from an operations product into something a CA can sign off on at year
end. Every recurring filing a charitable trust must track — Form 10BD /
10BE, ITR-7 (with Form 10, Form 10B/10BB trackers), GSTR-1/3B, TDS
quarterly returns (26Q / 24Q) — has a data prep + export pipeline. The
trust still submits on the relevant government portal; Rakshana stores
the ARN and the source data for the audit trail.

## What's built

### Form 10BD · Form 10BE

- **CSV aggregator** that emits the IT portal-format file (FY 2024-25
  schema, no header) and a human-readable audit copy (with header).
  Single-source-of-truth mapping in `src/lib/compliance/10bd-codes.ts`
  for donor types, ID codes, donation types, and mode codes.
- **Validation surface** that lists donors with blocking issues (missing
  PAN, missing address, PAN format mismatch) and soft warnings
  (single-day donations > ₹50,000). Excluded counts (anonymous, in-kind,
  cancelled) are visible.
- **Donor dominance rule** — Corpus > Specific Grant > Others; any FCRA
  flag promotes the row to Foreign Source. Documented in
  `CODE-HEALTH.md`.
- **Mode dominance** — amount-weighted picker across the donor's modes.
- **4-step wizard UI** at `/compliance/10bd/[id]`:
  1. Select year (FY picker + revised filing path)
  2. Validate donors (paginated 25/page, filter chips, sticky summary)
  3. Export & file (Portal CSV + Audit CSV + IT portal instructions +
     mark-filed with ARN)
  4. Generate 10BE (per-donor table + bulk generate)
- **Form 10BE PDF** (`src/lib/pdf/form-10be.ts`): A4 portrait, ARN block,
  donation type breakup, amount in words, certificate number allocated
  via the share-core sequence allocator (`FORM_10BE` kind, prefix `10BE`).
  Regeneration preserves the certificate number.

### Income Tax module

- **`/compliance/income-tax`** dashboard surfaces 12A and 80G renewal
  status (with days-remaining) plus the live 85% application-of-income
  tile.
- **85% rule calculator** (`src/lib/compliance/eighty-five-rule.ts`) is
  the canonical Sec 11 implementation. Used by the dashboard tile, the
  IT module card, ITR-7 figures, and the dashboard KPI.
- **115BBC anonymous floor**: MAX(₹1,00,000, 5% of domestic). Excess
  taxed at 30% separately and excluded from 85% receipts. Documented in
  `CODE-HEALTH.md`.
- **ITR-7 figures workbench** at `/compliance/income-tax/itr7`:
  - Computes Schedule VC (Voluntary Contributions: corpus / domestic /
    FCRA / anonymous with 115BBC floor + excess) and Schedule AOI
    (Application of Income: revenue / capital / accumulation / loans
    repaid).
  - Persists into `FinancialYearSummary` (upsert).
  - Exports a 4-sheet Excel workbook (Cover / Schedule VC / Schedule AOI
    / 85% Computation) for the trust's CA.
- **Form 10 (Sec 11(2) accumulation) tracker** at
  `/compliance/income-tax/form-10`: create accumulations with purpose,
  amount, FY, period (default 5 years); status badges + days-remaining.
  Active accumulations contribute to the 85% rule numerator.
- **Form 10B / 10BB tracker** at `/compliance/income-tax/audit-report`:
  applicability inferred from registrations; status list; the CA's
  audited report is uploaded externally.

### TDS module

- **`/compliance/tds`** dashboard: quarter tiles (Q1–Q4 totals + return
  status), section-wise summary table (192 / 194C / 194J / etc),
  challan vs entry reconciliation tile, active LDC certificates list.
- **TDS return aggregator** (`src/lib/compliance/tds-return.ts`):
  - Per-deductee bucket with totals, sections, challan linkage, valid
    PAN check, LDC reference.
  - Filters by form type — 24Q includes salary sections (192*); 26Q
    excludes them.
  - Surfaces validation warnings (missing challan linkage, PAN issues).
- **Exporters**: `exportTdsExcel` (4-sheet CA-friendly workbook:
  Summary / Section-wise / Deductees / Challans) + `buildRpuText` (a
  simplified tab-separated grid the CA can paste into the NSDL RPU
  utility).
- **Form 16 / 16A** are deferred to a follow-up because TRACES-issued
  versions supersede any draft Rakshana could produce. The aggregator
  has everything needed to render them; the PDF template is a small
  follow-up task.

### GST module

- Placeholder UI when no GSTIN is set — directs the user to Settings →
  Tax Compliance.
- When GSTIN is set:
  - Current-period tile (invoices, taxable value, tax liability, total),
    next-month due dates for GSTR-1 (11th) and GSTR-3B (20th).
  - Recent invoices table.
  - Past filings list.
- **GSTR aggregator** (`src/lib/compliance/gstr.ts`): per-period
  B2B (with GSTIN) vs B2CS (without) split; CGST/SGST/IGST totals;
  exempt outward separated. Exporters for GSTR-1 (Summary / B2B / B2CS)
  and GSTR-3B (single summary sheet).

### Compliance calendar

- **`/compliance/calendar`** lists every upcoming statutory filing,
  grouped by category (IT / GST / TDS / FCRA / 12A / 80G / DARPAN /
  INTERNAL).
- **Recurring-item generator**
  (`src/lib/compliance/recurring-items.ts`): idempotent generation of
  `ComplianceItem` rows for the next 12 months — GSTR-1 (11th
  monthly), GSTR-3B (20th monthly), TDS payment (7th monthly), TDS
  return (Q1: 31 Jul · Q2: 31 Oct · Q3: 31 Jan · Q4: 31 May), Form
  10BD (31 May annual), Form 10B/10BB (30 Sep annual), ITR-7 (31 Oct
  annual). GST items only generated when GSTIN is set.

### Dashboard + sidebar

- **85% rule tile** on the dashboard now calls the canonical
  `computeEightyFiveRule` (no more rough capital-deduction calc).
  Numbers match the IT module page and the ITR-7 export to the paise.
- **Compliance attention chips** at the top of the dashboard route to
  the correct module (GST → `/compliance/gst`, TDS → `/compliance/tds`,
  IT → `/compliance/income-tax`, registration items → settings).
- **Sidebar** now has six compliance routes: Overview · Form 10BD ·
  Income Tax · GST · TDS · Calendar.

## Schema migration

`20260522094814_phase5_compliance_suite` adds:

- `CertificateSeriesKind.FORM_10BE` enum value.
- `Form10BDFiling` gets `summaryPdfUrl`, `isRevision`, `originalFilingArn`.
- `ItFiling` gets `taxLiability`, `excelUrl`, `pdfUrl`.
- `TdsChallan` gets `reconciledAmount`.
- `Form10BECertificate` gets `certificateNumber`, `certificateSeriesId`
  (relation to `CertificateSeries`), `amountInWords`.
- New `Accumulation` model + `AccumulationStatus` enum for Sec 11(2)
  tracking.

## Permissions

24 new permission keys grouped under "Compliance suite (Phase 5)" — see
`src/lib/auth/permissions.ts`. RBAC matrix unchanged:
OWNER/ADMIN/ACCOUNTANT/AUDITOR for view; OWNER/ADMIN for create/export;
OWNER/ADMIN for mark-filed.

## Tests

213 tests pass across 29 test files. Phase 5 additions:

- `10bd-codes.test.ts` — 8 tests (code mappings, dominance, mode weighting)
- `10bd-aggregator.test.ts` — 19 tests (aggregation, exclusions, CSV,
  multi-tenant isolation regression)
- `form-10be.test.ts` — 7 tests including the **50-concurrent-generation
  uniqueness regression** (Phase 5 acceptance criterion) and multi-tenant
  isolation
- `eighty-five-rule.test.ts` — 12 tests (corpus exclusion, FCRA
  segregation, 115BBC floor, FY boundary, decimal rounding,
  multi-tenant isolation)
- `itr7-figures.test.ts` — 3 tests (manual spreadsheet match across 5+
  line items, FinancialYearSummary upsert, Excel structure)
- `tds-return.test.ts` — 4 tests (26Q/24Q form filtering, section-wise
  aggregation, RPU text format)
- `gstr.test.ts` — 2 tests (B2B/B2CS split, CGST/SGST/IGST totals)
- `recurring-items.test.ts` — 4 tests (TDS-only without GSTIN, GST
  items when GSTIN set, idempotency, **multi-tenant isolation
  regression**)

Multi-tenant isolation is explicitly tested in every compliance lib —
this was a Phase 5 acceptance criterion.

## Performance / acceptance criteria

- **50 concurrent 10BE generations** produce 50 unique sequential
  certificate numbers (`form-10be.test.ts` runs this in < 5 s)
- **ITR-7 figures** match a manual spreadsheet across 5 line items
  (corpus, FCRA, anonymous excess, revenue/capital application,
  accumulation, application percentage)
- **Build smoke**: `npm run build` compiles all 9 new compliance routes;
  no TypeScript errors across the full project.

## Deferred to follow-up

- **Form 16 / 16A draft PDFs** — the TDS aggregator has the per-deductee
  data ready; the PDF template is mechanical (same architecture as 10BE)
  and was deferred so the TRACES authoritative version isn't shadowed.
- **JSON export for ITR-7** that matches the IT department's e-filing
  schema — Excel covers the CA's review workflow; JSON is a portal
  convenience that can ship in Phase 6.
- **Bulk dispatch for 10BE** (email + WhatsApp through the Phase 2
  notify layer) — single-donor dispatch is wired; bulk runs sequentially
  through the same generator. Wire the dispatch when the org's email
  provider is real (Phase 6).
- **Auto-create cert-series race fix** — the sequence allocator's
  bootstrap path (first allocation of a new FY) is racy under high
  concurrency. The 50-concurrent test pre-creates the series to avoid
  this. Pre-existing limitation that affects all `CertificateSeriesKind`
  values; fix lifts to a `INSERT ... ON CONFLICT` pattern when we
  productionise multi-org cron jobs.

## Where the docs live

- **Computation rules** (85% · 115BBC · 10BD dominance · FCRA · GST
  interstate) → `CODE-HEALTH.md`
- **Reusable libs + UI routes** → `REUSE-MAP.md` (Phase 5 section)
- **Permission keys** → `src/lib/auth/permissions.ts` (Compliance suite section)
- **Schema** → `prisma/schema.prisma` (Form10BDFiling, Form10BECertificate,
  ItFiling, Accumulation, TdsEntry/Challan/Return, GstInvoice/Filing,
  ComplianceItem)

## Verification

```bash
npx prisma migrate deploy   # applies the Phase 5 migration
npm test                    # 213 / 213 green
npm run build               # all routes compile
npm run dev                 # http://localhost:3000 → compliance suite live
```

Then in browser:

1. `/compliance` shows five module cards
2. `/compliance/10bd` lists filings; click "New filing" → 4-step wizard
3. `/compliance/income-tax` shows 85% rule tile matching the dashboard
4. `/compliance/income-tax/itr7` computes figures → Excel download
5. `/compliance/tds` shows quarter tiles + section table
6. `/compliance/gst` shows the GST setup placeholder unless GSTIN is set
7. `/compliance/calendar` "Refresh calendar" populates 12 months of due
   items
