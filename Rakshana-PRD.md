# Rakshana — Trust Management Platform

**Product Requirements Document**

| | |
|---|---|
| Product | Rakshana Trust Management Platform |
| Primary client | Rakshana.org (single trust, MVP) |
| Future scope | Multi-tenant SaaS for Indian NGOs / Section 8 / Trusts |
| Stack | Next.js 15 (App Router) · TypeScript · Prisma · PostgreSQL · NextAuth v5 · Tailwind · shadcn/ui · Tabler icons |
| Owner | Lakshmanan / Indefine |
| Status | Draft v1 — pre-build |

---

## 1. Purpose

Indian charitable trusts and Section 8 companies juggle three workloads simultaneously:

1. **Operations** — donors, donations, projects, beneficiaries, volunteers
2. **Accounting** — receipts, expenses, vendor bills, petty cash, project-wise fund flow
3. **Statutory compliance** — Form 10BD/10BE, ITR-7, Form 10/10B/10BB, 85% application rule, GST returns, TDS returns, FCRA, 12A/80G renewals

Most NGOs glue these together with Tally + Excel + WhatsApp + paper receipts, which produces audit findings, missed deadlines, and lost donor confidence.

Rakshana is one platform that covers all three workloads, optimised for **trustees and accountants who are not technical**, with strong defaults for Indian regulatory formats.

## 2. Goals & Non-Goals

### Goals (MVP)

- Zero-friction donation recording (under 30 seconds per donation, mobile-capable)
- Automatic 80G receipt generation with trust logo + authorised signature
- Form 10BD donor-wise breakup ready for IT portal upload, every May
- Form 10BE certificate generation per donor with bulk download
- Project-wise fund utilisation that auditors can sign off
- Compliance calendar that no trustee can ignore (dashboard + email + WhatsApp reminders)
- Full audit trail — every record shows who created/edited it and when
- Indian number formatting everywhere (₹1,23,45,678 not ₹123,456,78)

### Non-Goals (MVP)

- Replacing Tally / Zoho Books as the primary GL — Rakshana **feeds** them, doesn't replace
- Direct IT portal / GST portal / TRACES filing — we generate the upload files, the user uploads
- Payment gateway / online donation collection (Phase 2 candidate, Razorpay)
- Mobile native apps (responsive web is enough for MVP)
- Multi-language UI (English only for MVP; Tamil/Hindi in Phase 2)

## 3. Personas

| Persona | Primary need | Frequency |
|---|---|---|
| **Trustee / Founder** | Dashboard view, compliance status, donor relationships | Weekly |
| **Accountant** | Daily donation/expense entry, monthly receipts, return prep | Daily |
| **Project Manager** | Project budgets, beneficiary records, utilisation reports | Daily |
| **CA / Auditor** | Read-only access, ledger view, compliance filings, year-end exports | Quarterly + Year-end |
| **Volunteer Coordinator** | Volunteer onboarding, activity assignment, certificates | Weekly |
| **External Auditor (future)** | Read-only scoped access to selected modules | Annual |

## 4. Module Map

| # | Module | Phase | Key Output |
|---|---|---|---|
| 0 | Foundation (auth, RBAC, audit, layout) | 0 | — |
| – | Profile & Trust Identity | 1 | Single source of truth |
| 1 | Donor Management | 2 | Donor master |
| 2 | Donation Recording | 2 | 80G receipts |
| 4 | Expense Management | 3 | Vouchers, TDS feed |
| 9 | Project Management | 4 | Utilisation certificates |
| 10 | Beneficiary Management | 4 | Impact reports |
| 11 | Volunteer Management | 4 | Volunteer certificates |
| 5 | Form 10BD & 10BE | 5 | IT portal CSV + per-donor 10BE PDFs |
| 6 | Income Tax Compliance | 5 | ITR-7 data, 10/10B/10BB trackers, 85% rule monitor |
| 7 | GST Compliance | 5 | GSTR-1 + GSTR-3B data exports |
| 8 | TDS Compliance | 5 | 26Q/24Q, Form 16/16A, Challan 281 |
| 12 | Reports & Dashboards | 6 | Compliance calendar, KPI tiles, exports |
| 13 | Organisation Settings | 0 + 6 | Master config |

