"use client";

import { ErrorState } from "@/components/patterns/ErrorState";
import "./globals.css";

/**
 * Last resort: the boundary Next.js uses when the root layout itself throws.
 * It replaces the whole document, so it has to supply its own `<html>` and
 * `<body>` and import the stylesheet the root layout normally brings in.
 *
 * The font variables set by `next/font` in the root layout are gone at this
 * point, so type falls back to the system stack, and the theme class
 * next-themes writes on `<html>` is gone too — this screen is always light.
 * Both are acceptable for a screen nobody should ever reach.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-dvh items-center justify-center bg-canvas px-6 antialiased">
        <ErrorState digest={error.digest} reset={reset} />
      </body>
    </html>
  );
}
