# Rakshana — Operations Guide

How to deploy + operate Rakshana on Railway, plus the day-to-day
runbook for incidents, backups, and routine maintenance.

---

## 1. First-time Railway deployment

### Prerequisites

- GitHub repo connected: https://github.com/Laaxxmm/rakshana
- Railway account: https://railway.com
- Gmail App Password (for SMTP) — see "Email & WhatsApp" below

### Steps

1. **Create the Railway project**
   - Railway dashboard → **New Project** → **Deploy from GitHub repo**
   - Pick `Laaxxmm/rakshana`
   - Railway auto-detects Next.js via Nixpacks

2. **Add the Postgres plugin**
   - In the project → **+ New** → **Database** → **Add PostgreSQL**
   - Railway injects `DATABASE_URL` into your app service automatically.
     Confirm under your app's **Variables** tab — you should see
     `DATABASE_URL` showing as a *reference* (not a literal string).

3. **Set the required environment variables**

   In your app service → **Variables** tab → add:

   | Variable | Value | Notes |
   |---|---|---|
   | `AUTH_SECRET` | output of `openssl rand -base64 32` | Different from dev value |
   | `AUTH_URL` | `https://<your-railway-domain>.up.railway.app` | Update after first deploy gives you a domain |
   | `AUTH_TRUST_HOST` | `true` | Required behind Railway's edge proxy |
   | `STORAGE_BACKEND` | *(unset)* | Defaults to `postgres`, which needs nothing else. Set `r2` only with the four `R2_*` vars — see §6. Never `local` |
   | `EMAIL_DRIVER` | `smtp` | or `console` for testing |
   | `SMTP_HOST` | `smtp.gmail.com` | |
   | `SMTP_PORT` | `465` | |
   | `SMTP_SECURE` | `true` | |
   | `SMTP_USER` | `you@gmail.com` | |
   | `SMTP_PASS` | `<16-char Gmail App Password>` | Create at https://myaccount.google.com/apppasswords |
   | `EMAIL_FROM` | `Rakshana Trust <you@gmail.com>` | Must match `SMTP_USER` |
   | `WHATSAPP_DRIVER` | `link` | Click-to-chat — no other vars needed |

   Don't set `DATABASE_URL`, `PORT`, `NODE_ENV`, or
   `RAILWAY_GIT_COMMIT_SHA` — Railway injects them.

4. **Trigger the first deploy**

   - Push to `main` (or click **Deploy** in Railway)
   - Watch the build logs. `nixpacks.toml` defines the build:
     1. `npm install --legacy-peer-deps --include=dev` (installs deps;
        `postinstall` regens the Prisma client)
     2. `npx prisma generate` (regen as belt-and-braces)
     3. `npx next build` (compiles the app)
   - Migrations do not run in the build — Railway only injects
     `DATABASE_URL` at runtime. They run from `deploy.preDeployCommand`
     in `railway.json` (`npx prisma migrate deploy`), after the build
     and before the container starts.
   - Then `npm run start` boots the server on Railway's `$PORT`
   - Health check `/api/health` must return 200 before Railway marks
     the deploy live. If it 503s, check the **Deploy Logs** for
     `prisma:error` lines.

5. **Seed the production database (one-off, just after first deploy)**

   - Railway → app service → **Settings** → **Shell** (or use the
     Railway CLI: `railway shell`)
   - Run: `npm run db:seed:prod`
   - This creates the seed user `lakshmanan@indefine.in` with the
     default password `Welcome@2026`.
   - **Immediately sign in and change the password** at
     **/settings/account** (account menu → *Settings* → *Your account ·
     change password*). The default is in the repo and not safe for
     production.
   - The seed writes that password only when it creates the user. Re-running
     `db:seed:prod` on a populated database leaves an already-rotated
     password alone, so it will not undo this step.

6. **Add a custom domain (optional)**

   - Railway → app service → **Settings** → **Domains** → **Custom Domain**
   - Add `app.rakshana.org` (or whatever you registered)
   - Update DNS: CNAME → the railway domain shown
   - Update `AUTH_URL` to the new domain → redeploy

