import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { IconArrowLeft } from "@tabler/icons-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ReadOnlyField } from "@/components/patterns/ReadOnlyField";
import { prisma } from "@/lib/db/prisma";
import { formatIST } from "@/lib/format/date";
import { GenerateCertButton } from "./GenerateCertButton";

export const metadata: Metadata = { title: "Volunteer — Rakshana" };

export default async function VolunteerProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const volunteer = await prisma.volunteer.findUnique({
    where: { id },
    include: {
      assignments: {
        orderBy: { id: "desc" },
        include: { activity: { select: { name: true, startsAt: true } } },
      },
      certificates: { orderBy: { generatedAt: "desc" } },
    },
  });
  if (!volunteer) notFound();

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Link
        href="/volunteers"
        className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
      >
        <IconArrowLeft size={14} />
        Back to volunteers
      </Link>
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">Volunteer</p>
          <h1
            className="mt-1 font-display text-3xl text-ink"
            style={{ fontVariationSettings: "'opsz' 28" }}
          >
            {volunteer.name}
          </h1>
          <p className="mt-1 flex items-center gap-2">
            <Badge variant="outline">{volunteer.status}</Badge>
            {volunteer.skills.map((s) => (
              <Badge key={s} variant="outline" className="text-[10px]">
                {s}
              </Badge>
            ))}
          </p>
        </div>
        <GenerateCertButton volunteerId={id} />
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <KPI label="Total hours" value={volunteer.totalHours.toString()} />
        <KPI label="Activities" value={String(volunteer.assignments.length)} />
        <KPI
          label="Last activity"
          value={
            volunteer.assignments[0]?.activity?.startsAt
              ? formatIST(volunteer.assignments[0].activity.startsAt)
              : "—"
          }
        />
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="activities">
            Activities
            <Badge variant="outline" className="ml-1 text-[10px]">
              {volunteer.assignments.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="certificates">
            Certificates
            <Badge variant="outline" className="ml-1 text-[10px]">
              {volunteer.certificates.length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Contact</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-5 md:grid-cols-2">
              <ReadOnlyField label="Phone" value={volunteer.phone} mono />
              <ReadOnlyField label="Email" value={volunteer.email} />
              <ReadOnlyField label="Availability" value={volunteer.availability} />
              <ReadOnlyField
                label="Joined"
                value={volunteer.joinedOn ? formatIST(volunteer.joinedOn) : null}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activities" className="mt-6">
          <Card>
            <CardContent className="p-0">
              {volunteer.assignments.length === 0 ? (
                <p className="p-8 text-center text-sm text-ink-muted">No activities yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Activity</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Check-in</TableHead>
                      <TableHead>Check-out</TableHead>
                      <TableHead className="text-right">Hours</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {volunteer.assignments.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="text-sm">{a.activity?.name ?? "—"}</TableCell>
                        <TableCell className="text-xs">
                          {a.activity?.startsAt ? formatIST(a.activity.startsAt) : "—"}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {a.checkInAt
                            ? new Date(a.checkInAt).toLocaleTimeString("en-IN", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : "—"}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {a.checkOutAt
                            ? new Date(a.checkOutAt).toLocaleTimeString("en-IN", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {a.hours?.toString() ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="certificates" className="mt-6">
          <Card>
            <CardContent className="p-0">
              {volunteer.certificates.length === 0 ? (
                <p className="p-8 text-center text-sm text-ink-muted">No certificates generated.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Certificate #</TableHead>
                      <TableHead>Period</TableHead>
                      <TableHead className="text-right">Hours</TableHead>
                      <TableHead>Generated</TableHead>
                      <TableHead>Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {volunteer.certificates.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-mono text-xs">
                          {c.certificateNumber ?? c.id.slice(0, 8)}
                        </TableCell>
                        <TableCell className="text-xs">
                          {formatIST(c.periodFrom)} → {formatIST(c.periodTo)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {c.totalHours.toString()}
                        </TableCell>
                        <TableCell className="text-xs text-ink-muted">
                          {formatIST(c.generatedAt)}
                        </TableCell>
                        <TableCell>
                          {c.fileUrl ? (
                            <a
                              href={c.fileUrl}
                              target="_blank"
                              rel="noopener"
                              className="text-xs text-primary hover:underline"
                            >
                              Download
                            </a>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function KPI({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <p className="text-[10px] uppercase tracking-[0.16em] text-ink-subtle">{label}</p>
      <p className="mt-1 font-display text-xl text-ink">{value}</p>
    </div>
  );
}
