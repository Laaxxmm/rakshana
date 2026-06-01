import type { Metadata } from "next";
import Link from "next/link";
import {
  IconReceiptTax,
  IconFileInvoice,
  IconCalculator,
  IconBuildingBank,
  IconCalendarStats,
} from "@tabler/icons-react";
import { Card, CardContent } from "@/components/ui/card";
import { prisma } from "@/lib/db/prisma";
import { requireOrgScope } from "@/lib/auth/scope";

export const metadata: Metadata = { title: "Compliance — Rakshana" };

export default async function ComplianceIndex() {
  const { organisationId } = await requireOrgScope();

  // Status counts feed each card
  const [filings10bd, itFilings, gst, tdsReturns, dueItems] = await Promise.all([
    prisma.form10BDFiling.count(),
    prisma.itFiling.count(),
    prisma.gstRegistration.findUnique({ where: { organisationId } }),
    prisma.tdsReturn.count(),
    prisma.complianceItem.count({
      where: { status: { in: ["DUE", "OVERDUE"] } },
    }),
  ]);

  const cards = [
    {
      title: "Form 10BD · 10BE",
      summary: "Annual statement of donations (31 May) + donor certificates",
      icon: IconFileInvoice,
      href: "/compliance/10bd",
      count: filings10bd,
      countLabel: "filings",
    },
    {
      title: "Income Tax",
      summary: "ITR-7, Form 10/10B, 12A & 80G renewals, 85% rule",
      icon: IconReceiptTax,
      href: "/compliance/income-tax",
      count: itFilings,
      countLabel: "filings",
    },
    {
      title: "GST",
      summary: gst
        ? "GSTR-1 (11th) · GSTR-3B (20th) · invoice export"
        : "Not registered — view setup guide",
      icon: IconBuildingBank,
      href: "/compliance/gst",
      count: gst ? null : 0,
      countLabel: gst ? "Active" : "Not set up",
    },
    {
      title: "TDS",
      summary: "Form 26Q/24Q quarterly returns · Form 16A drafts",
      icon: IconCalculator,
      href: "/compliance/tds",
      count: tdsReturns,
      countLabel: "returns",
    },
    {
      title: "Calendar",
      summary: "Due dates for every recurring filing across modules",
      icon: IconCalendarStats,
      href: "/compliance/calendar",
      count: dueItems,
      countLabel: "due / overdue",
    },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header>
        <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">
          Statutory compliance
        </p>
        <h1
          className="mt-1 font-display text-3xl text-ink"
          style={{ fontVariationSettings: "'opsz' 28" }}
        >
          Compliance Suite
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-muted">
          Every recurring statutory filing your trust needs to track. Each
          module preps the data; you submit the actual filing on the relevant
          government portal and record the ARN here for the audit trail.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Link key={c.href} href={c.href} className="block">
            <Card className="h-full transition-shadow hover:shadow-md">
              <CardContent className="space-y-3 p-5">
                <c.icon className="h-7 w-7 text-primary" />
                <div>
                  <h3 className="font-display text-lg text-ink">{c.title}</h3>
                  <p className="mt-1 text-sm text-ink-muted">{c.summary}</p>
                </div>
                {c.count !== null && (
                  <p className="text-xs text-ink-subtle">
                    <span className="font-semibold tabular-nums text-ink">{c.count}</span>{" "}
                    {c.countLabel}
                  </p>
                )}
                {c.count === null && (
                  <p className="text-xs text-ink-subtle">{c.countLabel}</p>
                )}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
