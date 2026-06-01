import type { Metadata } from "next";
import Link from "next/link";
import { IconArrowLeft } from "@tabler/icons-react";
import { prisma } from "@/lib/db/prisma";
import { requireOrgScope } from "@/lib/auth/scope";
import { getCurrentFY, getFinancialYearRange } from "@/lib/format/date";
import { ANON_DONATION_FIXED_FLOOR, ANON_DONATION_PERCENT_FLOOR } from "@/lib/constants/tax";
import { RecordDonationForm } from "./RecordDonationForm";

export const metadata: Metadata = { title: "Record donation — Rakshana" };

export default async function RecordDonationPage({
  searchParams,
}: {
  searchParams: Promise<{ donorId?: string }>;
}) {
  await requireOrgScope();
  const { donorId } = await searchParams;
  const fy = getCurrentFY();
  const { start, end } = getFinancialYearRange(fy);

  const [bankAccounts, projects, anonymousDonor, anonymousTotals, fyTotals, selectedDonor] =
    await Promise.all([
      prisma.bankAccount.findMany({
        where: { isActive: true },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      }),
      prisma.project.findMany({
        where: { status: { in: ["PLANNED", "ACTIVE"] } },
        orderBy: { name: "asc" },
      }),
      prisma.donor.findFirst({ where: { isAnonymousBucket: true } }),
      prisma.donation.aggregate({
        _sum: { amount: true },
        where: {
          donationDate: { gte: start, lt: end },
          status: { not: "CANCELLED" },
          donor: { isAnonymousBucket: true },
        },
      }),
      prisma.donation.aggregate({
        _sum: { amount: true },
        where: { donationDate: { gte: start, lt: end }, status: { not: "CANCELLED" } },
      }),
      donorId ? prisma.donor.findUnique({ where: { id: donorId } }) : Promise.resolve(null),
    ]);

  const anonTotal = Number(anonymousTotals._sum.amount ?? 0);
  const fyTotal = Number(fyTotals._sum.amount ?? 0);
  const limit = Math.max(ANON_DONATION_FIXED_FLOOR, fyTotal * (ANON_DONATION_PERCENT_FLOOR / 100));

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <Link
        href="/donations"
        className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
      >
        <IconArrowLeft size={14} />
        Back to donations
      </Link>
      <header>
        <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">New donation</p>
        <h1
          className="mt-1 font-display text-3xl text-ink"
          style={{ fontVariationSettings: "'opsz' 28" }}
        >
          Record a donation
        </h1>
      </header>

      <RecordDonationForm
        fy={fy}
        bankAccounts={bankAccounts.map((b) => ({
          id: b.id,
          bankName: b.bankName,
          accountNumber: b.accountNumber,
          purpose: b.purpose,
          isPrimary: b.isPrimary,
        }))}
        projects={projects.map((p) => ({ id: p.id, code: p.code, name: p.name }))}
        anonymous={
          anonymousDonor
            ? {
                donorId: anonymousDonor.id,
                fyTotal: anonTotal.toString(),
                limit: limit.toString(),
              }
            : null
        }
        initialDonor={
          selectedDonor
            ? {
                id: selectedDonor.id,
                name: selectedDonor.name,
                donorType: selectedDonor.donorType,
                pan: selectedDonor.pan,
                is80GEligible: selectedDonor.is80GEligible,
                isFcraEligible: selectedDonor.isFcraEligible,
                lastDonationDate: selectedDonor.lastDonationDate?.toISOString() ?? null,
                lifetime: selectedDonor.totalDonatedLifetime.toString(),
              }
            : null
        }
      />
    </div>
  );
}
