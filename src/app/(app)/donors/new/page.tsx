import type { Metadata } from "next";
import Link from "next/link";
import { IconArrowLeft } from "@tabler/icons-react";
import { DonorForm } from "../DonorForm";
import { requireOrgScope } from "@/lib/auth/scope";

export const metadata: Metadata = { title: "Add donor — Rakshana" };

export default async function NewDonorPage() {
  const scope = await requireOrgScope();
  const canEditInternalNotes = scope.role === "OWNER" || scope.role === "ADMIN";

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link
        href="/donors"
        className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
      >
        <IconArrowLeft size={14} />
        Back to donors
      </Link>
      <header>
        <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">New donor</p>
        <h1
          className="mt-1 font-display text-3xl text-ink"
          style={{ fontVariationSettings: "'opsz' 28" }}
        >
          Add a donor
        </h1>
      </header>
      <DonorForm
        mode="create"
        canEditInternalNotes={canEditInternalNotes}
        defaults={{
          donorType: "INDIVIDUAL",
          name: "",
          pan: "",
          aadhaarLast4: "",
          phone: "",
          whatsapp: "",
          email: "",
          addressLine1: "",
          addressLine2: "",
          city: "",
          district: "",
          state: "",
          pincode: "",
          country: "India",
          is80GEligible: true,
          isFcraEligible: false,
          isCsrDonor: false,
          csrCompanyCin: "",
          whatsappOptIn: true,
          tags: [],
          internalNotes: "",
        }}
      />
    </div>
  );
}
