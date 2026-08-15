"use server";

import { z } from "zod";
import { safeAction } from "@/lib/actions/safe-action";
import { roleHasPermission } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db/prisma";
import { formatINRWithSymbol } from "@/lib/format/inr";
import { formatIST, getFinancialYear } from "@/lib/format/date";

/**
 * Shortest query worth a database round trip. A "use server" module may only
 * export async functions, so the palette carries its own copy of this number.
 */
const MIN_SEARCH_LENGTH = 2;

/** Rows per group — enough to recognise the record, short enough to scan. */
const PER_GROUP = 5;

export type SearchGroup = "Donors" | "Donations" | "Projects" | "Vendors";

/**
 * One row in the command palette. `hint` is the secondary line — PAN, amount,
 * project code — that tells two similarly named records apart.
 */
export type SearchHit = {
  key: string;
  group: SearchGroup;
  label: string;
  hint: string;
  href: string;
};

const searchInput = z.object({
  q: z.string().trim().min(MIN_SEARCH_LENGTH).max(80),
});

/**
 * Global search behind the ⌘K palette: donors by name / PAN / phone,
 * donations by receipt number, projects by name or code, vendors by name or
 * PAN.
 *
 * Every query runs on the scoped `prisma` client, so a result can only ever
 * come from the caller's own organisation, and each user string is a Prisma
 * `contains` filter — a parameterised LIKE, never SQL text.
 *
 * There is no single permission that covers a search across four modules, so
 * `metadata` names none and each group is included only if the caller's role
 * may view that module. A role holding none of them gets an empty list rather
 * than an error, which is what the palette should show it anyway.
 */
export const searchEverything = safeAction
  .metadata({})
  .inputSchema(searchInput)
  .action(async ({ parsedInput, ctx }): Promise<SearchHit[]> => {
    const q = parsedInput.q;
    const role = ctx.scope.role;
    const like = { contains: q, mode: "insensitive" as const };

    const groups = await Promise.all([
      roleHasPermission(role, "donor.view")
        ? prisma.donor
            .findMany({
              where: {
                OR: [{ name: like }, { pan: like }, { phone: { contains: q } }],
              },
              select: { id: true, name: true, pan: true, phone: true, donorType: true },
              orderBy: { name: "asc" },
              take: PER_GROUP,
            })
            .then((rows) =>
              rows.map(
                (d): SearchHit => ({
                  key: `Donors:${d.id}`,
                  group: "Donors",
                  label: d.name,
                  hint: [d.pan, d.phone].filter(Boolean).join(" · ") || d.donorType,
                  href: `/donors/${d.id}`,
                }),
              ),
            )
        : [],

      roleHasPermission(role, "donation.view")
        ? prisma.donation
            .findMany({
              where: { receiptNumber: like },
              select: {
                id: true,
                receiptNumber: true,
                amount: true,
                donationDate: true,
                donor: { select: { name: true } },
              },
              orderBy: { donationDate: "desc" },
              take: PER_GROUP,
            })
            .then((rows) =>
              rows.map(
                (d): SearchHit => ({
                  key: `Donations:${d.id}`,
                  group: "Donations",
                  label: d.receiptNumber,
                  hint: [
                    formatINRWithSymbol(d.amount.toString(), { paise: true }),
                    formatIST(d.donationDate),
                    d.donor.name,
                  ].join(" · "),
                  // /donations opens a drawer for `open`, but only over the
                  // financial year it is listing, so the year travels with the id.
                  // ponytail: that list caps at 200 rows per year, so a hit older
                  // than the cap lands on the right year without the drawer. Give
                  // donations their own route if that starts biting.
                  href: `/donations?fy=${getFinancialYear(d.donationDate)}&open=${d.id}`,
                }),
              ),
            )
        : [],

      roleHasPermission(role, "project.view")
        ? prisma.project
            .findMany({
              where: { OR: [{ name: like }, { code: like }] },
              select: { id: true, name: true, code: true, status: true },
              orderBy: { name: "asc" },
              take: PER_GROUP,
            })
            .then((rows) =>
              rows.map(
                (p): SearchHit => ({
                  key: `Projects:${p.id}`,
                  group: "Projects",
                  label: p.name,
                  hint: `${p.code} · ${p.status}`,
                  href: `/projects/${p.id}`,
                }),
              ),
            )
        : [],

      roleHasPermission(role, "vendor.view")
        ? prisma.vendor
            .findMany({
              where: { OR: [{ name: like }, { pan: like }] },
              select: { id: true, name: true, pan: true },
              orderBy: { name: "asc" },
              take: PER_GROUP,
            })
            .then((rows) =>
              rows.map(
                (v): SearchHit => ({
                  key: `Vendors:${v.id}`,
                  group: "Vendors",
                  label: v.name,
                  hint: v.pan ?? "Vendor",
                  href: `/vendors/${v.id}`,
                }),
              ),
            )
        : [],
    ]);

    return groups.flat();
  });
