# Rakshana — Reuse Map

Before you write a new component, utility, or pattern, check this list. If
the thing exists, extend it. If it doesn't, add it after you ship.

## Auth & session

- `src/auth.ts` — NextAuth v5 config. JWT strategy, credentials provider,
  Prisma adapter (uses `basePrisma`), enriched session with
  `{ id, email, name, organisationId, organisationName, role }`.
- `src/middleware.ts` — protects every route except `/login`, `/api/auth/*`,
  `/design-system`.
- `src/lib/auth/scope.ts` — `getOrgScope()` reads the session and returns
  `{ userId, organisationId, organisationName, role }`. `requireOrgScope()`
  throws on null. Wrapped in React `cache()` so multiple callers per request
  hit `auth()` once.
- `src/lib/auth/permissions.ts` — RBAC matrix, `roleHasPermission()`.
- `src/lib/auth/require-permission.ts` — `requirePermission(key)` and
  `PermissionDeniedError`. Use inside Server Actions.
- `src/components/auth/Can.tsx` — Server Component that hides children for
  users who lack the permission. UI convenience only.

## Database

- `src/lib/db/prisma-base.ts` — the raw `PrismaClient`, globally cached in
  dev. **Never import directly outside this module's two re-exports.**
- `src/lib/db/prisma.ts`:
  - `prisma` — scoped client. Use this for all domain queries.
  - `prismaUnsafe` — unscoped. **Documented uses below.**
  - Composed audit-log hook fires on every mutation of a scoped model
    (except AuditLog itself).
- `src/lib/db/scoped-models.ts` — three sets: `SCOPED_MODELS`,
  `PARENT_SCOPED_MODELS` (no `organisationId` column, tenancy enforced via
  parent), `SYSTEM_MODELS`.

### Documented `prismaUnsafe` callers

| Caller                                                       | Why                                         |
|--------------------------------------------------------------|---------------------------------------------|
| `src/auth.ts` (Prisma adapter, credentials provider)         | Auth runs before a session exists           |
| `prisma/seed.ts`                                             | CLI script, no HTTP session                 |
| `src/app/(app)/settings/organisation/page.tsx`               | Fetches the Organisation row by `scope.organisationId` (Organisation is a SYSTEM_MODEL) |
| `src/lib/db/prisma.test.ts`                                  | Test setup / teardown                        |

If you find yourself reaching for `prismaUnsafe` outside these, talk to the
plan first. Most additions belong to one of these categories: auth, seed,
test, or fetching the Organisation row.

## Formatting

- `src/lib/format/inr.ts`:
  - `formatINR(value, opts?)` — Indian grouping (lakhs, crores).
  - `formatINRWithSymbol(value, opts?)` — prepends `₹`.
  - `inrInWords(value, opts?)` — "Rupees One Lakh … only", for 80G receipts.
- `src/lib/format/date.ts`:
  - `formatIST(input, pattern?)`, `formatISTInput`, `formatISTDateTime`.
  - `parseISTInput("DD/MM/YYYY")` → UTC Date.
  - `getCurrentFY()`, `getFinancialYear(date)`, `getFinancialYearRange(fy)`.

## Forms

- React Hook Form + Zod resolver. Schemas live in `src/lib/schemas/`. The
  same schema validates the form and the Server Action — share via
  `z.infer<>`.
- `src/components/ui/form.tsx` — shadcn form primitives.
- Pattern: a `LoginForm`-style client component that wraps a Server Action
  via `useActionState`. See `src/app/(auth)/login/LoginForm.tsx`.

## UI primitives

- All shadcn components live in `src/components/ui/`. They're customised
  to Rakshana tokens via `globals.css` semantic slots — don't fork them.
- `src/components/patterns/ReadOnlyField.tsx` — `label / value` pair with
  empty-state dash. Used on the org profile screen.

## Shell

- `src/components/shell/Sidebar.tsx` — nav tree, section headers, active
  state via `usePathname`.