## 5. Multi-Tenancy Strategy (Single Now, Multi Later)

Even though MVP is for one trust, every architectural decision is multi-tenant-safe so the migration is non-breaking:

- Every domain table has `organisationId: String` (FK to `Organisation`)
- One row in `Organisation` is seeded for Rakshana on first run
- Every Prisma query is scoped via a Prisma middleware that injects `organisationId` from the session
- NextAuth session carries `organisationId` and `role` of the active membership
- File storage paths are namespaced: `org/{orgId}/donors/{donorId}/pan.pdf`
- Receipt series, GST invoice series, financial year config are per-org
- All compliance numbers (12A, 80G, GSTIN, FCRA, PAN) live on `Organisation`, never hardcoded

When we go multi-tenant in Phase 7+, the only new work is: org creation flow, org switcher, billing/subscription, and a super-admin console. **No data migration.**

## 6. Roles & Permissions (RBAC)

Six built-in roles, each scoped to one organisation:

| Role | Scope |
|---|---|
| `OWNER` | Full access including org settings, billing, user management |
| `ADMIN` | Full operational access, no billing |
| `ACCOUNTANT` | Donations, expenses, vendors, GST, TDS, reports — no user management |
| `PROJECT_MANAGER` | Projects, beneficiaries, volunteers, project-tagged expenses |
| `AUDITOR` | Read-only access to all financial + compliance modules |
| `VIEWER` | Read-only dashboard + reports only |

Permissions are not stored per-role in DB for MVP — they are codified in a `permissions.ts` matrix. A `Role` and `Permission` table exists for future custom roles.

## 7. Module-by-Module Feature Specification

### 7.0 Organisation Profile (the foundation everything references)

**Sections** (matches your DOCX):

1. **Identity** — Org name, charitable purpose, sub-category, phone, email, website, registered address
2. **Legal Documents** — Trust Deed / Registration cert, PAN, authorised signatory
3. **Tax Compliance** — 12A registration number + date + validity, 80G approval number + date + validity, GSTIN (if registered)
4. **Funding Eligibility** — FCRA registration number + validity, NGO Darpan ID, CSR Form CSR-1 reference
5. **Advisors** — CA firm name, partner contact, email
6. **Banking** — Multiple bank accounts (one marked "primary for receipts", one "FCRA-only" if applicable)
7. **Branding** — Logo upload, authorised signature image, receipt header text, footer text

**Document uploads** — every certificate gets: file, issue date, expiry date (where applicable), auto-reminder 60 / 30 / 7 days before expiry.

**Critical:** FCRA bank account is segregated. The system enforces that FCRA donations can only be receipted to FCRA bank accounts.

### 7.1 Donor Management (Module 1)

**Donor profile fields:**
- Name (mandatory)
- Donor type: `INDIVIDUAL | CORPORATE | NRI | ANONYMOUS | TRUST | HUF`
- PAN (mandatory for donations > ₹2,000 to claim 80G; system warns if missing)
- Aadhaar (optional, masked in UI — only last 4 visible)
- Address (full, with state code — required for Form 10BD)
- Contact: phone, email, WhatsApp number (can be same as phone)
- 80G eligibility flag (auto-set based on PAN + donor type)
- FCRA eligibility (only foreign sources)
- CSR donor flag (with CSR company CIN if corporate)
- Tags (custom: e.g. "Major donor", "Recurring", "Alumni")
- Internal notes (visible only to ADMIN+)

**Document uploads:** PAN card, ID proof, CSR Form CSR-1 (for corporate CSR donors).

**Donor history view:** All donations, all communications, total lifetime value, 80G receipts issued list with download.

**Communication log:** Email/WhatsApp/SMS/Call entries with date, subject, body, attachment, sent-by user.

**Anonymous donors:** A single system donor "Anonymous Donations" is auto-created. The 5% / ₹1 lakh anonymous donation limit per Section 115BBC is tracked on this donor with year-on-year alert.

**Search & filter:** by name, PAN, phone, donor type, tag, last donation date.

**Bulk operations:** Import donors from Excel/CSV template.

### 7.2 Donation Recording (Module 2)

**Modes:** Cash, Cheque, DD, NEFT/RTGS/IMPS, UPI, Card, In-kind, Online (gateway placeholder).

