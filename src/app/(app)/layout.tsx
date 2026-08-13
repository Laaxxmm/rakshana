import { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Sidebar } from "@/components/shell/Sidebar";
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
    // The whole app sits inside one rounded surface floating on the canvas,
    // so the page reads as a single object rather than stacked panels.
    <div className="flex min-h-dvh gap-0 bg-canvas p-3 sm:p-4">
      <div className="flex flex-1 overflow-hidden rounded-[22px] bg-surface shadow-[var(--shadow-md)]">
        <Sidebar organisationName={session.user.organisationName} />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <main className="flex-1 overflow-y-auto px-8 pb-10 pt-2">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