- `src/components/shell/TopBar.tsx` — Server Component: command palette,
  FY chip, theme toggle, notification bell (live count), user menu.
- `src/components/shell/CommandPalette.tsx` — ⌘K opens shadcn Command with
  a static list (real search arrives in Phase 6).
- `src/components/shell/NotificationBell.tsx` — Server Component, reads
  `unreadCount()` and badges the count. Links to `/notifications`.
- `src/components/shell/ThemeToggle.tsx` + `ThemeProvider.tsx` — next-themes
  with `class` strategy.

## Form patterns (added in Phase 1)

- `src/components/patterns/EditableField.tsx` — label + RHF input + error
  + help. Use `<EditableFieldShell>` to wrap non-`<Input>` controls
  (`<Textarea>`, `<Select>`, `<Checkbox>`).
- `src/components/patterns/StickySaveBar.tsx` — sticky footer that
  appears only when the form is `isDirty`. Plug `dirty` + `pending` props
  from RHF state.
- `src/components/patterns/file-upload.tsx` — drag-drop zone, hand-rolled
  dropzone hook, lazy `pdfjs-dist` thumbnail for PDFs, inline preview for
  images. Calls `onSelect(file)`; the parent decodes the file and posts to
  the Server Action.
- `src/app/(app)/settings/organisation/_upload.ts` — `fileToActionPayload`
  helper. Base64-encodes a `File` into the `{ fileBytes, filename,
  claimedMime }` shape every upload action expects.
- `src/components/patterns/EditHistory.tsx` — collapsible "View history"
  block + side-drawer diff. Fed by `loadEditHistory(entityType, entityId)`
  from `src/lib/audit/history.ts`.
- `src/lib/audit/history.ts` — server-only loader that returns JSON-safe
  `EditHistoryEntry[]` for a `(entityType, entityId)` pair.

## Storage

- `src/lib/storage/` — adapter interface + `LocalFsAdapter` (default,
  writes to `<repo>/.uploads`) + `R2Adapter` (stub, lights up in Phase 6).
  Selected by `STORAGE_BACKEND` env var.
- `storage.put(key, buffer, opts)` / `storage.get(key)` — the only API
  callers should use.
- `storageKey.orgDocument / orgLogo / orgSignature / donationReceipt /
  donationReceiptArchive / donorDocument(...)` — deterministic path
  builders. **Never inline path strings.**
- `src/lib/storage/validate.ts` — `validateUpload(buffer, opts)` does the
  magic-byte check + size limit + claimed-vs-detected MIME compare. Every
  Server Action that accepts a file must call this server-side.
- `/api/files/[...key]` — secured streaming endpoint. Verifies the
  requesting user's `organisationId` matches the key prefix before
  serving a byte. **Never serve files from a public URL.**

## Notify (added in Phase 2)

- `src/lib/notify/` — same shape as `storage/`: adapter interface +
  per-channel adapters + factory by env var.
- `email` (default `ConsoleEmailAdapter`; `EMAIL_DRIVER=resend` swaps in
  `ResendEmailAdapter` stub). One method: `email.send({ to, subject, html,
  attachments? })`.
- `whatsapp` (default `ConsoleWhatsAppAdapter`; `WHATSAPP_DRIVER=cloud`
  swaps in `CloudWhatsAppAdapter` stub). One method: `whatsapp.send({ to,
  templateName, params, mediaUrl? })`.
- `dispatchDonationReceipt(donationId)` — fan-outs to both channels and
  writes a `Notification` row per channel.
- `renderDonationReceiptEmail(...)` — inline HTML template.

## Sequence allocators (Phase 2 + 3)

- `src/lib/services/sequence-allocator.ts` — `lockAndIncrement` shared
  core. `SELECT … FOR UPDATE` on any series-style table, increment,
  format. **Always called inside the same transaction that creates the
  domain row.**
