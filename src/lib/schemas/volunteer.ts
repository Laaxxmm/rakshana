import { z } from "zod";

const optionalText = z
  .preprocess(
    (v) => {
      if (v === null || v === undefined) return null;
      if (typeof v !== "string") return v;
      const t = v.trim();
      return t.length === 0 ? null : t;
    },
    z.union([z.string(), z.null()]),
  )
  .optional()
  .transform((v) => v ?? null);

export const VOLUNTEER_STATUSES = ["ACTIVE", "INACTIVE", "ALUMNI"] as const;

export const volunteerSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(160),
  phone: optionalText,
  email: optionalText,
  skills: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  availability: optionalText,
  joinedOn: z.coerce.date().nullable().optional().transform((d) => d ?? null),
});
export type VolunteerInput = z.infer<typeof volunteerSchema>;

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

export const volunteerActivitySchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    description: optionalText,
    location: optionalText,
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date().nullable().optional().transform((d) => d ?? null),
    requiredVolunteers: z.coerce.number().int().min(1).default(1),
  })
  .refine((v) => !v.endsAt || v.endsAt.getTime() > v.startsAt.getTime(), {
    message: "End time must be after start time",
    path: ["endsAt"],
  });
export type VolunteerActivityInput = z.infer<typeof volunteerActivitySchema>;

// ---------------------------------------------------------------------------
// Assignment (server-side check-in / check-out)
// ---------------------------------------------------------------------------

export const assignVolunteerSchema = z.object({
  activityId: z.string().min(1),
  volunteerId: z.string().min(1),
});

export const checkInSchema = z.object({
  assignmentId: z.string().min(1),
  time: z.coerce.date().default(() => new Date()),
});

export const checkOutSchema = z.object({
  assignmentId: z.string().min(1),
  time: z.coerce.date().default(() => new Date()),
});

// ---------------------------------------------------------------------------
// Certificate generation
// ---------------------------------------------------------------------------

export const generateVolunteerCertSchema = z.object({
  volunteerId: z.string().min(1),
  periodFrom: z.coerce.date(),
  periodTo: z.coerce.date(),
});
export type GenerateVolunteerCertInput = z.infer<typeof generateVolunteerCertSchema>;

/**
 * Pure helper: compute hours between two timestamps, capped at zero. Used
 * by the server-side check-out action AND the live preview in the UI.
 */
export function computeHours(checkInAt: Date | null, checkOutAt: Date | null): number {
  if (!checkInAt || !checkOutAt) return 0;
  const ms = checkOutAt.getTime() - checkInAt.getTime();
  return Math.max(0, Number((ms / (1000 * 60 * 60)).toFixed(2)));
}
