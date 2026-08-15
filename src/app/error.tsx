"use client";

import { ErrorState } from "@/components/patterns/ErrorState";

/**
 * Boundary for routes outside the signed-in app layout — the (auth) segment
 * and anything else directly under `src/app`. There is no shell around it, so
 * it centres itself on the canvas, and it points at the login screen rather
 * than the dashboard: whoever sees this may not have a session yet.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-6">
      <ErrorState
        digest={error.digest}
        reset={reset}
        homeHref="/login"
        homeLabel="Go to sign in"
      />
    </div>
  );
}
