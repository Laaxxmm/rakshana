"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  IconArrowDownCircle,
  IconArrowUpCircle,
  IconChartBar,
  IconSettings,
  IconShieldCheck,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  // Detail routes that live inside this hub but sit at a different top-level path.
  alsoMatches: string[];
};

const NAV_ITEMS: NavItem[] = [
  {
    href: "/donations",
    label: "Money in",
    icon: IconArrowDownCircle,
    alsoMatches: ["/donors"],
  },
  {
    href: "/expenses",
    label: "Money out",
    icon: IconArrowUpCircle,
    alsoMatches: ["/vendors", "/petty-cash", "/approvals", "/recurring-expenses", "/banking"],
  },
  { href: "/compliance", label: "Compliance", icon: IconShieldCheck, alsoMatches: [] },
  { href: "/reports", label: "Reports", icon: IconChartBar, alsoMatches: [] },
];

export function Sidebar({ organisationName }: { organisationName: string }) {
  const pathname = usePathname();
  return (
    <aside className="w-[240px] shrink-0 border-r border-border bg-sidebar text-sidebar-foreground flex flex-col">
      <div className="p-6">
        <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-ink-subtle">
          Trust
        </p>
        <p
          className="mt-1 font-display text-xl leading-tight text-ink"
          style={{ fontVariationSettings: "'opsz' 18" }}
        >
          {organisationName}
        </p>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        <ul className="space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const active = [item.href, ...item.alsoMatches].some((prefix) =>
              pathname.startsWith(prefix),
            );
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      : "text-ink-muted hover:bg-sidebar-accent/40 hover:text-ink",
                  )}
                >
                  <item.icon size={16} />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-border px-3 py-3">
        <Link
          href="/settings/organisation"
          className={cn(
            "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
            pathname.startsWith("/settings")
              ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
              : "text-ink-muted hover:bg-sidebar-accent/40 hover:text-ink",
          )}
        >
          <IconSettings size={16} />
          <span>Settings</span>
        </Link>
      </div>
    </aside>
  );
}
