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

  return (
    <header className="h-[60px] shrink-0 border-b border-border bg-surface/85 backdrop-blur-sm px-6 flex items-center gap-4">
      <div className="flex items-center gap-3">
        <CommandPalette />
        <Badge variant="outline" className="font-mono text-xs">
          FY {getCurrentFY()}
        </Badge>
      </div>
      <div className="ml-auto flex items-center gap-1">
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
