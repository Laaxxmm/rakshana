"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Sub-navigation for a hub. The sidebar rail carries one icon per hub; each
 * hub spans several routes, and without this strip those routes are only
 * reachable by typing the URL.
 *
 * Declared here rather than per page so a route can never be added to a hub
 * and silently left off the nav. `src/app/(app)/routes.test.ts` treats this
 * table plus the sidebar as the definition of "reachable" and fails on any
 * page missing from both.
 */
export const HUBS = {
  moneyIn: [
    { href: "/donations", label: "Donations" },
    { href: "/donors", label: "Donors" },
  ],
  moneyOut: [
    { href: "/expenses", label: "Expenses" },
    { href: "/approvals", label: "Approvals" },
    { href: "/vendors", label: "Vendors" },
    { href: "/petty-cash", label: "Petty cash" },
    { href: "/recurring-expenses", label: "Recurring" },
    { href: "/banking", label: "Banking" },
  ],
  programmes: [
    { href: "/projects", label: "Projects" },
    { href: "/beneficiaries", label: "Beneficiaries" },
    { href: "/volunteers", label: "Volunteers" },
    { href: "/volunteer-activities", label: "Activities" },
  ],
  compliance: [
    { href: "/compliance", label: "Overview", exact: true },
    { href: "/compliance/10bd", label: "Form 10BD" },
    { href: "/compliance/income-tax", label: "Income tax" },
    { href: "/compliance/tds", label: "TDS" },
    { href: "/compliance/calendar", label: "Calendar" },
  ],
} as const satisfies Record<string, readonly { href: string; label: string; exact?: boolean }[]>;

export function HubNav({ hub }: { hub: keyof typeof HUBS }) {
  const pathname = usePathname();
  const items = HUBS[hub];
  const activeItem = React.useRef<HTMLAnchorElement>(null);

  /*
   * Six tabs do not fit across a phone, so the strip scrolls sideways — and
   * the tab you are on can start off the right-hand edge, which reads as it
   * having been dropped. Pull it into view instead. `nearest` vertically so
   * this never scrolls the page itself, only the strip.
   */
  React.useEffect(() => {
    activeItem.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [pathname]);

  return (
    <nav className="-mx-1 flex items-center gap-1 overflow-x-auto border-b border-border pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {items.map((item) => {
        const active =
          "exact" in item && item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            ref={active ? activeItem : undefined}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-[10px] px-3 py-1.5 text-sm transition-colors md:min-h-0",
              active
                ? "bg-primary-soft font-medium text-primary"
                : "text-ink-muted hover:bg-surface-sunken hover:text-ink",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
