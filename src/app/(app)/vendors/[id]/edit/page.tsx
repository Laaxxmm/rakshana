import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { IconArrowLeft } from "@tabler/icons-react";
import { VendorForm } from "../../VendorForm";
import { prisma } from "@/lib/db/prisma";

export const metadata: Metadata = { title: "Edit vendor — Rakshana" };

export default async function EditVendorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const vendor = await prisma.vendor.findUnique({ where: { id } });
  if (!vendor) notFound();
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link
        href={`/vendors/${id}`}
        className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
      >
        <IconArrowLeft size={14} />
        Back to vendor
      </Link>
      <header>
        <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">Edit vendor</p>
        <h1
          className="mt-1 font-display text-3xl text-ink"
          style={{ fontVariationSettings: "'opsz' 28" }}
        >
          {vendor.name}
        </h1>
      </header>
      <VendorForm
        mode="edit"
        vendorId={id}
        defaults={{
          name: vendor.name,
          pan: vendor.pan ?? "",
          gstin: vendor.gstin ?? "",
          defaultTdsSection: vendor.defaultTdsSection ?? "",
          addressLine1: vendor.addressLine1 ?? "",
          addressLine2: vendor.addressLine2 ?? "",
          city: vendor.city ?? "",
          state: vendor.state ?? "",
          pincode: vendor.pincode ?? "",
          phone: vendor.phone ?? "",
          email: vendor.email ?? "",
          bankName: vendor.bankName ?? "",
          bankAccountNumber: vendor.bankAccountNumber ?? "",
          bankIfsc: vendor.bankIfsc ?? "",
        }}
      />
    </div>
  );
}
