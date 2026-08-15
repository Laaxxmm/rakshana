import { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { MobileNav, Sidebar } from "@/components/shell/Sidebar";
import { TopBar } from "@/components/shell/TopBar";

/**
 * Every route in this segment is per-tenant and session-gated — none can
 * ever be a valid static page. Forcing dynamic stops `next build` from
 * trying to prerender them, which on Railway fails outright because
 * DATABASE_URL is not injected during the build phase.
 */
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    // From the tablet breakpoint up the app sits inside one rounded surface
    // floating on the canvas, so the page reads as a single object rather than
    // stacked panels. A phone gets the surface edge to edge: the inset, the
    // corners and the shadow cost about 30px of a 375px screen and show
    // nothing, since there is no canvas left around them to float on.
    <div className="flex min-h-dvh gap-0 bg-canvas md:p-4">
      <div className="flex flex-1 overflow-hidden bg-surface md:rounded-[22px] md:shadow-[var(--shadow-md)]">
        <Sidebar organisationName={session.user.organisationName} />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          {/*
            One content width for the whole app. Pages used to set their own
            (max-w-5xl here, 6xl there), so switching tabs inside a hub made
            the page visibly jump. `scrollbar-gutter` reserves the scrollbar
            lane so a short page is not wider than a long one either.

            The bottom padding on a phone clears the fixed nav bar, which
            floats over the scroller and would otherwise sit on the last row.
          */}
          <main className="flex-1 overflow-y-auto px-4 pb-24 pt-2 md:px-8 md:pb-10 [scrollbar-gutter:stable]">
            <div className="mx-auto w-full max-w-6xl">{children}</div>
          </main>
          <MobileNav />
        </div>
      </div>
    </div>
  );
}
