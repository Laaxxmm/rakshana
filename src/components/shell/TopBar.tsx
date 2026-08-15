import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { CommandPalette } from "./CommandPalette";
import { ThemeToggle } from "./ThemeToggle";
import { UserMenu } from "./UserMenu";
import { NotificationBell } from "./NotificationBell";
import { getCurrentFY } from "@/lib/format/date";
import { auth } from "@/auth";

export async function TopBar() {
  const session = await auth();
  const user = session?.user;

  const organisationName = user?.organisationName ?? "Rakshana";

  return (
    <header className="h-[60px] shrink-0 border-b border-border bg-surface/85 backdrop-blur-sm px-3 md:px-6 flex items-center gap-2 md:gap-4">
      {/* Stands in for the rail's logo, which is the only click to the
          dashboard and is hidden at this width. */}
      <Link
        href="/"
        aria-label={organisationName}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-primary text-base font-bold text-primary-foreground md:hidden"
      >
        {organisationName.trim().charAt(0).toUpperCase() || "R"}
      </Link>
      <div className="flex items-center gap-3">
        <CommandPalette />
        {/* Today's financial year is context, not a control — a phone spends
            that width on the destinations instead. */}
        <Badge variant="outline" className="hidden font-mono text-xs md:inline-flex">
          FY {getCurrentFY()}
        </Badge>
      </div>
      {/*
        The three controls below size themselves between 32 and 36px, under
        the 44px a thumb needs. Each owns its own component, so the floor is
        set on them from here and released again once there is a pointer.
      */}
      <div className="ml-auto flex items-center gap-1 *:min-h-11 *:min-w-11 *:justify-center md:*:min-h-9 md:*:min-w-9">
        <ThemeToggle />
        <NotificationBell />
        {user ? (
          <UserMenu
            name={user.name ?? user.email}
            email={user.email}
            role={user.role}
          />
        ) : null}
      </div>
    </header>
  );
}
