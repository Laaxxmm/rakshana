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
import { DonationReceiptActions } from "@/components/patterns/DonationReceiptActions";
import { Decimal } from "decimal.js";
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
  // Mirrors the "donation.resendReceipt" permission; the action re-checks it.
  const canSend =
    (scope.role === "OWNER" || scope.role === "ADMIN" || scope.role === "ACCOUNTANT") &&
    !isAnon;
  const canViewNotes = scope.role === "OWNER" || scope.role === "ADMIN";

  const lifetime = new Decimal(donor.totalDonatedLifetime.toString());
  const donationCount = donations.length;
  // Money on a screen a trustee quotes, so the average is rounded to the
  // paisa half-up here rather than left to wherever the division stops. Its
  // denominator is the rows loaded above — the latest 100, cancelled ones
  // included — against a lifetime total that is net of cancellations.
  const avg =
    donationCount > 0
      ? lifetime.div(donationCount).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
      : new Decimal(0);
  const firstDate = donations[donations.length - 1]?.donationDate ?? null;

  return (
    <div className="space-y-5">
      <Link
        href="/donors"
        className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
      >
        <IconArrowLeft size={14} />
        Back to donors
      </Link>

      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">Donor</p>
          <h1
            className="mt-1 font-display text-2xl break-words text-ink sm:text-4xl"
          >
            {donor.name}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-2">
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
        {/* Full-width targets on a phone, where these two sit under the name
            rather than beside it. */}
        <div className="flex shrink-0 items-center gap-2">
          {canEdit ? (
            <Link
              href={`/donors/${id}/edit`}
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm hover:bg-surface-sunken sm:h-9 sm:min-h-0 sm:flex-none"
            >
              <IconEdit size={14} />
              Edit
            </Link>
          ) : null}
          <Link
            href={`/donations/new?donorId=${id}`}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-[color:var(--primary-hover)] sm:h-9 sm:min-h-0 sm:flex-none"
          >
            <IconPlus size={14} />
            Record donation
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-5">
        <KPI label="Lifetime" value={formatINRWithSymbol(lifetime, { paise: true })} mono />
        <KPI label="Donations" value={donationCount.toString()} mono />
        <KPI label="First" value={firstDate ? formatIST(firstDate) : "—"} />
        <KPI label="Average" value={formatINRWithSymbol(avg, { paise: true })} mono />
      </div>

      <Tabs defaultValue="overview">
        {/* Three labels and their counts run past 375px. Wrapping keeps every
            tab on screen — a strip that scrolls sideways hides the last one
            behind a gesture nobody is told about. */}
        <TabsList className="flex-wrap">
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
                /*
                  Below sm the table stops being one: every part of it lays
                  out as a block, so a donation reads as a stack — receipt
                  number, then the amount with its date and mode, then the
                  three send buttons at full width. Columns cannot do that
                  here. The buttons carry the address and the number they
                  send to, which is most of a phone's width on its own, and
                  cutting either to fit a column would hide the destination at
                  the click that sends it.

                  From sm up the same markup is the table it always was, with
                  the date, mode, amount and status back in columns of their
                  own and the stacked line hidden.
                */
                <Table className="max-sm:block">
                  <TableHeader className="max-sm:hidden">
                    <TableRow>
                      <TableHead>Receipt</TableHead>
                      <TableHead className="hidden sm:table-cell">Date</TableHead>
                      <TableHead className="hidden sm:table-cell">Mode</TableHead>
                      <TableHead className="hidden text-right sm:table-cell">Amount</TableHead>
                      <TableHead className="hidden sm:table-cell">Status</TableHead>
                      <TableHead>Receipt PDF</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="max-sm:block">
                    {donations.map((d) => {
                      // RECEIVED and REALISED are what the reader expects; only
                      // a status that changes what the row means is worth a
                      // line on a phone.
                      const notable = d.status !== "RECEIVED" && d.status !== "REALISED";
                      return (
                        <TableRow key={d.id} className="max-sm:block max-sm:px-2 max-sm:py-1">
                          <TableCell className="align-top font-mono text-xs max-sm:block">
                            {d.receiptNumber}
                            <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-xs sm:hidden">
                              <span className="text-sm tabular-nums text-ink">
                                {formatINRWithSymbol(d.amount.toString(), { paise: true })}
                              </span>
                              <span className="font-sans text-ink-muted">
                                {formatIST(d.donationDate)}
                              </span>
                              <span className="font-sans text-ink-muted">{d.mode}</span>
                              {notable ? (
                                <span className="font-sans text-ink">{d.status}</span>
                              ) : null}
                            </span>
                          </TableCell>
                          <TableCell className="hidden text-xs sm:table-cell">
                            {formatIST(d.donationDate)}
                          </TableCell>
                          <TableCell className="hidden sm:table-cell">
                            <Badge variant="outline" className="text-[10px]">
                              {d.mode}
                            </Badge>
                          </TableCell>
                          <TableCell className="hidden text-right align-top font-mono tabular-nums sm:table-cell">
                            {formatINRWithSymbol(d.amount.toString(), { paise: true })}
                          </TableCell>
                          <TableCell className="hidden sm:table-cell">
                            <Badge
                              variant={d.status === "RECEIVED" || d.status === "REALISED" ? "default" : "outline"}
                              className="text-[10px]"
                            >
                              {d.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="align-top max-sm:block">
                            <DonationReceiptActions
                              donationId={d.id}
                              donorEmail={donor.email}
                              donorWhatsApp={donor.whatsapp}
                              canSend={canSend}
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
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
    // Two per row on a phone. A lakh with paise is the widest thing that
    // lands here, so the figure is a size smaller there and breaks rather
    // than spills out of the box.
    <div className="min-w-0 rounded-md border border-border bg-surface p-3 sm:p-4">
      <p className="text-[10px] uppercase tracking-[0.16em] text-ink-subtle">{label}</p>
      <p
        className={
          mono
            ? "mt-1.5 font-mono text-[15px] break-words tabular-nums text-ink sm:mt-2 sm:text-lg"
            : "mt-1.5 text-[15px] break-words text-ink sm:mt-2 sm:text-lg"
        }
      >
        {value}
      </p>
    </div>
  );
}
