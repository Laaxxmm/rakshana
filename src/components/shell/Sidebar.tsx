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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number; stroke?: number }>;
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

/**
 * Icon-only rail. With four destinations the labels were pure noise — the
 * hover tooltip carries the name, and dropping them buys ~180px of content
 * width on every screen.
 */
export function Sidebar({ organisationName }: { organisationName: string }) {
  const pathname = usePathname();

  return (
    <aside className="flex w-[72px] shrink-0 flex-col items-center border-r border-border/70 bg-sidebar py-4">
      <Tooltip>
        <TooltipTrigger
          render={
            <Link
              href="/"
              aria-label={organisationName}
              className={cn(
                "flex h-11 w-11 items-center justify-center rounded-[14px] bg-primary text-lg font-bold text-primary-foreground transition-transform hover:scale-105",
              )}
            >
              {organisationName.trim().charAt(0).toUpperCase() || "R"}
            </Link>
          }
        />
        <TooltipContent side="right">{organisationName}</TooltipContent>
      </Tooltip>

      <nav className="mt-7 flex flex-1 flex-col items-center gap-1.5">
        {NAV_ITEMS.map((item) => {
          const active = [item.href, ...item.alsoMatches].some((prefix) =>
            pathname.startsWith(prefix),
          );
          return (
            <Tooltip key={item.href}>
              <TooltipTrigger
                render={
                  <Link
                    href={item.href}
                    aria-label={item.label}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex h-11 w-11 items-center justify-center rounded-[14px] transition-colors",
                      active
                        ? "bg-primary-soft text-primary"
                        : "text-ink-muted hover:bg-surface-sunken hover:text-ink",
                    )}
                  >
                    <item.icon size={22} stroke={1.8} />
                  </Link>
                }
              />
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </nav>

      <Tooltip>
        <TooltipTrigger
          render={
            <Link
              href="/settings/organisation"
              aria-label="Settings"
              className={cn(
                "flex h-11 w-11 items-center justify-center rounded-[14px] transition-colors",
                pathname.startsWith("/settings")
                  ? "bg-primary-soft text-primary"
                  : "text-ink-muted hover:bg-surface-sunken hover:text-ink",
              )}
            >
              <IconSettings size={22} stroke={1.8} />
            </Link>
          }
        />
        <TooltipContent side="right">Settings</TooltipContent>
      </Tooltip>
    </aside>
  );
}
