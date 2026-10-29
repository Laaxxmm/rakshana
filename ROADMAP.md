# Rakshana — Roadmap (post Phase 6)

Decided 29/10/2026: Rakshana stays the trust's own tool. Phases A–C close the
gaps a single trust feels; Phase D is optional platform polish, built last.
Source of the gap list: `/Users/lakshmanan/Downloads/Reverse/sevastack-vs-rakshana.md`.

**Every item is built under [GUARDRAILS.md](./GUARDRAILS.md).** Read it first.

Legend: `[ ]` todo · `[~]` in progress · `[x]` done · **[STATUTORY]** = stop
for user/CA approval of the design note before code (GUARDRAILS §3).
Each item gets a `Design` sub-section written by the session that builds it.

Order: A → B → C → D. Inside a phase, any order unless "Depends on" says so.

---

## Phase A — books complete and reconcilable

### [~] A1. Restricted (specific) funds — **[STATUTORY]**
Unspent earmarked donations were folded into the General Fund on the Balance Sheet.
- **Built 29/10/2026 (uncommitted on `main`, move to `roadmap/a1-restricted-funds`):**
  `src/lib/services/restricted-funds.ts` (project = fund; received = earmarked
  PROJECT_SPECIFIC/CSR/EARMARKED_GRANT cash donations, spent = APPROVED/PAID
  project expenses, balance floored at 0). Balance Sheet carves one
  "Restricted fund — <project>" line per positive balance out of the General
  Fund (totals unchanged). Projects list "Restricted" column; project page KPI.
  Test: `reports.test.ts` "carves each project's unspent earmarked money…".
- **Open for CA before ticking:** (1) Can a Sec 11(2) `Accumulation` be for a
  specific project? It has no `projectId` today; if yes, it would be carved
  twice. (2) Is a separate "capital asset fund" line wanted for assets bought
  from restricted money? (3) Named corpus sub-funds needed?

### [ ] A2. Fixed deposits / investments — **[STATUTORY]**
- Model `Investment` (type FD/RD/other Sec 11(5) mode, bank, number, principal,
  rate, start, maturity, interest payout cumulative/periodic, TDS deducted by
  bank, funded from GENERAL/CORPUS/project, status ACTIVE/MATURED/CLOSED).
- Placing an FD moves cash → investment (not an expense); maturity moves it back
  plus interest.
- FY interest accrual computed (method agreed with CA: accrual vs receipt).
  Replaces the manual `manualInterestIncome` parameter in I&E and Fund Flow,
  manual override kept.
- Balance Sheet asset line "Investments — fixed deposits"; Cash + Bank reduced.
- Maturity reminders into the compliance calendar (`ComplianceItem`).
- Flag: corpus not invested in a Sec 11(5) mode.
- **Accept:** fixture with 2 FDs across a FY boundary pins accrued interest,
  BS investment line, cash line, I&E interest; tenant-isolation test.

### [ ] A3. Fixed asset register + depreciation — **[STATUTORY]**
- Model `FixedAsset` (name, block, cost, put-to-use date, optional link to the
  capital `Expense`, disposal date/value) and per-FY depreciation rows.
- Book depreciation (method/rates from CA) for I&E and BS net block. Income-tax
  WDV schedule kept separately; **Sec 11(6): no IT depreciation where cost was
  claimed as application** — the ITR-7 figures must not double-claim.
- Half rate when put to use < 180 days in the year (if CA confirms for book basis).
- BS "Fixed Assets" changes from gross capital spend to net block; I&E gains a
  depreciation line. Both conventions documented in the report headers.
- Backfill: create assets from existing capital expenses (script + dry-run).
- **Accept:** fixture pins gross block, depreciation, net block across 2 FYs,
  and that BS still balances by construction; ITR-7 figures test unchanged or
  deliberately updated with CA sign-off.

### [ ] A4. Bank statement import + reconciliation
- Model `BankStatementLine` (bankAccount, date, narration, reference, debit,
  credit, running balance, match → donation / expense / petty-cash top-up /
  investment, status UNMATCHED/MATCHED/IGNORED).
- Import CSV/XLSX with column mapping; presets for the trust's actual banks.
  De-duplicate on (account, date, amount, reference).
- Auto-match: exact amount, date window ±3 days, UTR/cheque no. in narration.
  Never auto-match when more than one candidate fits; leave for manual.
- Reconciliation view per account: statement closing balance vs book balance,
  difference, unmatched lines on both sides (BRS format).
