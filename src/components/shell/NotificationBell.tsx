import Link from "next/link";
import { IconBell } from "@tabler/icons-react";
import { unreadCount } from "@/lib/notifications/counts";

export async function NotificationBell() {
  const count = await unreadCount();
  return (
    <Link
      href="/notifications"
      aria-label={
        count > 0
          ? `${count} item${count === 1 ? "" : "s"} need${count === 1 ? "s" : ""} attention`
          : "Notifications"
      }
      className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-ink-muted hover:bg-surface-sunken hover:text-ink transition-colors"
    >
      <IconBell size={18} />
      {count > 0 ? (
        <span
          className="absolute -top-0.5 -right-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[color:var(--danger)] px-1 text-[10px] font-medium text-white font-mono"
          aria-hidden
        >
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Link>
  );
}
