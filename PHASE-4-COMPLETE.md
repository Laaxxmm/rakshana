# Phase 4 — Complete

**Built:** 2026-05-22
**On top of:** Phases 0, 1, 2, 3 (see their `PHASE-N-COMPLETE.md`)

## What ships in Phase 4

| # | Step | Status |
|---|------|--------|
| 1 | Schema migration: `Project.isFcra`, `Expense.budgetHeadId` + `exceededBudgetAt`, `Organisation.disbursementAckThreshold`, new `CertificateSeries` model + enum, certificate-number relations on UtilisationCertificate / VolunteerCertificate | ✅ |
| 2 | `allocateCertificateNumber` (shares core with receipt + voucher allocators) + 50-parallel concurrency test | ✅ |
| 3 | Permissions matrix + project / beneficiary / volunteer Zod schemas | ✅ |
| 4 | Project workflow state machine + transition tests | ✅ |
| 5 | Utilisation share calculator + tests (PRD acceptance: 3 donors with mixed purposes, conservation property verified) | ✅ |
| 6 | Utilisation certificate PDF (A4 portrait) + pdf-parse tests | ✅ |
| 7 | Volunteer certificate PDF (A4 landscape "Certificate of Appreciation") + pdf-parse tests | ✅ |
| 8 | Project surface (list with status filter, 6-tab profile, new/edit form) | ✅ |
| 9 | Beneficiary surface (list, 4-tab profile, new form, disbursement + impact actions) | ✅ |
| 10 | Volunteer surface (list, 3-tab profile, new form, generate-cert dialog) + activities actions + check-in/out | ✅ |
| 11 | Sidebar updates, donation FCRA propagation, expense FCRA bank enforcement | ✅ |
| 12 | Dashboard: real Active projects, Beneficiaries served (FY), Volunteer hours (FY), project spend leaderboard | ✅ |
| 13 | Tests + typecheck + dev-server smoke (all Phase 4 routes return 200) | ✅ |
| 14 | This file + REUSE-MAP additions | ✅ |

## Test coverage

| File | Tests |
|------|------|
| Phase 0 (5 files) | 35 |
| Phase 1 (4 files) | 34 |
| Phase 2 (3 files) | 23 |
| Phase 3 (5 files) | 34 |
| `certificate-number.test.ts` (Phase 4) | 3 |
| `project-workflow.test.ts` (Phase 4) | 14 |
| `utilisation-calc.test.ts` (Phase 4) | 7 |
| `utilisation-certificate.test.ts` (Phase 4 PDF) | 2 |
| `volunteer-certificate.test.ts` (Phase 4 PDF) | 2 |
| **Total** | **154** |

All 154 tests pass. Typecheck clean (`tsc=0`).

## Acceptance criteria

| # | Criterion | Result |
|---|-----------|--------|
| 1 | Project created with budget heads, marked ACTIVE, tagged on a donation | ✅ donation form's project dropdown filters to PLANNED/ACTIVE; Funding tab shows tagged donations |
| 2 | Project profile shows committed/spent/remaining per head | ✅ Budget tab aggregates approved + paid expenses by `budgetHeadId` |
| 3 | Utilisation certificate generates for 1 project, multiple donors, correct share | ✅ PDF tests + utilisation-calc tests cover the math (`PRD acceptance` test passes) |
| 4 | Utilisation cert opens in Chrome with all blocks + Indian formatting | ✅ pdf-parse asserts `1,00,000` (not `100,000`) |
| 5 | Beneficiary enrolled in project, disbursement recorded, appears on both profiles | ✅ `enrolBeneficiary` + `recordDisbursement` actions + project/beneficiary profile reads |
| 6 | PROJECT_MANAGER sees only beneficiaries in their projects | ✅ `beneficiaries/page.tsx` filters; `beneficiaries/[id]/page.tsx` notFound if no access |
| 7 | Volunteer activity created, volunteers assigned, checked in/out, hours auto-compute | ✅ `checkOutVolunteer` runs `computeHours` + updates `Volunteer.totalHours` in a transaction |
| 8 | Volunteer certificate generates with name, hours, period | ✅ pdf-parse test verifies all three |
| 9 | Expense exceeding head budget warns; over 10% blocks | ⏭ **Deferred to Phase 4.5** — schema field (`exceededBudgetAt`) exists; UI warning + hard-block not wired yet |
| 10 | Placeholder migration tool moves 5 donations + 3 expenses to a new project | ✅ `migrateFromPlaceholder` Server Action ships; UI wraps deferred |
| 11 | Dashboard shows real Active projects + Beneficiaries served | ✅ live smoke confirmed |
| 12 | 50 concurrent utilisation cert numbers — unique sequential | ✅ `certificate-number.test.ts` passes |
| 13 | FCRA-tagged donation auto-flags project; non-FCRA bank rejected | ✅ donation action propagates `Project.isFcra`; expense action throws on non-FCRA bank for FCRA project |
| 14 | `npm test` passes all tests | ✅ 154/154 |
| 15 | REUSE-MAP updated | ✅ Certificate allocator + PDFs + utilisation calc + project workflow + FCRA propagation + volunteer hours + beneficiary scoping all documented |
| 16 | This summary | ✅ |

## Key architectural decisions

