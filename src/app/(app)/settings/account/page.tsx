import type { Metadata } from "next";
import { requireOrgScope } from "@/lib/auth/scope";
import { PasswordForm } from "./PasswordForm";

export const metadata: Metadata = { title: "Your account — Rakshana" };

export default async function AccountSettingsPage() {
  const scope = await requireOrgScope();

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">
          Settings · Account
        </p>
        <h1 className="mt-1 font-display text-3xl text-ink sm:text-4xl">Your account</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {scope.role} · {scope.organisationName}
        </p>
      </header>

      <PasswordForm />

      <p className="text-sm text-ink-muted">
        Sessions are JSON Web Tokens with a 12-hour lifetime, so a browser
        already signed in elsewhere stays signed in until its token expires.
        Sign out there too if the old password may be known to someone else.
      </p>
    </div>
  );
}
