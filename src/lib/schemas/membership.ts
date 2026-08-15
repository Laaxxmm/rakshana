import { z } from "zod";
import type { OrgRole } from "@prisma/client";
import { passwordSchema } from "./user";

/**
 * The roles a trustee hands out on /settings/members, in picker order, each
 * with the line shown beside it.
 *
 * Every summary is read off the `PERMISSIONS` table in
 * `src/lib/auth/permissions.ts` — that table stays the only grant, this is
 * the plain-English rendering of it. ACCOUNTANT comes first because bringing
 * the CA on is the reason this screen exists.
 *
 * Type-only import of `OrgRole`: this module is pulled into the browser
 * bundle by the members form, and `@prisma/client` must not follow it there.
 */
export const ROLE_CHOICES = [
  {
    value: "ACCOUNTANT",
    label: "Accountant",
    summary:
      "Donors, donations, expenses (approves up to ₹10,000), vendors, TDS and 80G filings, reports, the document library and the audit trail.",
  },
  {
    value: "ADMIN",
    label: "Admin",
    summary:
      "Everything day to day, including approvals up to ₹1,00,000 and filing returns. Cannot change organisation settings or members.",
  },
  {
    value: "PROJECT_MANAGER",
    label: "Project manager",
    summary:
      "Projects, beneficiaries and volunteers. Raises expenses but cannot approve them. No donor or donation edits.",
  },
  {
    value: "AUDITOR",
    label: "Auditor",
    summary:
      "Read-only across donations, expenses, projects and filings, plus reports, the document library and the audit trail. Edits no record.",
  },
  {
    value: "VIEWER",
    label: "Viewer",
    summary: "Reports only. No donor, donation or expense detail.",
  },
  {
    value: "OWNER",
    label: "Owner",
    summary:
      "Full control — organisation settings, banking, members, unlimited approvals. Give this only to a trustee.",
  },
] as const satisfies readonly { value: OrgRole; label: string; summary: string }[];

const ROLE_VALUES = ROLE_CHOICES.map((c) => c.value) as unknown as [OrgRole, ...OrgRole[]];

export const roleSchema = z.enum(ROLE_VALUES);

/** "PROJECT_MANAGER" → "Project manager", for anywhere a role is shown. */
export const roleLabel = (role: string): string =>
  ROLE_CHOICES.find((c) => c.value === role)?.label ?? role;

const membershipIdSchema = z.string().min(1, "Pick a member");

/**
 * A new member of the acting user's organisation.
 *
 * There is no `organisationId` field on purpose — the action takes the org
 * from the session scope, and Zod drops any that a caller adds to the payload.
 *
 * The OWNER types the first password here and hands it over; the member
 * changes it at /settings/account. `passwordSchema` is the same one that flow
 * enforces, so the two ends agree on what a valid password is.
 */
export const addMemberSchema = z
  .object({
    name: z.string().trim().min(2, "Enter the member's name"),
    // Lower-cased here because sign-in looks the user up by
    // `email.toLowerCase()` (src/auth.ts) against a unique column.
    email: z.string().trim().toLowerCase().email("Enter a valid email"),
    role: roleSchema,
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Re-type the password"),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

export const changeMemberRoleSchema = z.object({
  membershipId: membershipIdSchema,
  role: roleSchema,
});

/** `false` takes the member's access away; the membership row itself stays. */
export const setMemberAccessSchema = z.object({
  membershipId: membershipIdSchema,
  isActive: z.boolean(),
});

export type AddMemberInput = z.infer<typeof addMemberSchema>;
