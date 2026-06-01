import type { Metadata } from "next";
import Link from "next/link";
import { IconArrowLeft } from "@tabler/icons-react";
import { VolunteerForm } from "../VolunteerForm";

export const metadata: Metadata = { title: "Add volunteer — Rakshana" };

export default function NewVolunteerPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link
        href="/volunteers"
        className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
      >
        <IconArrowLeft size={14} />
        Back to volunteers
      </Link>
      <header>
        <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">New volunteer</p>
        <h1
          className="mt-1 font-display text-3xl text-ink"
          style={{ fontVariationSettings: "'opsz' 28" }}
        >
          Add a volunteer
        </h1>
      </header>
      <VolunteerForm
        mode="create"
        defaults={{
          name: "",
          phone: "",
          email: "",
          skills: "",
          availability: "",
          joinedOn: new Date().toISOString().slice(0, 10),
        }}
      />
    </div>
  );
}