- This becomes the external cross-check the Balance Sheet header asks for.
- **Accept:** fixture statement with matched, ambiguous and unmatched lines;
  BRS difference zero after manual matches; re-import creates no duplicates.

### [ ] A5. Dashboard to-do + accounting health
Derived only, no new tables: overdue/near compliance items, donations awaiting
realisation/receipt, expenses awaiting approval, unmatched bank lines (after
A4), FDs maturing in 30 days (after A2), restricted funds unspent past project
end date. Each row links to the screen that resolves it.
- **Accept:** page test with stubbed counts; each link resolves.

### [ ] A6. Auditor access with expiry
`OrgRole.AUDITOR` already exists. Add `Membership.expiresAt`; auth denies
expired memberships; confirm AUDITOR is read-only across every safeAction and
can download reports/exports. Invite flow sets the expiry.
- **Accept:** RBAC matrix test covers AUDITOR on every permission key; expired
  membership cannot sign in or act.

### [ ] A7. Tally export (XML)
- Ledger mapping settings: expense categories, bank accounts, donation purposes
  → Tally ledger names.
- Export a period as Tally XML: Receipt vouchers (donations), Payment vouchers
  (expenses, net of TDS), Journal (TDS payable), Contra (petty-cash top-ups).
- **Accept:** golden-file test of the XML for a fixture; manual check: imports
  into a TallyPrime test company without errors (user/CA verifies).

### [ ] A8. Uploads to R2
`src/lib/storage` has an R2 stub; Railway's filesystem is ephemeral
(OPERATIONS.md). Implement the R2 adapter, a one-off migration script for
existing files (dry-run first), env vars in `.env.example` + OPERATIONS.md.
- **Accept:** adapter test against a mocked S3 client; signed-URL streaming
  via `/api/files` unchanged for callers.

---

## Phase B — trust operations off paper

### [ ] B1. Governance
Models `BoardMember` (name, designation, PAN, DIN if any, appointed, term end,
KYC docs), `Meeting` (BOARD/AGM/EGM, date, notice sent date, quorum required /
present, attendees, minutes doc, status), `Resolution` (number from
`sequence-allocator`, e.g. `RES/FY/NNN`; text; meeting or circular; votes;
status), `Policy` (name, version, effective from, next review, doc).
Term ends and policy reviews feed the compliance calendar. Minutes PDF via the
existing PDF helpers.
- **Accept:** resolution numbering concurrency test (reuse allocator pattern);
  reminders appear in the calendar; tenant-isolation tests.

### [ ] B2. In-kind donations — **[STATUTORY]**
`Donation.isInKind` / `inKindDescription` / `inKindValuationMethod` already
exist. Add the UI, item quantity/unit, stock status (in stock / distributed /
in use), and a non-80G acknowledgement (in-kind gifts are not 80G-deductible;
wording from CA). Optional link to B6 inventory.
- **Accept:** in-kind never gets an 80G receipt or a 10BD row; test covers it.

### [ ] B3. Public project page + donation page + recurring
- Public route per project (`/give/<org-slug>/<project-code>`): progress,
  description, donate button. Middleware allowlist; no donor PII shown.
- Recurring donations via Razorpay Subscriptions; webhook books each charge as
  a Donation (captured amount, as the existing webhook does) with its receipt.
- Embed snippet (button linking to the page).
- **Accept:** webhook test for a subscription charge; public page renders with
  no session; input validation and rate-limit/honeypot on the form.

### [ ] B4. Outreach broadcasts
`Campaign` (name, channel EMAIL/WHATSAPP, segment filter, body/template,
schedule, status) sending through the existing notify adapters and
`Notification` queue. Segment by donor type, project, last gift date, FCRA.
Donor consent + unsubscribe (`Donor.marketingConsent`, unsubscribe link);
WhatsApp only with approved templates. Sends use console adapter outside prod.
- **Accept:** segment query test; unsubscribed donors excluded; no real sends in tests.

### [ ] B5. Tasks
`Task` (title, assignee, due, status, optional link type/id to any record,
optional meeting for action items). "My tasks" on dashboard (A5).

### [ ] B6. Inventory (optional — only if the trust holds stock)
`StockItem`, `StockMovement` (in/out, quantity, source: purchase / in-kind /
distribution to beneficiary). Low-stock threshold.

