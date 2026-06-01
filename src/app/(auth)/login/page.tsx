import type { Metadata } from "next";
import LoginForm from "./LoginForm";

export const metadata: Metadata = { title: "Sign in — Rakshana" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <main className="min-h-dvh flex items-center justify-center bg-canvas px-6">
      <div className="w-full max-w-[420px]">
        <header className="mb-10 text-center">
          <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">
            Rakshana
          </p>
          <h1
            className="mt-2 font-display text-4xl text-ink"
            style={{ fontVariationSettings: "'opsz' 36" }}
          >
            Welcome back
          </h1>
          <p className="mt-2 text-sm text-ink-muted">
            Sign in to manage your trust&apos;s donations, projects, and compliance.
          </p>
        </header>

        <div className="rounded-lg border border-border bg-surface p-8 shadow-[var(--shadow-md)]">
          <LoginForm next={next} />
        </div>

        <p className="mt-6 text-center text-xs text-ink-subtle">
          Need help signing in? Contact your trust administrator.
        </p>
      </div>
    </main>
  );
}
