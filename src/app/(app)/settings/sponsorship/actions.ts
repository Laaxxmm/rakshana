"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { returnValidationErrors } from "next-safe-action";
import { safeAction } from "@/lib/actions/safe-action";
import { prisma } from "@/lib/db/prisma";
import {
  createSponsorshipItemSchema,
  setSponsorshipItemActiveSchema,
  updateSponsorshipItemSchema,
} from "@/lib/schemas/sponsorship";

const CATALOGUE = "/settings/sponsorship";
/** The picker reads the catalogue, so a revision has to reach it too. */
const PICKER = "/donations/new";

const DUPLICATE_LABEL =
  "Another item already has this name. Give this one a different name, or edit that item instead.";

function revalidate() {
  revalidatePath(CATALOGUE);
  revalidatePath(PICKER);
}

/**
 * `SponsorshipItem` is a SCOPED_MODEL (`src/lib/db/scoped-models.ts`), so the
 * tenancy extension puts the session's organisationId into the `data` of a
 * create and into the `where` of an update — an id belonging to another trust
 * matches no row and Prisma throws P2025. It also writes the AuditLog entry
 * for every one of these writes, which is why none is written here by hand.
 *
 * Amounts are handed to Prisma as fixed-point strings off the Decimal the
 * schema parsed. No Number ever touches a rupee.
 */

export const createSponsorshipItem = safeAction
  .metadata({ requires: "sponsorship.manage" })
  .inputSchema(createSponsorshipItemSchema)
  .action(async ({ parsedInput }) => {
    const { amount, ...rest } = parsedInput;
    try {
      await prisma.sponsorshipItem.create({
        // `organisationId` is required by the generated create type but is
        // supplied by the tenancy extension at runtime, so the literal is
        // cast — the same escape hatch every other scoped create uses.
        data: { ...rest, amount: amount.toFixed(2) } as never,
      });
    } catch (err) {
      // @@unique([organisationId, label]). Two rows with one name would make
      // the picker ambiguous and the receipt unreadable.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        returnValidationErrors(createSponsorshipItemSchema, {
          label: { _errors: [DUPLICATE_LABEL] },
        });
      }
      throw err;
    }
    revalidate();
    return { ok: true };
  });

/**
 * Reprice, rename, change the unit noun, or move the row within its category.
 *
 * What this cannot do is rewrite a receipt: the donation carries its own copy
 * of the label and the unit price, so this decides what the NEXT donor is
 * offered.
 */
export const updateSponsorshipItem = safeAction
  .metadata({ requires: "sponsorship.manage" })
  .inputSchema(updateSponsorshipItemSchema)
  .action(async ({ parsedInput }) => {
    const { id, amount, ...rest } = parsedInput;
    try {
      await prisma.sponsorshipItem.update({
        where: { id },
        data: { ...rest, amount: amount.toFixed(2) },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        returnValidationErrors(updateSponsorshipItemSchema, {
          label: { _errors: [DUPLICATE_LABEL] },
        });
      }
      throw err;
    }
    revalidate();
    return { ok: true };
  });

/**
 * Take an item off the menu, or put it back. The picker filters on `isActive`,
 * so this is how a discontinued item leaves the brochure — the row stays,
 * because DonationLineItem references it and the donations it paid for have to
 * stay readable.
 */
export const setSponsorshipItemActive = safeAction
  .metadata({ requires: "sponsorship.manage" })
  .inputSchema(setSponsorshipItemActiveSchema)
  .action(async ({ parsedInput }) => {
    await prisma.sponsorshipItem.update({
      where: { id: parsedInput.id },
      data: { isActive: parsedInput.isActive },
    });
    revalidate();
    return { ok: true };
  });