### [ ] B7. Purchase orders (optional)
Quote → PO (number from allocator) → approval via existing `approval-policy`
→ goods received → convert to `Expense` with the PO linked.

### [ ] B8. One-page board report
PDF from existing report data: income, expenditure, cash + bank, restricted
funds, project budget vs spent, compliance status. Reuses report renderers.

---

## Phase C — HR & payroll (only if staff are paid through the trust's books)

### [ ] C1. HR core
`Employee` (personal, PAN, UAN, ESIC no., bank, department, designation, join
date, employment type), `Department`, `Holiday`, leave types/requests/balances,
attendance (manual daily; optional mobile punch with location later).

### [ ] C2. Reimbursements
Claim with bills → existing approval policy → books an `Expense` with the
employee as payee, project/budget head tagged.

### [ ] C3. Payroll — **[STATUTORY]**
Depends on C1. Salary structure; monthly run; PF, ESI, Professional Tax (state
of the trust), TDS u/s 192 reusing `tax-calc` and feeding the existing 24Q.
Payslip PDF, salary register, PF ECR file, Form 16 data. Every rate, ceiling
and slab in a cited, FY-versioned constants module, signed off by the CA.
- **Accept:** fixture payroll for 4 employees (below/above PF wage ceiling,
  ESI eligible/not, with/without TDS) pins every deduction and net pay;
  24Q figures reconcile with payroll TDS.

### [ ] C4. HR reports
Salary register, attendance muster, leave register, PF/ESI summaries (Excel/PDF).

---

## Phase D — optional platform polish (build last, only if wanted)

- [ ] D1. Getting-started checklist (org profile, registrations, bank, receipt series, team)
- [ ] D2. Custom fields on donors / beneficiaries / projects
- [ ] D3. Full data backup download (zip of JSON + uploaded files)
- [ ] D4. DPDP: consent records, data-access/erasure request log with due dates
- [ ] D5. Sent-communications log with delivery status (from notify adapters)
- [ ] D6. Certificate/receipt QR verification public page
- [ ] D7. Donor reviews/testimonials (approved before shown on B3 pages)
- [ ] D8. Read-only REST API with org-scoped API keys; MCP server on top of it
- [ ] D9. Simple public trust website from org profile + B3 project pages

**Out of scope** (SaaS-only, revisit only if Rakshana is ever offered to other
NGOs): plans & billing, module toggles, referral, CSR AI proposals, social
scheduler, grant discovery, goods marketplace, ID cards, visitor book, hiring,
staff scorecard.

---

## Session prompt (paste into a Claude Code session opened in this folder)

```
Work on Rakshana roadmap item <ID> (e.g. A2). If I gave no ID, pick the first
unchecked item in ROADMAP.md whose dependencies are done, and tell me which.

1. Read, in order: AGENTS.md, README.md (five non-negotiables), GUARDRAILS.md
   (all of it), REUSE-MAP.md, CODE-HEALTH.md, the ROADMAP.md entry for the
   item, and the latest round in BUILD-LOG.md. Then read every file the item
   touches end to end, and grep every caller of anything you will change.

2. Check the environment per GUARDRAILS §7: rakshana-postgres running on
   5432, .env.test.local pointing at it, deps installed, prisma generated.
   Never touch the database on port 5433.

3. Write a "Design" sub-section under the item in ROADMAP.md: data model
   changes, files to touch, what you reuse (cite REUSE-MAP entries), statutory
   basis with citations, and a hand-computed test fixture with expected
   figures. If the item is [STATUTORY], or any rate/threshold/legal reading
   or any existing statement figure is involved, STOP here, show me the
   design note and wait for my approval.

4. Create branch roadmap/<id>-<slug> from main. Write the failing tests from
   the fixture first, then the smallest code that passes them. No scope
   creep: bugs found in passing go to BUILD-LOG "Known, not fixed".

5. Run the verification gate (GUARDRAILS §9) and paste the real output:
   npx tsc --noEmit · npm test · npx eslint <touched files> ·
   env -u DATABASE_URL npx next build (if pages/routes changed).
   If anything fails, fix it or report it. Don't call the item done.

6. Finish per GUARDRAILS §10: tick the item in ROADMAP.md, add a BUILD-LOG
   round with the results table, update REUSE-MAP.md / CODE-HEALTH.md where
   relevant, commit on the branch (conventional message), do not push.

7. Report: what changed (files), test/gate results, any deviation from the
   design note, and questions for the CA.
```
