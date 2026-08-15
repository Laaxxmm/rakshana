"use client";

import { buttonVariants } from "@/components/ui/button";

/**
 * What a user sees when a route throws. Rendered by the `error.tsx`
 * boundaries in `src/app`, which receive `{ error, reset }` from Next.js.
 *
 * Two rules hold here. The thrown message never reaches the screen — a
 * production build redacts it before the client ever sees it, and an internal
 * string helps nobody. What does reach the screen is `digest`, the hash
 * Next.js attaches to a server-side error and writes to the server log: it is
 * the only handle tying what the user saw to what was logged.
 *
 * "Try again" calls `reset()`, which re-renders the failed segment — that
 * recovers a transient failure (a dropped database connection) and visibly
 * does nothing for a persistent one, so the fallback is a plain `<a>`. A hard
 * navigation rather than a client-side `<Link>`, because after a failed render
 * the client cache may still hold the state that broke.
 */
export function ErrorState({
  digest,
  reset,
  homeHref = "/",
  homeLabel = "Go to dashboard",
}: {
  digest?: string;
  reset: () => void;
  homeHref?: string;
  homeLabel?: string;
}) {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="font-display text-2xl text-ink">This page didn&rsquo;t load</h1>
      <p className="mt-2 text-sm text-ink-muted">
        Something on our side failed while building this page. Your data is
        untouched — nothing you were looking at was changed or lost.
      </p>

      <div className="mt-6 flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={reset}
          className={buttonVariants({ size: "lg" })}
        >
          Try again
        </button>
        <a href={homeHref} className={buttonVariants({ variant: "outline", size: "lg" })}>
          {homeLabel}
        </a>
      </div>

      {digest ? (
        <p className="mt-8 text-xs text-ink-subtle">
          If it keeps failing, report this code:{" "}
          <span className="font-mono text-ink-muted">{digest}</span>
        </p>
      ) : (
        <p className="mt-8 text-xs text-ink-subtle">
          If it keeps failing, note the time and what you clicked when reporting it.
        </p>
      )}
    </div>
  );
}
