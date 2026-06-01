import type { Metadata } from "next";
import Link from "next/link";
import { IconArrowLeft } from "@tabler/icons-react";
import { ImportDonorsForm } from "./ImportDonorsForm";

export const metadata: Metadata = { title: "Import donors — Rakshana" };

export default function ImportDonorsPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <header>
        <Link
          href="/donors"
          className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
        >
          <IconArrowLeft className="h-3 w-3" /> All donors
        </Link>
        <h1
          className="mt-2 font-display text-3xl text-ink"
          style={{ fontVariationSettings: "'opsz' 28" }}
        >
          Bulk import donors
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-muted">
          Upload a CSV exported from your existing system (Excel, Tally, an
          older donor sheet). We'll validate every row, show you what looks
          right and what doesn't, and only insert after you confirm.
        </p>
      </header>

      <ImportDonorsForm />
    </div>
  );
}
