import type { Metadata } from "next";
import Link from "next/link";
import { differenceInCalendarDays } from "date-fns";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/db/prisma";
import { formatIST, formatISTDateTime } from "@/lib/format/date";
import { MarkAllReadButton } from "./MarkAllReadButton";

export const metadata: Metadata = { title: "Notifications — Rakshana" };

const REFERENCE_TO_TAB: Record<string, string> = {
  TwelveARegistration: "tax",
  EightyGRegistration: "tax",
  GstRegistration: "tax",
  FcraRegistration: "funding",
  DarpanRegistration: "funding",
  CsrOneRegistration: "funding",
};

export default async function NotificationsPage() {
  const [compliance, notifications] = await Promise.all([
    prisma.complianceItem.findMany({
      where: { status: { in: ["UPCOMING", "DUE", "OVERDUE"] } },
      orderBy: { dueDate: "asc" },
    }),
    prisma.notification.findMany({
      orderBy: [{ isRead: "asc" }, { createdAt: "desc" }],
      take: 100,
    }),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">Inbox</p>
          <h1
            className="mt-1 font-display text-3xl text-ink"
            style={{ fontVariationSettings: "'opsz' 28" }}
          >
            Notifications
          </h1>
        </div>
        {notifications.some((n) => !n.isRead) ? <MarkAllReadButton /> : null}
      </header>

      <Tabs defaultValue="compliance">
        <TabsList>
          <TabsTrigger value="compliance">
            Compliance
            <Badge variant="outline" className="ml-2">
              {compliance.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="all">
            All
            <Badge variant="outline" className="ml-2">
              {notifications.length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="compliance" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Items needing attention</CardTitle>
            </CardHeader>
            <CardContent>
              {compliance.length === 0 ? (
                <p className="text-sm text-ink-muted">Nothing on the horizon. 🌤</p>
              ) : (
                <ul className="divide-y divide-border">
                  {compliance.map((c) => {
                    const daysLeft = differenceInCalendarDays(c.dueDate, new Date());
                    const tab = c.referenceModel ? REFERENCE_TO_TAB[c.referenceModel] : null;
                    return (
                      <li key={c.id} className="py-3 flex items-center gap-4">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{c.title}</p>
                          <p className="text-xs text-ink-subtle">
                            <span className="font-mono">{formatIST(c.dueDate, "dd MMM yyyy")}</span>
                            {" · "}
                            <Badge variant="outline" className="text-[10px]">
                              {c.category.replace(/_/g, " ")}
                            </Badge>
                          </p>
                        </div>
                        <DaysChip daysLeft={daysLeft} status={c.status} />
                        {tab ? (
                          <Link
                            href={`/settings/organisation#${tab}`}
                            className="text-xs text-primary underline-offset-4 hover:underline whitespace-nowrap"
                          >
                            View →
                          </Link>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="all" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>All notifications</CardTitle>
            </CardHeader>
            <CardContent>
              {notifications.length === 0 ? (
                <p className="text-sm text-ink-muted">No notifications yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {notifications.map((n) => (
                    <li key={n.id} className="py-3 flex items-start gap-3">
                      {!n.isRead ? (
                        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden />
                      ) : (
                        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" aria-hidden />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className={n.isRead ? "text-sm text-ink-muted" : "text-sm font-medium text-ink"}>
                          {n.title}
                        </p>
                        <p className="text-xs text-ink-subtle line-clamp-2">{n.body}</p>
                        <p className="mt-1 font-mono text-[11px] text-ink-subtle">
                          {formatISTDateTime(n.createdAt)}
                        </p>
                      </div>
                      <Badge variant="outline" className="text-[10px]">
                        {n.channel}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function DaysChip({ daysLeft, status }: { daysLeft: number; status: string }) {
  let cls = "bg-[color:var(--success)]/12 text-[color:var(--success)]";
  let text = `${daysLeft}d left`;
  if (status === "OVERDUE" || daysLeft < 0) {
    cls = "bg-[color:var(--danger)]/12 text-[color:var(--danger)]";
    text = `${Math.abs(daysLeft)}d overdue`;
  } else if (daysLeft === 0) {
    cls = "bg-[color:var(--danger)]/12 text-[color:var(--danger)]";
    text = "Due today";
  } else if (daysLeft <= 7) {
    cls = "bg-[color:var(--danger)]/12 text-[color:var(--danger)]";
  } else if (daysLeft <= 14) {
    cls = "bg-[color:var(--warning)]/12 text-[color:var(--warning)]";
  }
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}
    >
      {text}
    </span>
  );
}
