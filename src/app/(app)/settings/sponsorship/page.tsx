import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db/prisma";
import { requireOrgScope } from "@/lib/auth/scope";
import { roleHasPermission } from "@/lib/auth/permissions";
import { CatalogueList, type CatalogueRow } from "./CatalogueList";

export const metadata: Metadata = { title: "Sponsorship menu — Rakshana" };

/**
 * The brochure menu, editable.
 *
 * Same order as the picker at /donations/new — [category, sortOrder, label] —
 * so the list on this screen is the list a volunteer sees, and moving a
 * position here moves it there. Inactive rows are listed too: this is the only
 * screen that can put one back.
 */
export default async function SponsorshipCataloguePage() {
  const scope = await requireOrgScope();

  const items = await prisma.sponsorshipItem.findMany({
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { label: "asc" }],
  });

  const canEdit = roleHasPermission(scope.role, "sponsorship.manage");

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">
          Settings · Sponsorship menu
        </p>
        <h1 className="mt-1 font-display text-3xl text-ink sm:text-4xl">Sponsorship menu</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-muted">
          The prices the trust quotes donors, and the list the donation screen
          offers. A price change applies to the next donation — receipts already
          issued keep the figure they were written with.
        </p>
        <Link
          href="/settings/organisation"
          className="mt-2 inline-block text-sm text-ink-muted underline underline-offset-4 hover:text-ink"
        >
          Organisation profile
        </Link>
      </header>

      {canEdit ? null : (
        <p className="text-sm text-ink-muted">
          Read-only. An owner or admin revises these prices.
        </p>
      )}

      <CatalogueList
        canEdit={canEdit}
        items={items.map(
          (i): CatalogueRow => ({
            id: i.id,
            category: i.category,
            label: i.label,
            // Decimal → string at the server boundary. A client component
            // cannot be handed a Decimal, and must never be handed a number.
            amount: i.amount.toString(),
            unitNoun: i.unitNoun,
            sortOrder: i.sortOrder,
            isActive: i.isActive,
          }),
        )}
      />
    </div>
  );
}