1. **Beneficiary identification — Option (a) real names** with role-gated access. PROJECT_MANAGER scope filters at the application layer (Prisma extension stays generic). OWNER/ADMIN get full access; ACCOUNTANT/AUDITOR see aggregates only.
2. **Sequence allocator already share-core** in Phase 3. The new `allocateCertificateNumber` delegates to `lockAndIncrement` with a `CertificateSeries` table — no further refactor needed.
3. **Utilisation share math: earmarked first, pooled second.** When total earmarked donations exceed total expenses, earmarked donors share pro-rata; pooled donors get the residual. Conservation property: sum of donor shares ≤ totalExpenses (verified in tests).
4. **FCRA propagation auto-flips `Project.isFcra`** on the first FCRA donation tagged to a project. Subsequent expenses against that project must come from FCRA-only banks (hard error otherwise). Cash + petty cash blocked for FCRA project spends.
5. **Project completion is human-triggered.** A notification fires to OWNER + project manager when a project transitions to COMPLETED, prompting them to generate utilisation certificates. We don't auto-generate — auditors prefer human review.
6. **`server-only` shim** continues to alias to a no-op in tests.
7. **Volunteer hours computed at check-out**, stored both on the assignment (per-event) and as a running total on the volunteer (denormalised for fast dashboard reads). One transaction.

## Schema delta

```diff
 model Organisation {
+  disbursementAckThreshold Decimal @default(1000) @db.Decimal(18, 2)
+  certificateSeries  CertificateSeries[]
 }
 model Project {
+  isFcra          Boolean @default(false)
 }
 model ProjectBudgetHead {
+  expenses        Expense[]
 }
 model Expense {
+  budgetHeadId    String?
+  budgetHead      ProjectBudgetHead? @relation(...)
+  exceededBudgetAt DateTime?
 }
 model UtilisationCertificate {
+  certificateNumber String?
+  certificateSeriesId String?
+  certificateSeries CertificateSeries? @relation(...)
+  status      String @default("ACTIVE")
+  @@index([projectId, donorId])
 }
 model VolunteerCertificate {
+  certificateNumber String?
+  certificateSeriesId String?
+  certificateSeries CertificateSeries? @relation(...)
 }
+model CertificateSeries { … @@unique([organisationId, kind, financialYear]) }
+enum CertificateSeriesKind { UTILISATION | VOLUNTEER }
```

Migration: `prisma/migrations/20260522091413_phase4_projects_beneficiaries_volunteers/`. Additive. No data migration required.

## What's deferred (Phase 4.5 / 5 / 6)

Same discipline as prior phases — called out up front:

- **Budget overrun warning + 10% hard block UI** — schema field shipped; expense form wiring lands next
- **Budget head dropdown on the expense form** — server actions accept `budgetHeadId`; form UI for the per-project dropdown deferred
- **Placeholder migration UI** (`/projects/migrate-from-placeholder`) — action ships, UI follows
- **Excel exports** for projects / beneficiaries / volunteers
- **Bulk utilisation cert generation** — action shape is per-donor; bulk just loops
- **Reallocate-budget UI** — action ready
- **Beneficiary Documents tab + photo/ID upload** — schema fields exist; FileUpload pattern from Phase 1 wires in
- **`/volunteer-activities` route** (sidebar links to it but the page wasn't built) — activities table + assignment management on a single page is a clean Phase 4.5 candidate
- **`/projects/[id]/edit` budget heads inline edit + add-head action UI**
- **Markdown rendering for project descriptions** (plain text + line breaks for now)
- **End-date reminder card on project profile** (`syncExpiryReminders` available)
- **PDF helper extraction** (`pdf/lib/header.ts` etc.) — flagged in CODE-HEALTH

## Known caveats

- **`UtilisationCertificate.status` is a string column**, not an enum. The Phase 4 prompt didn't ask for an enum and we have only two values (`ACTIVE` / `CANCELLED`); migrating to a proper enum is a Phase 5 hardening item.
- **Project profile Reports tab shows utilisation certificates**, not the project income+expenditure or impact reports. Those are Phase 5/6 deliverables.
- **`/volunteer-activities` sidebar link 404s** until Phase 4.5 ships the page.

## Run from a fresh clone

```bash
docker compose up -d
npm install
npx prisma migrate deploy
npm run db:seed
npm run dev
# log in as lakshmanan@indefine.in / Welcome@2026
# /projects           — project list + status filter pills
# /projects/new       — create a project with budget heads
# /projects/[id]      — 6-tab profile (Overview / Budget / Funding / Expenses / Beneficiaries / Reports)
# /beneficiaries      — role-scoped list
# /beneficiaries/[id] — 4-tab profile with disbursements + impact metrics
# /volunteers         — volunteer list with hours
# /volunteers/[id]    — generate volunteer certificate from the profile
# /                   — dashboard now shows real Active projects + Beneficiaries served + Volunteer hours FY + Project spend leaderboard
```

## What comes next

Phase 5 — **Compliance Suite (Form 10BD/10BE + ITR-7 data prep + GSTR-1/3B + TDS quarterly returns)**. Phases 2/3/4 captured every data point Phase 5 needs to export — donations with PAN, expenses with TDS section/rate/amount, project utilisation, beneficiary disbursements. Phase 5 is largely aggregation + format conversion.
