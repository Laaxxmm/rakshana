import type { Metadata } from "next";
import Link from "next/link";
import { IconFolder } from "@tabler/icons-react";
import { Card, CardContent } from "@/components/ui/card";
import { requireOrgScope } from "@/lib/auth/scope";
import { roleHasPermission } from "@/lib/auth/permissions";
import { listDocumentMonths } from "./library";

export const metadata: Metadata = { title: "Documents — Rakshana" };

export default async function DocumentsPage() {
  const scope = await requireOrgScope();
  if (!roleHasPermission(scope.role, "documents.view")) {
    return <NotPermitted />;
  }

  const months = await listDocumentMonths();
  const total = months.reduce((n, m) => n + m.count, 0);

  return (
    <div className="space-y-5">
      <header>
        <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">Audit</p>
        <h1 className="mt-1 font-display text-3xl text-ink">Documents</h1>
        <p className="text-sm text-ink-muted">
          Every bill, 80G receipt and organisation paper, filed by month. {total}{" "}
          {total === 1 ? "document" : "documents"} in {months.length}{" "}
          {months.length === 1 ? "month" : "months"}.
        </p>
      </header>

      {months.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <p className="font-display text-xl text-ink">Nothing filed yet.</p>
            <p className="mt-2 text-sm text-ink-muted">
              Bills attached to expenses, generated 80G receipts and documents
              uploaded on the organisation page all show up here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {months.map((m) => (
            <Link key={m.month} href={`/documents/${m.month}`} className="block">
              <Card className="h-full transition-shadow hover:shadow-md">
                <CardContent className="flex items-center gap-3 p-5">
                  <IconFolder size={26} stroke={1.6} className="shrink-0 text-primary" />
                  <div className="min-w-0">
                    <p className="font-display text-lg text-ink">{m.label}</p>
                    <p className="text-xs text-ink-muted">
                      {m.count} {m.count === 1 ? "document" : "documents"}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Shown instead of the library to roles without `documents.view`. `loadLibrary`
 * calls `requirePermission` regardless — this only spares them a thrown error
 * where a plain sentence is clearer.
 */
function NotPermitted() {
  return (
    <Card>
      <CardContent className="p-12 text-center">
        <p className="font-display text-xl text-ink">Documents are not open to your role.</p>
        <p className="mt-2 text-sm text-ink-muted">
          Ask an owner for the accountant or auditor role.
        </p>
      </CardContent>
    </Card>
  );
}
