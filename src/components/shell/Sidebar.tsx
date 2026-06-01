"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  IconLayoutDashboard,
  IconHeartHandshake,
  IconReceiptRupee,
  IconReceipt,
  IconBuildingBank,
  IconBuildingStore,
  IconCoin,
  IconRepeat,
  IconChecks,
  IconFolders,
  IconUsersGroup,
  IconAffiliate,
  IconCalendarEvent,
  IconFileInvoice,
  IconReceiptTax,
  IconCalculator,
  IconChartBar,
  IconSettings,
  IconShieldCheck,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: React.ComponentType<{ size?: number }> };

const NAV_SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: "Overview",
    items: [{ href: "/", label: "Dashboard", icon: IconLayoutDashboard }],
  },
  {
    title: "Fundraising",
    items: [
      { href: "/donors", label: "Donors", icon: IconHeartHandshake },
      { href: "/donations", label: "Donations", icon: IconReceiptRupee },
    ],
  },
  {
    title: "Accounting",
    items: [
      { href: "/expenses", label: "Expenses", icon: IconReceipt },
      { href: "/approvals", label: "Approvals", icon: IconChecks },
      { href: "/vendors", label: "Vendors", icon: IconBuildingStore },
      { href: "/petty-cash", label: "Petty cash", icon: IconCoin },
      { href: "/recurring-expenses", label: "Recurring", icon: IconRepeat },
      { href: "/banking", label: "Banking", icon: IconBuildingBank },
    ],
  },
  {
    title: "Programmes",
    items: [
      { href: "/projects", label: "Projects", icon: IconFolders },
      { href: "/beneficiaries", label: "Beneficiaries", icon: IconUsersGroup },
      { href: "/volunteers", label: "Volunteers", icon: IconAffiliate },
      { href: "/volunteer-activities", label: "Activities", icon: IconCalendarEvent },
    ],
  },
  {
    title: "Compliance",
    items: [
      { href: "/compliance", label: "Overview", icon: IconShieldCheck },
      { href: "/compliance/10bd", label: "Form 10BD", icon: IconFileInvoice },
      { href: "/compliance/income-tax", label: "Income Tax", icon: IconReceiptTax },
      { href: "/compliance/gst", label: "GST", icon: IconBuildingBank },
      { href: "/compliance/tds", label: "TDS", icon: IconCalculator },
      { href: "/compliance/calendar", label: "Calendar", icon: IconCalendarEvent },
    ],
  },
  {
    title: "Insights",
    items: [{ href: "/reports", label: "Reports", icon: IconChartBar }],
  },
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
        {NAV_SECTIONS.map((section) => (
          <div key={section.title} className="mb-5">
            <p className="px-3 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-subtle">
              {section.title}
            </p>
            <ul className="mt-1 space-y-0.5">
              {section.items.map((item) => {
                const active =
                  item.href === "/"
                    ? pathname === "/"
                    : item.href === "/compliance"
                    ? pathname === "/compliance"
                    : pathname.startsWith(item.href);
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
          </div>
        ))}
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
