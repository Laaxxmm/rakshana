"use server";

import { z } from "zod";
import { safeAction } from "@/lib/actions/safe-action";
import { prisma } from "@/lib/db/prisma";

export const searchVendors = safeAction
  .metadata({ requires: "vendor.view" })
  .inputSchema(z.object({ q: z.string().trim() }))
  .action(async ({ parsedInput }) => {
    const { q } = parsedInput;
    if (q.length < 2) return { ok: true, vendors: [] };
    const vendors = await prisma.vendor.findMany({
      where: {
        isActive: true,
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { pan: { contains: q, mode: "insensitive" } },
        ],
      },
      // The picker renders name, PAN and the TDS default; selecting only those
      // keeps the rest of the vendor row out of the payload entirely.
      select: { id: true, name: true, pan: true, defaultTdsSection: true },
      orderBy: { name: "asc" },
      take: 10,
    });
    return { ok: true, vendors };
  });
