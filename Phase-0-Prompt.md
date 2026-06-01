# Rakshana — Phase 0 Build Prompt (Claude Code)

**How to use:** Open Claude Code in an empty folder. Paste everything from `=== BEGIN PROMPT ===` to `=== END PROMPT ===` as your first message. Claude Code will scaffold the project, then stop and ask before each major step.

**Reference files to attach to the same Claude Code session** (drop them into the project folder first):
- `Rakshana-PRD.md`
- `schema.prisma`
- (optional) `Rakshana-Design-Prompt.md` for visual context

---

## What Phase 0 produces

By the end of Phase 0, you will have:

1. A running Next.js 15 + TypeScript + Prisma + PostgreSQL app at `localhost:3000`
2. NextAuth v5 with email/password login working end-to-end
3. Database migrated to the full schema (all 60+ models from `schema.prisma`)
4. RBAC enforced on every API route via middleware
5. Multi-tenant scoping enforced via Prisma extension (every query auto-filtered by `organisationId`)
6. Audit log middleware that records every mutation
7. Design system page at `/design-system` showing tokens, typography, and base components
8. App shell: sidebar + topbar + main layout, theme toggle, Cmd+K palette stub
9. Organisation profile screen (read-only for now; editable in Phase 1)
10. A seeded database with one organisation (Rakshana Trust), one OWNER user, and master data (expense categories, TDS sections, receipt series)
11. `CLAUDE.md`, `CODE-HEALTH.md`, `SECURITY.md`, `DESIGN-TOKENS.md`, `REUSE-MAP.md` discipline files at the repo root

**Phase 0 does NOT build:** donor management, donations, expenses, projects, compliance modules. Those are Phases 1–6.

---

=== BEGIN PROMPT ===

# Project: Rakshana — Trust Management Platform

You are scaffolding **Rakshana**, a Trust Management Platform for Indian charitable trusts and Section 8 companies. The owner of this project is Lakshmanan (Indefine, Bangalore). Before you begin, read these files in the project folder — they are the contract:

1. `Rakshana-PRD.md` — product spec, all 13 modules, multi-tenancy strategy, UX principles
2. `schema.prisma` — the complete Prisma schema (60+ models, all 13 modules, audit log, RBAC tables)
3. `Rakshana-Design-Prompt.md` — visual direction (typography, colour tokens, layout)

**Read all three before writing any code.** When you are unsure about scope, defer to the PRD. When you are unsure about data shape, defer to the schema. When you are unsure about visuals, defer to the design prompt.

---

## Stack (non-negotiable for Phase 0)