- `allocateReceiptNumber(tx, { organisationId, isFcra, financialYear })`
  in `src/lib/services/receipt-number.ts` — donations.
- `allocateVoucherNumber(tx, { organisationId, kind, financialYear })`
  in `src/lib/services/voucher-number.ts` — expenses. `kind` ∈
  `GENERAL | PETTY_CASH | RECURRING`; each runs on its own counter
  (prefixes `VCH / PCV / RCV`).
- Both auto-create the series on FY rollover and pass the 50-parallel
  concurrency test.

## PDF generation (Phase 2 + 3)

- `generate80GReceipt(donationId)` in `src/lib/pdf/receipt-80g.ts` —
  donations.
- `generateVoucherPdf(expenseId)` in `src/lib/pdf/voucher.ts` —
  expenses. Renders gross/TDS/net/GST split + approval trail. PAID +
  CANCELLED stamps. Same currency / date discipline as the receipt.
- All currency through `formatINR` / `inrInWords`; all dates through
  `formatIST`. **Never inline currency or date formatting on the PDF.**

## Tax math (Phase 3)

- `computeTds({ grossAmount, section, ldcRate?, fyToDateForSection? })`
  in `src/lib/services/tax-calc.ts`. Returns `{ rate, amount,
  netPayable, sectionMeta, warnings }`. LDC override replaces the
  section default rate. Threshold warning when cumulative FY payment is
  below the section minimum.
- `computeGst({ taxableValue, rate, isInterState })` — CGST+SGST split
  for intra-state, single IGST for inter-state.
- Both pure; called from the expense form's live preview AND
  server-side validation (so client and server agree).

## Approval workflow (Phase 3)

- `src/lib/services/expense-workflow.ts` — state machine. Legal
  transitions: DRAFT → PENDING_APPROVAL | APPROVED, PENDING → APPROVED
  | REJECTED | CANCELLED, APPROVED → PAID | CANCELLED, REJECTED → DRAFT,
  PAID → CANCELLED. `assertTransition()` / `nextStatus()` are pure;
  Server Actions wrap them with the Prisma write.
- `src/lib/services/approval-policy.ts` — `requiredApprovalRole(orgId,
  amount)` consults `ApprovalPolicy` rows. `canAutoApprove(orgId,
  actorRole, amount)` decides whether the actor's role clears the band
  (auto-self-approval shortcut).

## Recurring expenses (Phase 3)

- `src/lib/services/recurring-expense-runner.ts` —
  `runRecurringExpenseGeneration()`. Idempotent via `lastGeneratedFor`.
  Phase 3 ships a manual OWNER-triggered button; Phase 6 wires the cron.

## Certificate allocator + PDFs (Phase 4)

- `allocateCertificateNumber(tx, { kind, ... })` in
  `src/lib/services/certificate-number.ts`. Shares core with receipt +
  voucher allocators. Kinds: `UTILISATION` (`UTIL/FY/NNNN`) and
  `VOLUNTEER` (`VOL/FY/NNNN`). 50-parallel concurrency test passes.
- `generateUtilisationCertificate(input)` in
  `src/lib/pdf/utilisation-certificate.ts` — A4 portrait, includes
  proportionate share + head-wise breakup + CANCELLED watermark.
- `generateVolunteerCertificate(input)` in
  `src/lib/pdf/volunteer-certificate.ts` — A4 landscape "Certificate of
  Appreciation" with decorative borders, total hours, signature block.

## Utilisation share calculator (Phase 4)

- `computeUtilisationShare(input)` in
  `src/lib/services/utilisation-calc.ts`. Pure — handles earmarked
  (PROJECT_SPECIFIC / CSR / EARMARKED_GRANT) vs pooled (CORPUS /
  GENERAL) donations. Conservation: sum of donor shares ≤ totalExpenses.

## Project workflow + FCRA propagation (Phase 4)

