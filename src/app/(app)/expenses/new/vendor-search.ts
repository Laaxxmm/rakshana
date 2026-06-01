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
          { gstin: { contains: q, mode: "insensitive" } },
        ],
      },
      orderBy: { name: "asc" },
      take: 10,
    });
    return {
      ok: true,
      vendors: vendors.map((v) => ({
        id: v.id,
        name: v.name,
        pan: v.pan,
        gstin: v.gstin,
        defaultTdsSection: v.defaultTdsSection,
        stateCode: v.stateCode,
      })),
    };
  });
