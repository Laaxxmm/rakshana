import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { IconArrowLeft } from "@tabler/icons-react";
import { DonorForm } from "../../DonorForm";
import { prisma } from "@/lib/db/prisma";
import { requireOrgScope } from "@/lib/auth/scope";

export const metadata: Metadata = { title: "Edit donor — Rakshana" };

export default async function EditDonorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const scope = await requireOrgScope();
  const donor = await prisma.donor.findUnique({ where: { id } });
  if (!donor) notFound();
  if (donor.isAnonymousBucket) {
    return (
      <div className="mx-auto max-w-3xl rounded-md border border-border bg-surface p-6 text-sm">
        The Anonymous Donations bucket cannot be edited.
      </div>
    );
  }

  const canEditInternalNotes = scope.role === "OWNER" || scope.role === "ADMIN";

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link
        href={`/donors/${id}`}
        className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
      >
        <IconArrowLeft size={14} />
        Back to donor
      </Link>
      <header>
        <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">Edit donor</p>
        <h1
          className="mt-1 font-display text-3xl text-ink"
          style={{ fontVariationSettings: "'opsz' 28" }}
        >
          {donor.name}
        </h1>
      </header>
      <DonorForm
        mode="edit"
        donorId={id}
        canEditInternalNotes={canEditInternalNotes}
        defaults={{
          donorType: donor.donorType,
          name: donor.name,
          pan: donor.pan ?? "",
          aadhaarLast4: donor.aadhaarLast4 ?? "",
          phone: donor.phone ?? "",
          whatsapp: donor.whatsapp ?? "",
          email: donor.email ?? "",
          addressLine1: donor.addressLine1 ?? "",
          addressLine2: donor.addressLine2 ?? "",
          city: donor.city ?? "",
          district: donor.district ?? "",
          state: donor.state ?? "",
          pincode: donor.pincode ?? "",
          country: donor.country,
          is80GEligible: donor.is80GEligible,
          isFcraEligible: donor.isFcraEligible,
          isCsrDonor: donor.isCsrDonor,
          csrCompanyCin: donor.csrCompanyCin ?? "",
          whatsappOptIn: donor.whatsappOptIn,
          tags: donor.tags,
          internalNotes: donor.internalNotes ?? "",
        }}
      />
    </div>
  );
}
