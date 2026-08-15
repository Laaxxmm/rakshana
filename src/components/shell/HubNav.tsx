"use client";

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

  return (
    <nav className="-mx-1 flex flex-wrap items-center gap-1 border-b border-border pb-3">
      {items.map((item) => {
        const active =
          "exact" in item && item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-[10px] px-3 py-1.5 text-sm transition-colors",
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
