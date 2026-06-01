# Rakshana

Trust Management Platform for Indian charitable trusts and Section 8
companies. Covers fundraising operations, accounting, programmes, and
statutory compliance — multi-tenant from day one.

## What's inside

| Module | Highlights |
|---|---|
| **Donors & donations** | Donor master · 30-second donation entry · atomic 80G receipt allocation · per-donor lifetime totals · CSV bulk import |
| **Accounting** | Expenses with TDS auto-calc · approval workflow · petty cash floats · recurring expense templates · vendor master · banking dashboard |
| **Programmes** | Projects with budget heads · beneficiary master + disbursements · volunteer activities + check-in/out + certificates |
| **Compliance Suite** | Form 10BD wizard (4 steps) · 10BE donor certificates · ITR-7 figures · 85% rule calculator · Form 10 accumulations · GSTR-1/3B · TDS 26Q/24Q · compliance calendar |
| **Reports** | 10 standard reports (Receipt & Payment · Income & Expenditure · Balance Sheet · Fund Flow · Donor-wise · Project Utilisation · TDS Quarterly · GST Summary · Audit Trail · Beneficiary Impact) — Excel + PDF |

## Stack

- **Next.js 16** (App Router · Server Components · TypeScript strict)
- **Prisma 6** + **PostgreSQL 16**
- **NextAuth v5** (credentials + JWT session)
- **Tailwind 4** + **shadcn/ui** (base-nova style with custom design tokens)
- **PDFKit** (PDFs) · **ExcelJS** (Excel) · **Decimal.js** (money)
- **Nodemailer** (Gmail SMTP) · `wa.me` click-to-chat (WhatsApp)
- **Vitest** (236 tests covering multi-tenant isolation, computations, PDF/Excel rendering)

## Five non-negotiables

1. **Multi-tenant scope is mandatory.** Every domain query goes through
   the scoped Prisma client; the unsafe client is reserved for auth,
   seed, and super-admin work.
2. **Money is `Decimal(18, 2)`.** Never `number`. UI through `formatINR`.
3. **Mutations go through `safeAction`** with optional permission keys.
   Audit log is written automatically.
4. **Indian formatting throughout** — lakhs/crores, DD/MM/YYYY,
   FY April–March.
5. **Reuse before rewrite.** See `REUSE-MAP.md` before creating a new
   utility, component, or pattern.

## Local development

```bash
# 1. Start Postgres
docker compose up -d

# 2. Copy env template, fill in values
cp .env.example .env

# 3. Install + migrate + seed
npm install
npx prisma migrate deploy
npm run db:seed

# 4. Run the app
npm run dev    # http://localhost:3000

# 5. Run the test suite
npm test
```

Seeded login: `lakshmanan@indefine.in` / `Welcome@2026`
(**change this immediately on first login in any environment**).

## Deployment

See **[OPERATIONS.md](./OPERATIONS.md)** for the full Railway deployment
runbook — required env vars, first-deploy walkthrough, backup procedure,
incident playbook, and the path to migrate storage from local-FS to
Cloudflare R2.

## Repository layout

```
src/
├─ app/(app)/           Authenticated routes
│  ├─ donors/           Donor master + bulk import
│  ├─ donations/        Donation entry + drawer + receipt PDFs
│  ├─ expenses/         Expense workflow + voucher PDFs
│  ├─ approvals/        Pending-approval queue
│  ├─ vendors/          Vendor master
│  ├─ petty-cash/       Petty cash floats + top-ups
│  ├─ recurring-expenses/  Recurring templates + runner
│  ├─ banking/          Bank account dashboard
│  ├─ projects/         Project profiles + budget heads + utilisation certs
│  ├─ beneficiaries/    Beneficiary master + disbursements
│  ├─ volunteers/       Volunteer profiles + activities + certificates
│  ├─ volunteer-activities/  Activity master
│  ├─ compliance/       10BD wizard · Income Tax · GST · TDS · Calendar
│  ├─ reports/          10 standard reports + history
│  ├─ settings/         Org profile (6 tabs)
│  └─ notifications/    Dispatch queue
├─ app/(auth)/login/    Login screen
├─ app/api/             /api/health · /api/files (signed file streaming)
├─ lib/
│  ├─ auth/             scope · permissions · safe-action wrapper
│  ├─ compliance/       10bd-aggregator · eighty-five-rule · itr7-figures · gstr · tds-return · recurring-items
│  ├─ db/               Multi-tenant Prisma extension + audit log composer
│  ├─ exporter/         Shared xlsx helper
│  ├─ format/           inr · date (FY/IST)
│  ├─ notify/           Adapter pattern: console · smtp · resend · wa.me · WhatsApp Cloud
│  ├─ pdf/              receipt-80g · voucher · utilisation-cert · volunteer-cert · form-10be
│  ├─ reports/          10 report generators + shared renderers
│  ├─ schemas/          Zod schemas (single source of truth)
│  ├─ services/         sequence-allocator · tax-calc · utilisation-calc · …
│  └─ storage/          Adapter pattern: local-fs · r2 (stub)
└─ middleware.ts        Auth gate + public-path allowlist

prisma/
├─ schema.prisma        60+ models
└─ migrations/          Sequential migrations
```

## Internal docs

- **[REUSE-MAP.md](./REUSE-MAP.md)** — Every reusable lib, component,
  and pattern. Read this before adding utilities.
- **[CODE-HEALTH.md](./CODE-HEALTH.md)** — Coding bar + computation rules
  (85% rule, 115BBC, 10BD dominance, FCRA segregation, GST interstate).
- **[DESIGN-TOKENS.md](./DESIGN-TOKENS.md)** — Colour, type, spacing,
  shadow tokens + light/dark mode mapping.
- **[SECURITY.md](./SECURITY.md)** — Threat model, auth & RBAC, audit
  trail, secrets handling.
- **[OPERATIONS.md](./OPERATIONS.md)** — Deployment + incident runbook.

## Status

Phases 0–6 complete. The app handles the full annual compliance cycle
for a charitable trust. Performance polish, cron deployment, user manual,
and Sentry wiring land in Phase 6 polish. See `OPERATIONS.md` for
known gaps (notably: filesystem storage on Railway is ephemeral —
switch to R2 before going production-critical).

## License

Private — internal use by Rakshana Trust.
