"use server";

import { z } from "zod";
import { safeAction } from "@/lib/actions/safe-action";
import { prisma } from "@/lib/db/prisma";

/**
 * Search donors by name / PAN / phone. Used by the combobox on the
 * record-donation form. Capped to 10 results to keep the dropdown legible.
 */
export const searchDonors = safeAction
  .metadata({ requires: "donor.view" })
  .inputSchema(z.object({ q: z.string().trim() }))
  .action(async ({ parsedInput }) => {
    const { q } = parsedInput;
    if (q.length < 2) return { ok: true, donors: [] };

    const donors = await prisma.donor.findMany({
      where: {
        status: "ACTIVE",
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { pan: { contains: q, mode: "insensitive" } },
          { phone: { contains: q } },
        ],
      },
      orderBy: [{ isAnonymousBucket: "asc" }, { lastDonationDate: "desc" }, { name: "asc" }],
      take: 10,
    });

    return {
      ok: true,
      donors: donors.map((d) => ({
        id: d.id,
        name: d.name,
        donorType: d.donorType,
        pan: d.isAnonymousBucket ? null : d.pan,
        is80GEligible: d.is80GEligible,
        isFcraEligible: d.isFcraEligible,
        isAnonymousBucket: d.isAnonymousBucket,
        lastDonationDate: d.lastDonationDate?.toISOString() ?? null,
        lifetime: d.totalDonatedLifetime.toString(),
      })),
    };
  });
