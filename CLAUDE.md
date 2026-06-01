# Rakshana — Claude Code briefing

You are working on **Rakshana**, a Trust Management Platform for Indian
charitable trusts and Section 8 companies. The product covers operations
(donors, donations, projects, beneficiaries), accounting (expenses, vendor
bills, petty cash), and statutory compliance (Form 10BD/10BE, ITR-7, GST,
TDS, FCRA). The platform is multi-tenant from day one — every MVP feature
must work for any number of tenant organisations.

The full spec is in [`Rakshana-PRD.md`](./Rakshana-PRD.md). The data model is
in [`prisma/schema.prisma`](./prisma/schema.prisma). The Phase 0 build prompt
is in [`Phase-0-Prompt.md`](./Phase-0-Prompt.md). Read these before changing
schema or scope.

## Stack

- **Next.js 16** (App Router, Server Components by default, TypeScript strict)
- **Prisma 6** + **PostgreSQL 16** (Docker Compose locally)
- **NextAuth v5** (credentials + JWT session)
- **Tailwind 4** with CSS-variable design tokens (NOT default Tailwind palette)
- **shadcn/ui** (base-nova style), customised to Rakshana tokens
- **Tabler Icons** via `@tabler/icons-react`
- **React Hook Form + Zod** for forms, **next-safe-action** for Server Actions
- **Decimal.js** for money; **date-fns** + **date-fns-tz** (IST) for dates
- **pino** for structured logging; **vitest** for tests
- Fonts: **Fraunces** (display), **Inter Tight** (body), **JetBrains Mono** (numbers)

## The five non-negotiables

1. **Multi-tenant scope is mandatory.** Every domain query goes through
   `prisma` (the scoped client in `src/lib/db/prisma.ts`). The extension
   throws when there is no session. The unsafe client `prismaUnsafe` exists
   only for auth, seed, and super-admin work — every other use of it must be
   documented in `REUSE-MAP.md`.

2. **Money is Decimal(18,2).** Never `number`. Never `parseFloat`. Use
   `decimal.js` everywhere, including Zod schemas. UI formatting goes through
   `formatINR` in `src/lib/format/inr.ts`.

3. **Mutations flow through Server Actions wrapped by `safeAction`.** They
   require auth and optionally a `requires: "permission.key"` metadata. The
   audit log is written automatically by the Prisma extension — never call
   `prisma.auditLog.create` by hand.

4. **Indian formatting is centralised.** Lakhs and crores, never millions:
   `₹1,84,32,500` from `formatINR`; DD/MM/YYYY from `formatISTInput`; FY
   from `getCurrentFY()` (April–March).

5. **Reuse before rewrite.** Check `REUSE-MAP.md` before creating a new
   utility, component, or pattern. Append to it as you ship reusable units.

## Coding conventions

- `@/` alias → `src/`. Set in `tsconfig.json` and `components.json`.
- Route groups: `(auth)` for unauth screens, `(app)` for authed screens. The
  grouping is not visible in URLs.
- Server Actions live next to their screen (`actions.ts`); shared ones go in
  `src/lib/actions/`.
- Forms use React Hook Form + Zod resolver; the Zod schema lives in
  `src/lib/schemas/` and is imported by both the form and the action.
- File length cap: 300 lines. Split when you cross.
- Component naming: `PascalCase` for components, `camelCase` for utilities,
  `kebab-case` for filenames except components.
- No client-side data fetching for tables — Server Components + Suspense.
- No nested ternaries in JSX. Extract or use early returns.

## Run it locally

```bash
docker compose up -d         # Postgres on :5432
npm install
npx prisma migrate deploy
npm run db:seed              # owner: lakshmanan@indefine.in / Welcome@2026
npm run dev                  # http://localhost:3000
npm test                     # smoke suite
```

## Where things live

- **PRD** → `Rakshana-PRD.md`
- **Phase 0 prompt** → `Phase-0-Prompt.md`
- **Schema** → `prisma/schema.prisma`
- **Design tokens** → `src/app/globals.css` + `DESIGN-TOKENS.md`
- **Reuse map** → `REUSE-MAP.md`
- **Security posture** → `SECURITY.md`
- **Code-health bar** → `CODE-HEALTH.md`

When unsure, defer to the PRD for scope, the schema for data shape, and
`DESIGN-TOKENS.md` for visuals. If two reasonable approaches exist and the
wrong one is expensive to undo (a schema relation, an auth design),
**state both and ask** before writing code.