### Deploy verification checklist

- [ ] `https://<domain>/api/health` returns `{"status":"ok"}`
- [ ] `/login` page loads (no 500 from middleware)
- [ ] Sign in works · receipt PDF generates · WhatsApp button opens wa.me
- [ ] `/compliance/calendar` populates after clicking **Refresh calendar**

---

## 2. Subsequent deploys

Just push to `main`:

```bash
git push origin main
```

Railway auto-deploys on every push. If a migration fails the deploy
fails — your previous version stays live. Fix the migration locally,
push again.

To deploy a hotfix branch:
```bash
git push origin hotfix/some-fix
```
Then in Railway → **Deployments** → choose the branch.

---

## 3. Email & WhatsApp configuration

### Gmail SMTP (free, 500 emails/day)

1. Enable 2FA on the Gmail account
2. https://myaccount.google.com/apppasswords → create one for "Mail"
3. Set `SMTP_*` env vars per the table above
4. Send-from address must match `SMTP_USER` — Gmail enforces this

### WhatsApp click-to-chat (free, manual send)

`WHATSAPP_DRIVER=link` — no setup. The app builds `wa.me/<number>?text=...`
URLs. The user clicks **WhatsApp** in the donation drawer; a tab opens
with WhatsApp Web (or the mobile app) carrying the pre-filled message.
They attach the receipt manually and tap Send.

### Upgrade paths (not built yet)

- `EMAIL_DRIVER=resend` → see `.env.example` for Resend API key vars
- `WHATSAPP_DRIVER=cloud` → Meta WhatsApp Cloud API (business
  verification required); see `src/lib/notify/channels/whatsapp-cloud.ts`

---

## 4. Database backups

**Railway plugin backups** — automatically taken nightly by Railway's
Postgres plugin. Restore via Railway dashboard → Postgres plugin →
**Backups** → pick a snapshot.

**Manual backup before risky changes:**

```bash
railway run pg_dump $DATABASE_URL > backup-$(date +%Y%m%d).sql
```

Restore:

```bash
railway run psql $DATABASE_URL < backup-20260601.sql
```

A scheduled cron-driven backup-to-R2 is planned for Phase 6 polish but
not yet wired.

---

## 5. Cron jobs (planned, not yet deployed)

Phase 5 built the runners. Phase 6 polish will deploy them as Railway
cron services. The runners are idempotent so manual triggering remains
safe:

- `runRecurringExpenseGeneration` → click **Run now** on `/recurring-expenses`
- `generateRecurringItems` → click **Refresh calendar** on `/compliance/calendar`

When cron ships, scheduled invocations will write `JobRun` rows.

---

## 6. Storage backend

**`STORAGE_BACKEND=postgres`** is the default and needs no configuration. Logos,
signatures, donor KYC documents, receipts / vouchers and report PDFs are stored
as rows alongside everything else, so they are covered by the same backups and
survive a redeploy. At this trust's volume — roughly 80 documents a month — the
table stays small.

> ⚠️ **`local` loses files on Railway.** Containers are ephemeral: every
> restart and redeploy resets the filesystem, taking every uploaded file with
> it. Receipts generated before August 2026 were lost this way. `local` is for
> development only, and the app now refuses it in favour of `postgres` unless
> `LOCAL_STORAGE_ROOT` names a path you have chosen deliberately.

**`STORAGE_BACKEND=r2`** stores the same keys as objects in Cloudflare R2
(S3-compatible). Content-type is kept as native object metadata. Reads are
still proxied through `/api/files/[...]` so the org-scope check runs on every
request — the bucket stays private, no public or presigned URLs.

**Setting up Cloudflare R2:**

1. Cloudflare → R2 → create a bucket, e.g. `rakshana-prod`. Leave public
   access **disabled**.
2. R2 → Manage R2 API Tokens → create a token with **Object Read & Write**
   scoped to that bucket. Copy the Access Key ID and Secret Access Key — the
   secret is shown once.
3. Note the Account ID from the R2 overview page; the adapter talks to
   `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com` with region `auto`.
