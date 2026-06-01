/**
 * Models with an organisationId column — auto-scoped reads and writes.
 * The Prisma extension injects organisationId into every where/data clause
 * and rejects operations when the session scope is missing.
 *
 * Verified by reading prisma/schema.prisma: every model in this set has
 * `organisationId String` (some with `@unique`).
 */
export const SCOPED_MODELS = new Set<string>([
  // Org sub-records (unique per org)
  "TwelveARegistration",
  "EightyGRegistration",
  "GstRegistration",
  "FcraRegistration",
  "DarpanRegistration",
  "CsrOneRegistration",

  // Domain — donors, donations, communications
  "OrgDocument",
  "BankAccount",
  "Donor",
  "Communication",
  "ReceiptSeries",
  "Donation",

  // Expenses
  "Vendor",
  "ExpenseCategory",
  "Expense",
  "ApprovalPolicy",
  "PettyCashFloat",
  "RecurringExpense",

  // Projects / Beneficiaries / Volunteers
  "Project",
  "Beneficiary",
  "Volunteer",
  "VolunteerActivity",

  // Filings & compliance
  "Form10BDFiling",
  "Form10BECertificate",
  "ItFiling",
  "FinancialYearSummary",
  "GstInvoiceSeries",
  "GstInvoice",
  "GstFiling",
  "TdsEntry",
  "TdsChallan",
  "TdsReturn",
  "LdcCertificate",
  "ComplianceItem",

  // System per-tenant
  "Notification",
  "AuditLog",
]);

/**
 * Models without an organisationId column but still tenant-private.
 * Tenancy is enforced via the parent relation (e.g. an ExpenseApproval
 * is only reachable through its scoped Expense). The extension passes
 * these through unchanged.
 */
export const PARENT_SCOPED_MODELS = new Set<string>([
  "DonorDocument",
  "ExpenseApproval",
  "PettyCashTopUp",
  "ProjectBudgetHead",
  "GrantAllocation",
  "UtilisationCertificate",
  "BeneficiaryEnrolment",
  "BeneficiaryDisbursement",
  "ImpactRecord",
  "VolunteerAssignment",
  "VolunteerCertificate",
]);

/**
 * True system tables — never scoped. Used by NextAuth, RBAC config,
 * and tenant management.
 */
export const SYSTEM_MODELS = new Set<string>([
  "User",
  "Account",
  "Session",
  "VerificationToken",
  "Organisation",
  "Membership",
  "Role",
  "Permission",
  "RolePermission",
]);
