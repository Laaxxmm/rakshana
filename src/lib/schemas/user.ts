import { z } from "zod";

// ---------------------------------------------------------------------------
// Password
// ---------------------------------------------------------------------------

/**
 * bcrypt hashes only the first 72 bytes of its input and ignores the rest, so
 * two passwords sharing a 72-byte prefix are interchangeable at sign-in.
 * Reject the longer input rather than silently truncating it.
 */
const MAX_PASSWORD_BYTES = 72;

const byteLength = (s: string) => new TextEncoder().encode(s).length;

/**
 * Rules for a password the user picks. Deliberately not `.trim()`ed — leading
 * and trailing spaces are part of the secret the user typed.
 */
export const passwordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters")
  .refine((s) => byteLength(s) <= MAX_PASSWORD_BYTES, "Password must be at most 72 bytes")
  .refine((s) => /[a-z]/.test(s), "Password needs at least one lower-case letter")
  .refine((s) => /[A-Z]/.test(s), "Password needs at least one upper-case letter")
  .refine((s) => /\d/.test(s), "Password needs at least one digit");

/**
 * Input for the in-app change-password form
 * (`/settings/account`). `currentPassword` is only checked for presence here —
 * whether it is *correct* is decided server-side against the stored hash.
 */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1, "Re-type the new password"),
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ["newPassword"],
    message: "New password must be different from the current one",
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
