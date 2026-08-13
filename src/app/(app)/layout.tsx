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
    <div className="flex min-h-dvh">
      <Sidebar organisationName={session.user.organisationName} />
      <div className="flex flex-1 flex-col">
        <TopBar />
        <main className="flex-1 overflow-y-auto bg-canvas px-8 py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