- `src/lib/services/project-workflow.ts` — state machine for
  `PLANNED → ACTIVE → ON_HOLD → COMPLETED | CANCELLED`.
- FCRA propagation in `donations/actions.ts`: tagging an FCRA donation
  to a project auto-flips `Project.isFcra`. Expenses against an FCRA
  project must use an FCRA-only bank account (enforced in
  `expenses/actions.ts > submitExpense`).

## Volunteer hours (Phase 4)

- `computeHours(checkInAt, checkOutAt)` in `src/lib/schemas/volunteer.ts`.
- `checkOutVolunteer` Server Action updates both the assignment hours
  and the volunteer's running `totalHours` in one transaction.

## Beneficiary access scoping (Phase 4)

- `/beneficiaries` page filters by PROJECT_MANAGER scope at the app
  layer (Prisma extension stays generic). OWNER/ADMIN see all;
  PROJECT_MANAGER sees beneficiaries enrolled in their managed projects.

## Compliance / reminders

- `src/lib/compliance/expiry.ts` — `syncExpiryReminders({ category,
  title, expiryDate, referenceModel, referenceId, ... })`. Wipes active
  reminders and recreates them at the lead days in `REMINDER_LEAD_DAYS`
  (60 / 30 / 7). Idempotent — call it from every upsert action whose
  entity carries an `expiryDate`.
- `src/lib/notifications/counts.ts` — `unreadCount()` returns notifications
  (unread) + ComplianceItem (DUE/OVERDUE). Used by the topbar bell.

## Constants / schemas (added in Phase 1)

- `src/lib/constants/states.ts` — 28 states + 8 UTs with GST codes,
  `stateCodeForName(name)` lookup, `INDIAN_STATES` array (for `<Select>`).
- `src/lib/schemas/organisation.ts` — every Zod schema and primitive used
  by the org-profile screens (PAN, TAN, CIN, GSTIN, IFSC, pincode,
  Indian-phone normaliser, identity, 12A, 80G, GST, FCRA, Darpan, CSR-1,
  bank account, branding text, doc metadata). **Import primitives from
  here when adding any new form** — don't redefine them.

## Server Action helpers

- `src/lib/actions/safe-action.ts` — `safeAction` from next-safe-action.
  Every mutation flows through it. Required auth, optional
  `metadata({ requires: "donation.create" })` permission gate. Errors are
  serialised via `handleServerError`.

## Audit log

- Don't write `prisma.auditLog.create` by hand. The extension does it for
  every mutation on a scoped model. If you need additional metadata, add
  it to `writeAuditEntry` in `src/lib/db/prisma.ts`.
- IP address and user agent are TODOs (require per-request context).

## File uploads (lives now, see "Storage" above)

The full storage stack landed in Phase 1. Local-FS for dev; R2 stub for
Phase 6 deploy. Path layout: `org/{orgId}/documents/{docId}.{ext}`,
`org/{orgId}/branding/{logo|signature}.{ext}`.

## Adding a new entry

When you ship a reusable thing, add a line here:

- **What** (the thing) — **where** (file path) — **how** (one-line usage).

Example:

> `useDonationFilters()` — `src/lib/hooks/use-donation-filters.ts` — wraps
> URL params for the donations table; mirror this for any filtered table
> in Phase 2+.

---

## Phase 5 — Compliance suite

### 10BD / 10BE (the most-touched feature in this phase)

- `src/lib/compliance/10bd-codes.ts` — IT-portal code mappings (FY 2024-25).
  Single source of truth: `donorTypeForCsv`, `donorIdForCsv`,
  `dominantDonationType` (Corpus > Specific > Others; FCRA overrides),
  `dominantModeCode` (amount-weighted), `donationTypeCode`.
  **When the IT portal updates the schema, this is the only file that changes.**