- **Next.js 15** (App Router, Server Components by default, TypeScript strict mode)
- **Prisma 6** + **PostgreSQL 16** (use Docker Compose for local DB)
- **NextAuth v5** (credentials provider + email magic link)
- **Tailwind CSS** with CSS custom properties for design tokens (NOT Tailwind's default config)
- **shadcn/ui** components, customised to the Rakshana design tokens
- **Tabler Icons** via `@tabler/icons-react`
- **React Hook Form + Zod** for forms and validation
- **next-safe-action** for type-safe Server Actions with auth + Zod
- **Decimal.js** for money (never use float)
- **date-fns** + `date-fns-tz` (IST) for dates
- **pino** for structured logging

**Fonts (next/font/google):**
- Fraunces (display, headings)
- Inter Tight (body, UI)
- JetBrains Mono (numbers, codes, identifiers)

---

## Build philosophy

This is the same discipline used in Indefine Kitchen and Vision by Indefine. Follow it strictly.

1. **Plan before building.** At each step, state what you are about to do, then ask the user to approve before running commands or writing more than one file.

2. **Re-use before re-write.** Before writing a new component or utility, check the existing files. If something close exists, extend it. Maintain `REUSE-MAP.md` as you go.

3. **Multi-tenant safe from the first commit.** Every domain query goes through the Prisma extension that auto-injects `organisationId`. Never bypass it. There will be a one-line escape hatch (`prisma.$unsafe`) only for system-level operations (auth, super-admin), and any use of it must be documented.

4. **No magic numbers, no hard-coded strings.** Constants live in `lib/constants/`. Permissions live in `lib/auth/permissions.ts`. TDS rates, GST rates, FY config live in `lib/constants/tax.ts`.

5. **Server-first.** API routes and Server Actions handle all mutations. Client components only for interactivity. No client-side database access.

6. **Money is Decimal(18,2).** Never `number`. Never `parseFloat`. Use `decimal.js` everywhere, including in Zod schemas (`z.coerce.string().refine(isDecimal)`).

7. **Indian number formatting is centralised.** One utility, `formatINR(value, opts)`, in `lib/format/inr.ts`. Same pattern as Vision. Same for dates (`formatIST`).

8. **Every mutation produces an audit log entry.** This is handled by the Prisma extension, not by individual route handlers. Don't write `prisma.auditLog.create` by hand.

9. **Type safety end-to-end.** Zod schemas in `lib/schemas/` are shared between form validation and Server Action input. Inferred types via `z.infer<>` only.

10. **Test the seam, not the surface.** For Phase 0, write smoke tests for: auth flow, Prisma multi-tenant scoping, audit log emission, permission middleware. Use `vitest`.

---

## Phase 0 — Step-by-step plan

Work through these steps **one at a time**. After each step, summarise what was done, list the files created or modified, and **wait for user approval** before moving to the next step.

### Step 1 — Repo scaffold

1. Create a Next.js 15 app with TypeScript strict, App Router, Tailwind, ESLint, src directory: `npx create-next-app@latest rakshana --typescript --tailwind --app --src-dir --eslint --no-import-alias`
2. Install runtime deps: `prisma @prisma/client @auth/prisma-adapter next-auth@beta @tabler/icons-react react-hook-form @hookform/resolvers zod next-safe-action decimal.js date-fns date-fns-tz pino bcryptjs`
3. Install dev deps: `@types/bcryptjs vitest @vitejs/plugin-react happy-dom @testing-library/react @testing-library/jest-dom prisma`
4. Install shadcn/ui: `npx shadcn@latest init` — choose: New York style, Slate base colour (we override), CSS variables YES, RSC YES, tsconfig paths YES, components.json at root.
5. Add base shadcn components: `button input label dialog drawer dropdown-menu tabs table card badge separator avatar form select textarea checkbox switch toast tooltip command popover sheet`
6. Create folder structure (see "Project structure" below).
7. Add a `docker-compose.yml` with Postgres 16 (port 5432, db `rakshana`, user `rakshana`, password from `.env`).
8. Create `.env.example` and `.env` with `DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL`, `NODE_ENV`.
9. Add `.gitignore` entries: `.env`, `.next`, `node_modules`, `coverage`.
10. Initial commit: "chore: scaffold Next.js 15 + Tailwind + shadcn".

**Stop and report.** Run `npm run dev` and confirm the default Next.js page loads. Wait for approval.

### Step 2 — Prisma + schema migration

1. Copy `schema.prisma` (provided in the project folder) into `prisma/schema.prisma`. Do not modify it during Phase 0 — if anything looks wrong, surface it and wait for the user.
2. Run `npx prisma generate`.
3. Start Postgres: `docker compose up -d`.
4. Run the first migration: `npx prisma migrate dev --name init`.
5. Verify the migration by running `npx prisma studio` and confirming all 60+ tables exist.

**Stop and report.** Show the migration file and list the tables created. Wait for approval.

### Step 3 — Design tokens & global styles

Create `src/app/globals.css` with **exactly** these CSS custom properties (copied from `Rakshana-Design-Prompt.md`, with dark mode):

```css
@import "tailwindcss";

@layer base {
  :root {
    /* Canvas — warm paper */
    --canvas: #FAF8F3;
    --surface: #FFFFFF;
    --surface-sunken: #F4F1EA;

    /* Ink */
    --ink: #1A1814;
    --ink-muted: #5C5852;
    --ink-subtle: #8A857E;

    /* Brand */
    --primary: #1A6E5A;
    --primary-hover: #155A4A;
    --primary-soft: #E8F0ED;

    /* Accent — saffron, used sparingly */
    --accent: #C26B2A;
    --accent-soft: #FBF1E5;

    /* Semantic */
    --success: #2F7D5E;
    --warning: #B8761E;
    --danger:  #B5443A;
    --info:    #2F5D7D;

    /* Borders */
    --border: #E8E3D9;
    --border-strong: #D4CEC2;

    /* Radii */
    --radius-sm: 4px;
    --radius:    6px;
    --radius-md: 8px;
    --radius-lg: 12px;

    /* Shadows */
    --shadow-sm: 0 1px 2px rgba(26, 24, 20, 0.04);
    --shadow-md: 0 4px 12px rgba(26, 24, 20, 0.06);
    --shadow-lg: 0 12px 32px rgba(26, 24, 20, 0.08);
  }

  .dark {
    --canvas: #13110E;
    --surface: #1B1814;
    --surface-sunken: #14110D;
    --ink: #F2EDE3;
    --ink-muted: #A8A199;
    --ink-subtle: #6B665E;
    --primary: #2F9576;
    --primary-hover: #38AB89;
    --primary-soft: #1B2D27;
    --accent: #D88547;
    --accent-soft: #2A1F14;
    --border: #2A2620;
    --border-strong: #3A352C;
  }

  body {
    background-color: var(--canvas);
    color: var(--ink);
    font-feature-settings: "ss01", "cv11";
  }

  /* Paper grain background */
  body::before {
    content: "";
    position: fixed;
    inset: 0;
    pointer-events: none;
    opacity: 0.03;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
    z-index: 0;
  }
}
```

Then create `DESIGN-TOKENS.md` at repo root, documenting every token, when to use it, and explicit DON'Ts (no purple gradients, no glassmorphism, etc., per the design prompt).

Configure `next/font/google` in `src/app/layout.tsx`:
- Fraunces → `--font-display`
- Inter Tight → `--font-sans` (default)
- JetBrains Mono → `--font-mono`

**Stop and report.** Wait for approval.

### Step 4 — Auth (NextAuth v5)

1. Set up NextAuth v5 with Prisma adapter. Use `@auth/prisma-adapter` against the `User`, `Account`, `Session`, `VerificationToken` models that already exist in `schema.prisma`.
2. Credentials provider with bcrypt-hashed passwords. Email magic link as secondary (use Resend later; for Phase 0, log magic link to console).
3. Custom session callback: enrich the session with `organisationId`, `role`, and `userId` from the user's active membership.
4. Auth files:
   - `src/auth.ts` — NextAuth config
   - `src/middleware.ts` — protect all routes except `/login`, `/api/auth/*`, `/design-system`
   - `src/app/(auth)/login/page.tsx` — login screen, styled per design tokens
   - `src/app/(auth)/login/actions.ts` — Server Action for credentials login
5. Build the login screen — Fraunces heading "Welcome to Rakshana", subdued paper canvas, simple email+password form. No background image.

**Stop and report.** Demonstrate that an unauthenticated visit to `/` redirects to `/login`. Wait for approval.

### Step 5 — Multi-tenant Prisma extension

This is **the single most important piece of Phase 0.** Get it right.

Create `src/lib/db/prisma.ts`:

```ts
import { PrismaClient } from "@prisma/client";
import { getOrgScope } from "@/lib/auth/scope";

const basePrisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["query", "warn", "error"] : ["error"],
});

// Models that have organisationId (every domain model)
const SCOPED_MODELS = new Set([
  "Donor", "Donation", "ReceiptSeries", "Expense", "Vendor", "ExpenseCategory",
  "PettyCashFloat", "RecurringExpense", "Project", "Beneficiary", "Volunteer",
  "VolunteerActivity", "Form10BDFiling", "Form10BECertificate", "ItFiling",
  "GstInvoice", "GstInvoiceSeries", "GstFiling", "TdsEntry", "TdsChallan",
  "TdsReturn", "LdcCertificate", "BankAccount", "OrgDocument", "Communication",
  "ApprovalPolicy", "Notification", "AuditLog", "ComplianceItem",
  "FinancialYearSummary", "ExpenseApproval",
]);

// Models that should NEVER be auto-scoped (auth, system tables, Organisation itself)
const SYSTEM_MODELS = new Set([
  "User", "Account", "Session", "VerificationToken", "Organisation",
  "Membership", "Role", "Permission", "RolePermission",
  "TwelveARegistration", "EightyGRegistration", "GstRegistration",
  "FcraRegistration", "DarpanRegistration", "CsrOneRegistration",
]);

export const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!SCOPED_MODELS.has(model ?? "")) return query(args);

        const scope = await getOrgScope();
        if (!scope?.organisationId) {
          throw new Error(
            `Tenant scope missing for ${model}.${operation}. Use prisma.$unsafe for system ops.`
          );
        }

        // Inject organisationId for reads
        if (["findFirst", "findMany", "findUnique", "count", "aggregate", "groupBy"].includes(operation)) {
          args.where = { ...args.where, organisationId: scope.organisationId };
        }
        // Inject for writes
        if (operation === "create") {
          args.data = { ...args.data, organisationId: scope.organisationId };
        }
        if (operation === "createMany") {
          args.data = (args.data as any[]).map((d) => ({ ...d, organisationId: scope.organisationId }));
        }
        // Block bulk updates that don't include scope (force explicit)
        if (["updateMany", "deleteMany"].includes(operation)) {
          args.where = { ...args.where, organisationId: scope.organisationId };
        }
        // Update / delete by id — verify the row belongs to the org
        if (["update", "delete"].includes(operation)) {
          args.where = { ...args.where, organisationId: scope.organisationId };
        }

        return query(args);
      },
    },
  },
});

// Escape hatch — for auth, NextAuth adapter, super-admin only.
// Every use of `prismaUnsafe` MUST be documented in REUSE-MAP.md.
export const prismaUnsafe = basePrisma;
```

Then create `src/lib/auth/scope.ts`:

```ts
import { auth } from "@/auth";
import { cache } from "react";

export const getOrgScope = cache(async () => {
  const session = await auth();
  if (!session?.user) return null;
  return {
    organisationId: session.user.organisationId,
    userId: session.user.userId,
    role: session.user.role,
  };
});
```

**Write a smoke test (`src/lib/db/prisma.test.ts`):**
- Mock `getOrgScope` to return `org-A`
- Create a Donor → assert it has `organisationId: "org-A"`
- Mock scope to `org-B` → `findMany` returns zero rows
- Mock missing scope → operations throw

**Stop and report.** Show the test passing. Wait for approval.

### Step 6 — RBAC & permission middleware

1. Create `src/lib/auth/permissions.ts` — a permission matrix keyed on `OrgRole`. Example shape:
   ```ts
   export const PERMISSIONS = {
     "donation.create":   ["OWNER", "ADMIN", "ACCOUNTANT"],
     "donation.cancel":   ["OWNER", "ADMIN"],
     "expense.approve.upto10k":   ["OWNER", "ADMIN", "ACCOUNTANT"],
     "expense.approve.upto100k":  ["OWNER", "ADMIN"],
     "expense.approve.unlimited": ["OWNER"],
     "form10bd.file":     ["OWNER", "ADMIN"],
     "org.settings.edit": ["OWNER"],
     "user.invite":       ["OWNER"],
     "audit.view":        ["OWNER", "ADMIN", "AUDITOR"],
     // ... fully enumerate from the PRD module-by-module
   } as const;
   ```
2. Create `requirePermission(key)` — throws if current session lacks the permission. Used inside Server Actions.
3. Create a small `<Can permission="...">` server component for UI gating (hides buttons/menu items the user can't use).
4. Wire `next-safe-action` to require auth + permission on each action.

**Stop and report.** Wait for approval.

### Step 7 — Audit log middleware

Extend `prisma` (compose with the multi-tenant extension above) with an audit-log hook that fires after every `create`, `update`, `delete`, `updateMany`, `deleteMany` on a SCOPED model.

It writes an `AuditLog` entry containing: `userId`, `organisationId`, `action` (e.g. `donation.create`), `entityType`, `entityId`, `before` (only for update/delete), `after` (for create/update), `ipAddress`, `userAgent`.

For Phase 0, `before` capture can be a follow-up read; if performance later matters, switch to row-level triggers. Document the choice in `CODE-HEALTH.md`.

**Stop and report.** Demonstrate that creating a record produces an `AuditLog` row. Wait for approval.

### Step 8 — App shell layout

Build the shell described in the design prompt:

- `src/app/(app)/layout.tsx` — three-zone layout: sidebar 240px + topbar 60px + main.
- `src/components/shell/Sidebar.tsx` — navigation tree from the design prompt, with section headers and active states.
- `src/components/shell/TopBar.tsx` — page title slot, Cmd+K search input, FY selector chip, notifications bell (placeholder), user menu.
- `src/components/shell/ThemeToggle.tsx` — light/dark switcher via `data-theme` attribute on `<html>`.
- `src/components/shell/CommandPalette.tsx` — shadcn `Command` opened with Cmd+K. Phase 0 stub: searches inside a fixed in-memory list (donors, donations, projects). Real search comes in later phases.

**Stop and report.** Wait for approval.

### Step 9 — Design system page

Create `/src/app/(app)/design-system/page.tsx` (publicly accessible — see middleware) that renders:

- Colour swatches for every token (light + dark side by side)
- Typography ramp: H1 Fraunces, H2 Fraunces, H3 Inter Tight, body Inter Tight, mono JetBrains
- All button variants (primary, secondary, ghost, destructive)
- Input states (default, focus, error, disabled)
- A sample receipt-style card (looks like a printed receipt with placeholder data)
- Sample table with `tabular-nums` numbers and `formatINR` output
- Mode chip variants (Cash, Cheque, NEFT/RTGS, UPI, In-kind)

This page is the visual contract for every later phase. When new components are added, they appear here first.

**Stop and report.** Wait for approval.

### Step 10 — Indian-format utilities

Create `src/lib/format/inr.ts`:

```ts
export function formatINR(value: number | string | Decimal, opts?: { paise?: boolean; sign?: boolean }) {
  // Indian system: 1,84,32,500 not 18,432,500
  // Implementation: split integer + decimal, apply ##,##,##,### grouping
  // Tests: 100 -> "100", 1000 -> "1,000", 100000 -> "1,00,000", 12345678 -> "1,23,45,678"
  // Negative: -1234 -> "-1,234"
}

export function formatINRWithSymbol(value: number | string | Decimal) {
  return `₹${formatINR(value)}`;
}

export function inrInWords(value: number | string | Decimal): string {
  // "Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six only"
  // Indian system: lakhs and crores, NOT millions
}
```

Create `src/lib/format/date.ts`:

```ts
export const IST = "Asia/Kolkata";
export function formatIST(date: Date | string, pattern = "dd MMM yyyy"): string {...}
export function formatISTInput(date: Date | string): string {/* DD/MM/YYYY */}
export function getCurrentFY(): string { /* "2025-26" */ }
```

**Write tests for every function.** Vitest. ~30 assertions total covering edge cases (zero, negative, very large, paise, FY boundaries).

**Stop and report.** Show tests passing. Wait for approval.

### Step 11 — Seed data

Create `prisma/seed.ts` that idempotently creates:

1. One `Organisation`: "Rakshana Trust" with placeholder PAN, registered Bangalore address, FY April–March, deep-green branding.
2. Sub-records: empty `TwelveARegistration`, `EightyGRegistration`, etc. (the Phase 1 profile flow fills these).
3. One `BankAccount` (HDFC current account, marked primary, GENERAL purpose).
4. One `User` with email `lakshmanan@indefine.in`, password `Welcome@2026` (bcrypt-hashed), and a `Membership` to Rakshana Trust as `OWNER`.
5. **Master data** — same shape for every future tenant:
   - `ExpenseCategory` tree: Operations, Programmes, Administration, Capital, Personnel (with children: Salaries, Training, Travel, Office Rent, Utilities, Bank Charges, Audit Fees, Stationery, etc.)
   - `ReceiptSeries`: `RKS/2025-26/` (general) and `RKS-FC/2025-26/` (FCRA)
   - `GstInvoiceSeries`: `INV/2025-26/`
   - `ApprovalPolicy` rows: up to ₹10,000 → ACCOUNTANT, ₹10,001–₹1,00,000 → ADMIN, > ₹1,00,000 → OWNER
6. The system "Anonymous Donations" `Donor` with `isAnonymousBucket: true`.

Wire `prisma db seed` into `package.json`.

**Stop and report.** Run seed; verify Prisma Studio shows the seeded org. Wait for approval.

### Step 12 — Organisation profile (read-only)

Build `/src/app/(app)/settings/organisation/page.tsx` — a read-only display of the org profile, divided into the six tabs from the PRD: Identity, Legal Docs, Tax Compliance, Funding Eligibility, Banking, Branding.

For Phase 0, every field is read-only and renders the seeded values. An `Edit` button is visible but disabled with tooltip "Available in Phase 1." This screen is the first proof that the design system + data layer + auth + tenancy all wire together.

**Stop and report.** Wait for approval.

### Step 13 — Discipline files

Create these at the repo root. Each is meant to be re-read by Claude Code in every future phase.

**`CLAUDE.md`** — project briefing for any future Claude Code session. Contents:
- One-paragraph product description
- Stack summary
- The five non-negotiables (multi-tenant scope, money is Decimal, audit log via extension, Server Actions for mutations, Indian formatting via utilities)
- Coding conventions (file naming, route grouping, Zod-shared schemas)
- How to run the project locally (3 commands)
- Where to find: PRD, schema, design tokens, reuse map

**`CODE-HEALTH.md`** — engineering posture. Contents:
- Type safety: strict mode, no `any` without justified comment
- Error handling: every Server Action returns `Result<Data, AppError>`; never throw raw
- Logging: pino at the edge (Server Actions, API routes); no `console.log` in committed code
- Testing: smoke tests for auth, tenancy, audit, formatters in Phase 0
- Performance budgets (from PRD section 11)
- Bundle hygiene: dynamic-import heavy components (PDF, charts) from Phase 2 onwards

**`SECURITY.md`** — Contents:
- Auth flow + session lifetime
- Password hashing (bcrypt, cost factor 12)
- Multi-tenant scope as the primary defence
- File upload validation (MIME + magic-byte, max sizes)
- Soft-delete on financial records
- Audit log is append-only at the application layer
- Aadhaar storage rule: last 4 only
- Secrets policy: nothing in code, `.env` only, never committed

**`DESIGN-TOKENS.md`** — already created in Step 3; expand it now with the component-level rules from the design prompt (button states, input states, table style, chip tones, empty-state copy style).

**`REUSE-MAP.md`** — start with sections for each layer:
- Auth & session
- Database (extensions, scope, seed)
- Formatting (INR, dates, words)
- Forms (RHF + Zod patterns)
- UI primitives (shadcn-customised)
- Server Action helpers (`safeAction`, `requirePermission`)
- Audit log
- File uploads (placeholder for Phase 2)

As each phase adds reusable units, the new entries must be appended here. The phase-1 prompt will instruct Claude to consult this file before creating new components.

**Stop and report.** Wait for final approval of Phase 0.

---

## Project structure (target end-state of Phase 0)

```
rakshana/
├─ CLAUDE.md
├─ CODE-HEALTH.md
├─ SECURITY.md
├─ DESIGN-TOKENS.md
├─ REUSE-MAP.md
├─ Rakshana-PRD.md            (reference, gitignored or committed — owner's choice)
├─ docker-compose.yml
├─ .env.example
├─ next.config.ts
├─ tsconfig.json
├─ tailwind.config.ts
├─ components.json
├─ prisma/
│  ├─ schema.prisma
│  ├─ seed.ts
│  └─ migrations/
└─ src/
   ├─ auth.ts                        (NextAuth config)
   ├─ middleware.ts                  (route protection)
   ├─ app/
   │  ├─ layout.tsx                  (fonts, theme)
   │  ├─ globals.css                 (design tokens)
   │  ├─ (auth)/
   │  │  └─ login/page.tsx + actions.ts
   │  ├─ (app)/
   │  │  ├─ layout.tsx              (shell)
   │  │  ├─ page.tsx                (dashboard placeholder)
   │  │  ├─ design-system/page.tsx
   │  │  └─ settings/
   │  │     └─ organisation/page.tsx
   │  └─ api/
   │     └─ auth/[...nextauth]/route.ts
   ├─ components/
   │  ├─ shell/                     (Sidebar, TopBar, ThemeToggle, CommandPalette)
   │  ├─ ui/                        (shadcn-customised primitives)
   │  └─ patterns/                  (reusable patterns, e.g. ReadOnlyField)
   ├─ lib/
   │  ├─ auth/
   │  │  ├─ scope.ts
   │  │  └─ permissions.ts
   │  ├─ db/
   │  │  └─ prisma.ts               (extension + scope)
   │  ├─ format/
   │  │  ├─ inr.ts
   │  │  └─ date.ts
   │  ├─ actions/
   │  │  └─ safe-action.ts          (next-safe-action wrapper)
   │  ├─ schemas/                   (Zod schemas, shared client+server)
   │  └─ constants/
   │     └─ tax.ts                  (TDS sections, GST rates, FY)
   └─ tests/                        (vitest)
```

---

## Conventions Claude Code must follow

- **Imports use `@/` alias.** Configure in `tsconfig.json` and `components.json`.
- **Route grouping:** `(auth)` for unauth screens, `(app)` for authed screens. The grouping does not show in URLs.
- **Server Actions** live next to the screen that uses them (`actions.ts`), not in a global folder. Shared actions go under `src/lib/actions/`.
- **Forms** use React Hook Form + Zod resolver, with the Zod schema imported from `src/lib/schemas/`.
- **Error handling:** every Server Action returns `{ data?, error? }`. UI translates errors. Never let exceptions bubble to the toast layer.
- **No client-side data fetching for tables.** Use Server Components + Suspense. Phase 0 has no big tables anyway.
- **No nested ternaries in JSX.** Extract to small components or use early returns.
- **File length cap:** 300 lines. If a file grows past it, split.
- **Component naming:** `PascalCase` for components, `camelCase` for utilities, `kebab-case` for filenames except components.

---

## What to do when uncertain

1. If the **PRD** doesn't cover it and the **schema** doesn't cover it, ask the user before deciding.
2. If two reasonable approaches exist and choosing wrong would be expensive to undo later (e.g. how to model a relation), state both and ask.
3. If a library upgrade or pattern change is required (e.g. NextAuth API change), propose, do not silently change.
4. Never invent fields not present in `schema.prisma`. If you need a new field, propose a schema migration first.

---

## Acceptance for Phase 0

Phase 0 is complete when, in a fresh checkout, the following works:

1. `docker compose up -d`
2. `npm install`
3. `npx prisma migrate deploy`
4. `npm run db:seed`
5. `npm run dev`
6. Visit `localhost:3000` → redirected to `/login`
7. Log in as `lakshmanan@indefine.in` / `Welcome@2026`
8. Land on the dashboard placeholder, see the sidebar + topbar, see the seeded org name in the sidebar header
9. Navigate to `/settings/organisation` and see the seeded org profile read-only
10. Navigate to `/design-system` and see the visual contract
11. `npm test` passes the Phase 0 smoke tests (auth, tenancy, audit, formatters)

When all 11 acceptance criteria pass, write a `PHASE-0-COMPLETE.md` summary at the repo root: what was built, what's deferred, what to do next.

---

**Begin with Step 1.** Plan it out loud, then ask for approval before running any commands.

=== END PROMPT ===

---

## What comes after Phase 0

When Phase 0 is signed off, the next prompt is **Phase 1 — Organisation Profile (editable) + document expiry tracking**. After that:

- Phase 2 — Donor + Donation + 80G receipt PDF (the highest-traffic screens)
- Phase 3 — Expense Management + approval workflow + petty cash + TDS feed
- Phase 4 — Projects + Beneficiaries + Volunteers
- Phase 5 — Form 10BD/10BE + IT compliance + GST + TDS returns
- Phase 6 — Reports, dashboard, compliance calendar, polish, mobile pass

Each phase will get its own prompt file, all calling back to `CLAUDE.md`, `REUSE-MAP.md`, `DESIGN-TOKENS.md`, and the PRD.
