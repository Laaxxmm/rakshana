import type { Metadata } from "next";
import Link from "next/link";
import { IconArrowLeft } from "@tabler/icons-react";
import { VendorForm } from "../VendorForm";

export const metadata: Metadata = { title: "Add vendor — Rakshana" };

export default function NewVendorPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link
        href="/vendors"
        className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
      >
        <IconArrowLeft size={14} />
        Back to vendors
      </Link>
      <header>
        <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">New vendor</p>
        <h1
          className="mt-1 font-display text-3xl text-ink"
          style={{ fontVariationSettings: "'opsz' 28" }}
        >
          Add a vendor
        </h1>
      </header>
      <VendorForm
        mode="create"
        defaults={{
          name: "",
          pan: "",
          gstin: "",
          defaultTdsSection: "",
          addressLine1: "",
          addressLine2: "",
          city: "",
          state: "",
          pincode: "",
          phone: "",
          email: "",
          bankName: "",
          bankAccountNumber: "",
          bankIfsc: "",
        }}
      />
    </div>
  );
}