- `src/lib/compliance/10bd-aggregator.ts` — `aggregateFor10BD(orgId, fy)`
  groups donations per donor, surfaces blocking issues (missing PAN/address)
  and warnings (single-day > ₹50k). `buildCsv(agg, { withHeader })` emits
  the portal CSV (no header) and the audit CSV (with header).
- `src/lib/pdf/form-10be.ts` — `generateForm10BeCertificate({ filingId, donorId })`
  renders the donor certificate PDF. Reuses the existing cert row on
  regeneration (preserves the cert number). Allocates cert numbers via
  `allocateCertificateNumber({ kind: "FORM_10BE" })` — the share-core
  sequence allocator.

### 85% rule + ITR-7

- `src/lib/compliance/eighty-five-rule.ts` — `computeEightyFiveRule({ orgId, fy })`
  returns the full breakdown (receipts, application, percentage, shortfall,
  donor counts). **All downstream UI must call this** — never re-derive the
  85% number; the dashboard tile, IT module card, and ITR-7 export all
  share this single source.
- `src/lib/compliance/itr7-figures.ts` — `computeItr7Figures` wraps the
  85% rule and adds Schedule VC / AOI structure. `persistItr7Figures`
  upserts into `FinancialYearSummary`. `exportItr7Workbook` produces the
  4-sheet Excel (Cover / VC / AOI / 85% Computation).

### TDS

- `src/lib/compliance/tds-return.ts` — `aggregateTdsReturn({ formType, fy, quarter })`
  bucket per deductee, section-wise totals, challan reconciliation warnings.
  `exportTdsExcel` and `buildRpuText` produce the CA-friendly Excel and the
  simplified RPU flat text. Form type selects salary (192*) vs non-salary.

### GST

- `src/lib/compliance/gstr.ts` — `aggregateGstr({ period })` (YYYY-MM).
  B2B vs B2CS split (B2B if buyer has GSTIN). `exportGstrExcel(type, agg)`
  produces GSTR-1 (Summary / B2B / B2CS sheets) or GSTR-3B (Summary sheet).

### Recurring compliance calendar

- `src/lib/compliance/recurring-items.ts` — `generateRecurringItems({ orgId, horizonMonths })`
  materialises `ComplianceItem` rows for the next N months. Idempotent
  (lookup by orgId + category + title + dueDate). Generates: GSTR-1 (11th
  monthly), GSTR-3B (20th monthly), TDS payment (7th monthly), TDS return
  (Q1: 31 Jul · Q2: 31 Oct · Q3: 31 Jan · Q4: 31 May), Form 10BD (31 May
  annual), Form 10B/10BB (30 Sep annual), ITR-7 (31 Oct annual).

### Excel exporter

- `src/lib/exporter/xlsx.ts` — `buildWorkbook(sheets)` is the shared
  exceljs helper. Same shape used by ITR-7, GSTR-1/3B, Form 26Q, 10BD
  summary. Bold header row, configurable column widths, optional
  `preHeaderRows` for titles.

### Certificate sequence allocator (extended)

- `src/lib/services/certificate-number.ts` now allocates `FORM_10BE`
  certificate numbers (prefix `10BE`) in addition to `UTILISATION` and
  `VOLUNTEER`. Bootstrap is racy on first allocation (no row to lock); for
  contended bulk paths, pre-create the `CertificateSeries` row.

### Compliance UI routes

- `/compliance` — central index
- `/compliance/10bd` + `/[id]` — list + 4-step wizard
- `/compliance/income-tax` — IT compliance dashboard (12A/80G + 85% tile)
- `/compliance/income-tax/itr7` — figures workbench + Excel export
- `/compliance/income-tax/form-10` — Sec 11(2) accumulation tracker
- `/compliance/income-tax/audit-report` — Form 10B/10BB tracker
- `/compliance/tds` — TDS dashboard (quarter tiles + section-wise + LDC)
- `/compliance/gst` — GST dashboard (when GSTIN set; setup notice otherwise)
- `/compliance/calendar` — all recurring items, grouped by category
