# Rakshana — Security posture

## Authentication

- **NextAuth v5** with JWT sessions. Session lifetime: **12 hours**
  (`maxAge: 60 * 60 * 12` in `src/auth.ts`).
- Credentials provider with **bcrypt cost factor 12**. Magic-link provider
  is wired but ships in Phase 2 (currently logs the link to console).
- `AUTH_SECRET` must be 32+ bytes from a secure RNG. Generate with
  `openssl rand -base64 32`. Never commit `.env`.
- Login is **rate-limited per IP** — to be added in Phase 2 alongside the
  email provider (`upstash/ratelimit` or `next-safe-action`'s built-in).

## Multi-tenancy: the primary defence

The Prisma extension in `src/lib/db/prisma.ts` injects `organisationId` into
every read and write on a scoped model and throws when there is no session.
**Bypassing this is a security incident.**

Only the following code paths may import `prismaUnsafe`:

1. **NextAuth adapter** in `src/auth.ts` — reads/writes User, Account,
   Session, VerificationToken.
2. **Seed script** `prisma/seed.ts` — runs outside an HTTP session.
3. **The org profile page** `src/app/(app)/settings/organisation/page.tsx`
   uses `prismaUnsafe.organisation.findUnique({ id: scope.organisationId })`
   to fetch the single tenant row by id, then proves identity via the
   `scope`.

Every additional caller of `prismaUnsafe` must be added to
[`REUSE-MAP.md`](./REUSE-MAP.md) with justification.

## Authorisation (RBAC)

- Permission matrix in `src/lib/auth/permissions.ts`. Keys follow
  `module.action[.qualifier]`.
- `requirePermission("…")` in Server Actions enforces the check. UI affordances
  use the `<Can permission="…">` Server Component — it's convenience only;
  the real defence is server-side.
- Six built-in roles. Custom roles via `Role` + `Permission` tables are
  reserved for Phase 2+.

## File uploads (Phase 1+ — placeholder here)

- MIME + magic-byte verification on every upload.
- Per-org namespaced paths: `org/{orgId}/donors/{donorId}/pan.pdf`.
- Object storage uses signed URLs with a short TTL. No public buckets.
- PAN scans, ID proofs, Aadhaar imagery are flagged as "Sensitive PII" in
  the document table and access-gated by `donor.notes.view`.

## Sensitive data handling

- **Aadhaar**: only the last 4 digits are stored (`Donor.aadhaarLast4`).
  Never store the full 12-digit Aadhaar.
- **PAN**: stored uppercase, masked except last 4 in lists/tables (unmasked
  on the 80G receipt PDF).
- **Email / phone**: stored as-typed; OTP verification deferred to Phase 2.

## Audit trail

- Every successful mutation on a scoped model creates an `AuditLog` row via
  the Prisma extension. The hook is in `writeAuditEntry()` of
  `src/lib/db/prisma.ts`.
- AuditLog rows have no UI delete and no app-level update path.
  Application-layer append-only.
- `ipAddress` and `userAgent` are captured per request in Phase 1
  (currently null — see CODE-HEALTH.md).

## Soft delete on financial records

- `Donation.status = CANCELLED`, `Expense.status = CANCELLED`, etc. Never
  `DELETE FROM donation`.
- Reports filter on `status` to exclude cancelled rows.

## Secrets

- `.env` is gitignored. Only `.env.example` is committed.
- Never log secrets, tokens, or password hashes. The pino redaction config
  lists fields to scrub (Phase 1).
- Database password lives in `.env` (`POSTGRES_PASSWORD`); the prod
  password is rotated quarterly.

## Backups

- Local dev: `docker compose down -v` will wipe the volume; that's OK for
  dev. Prod: daily `pg_dump`, retained 30 days, copied to a separate
  region (Phase 6 deploy).

## Threat model summary

| Threat                                  | Defence                                     |
|-----------------------------------------|---------------------------------------------|
| Cross-tenant data leak                  | Prisma scope extension + smoke test         |
| Privilege escalation within an org      | `requirePermission` on every mutation       |
| Session hijack                          | 12h JWT, AUTH_SECRET rotated, HTTPS in prod |
| SQL injection                           | Prisma parameterisation                     |
| Stored XSS in donor notes               | React auto-escapes; sanitise before PDF gen |
| CSRF on Server Actions                  | Next.js sets the Origin check               |
| Audit-log tampering                     | No app-layer mutation path on `AuditLog`    |
| Brute-force login                       | Rate-limit (Phase 2)                        |
