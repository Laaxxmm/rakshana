import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { prisma } from "@/lib/db/prisma";
import { requireOrgScope } from "@/lib/auth/scope";
import { getCurrentFY } from "@/lib/format/date";
import { Itr7Workbench } from "./Itr7Workbench";

export const metadata: Metadata = { title: "ITR-7 — Rakshana" };

export default async function Itr7Page() {
  const { organisationId } = await requireOrgScope();
  const currentFy = getCurrentFY();
  // Default to the PREVIOUS FY because ITR-7 for FY 2023-24 is filed in FY 2024-25
  const [a, b] = currentFy.split("-");
  const previousFy = `${Number(a) - 1}-${String(Number(b) - 1).padStart(2, "0")}`;

  const existingFilings = await prisma.itFiling.findMany({
    where: { filingType: "ITR7" },
    orderBy: { financialYear: "desc" },
  });
  void organisationId;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <header>
        <Link
          href="/compliance/income-tax"
          className="text-sm text-ink-muted hover:text-ink"
        >
          ← Income Tax
        </Link>
        <h1
          className="mt-2 font-display text-3xl text-ink"
          style={{ fontVariationSettings: "'opsz' 28" }}
        >
          ITR-7 figures preparation
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-muted">
          Computes the schedule-wise figures your CA needs to file ITR-7 on the
          IT portal. We never file ITR-7 directly — we just prep the numbers and
          export Excel + a human-readable PDF for CA review.
        </p>
      </header>

      <Itr7Workbench defaultFy={previousFy} />

      {existingFilings.length > 0 && (
        <Card>
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold text-ink">Past exports</h3>
            <ul className="mt-3 space-y-2 text-sm">
              {existingFilings.map((f) => (
                <li key={f.id} className="flex items-center justify-between">
                  <span>
                    FY {f.financialYear} ·{" "}
                    <span className="text-ink-muted">{f.status}</span>
                  </span>
                  <span className="flex gap-3 text-xs">
                    {f.excelUrl && (
                      <a href={f.excelUrl} className="text-primary hover:underline" download>
                        Excel
                      </a>
                    )}
                    {f.ackNumber && (
                      <span className="font-mono text-ink-muted">{f.ackNumber}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
