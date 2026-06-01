import type { OrgRole } from "@prisma/client";

/**
 * RBAC permission matrix.
 *
 * Keys follow `{module}.{action}` (or `{module}.{action}.{qualifier}`).
 * Values list the roles that can perform the action. The list is the source
 * of truth — every Server Action and route handler must call
 * `requirePermission(key)` before mutating state.
 *
 * If you need a role with custom permissions, use the `Role` / `Permission`
 * tables (Phase 2+). Built-in roles are immutable.
 */
export const PERMISSIONS = {
  // ----- Organisation & users (OWNER-only by default) -----
  "org.settings.view":      ["OWNER", "ADMIN", "ACCOUNTANT", "PROJECT_MANAGER", "AUDITOR", "VIEWER"],
  "org.settings.edit":      ["OWNER"],
  "org.branding.edit":      ["OWNER"],
  "user.invite":            ["OWNER"],
  "user.role.change":       ["OWNER"],
  "user.deactivate":        ["OWNER"],

  // ----- Donor management -----
  "donor.view":             ["OWNER", "ADMIN", "ACCOUNTANT", "PROJECT_MANAGER", "AUDITOR"],
  "donor.create":           ["OWNER", "ADMIN", "ACCOUNTANT"],
  "donor.edit":             ["OWNER", "ADMIN", "ACCOUNTANT"],
  "donor.delete":           ["OWNER", "ADMIN"],
  "donor.import":           ["OWNER", "ADMIN"],
  "donor.notes.view":       ["OWNER", "ADMIN"],

  // ----- Donations -----
  "donation.view":          ["OWNER", "ADMIN", "ACCOUNTANT", "PROJECT_MANAGER", "AUDITOR"],
  "donation.create":        ["OWNER", "ADMIN", "ACCOUNTANT"],
  "donation.edit":          ["OWNER", "ADMIN", "ACCOUNTANT"],
  "donation.cancel":        ["OWNER", "ADMIN"],
  "donation.receipt.send":  ["OWNER", "ADMIN", "ACCOUNTANT"],
  "donation.resendReceipt": ["OWNER", "ADMIN", "ACCOUNTANT"],
  "donation.regenerate":    ["OWNER", "ADMIN"],

  // ----- Communications (donor log entries) -----
  "communication.create":   ["OWNER", "ADMIN", "ACCOUNTANT"],
  "communication.delete":   ["OWNER", "ADMIN"],

  // ----- Vendors -----
  "vendor.view":            ["OWNER", "ADMIN", "ACCOUNTANT", "PROJECT_MANAGER", "AUDITOR"],
  "vendor.create":          ["OWNER", "ADMIN", "ACCOUNTANT"],
  "vendor.update":          ["OWNER", "ADMIN", "ACCOUNTANT"],
  "vendor.delete":          ["OWNER", "ADMIN"],
  "vendor.import":          ["OWNER", "ADMIN"],
  "vendor.manage":          ["OWNER", "ADMIN", "ACCOUNTANT"],

  // ----- Expenses (approval tiers per PRD §7.3) -----
  "expense.view":           ["OWNER", "ADMIN", "ACCOUNTANT", "PROJECT_MANAGER", "AUDITOR"],
  "expense.create":         ["OWNER", "ADMIN", "ACCOUNTANT", "PROJECT_MANAGER"],
  "expense.update.draft":   ["OWNER", "ADMIN", "ACCOUNTANT"],
  "expense.submit":         ["OWNER", "ADMIN", "ACCOUNTANT", "PROJECT_MANAGER"],
  "expense.edit":           ["OWNER", "ADMIN", "ACCOUNTANT"],
  "expense.approve.upto10k":     ["OWNER", "ADMIN", "ACCOUNTANT"],
  "expense.approve.upto100k":    ["OWNER", "ADMIN"],
  "expense.approve.unlimited":   ["OWNER"],
  "expense.reject":         ["OWNER", "ADMIN", "ACCOUNTANT"],
  "expense.cancel":         ["OWNER", "ADMIN"],
  "expense.markPaid":       ["OWNER", "ADMIN", "ACCOUNTANT"],
  "expense.reopen":         ["OWNER", "ADMIN", "ACCOUNTANT"],

  // ----- Petty cash -----
  "pettyCash.float.manage":     ["OWNER", "ADMIN"],
  "pettyCash.expense.create":   ["OWNER", "ADMIN", "ACCOUNTANT", "PROJECT_MANAGER"],
  "pettyCash.topUp":            ["OWNER", "ADMIN", "ACCOUNTANT"],
  "pettycash.manage":           ["OWNER", "ADMIN", "ACCOUNTANT"],

  // ----- Recurring expenses -----
  "recurringExpense.manage":    ["OWNER", "ADMIN"],
  "recurringExpense.runJob":    ["OWNER"],

  // ----- LDC (lower deduction certificates) -----
  "ldc.manage":             ["OWNER", "ADMIN", "ACCOUNTANT"],

  // ----- Projects (Phase 4) -----
  "project.view":           ["OWNER", "ADMIN", "ACCOUNTANT", "PROJECT_MANAGER", "AUDITOR"],
  "project.create":         ["OWNER", "ADMIN", "PROJECT_MANAGER"],
  "project.update":         ["OWNER", "ADMIN", "PROJECT_MANAGER"],
  "project.edit":           ["OWNER", "ADMIN", "PROJECT_MANAGER"],
  "project.close":          ["OWNER", "ADMIN"],
  "project.transition.toActive":     ["OWNER", "ADMIN"],
  "project.transition.toCompleted":  ["OWNER", "ADMIN"],
  "project.transition.toCancelled":  ["OWNER"],
  "project.budget.reallocate":       ["OWNER", "ADMIN", "PROJECT_MANAGER"],
  "project.utilisationCertificate.generate": ["OWNER", "ADMIN", "ACCOUNTANT"],
  "project.migrateFromPlaceholder":  ["OWNER"],

  // ----- Beneficiaries (PRD §7.5 strict access) -----
  "beneficiary.view.list":      ["OWNER", "ADMIN", "PROJECT_MANAGER"],
  "beneficiary.view.detail":    ["OWNER", "ADMIN", "PROJECT_MANAGER"],
  "beneficiary.view":           ["OWNER", "ADMIN", "PROJECT_MANAGER", "AUDITOR"],
  "beneficiary.manage":         ["OWNER", "ADMIN", "PROJECT_MANAGER"],
  "beneficiary.create":         ["OWNER", "ADMIN", "PROJECT_MANAGER"],
  "beneficiary.update":         ["OWNER", "ADMIN", "PROJECT_MANAGER"],
  "beneficiary.delete":         ["OWNER", "ADMIN"],
  "beneficiary.idProof.view":   ["OWNER", "ADMIN"],
  "beneficiary.export.xlsx":    ["OWNER"],
  "beneficiary.disbursement.create": ["OWNER", "ADMIN", "ACCOUNTANT", "PROJECT_MANAGER"],
  "beneficiary.impact.create":  ["OWNER", "ADMIN", "PROJECT_MANAGER"],

  // ----- Volunteers (Phase 4) -----
  "volunteer.view":             ["OWNER", "ADMIN", "PROJECT_MANAGER", "ACCOUNTANT", "AUDITOR"],
  "volunteer.create":           ["OWNER", "ADMIN"],
  "volunteer.update":           ["OWNER", "ADMIN"],
  "volunteer.manage":           ["OWNER", "ADMIN", "PROJECT_MANAGER"],
  "volunteer.activity.manage":  ["OWNER", "ADMIN", "PROJECT_MANAGER"],
  "volunteer.checkIn":          ["OWNER", "ADMIN", "PROJECT_MANAGER"],
  "volunteer.certificate.generate": ["OWNER", "ADMIN"],

  // ----- Compliance -----
  "form10bd.view":          ["OWNER", "ADMIN", "ACCOUNTANT", "AUDITOR"],
  "form10bd.prepare":       ["OWNER", "ADMIN", "ACCOUNTANT"],
  "form10bd.file":          ["OWNER", "ADMIN"],
  "it.view":                ["OWNER", "ADMIN", "ACCOUNTANT", "AUDITOR"],
  "it.prepare":             ["OWNER", "ADMIN", "ACCOUNTANT"],
  "it.file":                ["OWNER", "ADMIN"],
  "gst.view":               ["OWNER", "ADMIN", "ACCOUNTANT", "AUDITOR"],
  "gst.prepare":            ["OWNER", "ADMIN", "ACCOUNTANT"],
  "gst.file":               ["OWNER", "ADMIN"],
  "tds.view":               ["OWNER", "ADMIN", "ACCOUNTANT", "AUDITOR"],
  "tds.prepare":            ["OWNER", "ADMIN", "ACCOUNTANT"],
  "tds.file":               ["OWNER", "ADMIN"],

  // ----- Reports & audit -----
  "reports.view":           ["OWNER", "ADMIN", "ACCOUNTANT", "PROJECT_MANAGER", "AUDITOR", "VIEWER"],
  "reports.export":         ["OWNER", "ADMIN", "ACCOUNTANT", "AUDITOR"],
  "audit.view":             ["OWNER", "ADMIN", "AUDITOR"],

  // ----- Compliance suite (Phase 5) -----
  "compliance.10bd.view":              ["OWNER", "ADMIN", "ACCOUNTANT", "AUDITOR"],
  "compliance.10bd.create":            ["OWNER", "ADMIN"],
  "compliance.10bd.export":            ["OWNER", "ADMIN"],
  "compliance.10bd.markFiled":         ["OWNER", "ADMIN"],
  "compliance.10be.generate":          ["OWNER", "ADMIN", "ACCOUNTANT"],
  "compliance.10be.dispatch":          ["OWNER", "ADMIN", "ACCOUNTANT"],
  "compliance.it.view":                ["OWNER", "ADMIN", "ACCOUNTANT", "AUDITOR"],
  "compliance.it.create":              ["OWNER", "ADMIN"],
  "compliance.it.itr7.export":         ["OWNER", "ADMIN"],
  "compliance.it.markFiled":           ["OWNER", "ADMIN"],
  "compliance.gst.view":               ["OWNER", "ADMIN", "ACCOUNTANT", "AUDITOR"],
  "compliance.gst.invoice.create":     ["OWNER", "ADMIN", "ACCOUNTANT"],
  "compliance.gst.export":             ["OWNER", "ADMIN"],
  "compliance.gst.markFiled":          ["OWNER", "ADMIN"],
  "compliance.tds.view":               ["OWNER", "ADMIN", "ACCOUNTANT", "AUDITOR"],
  "compliance.tds.challan.record":     ["OWNER", "ADMIN", "ACCOUNTANT"],
  "compliance.tds.challan.reconcile":  ["OWNER", "ADMIN", "ACCOUNTANT"],
  "compliance.tds.return.export":      ["OWNER", "ADMIN"],
  "compliance.tds.return.markFiled":   ["OWNER", "ADMIN"],
  "compliance.tds.form16.generate":    ["OWNER", "ADMIN"],
  "compliance.calendar.refresh":       ["OWNER"],

  // Reports module (Phase 6) — generation is broadly available, deletion is OWNER-only.
  "report.generate":                   ["OWNER", "ADMIN", "ACCOUNTANT", "AUDITOR"],
  "report.delete":                     ["OWNER"],
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

export function roleHasPermission(role: OrgRole, key: PermissionKey): boolean {
  const allowed = PERMISSIONS[key] as readonly OrgRole[];
  return allowed.includes(role);
}
