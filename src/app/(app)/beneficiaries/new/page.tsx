import type { Metadata } from "next";
import Link from "next/link";
import { IconArrowLeft } from "@tabler/icons-react";
import { BeneficiaryForm } from "../BeneficiaryForm";
import { requireOrgScope } from "@/lib/auth/scope";
import { roleHasPermission } from "@/lib/auth/permissions";

export const metadata: Metadata = { title: "Add beneficiary — Rakshana" };

export default async function NewBeneficiaryPage() {
  const scope = await requireOrgScope();
  const canEditInternalNotes = roleHasPermission(scope.role, "beneficiary.idProof.view");

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link
        href="/beneficiaries"
        className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
      >
        <IconArrowLeft size={14} />
        Back to beneficiaries
      </Link>
      <header>
        <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">New beneficiary</p>
        <h1
          className="mt-1 font-display text-3xl text-ink"
          style={{ fontVariationSettings: "'opsz' 28" }}
        >
          Add a beneficiary
        </h1>
      </header>
      <BeneficiaryForm
        mode="create"
        canEditInternalNotes={canEditInternalNotes}
        defaults={{
          code: "",
          name: "",
          dob: "",
          gender: "",
          category: "",
          phone: "",
          email: "",
          addressLine1: "",
          city: "",
          state: "",
          pincode: "",
          internalNotes: "",
        }}
      />
    </div>
  );
}
