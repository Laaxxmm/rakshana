# Phase 1 — Complete

**Built:** 2026-05-20
**On top of:** Phase 0 (see `PHASE-0-COMPLETE.md`)

## What ships in Phase 1

| #   | Step                                                             | Status |
|-----|------------------------------------------------------------------|--------|
| 1   | Schema migration: `OrgDocument.replacedById` + `deletedAt`        | ✅     |
| 2   | Storage abstraction (interface + `LocalFsAdapter` + R2 stub)      | ✅     |
| 3   | Zod schemas: `organisation.ts` (PAN, TAN, CIN, GSTIN, IFSC, phone, …) | ✅ |
| 4   | State master: 28 states + 8 UTs with GST codes                    | ✅     |
| 5   | Shared patterns: `EditableField`, `StickySaveBar`, `FileUpload`, `EditHistory` | ✅ |
| 6   | `syncExpiryReminders` + reminder lead days (60 / 30 / 7)          | ✅     |
| 7a  | Tab 1 — Identity (full form, state dropdown auto-fills code, CIN required for Section 8) | ✅ |
| 7b  | Tab 2 — Legal documents (upload, replace, delete, magic-byte check) | ✅   |
| 7c  | Tab 3 — Tax (12A + 80G + GST sub-cards, GSTIN/state warning)      | ✅     |
| 7d  | Tab 4 — Funding (FCRA + Darpan + CSR-1, FCRA-bank banner, +5y suggest) | ✅ |
| 7e  | Tab 5 — Banking (add / edit / set-primary tx / soft-deactivate)    | ✅     |
| 7f  | Tab 6 — Branding (logo + signature upload, header/footer, live preview) | ✅ |
| 8   | `/notifications` page + topbar bell with live count badge         | ✅     |
| 9   | `/settings/organisation/documents/[id]` detail page                | ✅     |
| 10  | Vitest: schemas, expiry, primary-bank tx, magic-byte (+1 new file from earlier) | ✅ |
| 11  | Discipline files updated + acceptance run                          | ✅     |

## Acceptance criteria — all 11 pass

1. ✅ All six tabs save independently with proper validation (each has its own form + Server Action; dirty bar only on that tab)
2. ✅ Upload accepts a real PDF; **renamed `.exe` rejected server-side** by `validateUpload()` magic-byte check (test in `src/lib/storage/validate.test.ts`)
3. ✅ Setting an 80G validity end date creates exactly 3 `ComplianceItem` rows — verified end-to-end against the dev DB; integration test in `src/lib/compliance/expiry.test.ts`
4. ✅ Toggling another bank as primary demotes the previous primary inside a Prisma transaction — test in `src/lib/banking/primary.test.ts`
5. ✅ Activating an FCRA registration with no FCRA-only bank shows the warning banner; adding one clears it (logic in `FundingPanel.tsx`)
6. ✅ Logo + signature upload visible in the live receipt preview card on the Branding tab
7. ✅ Edit-history block on every tab; side-drawer shows before/after JSON diff (driven by AuditLog from Phase 0)
8. ✅ Bell icon badges the count of unread notifications + DUE/OVERDUE compliance items (verified live: created a 12A expiring in 45 days, bell flipped from 0 → 1, `/notifications` listed all 3 reminders)
9. ✅ `npm test` — 8 files, **69 tests, all passing**
10. ✅ `REUSE-MAP.md` updated with the six new shared units
11. ✅ This file (`PHASE-1-COMPLETE.md`)

## Tests (Phase 1 additions)

| File                                       | Coverage                                |
|--------------------------------------------|------------------------------------------|
| `src/lib/schemas/organisation.test.ts`     | 20 tests — PAN/TAN/CIN/GSTIN/IFSC/pincode/phone/identity/bank account |
| `src/lib/storage/validate.test.ts`         | 8 tests — magic-byte detection + size limit + renamed-exe rejection |
| `src/lib/compliance/expiry.test.ts`        | 4 tests — creates 3, idempotent re-run, clears on null, OVERDUE stamping |
| `src/lib/banking/primary.test.ts`          | 1 test — primary toggle transaction       |

## Key architectural decisions

1. **Storage backend is pluggable**, default is `LocalFsAdapter` writing to `<repo>/.uploads` (gitignored). Set `STORAGE_BACKEND=r2` in Phase 6 to flip. The R2 adapter is a stub that explicitly throws.
2. **Files are never served from a public URL.** `/api/files/[...key]` re-checks `scope.organisationId` against the key prefix before streaming a byte. No signed URLs needed for Phase 1 because every read goes through the app.
3. **Base64 uploads via Server Actions.** Phase 1 ships uploads through `next-safe-action`'s typed input by encoding `File` → base64. Up to 10 MB this is fine; Phase 2 will switch to multipart-form route handlers if doc sizes grow.
4. **Tenancy is enforced at three layers** for `/api/files`: scope check on every read, key embeds `org/{orgId}/`, and `LocalFsAdapter.absPath()` rejects `..` traversal. Belt + braces + suspenders.
5. **Each tab is its own form + action.** A single failed regex on the Banking tab no longer blocks a save on Identity. Per-tab dirty state, per-tab save bar.
6. **`syncExpiryReminders` is the single source of expiry truth.** Every action that mutates 12A / 80G / FCRA calls it. Statuses (UPCOMING / DUE / OVERDUE) are stamped at write time; a Phase 5 cron will daily re-stamp.

## Schema changes

```diff
 model OrgDocument {
   id             String   @id @default(cuid())
   organisationId String
   …
+  mimeType       String?
+  fileSize       Int?
+  deletedAt      DateTime?     // soft-delete only — never hard-delete
+  replacedById   String?
+  replacedBy     OrgDocument?  @relation("OrgDocReplacement", fields: [replacedById], references: [id])
+  replaces       OrgDocument[] @relation("OrgDocReplacement")
   …
+  @@index([organisationId, deletedAt])
 }
```

Migration: `prisma/migrations/20260520110340_org_document_versioning/`. Additive — no data migration required.

## Known carryovers to Phase 2+

- **Base64 → multipart upload** if files routinely exceed a few MB.
- **R2 implementation** in `src/lib/storage/r2-adapter.ts` (currently throws).
- **PDF.js worker** is currently CDN-loaded; copy the worker into `public/` and switch to a relative URL in Phase 6 (bundle audit).
- **Daily cron to re-stamp `OVERDUE`** — `syncExpiryReminders` only stamps at write time. Phase 5.
- **Notification delivery (email / WhatsApp)** still in-app only. Wired when the 80G receipt emailer ships in Phase 2.
- **Mini-popover preview on bell hover** (the prompt's nice-to-have) — deferred. The bell links straight to `/notifications`; hover preview adds little value when the page itself is one click away. Reconsider after user testing.

## Run from a fresh clone

```bash
docker compose up -d
npm install
npx prisma migrate deploy
npm run db:seed
npm run dev
# log in as lakshmanan@indefine.in / Welcome@2026
# /settings/organisation has six editable tabs
# /notifications shows compliance reminders
```

## What comes next

Phase 2 — **Donor management + Donation recording + 80G receipt PDF**. Will lean heavily on the patterns built here: `EditableField`, `StickySaveBar`, `FileUpload`, `EditHistory`, `safeAction.metadata({ requires: "donation.create" })`, `formatINR` / `inrInWords`, `storage.put` for receipt PDFs.
