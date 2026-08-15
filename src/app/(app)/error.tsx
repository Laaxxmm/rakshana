"use client";

import { ErrorState } from "@/components/patterns/ErrorState";

/**
 * Boundary for every signed-in route. It renders inside the app layout, so
 * the sidebar and top bar survive the failure and the rest of the app stays
 * reachable — only the failed page is replaced.
 */
export default function AppSegmentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorState digest={error.digest} reset={reset} />;
}
