"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  IconArrowDownCircle,
  IconArrowUpCircle,
  IconChartBar,
  IconFolders,
  IconSettings,
  IconShieldCheck,
  IconUsersGroup,
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
  // Projects, beneficiaries, volunteers and activities are the programme side
  // of the trust — what the money bought and who delivered it — so they share
  // one hub instead of being scattered through the two money hubs.
  {
    href: "/projects",
    label: "Programmes",
    icon: IconUsersGroup,
    alsoMatches: ["/beneficiaries", "/volunteers", "/volunteer-activities"],
  },
  { href: "/compliance", label: "Compliance", icon: IconShieldCheck, alsoMatches: [] },
  { href: "/documents", label: "Documents", icon: IconFolders, alsoMatches: [] },
  { href: "/reports", label: "Reports", icon: IconChartBar, alsoMatches: [] },
];

/** A hub owns its own path and the detail routes listed against it. */
function isActive(pathname: string, item: NavItem): boolean {
  return [item.href, ...item.alsoMatches].some((prefix) => pathname.startsWith(prefix));
}

/**
 * Icon-only rail, from the tablet breakpoint up. With a handful of
 * destinations the labels were pure noise — the hover tooltip carries the
 * name, and dropping them buys ~180px of content width. A phone gets
 * `MobileNav` instead: 72px of permanent chrome is a fifth of a 375px screen,
 * and a hover tooltip is unreadable without a mouse.
 *
 * Every entry is shown to every role. The rail does not know the session role,
 * and a destination that refuses you says so on arrival — /documents renders a
 * plain refusal for roles without `documents.view`.
 */
export function Sidebar({ organisationName }: { organisationName: string }) {
  const pathname = usePathname();

  return (
    <aside className="hidden w-[72px] shrink-0 flex-col items-center border-r border-border/70 bg-sidebar py-4 md:flex">
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
          const active = isActive(pathname, item);
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

/**
 * The phone's rail: one cell per hub, pinned to the bottom of the screen where
 * a thumb already is. It reads `NAV_ITEMS` — the same table the rail reads — so
 * a hub cannot be added to one and forgotten in the other.
 *
 * The rail's two non-hub links are carried by chrome that stays on screen at
 * this width rather than by a cell each: the dashboard by the top bar's brand
 * mark, settings by the account menu. `mobile-nav.test.tsx` holds that split.
 */
export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Sections"
      className="fixed inset-x-0 bottom-0 z-40 grid auto-cols-fr grid-flow-col border-t border-border bg-surface/95 pb-2 backdrop-blur-sm md:hidden"
    >
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-14 flex-col items-center justify-center gap-1 px-0.5 pt-1.5 text-[10px] leading-none transition-colors",
              active ? "font-medium text-primary" : "text-ink-muted",
            )}
          >
            <span
              className={cn(
                "flex h-7 w-12 items-center justify-center rounded-full",
                active && "bg-primary-soft",
              )}
            >
              <item.icon size={21} stroke={1.8} />
            </span>
            <span className="w-full truncate text-center">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