4. Add Railway env vars:
   - `STORAGE_BACKEND=r2`
   - `R2_ACCOUNT_ID=<cloudflare account id>`
   - `R2_ACCESS_KEY_ID=<token id>`
   - `R2_SECRET_ACCESS_KEY=<token secret>`
   - `R2_BUCKET_NAME=rakshana-prod`
5. Redeploy, then upload an org logo and reload the branding page. If a var
   is missing the request fails with `[storage] STORAGE_BACKEND=r2 but
   missing env: …` naming it — the client is built on first use, so a
   misconfigured deploy still boots.
6. Migrating existing files: copy the container's `/.uploads` tree into the
   bucket preserving relative paths (`rclone copy .uploads r2:rakshana-prod`).
   Skip the `.meta.json` sidecars — they are a local-adapter detail; set the
   content-type on the objects instead, or re-upload through the app.

---

## 7. Incident playbook

### Site is down

1. Railway → Deployments → **Logs** — look for `prisma:error`,
   `Error:`, or repeated `503` lines
2. Common causes:
   - DB connection limits exhausted → restart the app service
   - A new migration failed → check the deploy log
   - Auth secret rotated and old session cookies are 401-ing → users
     re-sign in; not really an outage
3. If unrecoverable: Railway → Deployments → pick the **last good
   deploy** → click **Redeploy**

### Receipts not generating

- `prisma:error` in logs → DB connection issue
- `ENOENT … /ROOT/.../pdfkit/...` → check `next.config.ts` still has
  `serverExternalPackages: ["pdfkit", "exceljs", "pdf-parse"]`
- Specific donor failing → that donor is missing PAN or address;
  check the donor profile

### Email not sending

- Gmail SMTP throwing `Invalid login` → App Password expired or the
  account was reset; regenerate it
- Daily limit hit (500/day on Gmail) → bump to Resend by switching
  `EMAIL_DRIVER` to `resend` and setting `RESEND_API_KEY`

### WhatsApp link opens but message is blank

- The receipt URL embedded in the message uses `AUTH_URL` — make sure
  it's set to the public Railway domain, not `http://localhost:3000`

### Changing a password (routine)

Anyone who can still sign in changes their own password in the app:
**account menu → Settings → "Your account · change password"**, or go
straight to `/settings/account`. The form asks for the current password,
the new one, and a confirmation; the current password is re-checked against
the stored hash server-side before anything is written.

The new password must be at least 12 characters with an upper-case letter, a
lower-case letter and a digit, and at most 72 bytes (bcrypt ignores anything
past 72). Rules live in `src/lib/schemas/user.ts`.

There is no self-service "forgot password" email — a user who cannot sign in
needs the reset below run by someone with database access.

### Forgot the OWNER password

If only one OWNER exists and they're locked out, rewrite the hash directly.
The column is `User.passwordHash`; cost factor 12 matches the seed and
`SECURITY.md`.

```bash
railway run npx tsx -e "
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
(async () => {
  const prisma = new PrismaClient();
  const passwordHash = await bcrypt.hash('NewPass@2026', 12);
  await prisma.user.update({
    where: { email: 'lakshmanan@indefine.in' },
    data: { passwordHash },
  });
  console.log('reset');
  process.exit(0);
})();
"
```

The async IIFE is not decoration: `tsx -e` compiles to CommonJS and rejects
top-level `await` outright.

Pick a temporary password that satisfies the rules above, then sign in and
rotate it at `/settings/account` — the one in this file is public.

Re-seeding is **not** a password reset: `prisma/seed.ts` writes the password
only in its `create` branch, so `db:seed:prod` against an existing owner
leaves the current hash untouched.

---

## 8. Routine maintenance

- **Daily** — glance at Railway → **Metrics** for CPU / memory / errors
- **Weekly** — check Postgres connection count + DB size; check
  `/notifications` for any failed dispatches
- **Monthly** — verify a Railway Postgres backup can restore to a
  scratch DB (the *I tested my backup* drill)
- **Quarterly** — rotate `AUTH_SECRET` and `SMTP_PASS`; ensure 2 OWNER
  users exist
