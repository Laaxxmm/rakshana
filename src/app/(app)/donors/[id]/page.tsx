import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  IconArrowLeft,
  IconEdit,
  IconPlus,
} from "@tabler/icons-react";
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
import { EditHistory } from "@/components/patterns/EditHistory";
import { prisma } from "@/lib/db/prisma";
import { requireOrgScope } from "@/lib/auth/scope";
import { loadEditHistory } from "@/lib/audit/history";
import { formatINRWithSymbol } from "@/lib/format/inr";
import { formatIST, formatISTDateTime } from "@/lib/format/date";

export const metadata: Metadata = { title: "Donor — Rakshana" };

export default async function DonorProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const scope = await requireOrgScope();

  const donor = await prisma.donor.findUnique({ where: { id } });
  if (!donor) notFound();

  const [donations, communications, history] = await Promise.all([
    prisma.donation.findMany({
      where: { donorId: id },
      orderBy: { donationDate: "desc" },
      take: 100,
    }),
    prisma.communication.findMany({
      where: { donorId: id },
      orderBy: { occurredAt: "desc" },
      take: 50,
    }),
    loadEditHistory("Donor", id),
  ]);

  const isAnon = donor.isAnonymousBucket;
  const canEdit = (scope.role === "OWNER" || scope.role === "ADMIN" || scope.role === "ACCOUNTANT") && !isAnon;
  const canViewNotes = scope.role === "OWNER" || scope.role === "ADMIN";

  const lifetimeAmount = donor.totalDonatedLifetime.toString();
  const donationCount = donations.length;
  const avg = donationCount > 0 ? Number(donor.totalDonatedLifetime) / donationCount : 0;
  const firstDate = donations[donations.length - 1]?.donationDate ?? null;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <Link
        href="/donors"
        className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
      >
        <IconArrowLeft size={14} />
        Back to donors
      </Link>

      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">Donor</p>
          <h1
            className="mt-1 font-display text-4xl text-ink"
            style={{ fontVariationSettings: "'opsz' 36" }}
          >
            {donor.name}
          </h1>
          <p className="mt-1 flex items-center gap-2">
            <Badge variant="outline">{donor.donorType}</Badge>
            {donor.isAnonymousBucket ? <Badge>System bucket</Badge> : null}
            <Badge variant={donor.status === "ACTIVE" ? "default" : "outline"}>
              {donor.status}
            </Badge>
            {donor.is80GEligible ? <Badge variant="outline" className="text-[10px]">80G</Badge> : null}
            {donor.isFcraEligible ? <Badge variant="outline" className="text-[10px]">FCRA</Badge> : null}
            {donor.isCsrDonor ? <Badge variant="outline" className="text-[10px]">CSR</Badge> : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canEdit ? (
            <Link
              href={`/donors/${id}/edit`}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm hover:bg-surface-sunken"
            >
              <IconEdit size={14} />
              Edit
            </Link>
          ) : null}
          <Link
            href={`/donations/new?donorId=${id}`}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-[color:var(--primary-hover)]"
          >
            <IconPlus size={14} />
            Record donation
          </Link>
        </div>
      </header>

      <div className="grid gap-5 md:grid-cols-4">
        <KPI label="Lifetime" value={formatINRWithSymbol(lifetimeAmount, { paise: true })} mono />
        <KPI label="Donations" value={donationCount.toString()} mono />
        <KPI label="First" value={firstDate ? formatIST(firstDate) : "—"} />
        <KPI label="Average" value={formatINRWithSymbol(String(avg), { paise: true })} mono />
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="donations">
            Donations
            <Badge variant="outline" className="ml-1 text-[10px]">
              {donationCount}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="communications">
            Communications
            <Badge variant="outline" className="ml-1 text-[10px]">
              {communications.length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6 space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Contact</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-5 md:grid-cols-2">
              <ReadOnlyField label="Phone" value={donor.phone} mono />
              <ReadOnlyField label="WhatsApp" value={donor.whatsapp} mono />
              <ReadOnlyField label="Email" value={donor.email} />
              <ReadOnlyField label="PAN" value={donor.isAnonymousBucket ? null : donor.pan} mono />
              <ReadOnlyField
                label="Aadhaar"
                value={donor.aadhaarLast4 ? `xxxx-xxxx-${donor.aadhaarLast4}` : null}
                mono
              />
              <ReadOnlyField
                label="Address"
                value={[
                  donor.addressLine1,
                  donor.addressLine2,
                  [donor.city, donor.district].filter(Boolean).join(", "),
                  [donor.state, donor.pincode].filter(Boolean).join(" "),
                  donor.country,
                ]
                  .filter(Boolean)
                  .join("\n")}
              />
              {donor.isCsrDonor ? (
                <ReadOnlyField label="CSR company CIN" value={donor.csrCompanyCin} mono />
              ) : null}
            </CardContent>
          </Card>

          {donor.tags.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Tags</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1">
                  {donor.tags.map((t) => (
                    <Badge key={t} variant="outline">
                      {t}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {canViewNotes && donor.internalNotes ? (
            <Card>
              <CardHeader>
                <CardTitle>Internal notes (ADMIN+)</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-line">{donor.internalNotes}</p>
              </CardContent>
            </Card>
          ) : null}

          <EditHistory entries={history} />
        </TabsContent>

        <TabsContent value="donations" className="mt-6">
          <Card>
            <CardContent className="p-0">
              {donations.length === 0 ? (
                <p className="p-8 text-center text-sm text-ink-muted">No donations recorded yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Receipt</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Mode</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {donations.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell className="font-mono text-xs">{d.receiptNumber}</TableCell>
                        <TableCell className="text-xs">{formatIST(d.donationDate)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">
                            {d.mode}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatINRWithSymbol(d.amount.toString(), { paise: true })}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={d.status === "RECEIVED" || d.status === "REALISED" ? "default" : "outline"}
                            className="text-[10px]"
                          >
                            {d.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="communications" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Communication log</CardTitle>
            </CardHeader>
            <CardContent>
              {communications.length === 0 ? (
                <p className="text-sm text-ink-muted">No communications logged yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {communications.map((c) => (
                    <li key={c.id} className="py-3">
                      <p className="text-sm font-medium">
                        {c.subject ?? `${c.channel} ${c.direction.toLowerCase()}`}
                      </p>
                      <p className="text-xs text-ink-muted">{c.body}</p>
                      <p className="mt-1 flex items-center gap-2 text-[11px] text-ink-subtle">
                        <Badge variant="outline" className="text-[10px]">
                          {c.channel}
                        </Badge>
                        <span className="font-mono">{formatISTDateTime(c.occurredAt)}</span>
                      </p>
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

function KPI({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <p className="text-[10px] uppercase tracking-[0.16em] text-ink-subtle">{label}</p>
      <p
        className={
          mono ? "mt-2 font-mono tabular-nums text-lg text-ink" : "mt-2 text-lg text-ink"
        }
      >
        {value}
      </p>
    </div>
  );
}
