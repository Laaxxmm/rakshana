import { z } from "zod";
import { moneySchema } from "./donation";

/**
 * The sponsorship catalogue as the settings screen edits it.
 *
 * These rows are the brochure: `label`, `amount` and `unitNoun` are all read
 * by a donor, on the picker at /donations/new and on the receipt that follows.
 * Editing one changes what the next donation is offered and nothing else —
 * DonationLineItem snapshots label, unitAmount, quantity and lineTotal at the
 * moment of the donation (prisma/schema.prisma), so an issued receipt keeps
 * the figure it was written with.
 */

export const SPONSORSHIP_CATEGORIES = ["CHILDREN_EDUCATION", "COMMUNITY_TRAINING"] as const;
export type SponsorshipCategoryValue = (typeof SPONSORSHIP_CATEGORIES)[number];

/** Section headings, as the brochure prints them. */
export const SPONSORSHIP_CATEGORY_LABELS: Record<SponsorshipCategoryValue, string> = {
  CHILDREN_EDUCATION: "Children's education",
  COMMUNITY_TRAINING: "Community training",
};

/**
 * `amount` is `moneySchema`: it lands in Decimal(18, 2) and is parsed by
 * decimal.js, never by Number. `sortOrder` is the position within the
 * category — the picker orders by [category, sortOrder, label], so two rows
 * sharing a number still come out in a stable order rather than an arbitrary
 * one.
 */
const itemFields = {
  category: z.enum(SPONSORSHIP_CATEGORIES),
  label: z.string().trim().min(1, "Give the item a name").max(160),
  amount: moneySchema,
  unitNoun: z
    .string()
    .trim()
    .min(1, "Say what the quantity counts — child, woman, month")
    .max(24),
  sortOrder: z.coerce.number().int().min(0, "Position cannot be negative").max(999),
};

export const createSponsorshipItemSchema = z.object(itemFields);

export const updateSponsorshipItemSchema = z.object({
  id: z.string().min(1),
  ...itemFields,
});

/**
 * Taking an item off the menu, and putting it back. Never a delete:
 * DonationLineItem points at this row, and a discontinued item still has to
 * read back on the donations it paid for.
 */
export const setSponsorshipItemActiveSchema = z.object({
  id: z.string().min(1),
  isActive: z.boolean(),
});