**Donation form fields:**
- Donor (search-as-you-type, "+ Add donor" inline)
- Date
- Amount (₹) — for in-kind, value + valuation method
- Mode
- Bank account credited (filtered to org's bank accounts; FCRA filter if foreign donor)
- Cheque/UTR/UPI ref number
- Project / Programme (optional, drives Module 9)
- Purpose (corpus / general / project-specific / CSR-tied)
- 80G eligibility (auto-suggested, editable)
- CSR flag + CSR company CIN if applicable
- Receipt number (auto-generated from active series)
- Remarks

**Receipt series management:**
- Multiple series allowed (e.g. `RKS/2025-26/0001`, separate for FCRA: `RKS-FC/2025-26/0001`)
- Format configurable: prefix + FY + zero-padded counter
- Series locked to a financial year
- Cannot delete a receipted donation — only mark as `CANCELLED` (audit-trail preserved)

**80G receipt PDF (auto-generated):**
- Trust logo, name, address, 80G registration number with validity, PAN
- Donor name, PAN, address
- Donation amount in figures + words (Indian system: "Rupees One Lakh Twenty Three Thousand only")
- Date, mode, receipt number
- "Eligible for deduction under Section 80G(5)(iii) of the Income Tax Act, 1961"
- Authorised signature image
- Generated on save; downloadable; emailable; WhatsApp-able

**In-kind donations:**
- Valuation method recorded (fair market value / cost / appraised)
- Goods description
- These do **not** appear in Form 10BD (cash/banking only)

**CSR donations:**
- Tagged with CSR company CIN
- Linked to a project mandatorily
- Feeds CSR utilisation report

**Anonymous donations:**
- Quick-entry mode (no PAN required)
- Counter towards 115BBC limit shown live

### 7.3 Expense Management (Module 4)

**Expense voucher fields:**
- Date, voucher number (auto-series)
- Vendor / payee (from Vendor master, or "+ New")
- Amount (gross), TDS deduction (with section), net payable
- Mode of payment, bank account debited
- Project tagging (mandatory if expense type = "Project")
- Expense category (chart of accounts: travel, salaries, training, fees, etc.)
- Bill upload (PDF / image)
- GST input credit eligibility flag + amount
- Approval status

**Vendor master:**
- Name, PAN, GSTIN, address, contact
- TDS section default (e.g. for contractor → 194C)
- Bank details for payment

**Approval workflow:**
- Configurable per org: e.g. up to ₹10,000 = ACCOUNTANT only, ₹10,001–₹1,00,000 = ADMIN, > ₹1,00,000 = OWNER
- Pending approval queue per user
- Approval audit trail (who approved, when, notes)

**Petty cash:**
- One or more petty cash floats with float amount + custodian
- Imprest top-up entries
- Daily petty expense entries

**Recurring expenses:**
- Template (e.g. office rent, internet)
- Frequency: monthly / quarterly / yearly
- Auto-creates draft voucher on due date; accountant just verifies and approves

**TDS auto-deduction:**
- When vendor has a default section, TDS is pre-calculated
- TDS rate matrix maintained per section (configurable for FY changes)
- TDS entries auto-flow to Module 8

### 7.4 Project Management (Module 9)

**Project fields:**
- Name, code, description
- Start date, end date
- Total budget (with breakup by category)
- Funding sources (which donors/grants/CSR contributions are tagged)
- Project manager (user assignment)
- Status: `PLANNED | ACTIVE | ON_HOLD | COMPLETED | CANCELLED`

**Fund / grant allocation:**
- Track which donations are earmarked for which project
- Donations with `purpose=project-specific` must be linked to a project
- CSR donations mandatorily linked

**Budget vs Actual tracking:**
- Budget head-wise (training, materials, salaries, etc.)
- Live `Allocated | Spent | Committed | Remaining` per head
- Burn rate calculation

**Utilisation certificate generation:**
- PDF with: project name, donor name, amount received, amount utilised, balance, period, head-wise breakup
- Signed by authorised signatory (image)
- One-click generate per donor per project

**Project-wise income & expenditure report:**
- Standard format auditors expect
- Export to Excel + PDF

### 7.5 Beneficiary Management (Module 10)

**Beneficiary profile:**
- Name, DOB / age, gender, contact, address
- Category (e.g. student, patient, family, women's group)
- Photo + ID proof (optional)
- Programme / scheme enrolment (which projects they belong to)

**Aid / disbursement recording:**
- Date, type (cash / kind / service), value, project linkage
- Receipt acknowledgement (signature image / OTP / photo)
- Links to expense voucher

**Impact tracking:**
- Custom fields per programme (e.g. "scholarship → grade improvement", "medical → outcome")
- Periodic review entries

**Privacy:** Beneficiary data has stricter access (PROJECT_MANAGER + ADMIN only by default; viewable by AUDITOR in aggregate).

### 7.6 Volunteer Management (Module 11)

**Volunteer profile:**
- Name, contact, skills, availability
- Onboarding date, status

**Activity / event:**
- Event name, date, location, required volunteers
- Volunteer assignments

**Attendance log:**
- Per-event check-in / check-out
- Hours auto-calculated

**Volunteer certificate:**
- PDF: trust logo, volunteer name, total hours, activities, period, signature
- Generated on demand or annually

### 7.7 Form 10BD & 10BE (Module 5) — the highest-value compliance feature

**Form 10BD = annual statement of donations** filed with IT department by 31 May each year.

**Form 10BE = donor's certificate** to be issued after 10BD is filed.

**Workflow:**

1. **Year selection** — Pick FY
2. **Auto-collect** — System pulls all eligible donations:
   - Mode ≠ in-kind
   - Donor type ≠ ANONYMOUS
   - Donor has valid PAN
   - Donation date within FY
   - 80G eligible flag = true
3. **Validation panel** — flags problems before generating:
   - Donor missing PAN → action: fix donor profile
   - Donor missing address → action: fix
   - Aggregated by donor (multiple donations to one donor get summed per donation type)
4. **CSV export** — In the exact format the IT 10BD upload utility expects (column order, donation-type codes, identification-type codes)
5. **Mark filed** — After upload to IT portal, accountant enters ARN + filed-on date
6. **10BE generation** — Once marked filed, system generates one 10BE PDF per donor with:
   - Trust details + ARN of 10BD
   - Donor details
   - Aggregate donation amount + type breakup
   - Authorised signatory
7. **Bulk download** — ZIP of all 10BE PDFs; bulk email/WhatsApp to donors

**Anonymous donation handling:**
- Section 115BBC: anonymous donations exceeding higher of (5% of total donations) or ₹1,00,000 are taxable
- Dashboard tile shows live status
- Year-end report flags excess

**Due date reminder:** Dashboard + email + WhatsApp 60 / 30 / 7 days before 31 May.

### 7.8 Income Tax Compliance (Module 6)

**Registration trackers:**
- 12A: number, registration date, validity end date, renewal status, document upload
- 80G: number, approval date, validity end date, renewal status
- Reminders: 6 months / 3 months / 1 month before validity end

**ITR-7 data preparation:**
- Generate the figures required for ITR-7 Schedules
- Income heads: voluntary contributions (corpus / others), grants, interest, other
- Application of income: revenue / capital / accumulated
- 85% application of income calculation (live, year-to-date)
- Corpus donation tracking (separate from general)
- Foreign contribution segregation (FCRA flag)
- Export as: Excel template + JSON aligned to ITR-7 schema

**Form 10 (accumulation):** Tracker for amounts accumulated under Section 11(2) — purpose, period, status.

**Audit reports:**
- Form 10B / 10BB applicability check based on receipts threshold
- Document upload + filing tracker

**85% rule monitor:**
- Live calculation on dashboard
- Tile: "₹X applied of ₹Y receipts = Z%"
- If projecting < 85%, alert with months remaining

### 7.9 GST Compliance (Module 7)

Many trusts are GST-exempt for charitable services but may have taxable activities (e.g. training fees, event tickets).

**Sales invoice creation:**
- Standard GST invoice format
- Invoice series per FY
- HSN/SAC code, taxable value, IGST/CGST/SGST
- Exemption flag with exemption notification reference

**Purchase register:**
- Auto-populated from Expense Management when vendor bill has GST + ITC flag

**GSTR-1 data extraction:**
- Outward supplies summary in GSTR-1 JSON format
- B2B, B2C, exempted, nil-rated breakup

**GSTR-3B data extraction:**
- Monthly summary of outward + inward + ITC + tax payable

**Due date reminders:** 11th of month (GSTR-1), 20th of month (GSTR-3B).

### 7.10 TDS Compliance (Module 8)

**Sections supported (configurable):**
- 192 (Salary)
- 194C (Contractor)
- 194J (Professional)
- 194I (Rent)
- 194H (Commission)
- 194A (Interest)

**TDS deduction log:**
- Populated from Expense Management TDS entries
- Per-deductee, per-section, per-quarter view

**Form 26Q / 24Q data preparation:**
- Quarterly file in NSDL RPU format
- Validation against TDS rules

**Form 16 / 16A generation:**
- Auto-generated per deductee per FY
- Bulk download / email

**Challan 281 tracker:**
- Challan number, BSR code, date, amount per deduction
- Reconciliation against TDS deducted

**Quarterly due dates:** Auto-reminders 15 days / 7 days / day-of for Q1 (31 Jul), Q2 (31 Oct), Q3 (31 Jan), Q4 (31 May).

**Lower deduction certificate (LDC):** Per-deductee LDC upload with validity tracking.

### 7.11 Reports & Dashboards (Module 12)

**Dashboard KPI tiles:**
- Donations this month / FY (with YoY %)
- Expenses this month / FY
- Active projects + total budget
- Beneficiaries served (FY)
- 85% application status (live)
- Anonymous donation limit status
- Compliance items due in next 30 days (count, click to list)
- Bank balance summary

**Compliance calendar:**
- Visual calendar with chips per due date
- Filter by: GST / TDS / IT / FCRA / Internal
- Each entry: due date, item, status (`UPCOMING | DUE | FILED | OVERDUE`), responsible user

**Standard reports:**
- Receipt & Payment Account
- Income & Expenditure Account
- Balance Sheet (basic)
- Fund flow statement
- Donor-wise donation report (with 80G receipt links)
- Project utilisation report (per project, head-wise)
- TDS deduction report (quarterly)
- GST output / input summary
- Audit trail (filter by user, date, module)

**Export:** Every report has Excel + PDF export. Indian comma formatting always.

### 7.12 Organisation Settings (Module 13)

- Trust profile (covered above)
- Financial year configuration (April–March default, editable for non-calendar FY future flexibility)
- Bank account master
- User & role management
- Receipt series configuration
- GST invoice series configuration
- Expense category master (chart of accounts)
- TDS section master with rates
- Notification settings (email server, WhatsApp API token, SMS gateway)
- Signature & logo upload
- Audit trail viewer
- Data export (full Excel dump for backup / migration to Tally)

## 8. User Experience Principles

These are non-negotiable across every screen:

1. **One screen, one task** — Donation recording is one screen. Form 10BD is one wizard. No nested menus to find the action.
2. **Smart defaults from history** — Last-used payment mode, last-used project, last-used bank pre-filled.
3. **Inline validation, plain language** — "PAN looks incorrect (should be 10 characters like ABCDE1234F)" not "RegExp failed."
4. **Indian formatting always** — ₹1,23,45,678 not ₹123,45,678 or ₹12345678. Dates DD/MM/YYYY by default.
5. **Search everywhere — Cmd/Ctrl + K** — Global search jumps to donors, beneficiaries, projects, expenses, receipts.
6. **Bulk operations** — Excel import for donors / beneficiaries; bulk 10BE; bulk receipt download.
7. **Visible audit trail** — Every record shows "Created by X on Y · Last edited by Z on W."
8. **Print-friendly** — Receipts, 10BE certificates, utilisation certificates all match the format trustees / auditors are used to seeing on paper.
9. **Mobile-responsive priority screens** — Donation entry, volunteer attendance, beneficiary check-in.
10. **Empty states with next action** — A blank "Donations" page shows "Record your first donation →" not just a blank table.
11. **Confirmations only for destructive actions** — Cancel donation, delete user, etc. No "Are you sure?" for every save.
12. **Compliance calendar on every dashboard load** — The first thing any trustee sees is "What's due next?"

## 9. Notifications

- **Email** — transactional (Resend or SMTP) — HTML templates similar to SSFI
- **WhatsApp** — for receipts, reminders, 10BE delivery (WhatsApp Cloud API)
- **In-app** — bell-icon notification centre

**Triggered notifications:**
- Donation receipt → donor on save
- 10BE certificate → donor after 10BD filed
- Compliance due in 30/15/7/1 day → responsible user + OWNER
- Approval pending → approver
- 12A / 80G / FCRA expiry approaching → OWNER + Admin
- Monthly summary → trustees

## 10. Security & Audit

- NextAuth v5 with credentials + magic-link option
- Bcrypt password hashing, rate-limited login attempts
- Session timeout 12 hours (configurable)
- All sensitive fields (Aadhaar, PAN partially) masked in UI
- File uploads validated by MIME + magic-byte check
- Every mutation produces an `AuditLog` entry: user, action, entity, before/after JSON, IP, timestamp
- Audit log is append-only, no UI delete
- Soft-delete on all financial records (status flag, never hard delete)
- Daily Postgres backup retained 30 days
- Document files stored in object storage with signed-URL access only

## 11. Performance Targets

- Dashboard load < 1.5s on 4G
- Donation save < 800ms including receipt PDF generation
- Reports export < 5s for 12 months of data
- Bulk 10BE generation: 500 donors < 60s

## 12. Tech Decisions & Conventions

- **Money:** stored as `Decimal(18,2)` in DB, never float
- **Dates:** stored as `DateTime` UTC; UI formats to IST DD/MM/YYYY
- **Number formatting:** centralised utility (matches Vision pattern) — `formatINR(value, options)`
- **Validation:** Zod schemas shared between client + server
- **Forms:** React Hook Form + Zod resolver
- **PDF generation:** PDFKit server-side (same as SSFI)
- **Excel export:** SheetJS (xlsx)
- **Icons:** Tabler icons
- **Typography:** Inter (body) + Inter Tight (headings)
- **Colour palette (suggested for Rakshana brand identity):**
  - Primary: `#1A6E5A` (deep trust-green)
  - Accent: `#D97706` (saffron warmth)
  - Canvas: `#FAFAF7` (warm paper)
  - Ink: `#0F172A`
  - Success / Warning / Error: standard semantic
- **Dark mode:** Toggle from day one (CSS custom properties)
- **i18n-ready:** Strings extracted to `messages/en.json`, even though only English ships in MVP

## 13. Build Phases (Reminder)

| Phase | Scope | Est. duration |
|---|---|---|
| 0 | Foundation: scaffold, schema, auth, RBAC, layout, settings | 1 week |
| 1 | Organisation Profile + document expiry tracking | 0.5 week |
| 2 | Donor Management + Donation Recording + 80G receipts | 1.5 weeks |
| 3 | Expense Management + Vendor master + Petty cash + Approval workflow | 1 week |
| 4 | Project Management + Beneficiary Management + Volunteer Management | 1.5 weeks |
| 5 | Form 10BD/10BE + IT Compliance + GST + TDS | 2 weeks |
| 6 | Reports, Dashboard, Compliance Calendar, polish, mobile pass | 1 week |

Total: ~8.5 weeks of focused build with Claude Code.

## 14. Out-of-Scope (Captured for Phase 2+)

- Razorpay / online donation collection
- Donor-facing portal (self-service donation history + receipt download)
- CSR company portal (corporates upload their CSR Form CSR-2 reports)
- Mobile native apps
- Multi-language UI (Tamil, Hindi)
- Direct integration with Tally / Zoho Books (export-only for now)
- Direct e-filing on IT/GST/TRACES portals
- Bulk SMS via separate gateway
- AI-assisted bank statement classification (you already have this pattern in SKM-to-Tally; can be added)

## 15. Open Decisions for Phase 0 Kickoff

These come up before we cut Phase 0 prompts:

1. **Hosting target** — Hostinger VPS (like SSFI) or Railway?
2. **Object storage** — Cloudflare R2 / AWS S3 / Hostinger object storage?
3. **WhatsApp provider** — WhatsApp Cloud API direct or via Interakt / AiSensy?
4. **Email provider** — Resend / SES / SMTP?
5. **Domain** — `rakshana.org` for the trust site, `app.rakshana.org` for this platform? Or subdirectory?

We can answer these when Phase 0 starts; they don't block schema or PRD.
