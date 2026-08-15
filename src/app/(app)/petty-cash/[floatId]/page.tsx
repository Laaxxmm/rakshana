import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { IconArrowLeft } from "@tabler/icons-react";
import { Decimal } from "decimal.js";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { prisma } from "@/lib/db/prisma";
import { requireOrgScope } from "@/lib/auth/scope";
import { formatINRWithSymbol } from "@/lib/format/inr";
import { formatIST, getFinancialYear, resolvePeriod } from "@/lib/format/date";
import { DateRangeFilter } from "@/components/patterns/DateRangeFilter";
import { StatRow } from "@/components/patterns/StatRow";
import { HubNav } from "@/components/shell/HubNav";
import { FLOAT_DEBITED, LEGACY_FLOAT_NOTE } from "../float-ledger";

export const metadata: Metadata = { title: "Float ledger — Rakshana" };

const money = (value: Decimal | { toString(): string }) =>
  formatINRWithSymbol(value.toString(), { paise: true });

type Movement = {
  /** Stable across the two sources, and the sort's tie-break. */
  key: string;
  date: Date;
  /** Who the cash went to, or where it came from. */
  title: string;
  /** Voucher number, or a top-up's remarks. */
  note: string | null;
  /** Signatory: who drew the cash, or who raised the voucher. */
  by: string | null;
  /** Signed: a credit into the box is positive, a voucher out negative. */
  amount: Decimal;
};

/**
 * One float's ledger — the page a custodian reads standing at the cash box.
 *
 * Opening balance, every movement that changed it in date order, the running
 * balance after each, and what should be in the box at the end.
 *
 * The arithmetic is anchored on the stored `currentBalance` and walked
 * *backwards*: closing is that balance less every movement dated after the
 * window, and opening is closing less every movement inside it. Walking
 * forwards from the float's original amount instead would let any movement
 * this page does not know about show up as a running balance that disagrees
 * with the badge on the previous screen and with the cash in the box — and a
 * ledger that disagrees with the register it is reconciling is worse than
 * none. Anchoring costs nothing else: the same subtraction is what a period
 * opening balance needs anyway. Every step is Decimal, so the running column
 * lands on `currentBalance` to the paisa.
 */
export default async function FloatLedgerPage({
  params,
  searchParams,
}: {
  params: Promise<{ floatId: string }>;
  searchParams: Promise<{ period?: string; from?: string; to?: string; fy?: string }>;
}) {
  const { floatId } = await params;
  const range = resolvePeriod(await searchParams);
  await requireOrgScope();

  // Scoped read: another trust's floatId reads back as null, and the page is a
  // 404 rather than a window onto their cash box.
  const float = await prisma.pettyCashFloat.findUnique({
    where: { id: floatId },
    include: { custodian: { select: { name: true, email: true } } },
  });
  if (!float) notFound();

  // Everything from the window's first day onwards, in both directions: the
  // rows inside the window are the ledger, and the ones after it are what
  // separates today's `currentBalance` from the closing balance back then.
  // Bounded by the window the reader chose, so the widest query is the widest
  // ledger they asked to see.
  const [topUps, vouchers, legacy] = await Promise.all([
    // PettyCashTopUp carries no organisationId — it is parent-scoped, so the
    // tenancy extension passes this filter through untouched. `float.id` came
    // back from the scoped read above, which is what keeps it in this trust.
    prisma.pettyCashTopUp.findMany({
      where: { floatId: float.id, topUpDate: { gte: range.start } },
      include: { createdBy: { select: { name: true, email: true } } },
    }),
    prisma.expense.findMany({
      where: {
        ...FLOAT_DEBITED,
        pettyCashFloatId: float.id,
        expenseDate: { gte: range.start },
      },
      include: {
        createdBy: { select: { name: true, email: true } },
        vendor: { select: { name: true } },
      },
    }),
    prisma.expense.findMany({
      where: { pettyCashFloatId: float.id, description: { contains: LEGACY_FLOAT_NOTE } },
      orderBy: { expenseDate: "desc" },
      select: {
        id: true,
        voucherNumber: true,
        expenseDate: true,
        grossAmount: true,
        cashPayeeName: true,
        vendor: { select: { name: true } },
      },
    }),
  ]);

  const movements: Movement[] = [
    ...topUps.map((t) => ({
      key: `top-up:${t.id}`,
      date: t.topUpDate,
      title: "Top-up",
      note: t.remarks,
      by: t.createdBy?.name ?? t.createdBy?.email ?? null,
      amount: new Decimal(t.amount.toString()),
    })),
    ...vouchers.map((v) => ({
      key: `voucher:${v.id}`,
      date: v.expenseDate,
      title: v.vendor?.name ?? v.cashPayeeName ?? "Cash voucher",
      note: v.voucherNumber,
      by: v.createdBy?.name ?? v.createdBy?.email ?? null,
      amount: new Decimal(v.grossAmount.toString()).negated(),
    })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime() || a.key.localeCompare(b.key));

  const inWindow = movements.filter((m) => m.date < range.endExclusive);
  const closing = movements
    .filter((m) => m.date >= range.endExclusive)
    .reduce((b, m) => b.minus(m.amount), new Decimal(float.currentBalance.toString()));
  const opening = inWindow.reduce((b, m) => b.minus(m.amount), closing);

  const rows: (Movement & { balance: Decimal })[] = [];
  for (const m of inWindow) {
    rows.push({ ...m, balance: (rows.at(-1)?.balance ?? opening).plus(m.amount) });
  }

  const zero = new Decimal(0);
  const totalIn = inWindow.reduce((s, m) => (m.amount.gt(0) ? s.plus(m.amount) : s), zero);
  const totalOut = inWindow.reduce((s, m) => (m.amount.lt(0) ? s.plus(m.amount.abs()) : s), zero);
  const legacyTotal = legacy.reduce(
    (s, e) => s.plus(new Decimal(e.grossAmount.toString())),
    zero,
  );

  return (
    <div className="space-y-5">
      <HubNav hub="moneyOut" />

      <Link
        href="/petty-cash"
        className="inline-flex min-h-11 items-center gap-1.5 text-sm text-ink-muted hover:text-ink md:min-h-0"
      >
        <IconArrowLeft size={14} />
        All floats
      </Link>

      <header>
        <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">Petty cash</p>
        <h1 className="mt-1 font-display text-2xl break-words text-ink sm:text-3xl">
          {float.name}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Custodian {float.custodian?.name ?? float.custodian?.email ?? "unassigned"} · float{" "}
          {money(float.floatAmount)}
        </p>
      </header>

      <div className="space-y-2">
        <DateRangeFilter basePath={`/petty-cash/${float.id}`} range={range} />
        <p className="text-xs text-ink-muted">
          Showing {range.label}: {range.rangeLabel}
        </p>
      </div>

      {/* Opening, the two sides, and what the box should hold — the four
          figures a count is checked against, in that order. */}
      <StatRow
        stats={[
          { label: "Opening", value: money(opening) },
          { label: "In", value: money(totalIn) },
          { label: "Out", value: money(totalOut) },
          { label: "Closing", value: money(closing) },
        ]}
      />

      <Card>
        <CardContent className="p-0">
          {/* Below sm the movement and its amount keep their columns; the date
              and the signatory ride under the movement, and the running
              balance under the amount it follows from. The balance is the
              column this screen exists for, so it stays readable on a phone
              rather than waiting for a wider screen. */}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="hidden sm:table-cell">Date</TableHead>
                <TableHead>Movement</TableHead>
                <TableHead className="hidden sm:table-cell">By</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="hidden text-xs sm:table-cell">
                  {formatIST(range.start)}
                </TableCell>
                <TableCell className="whitespace-normal text-sm">
                  Opening balance
                  <span className="mt-0.5 block text-xs text-ink-muted sm:hidden">
                    {formatIST(range.start)}
                  </span>
                </TableCell>
                <TableCell className="hidden text-xs sm:table-cell">—</TableCell>
                <TableCell className="text-right font-mono tabular-nums text-ink-subtle">
                  —
                  <span className="mt-0.5 block text-xs text-ink-muted sm:hidden">
                    {money(opening)}
                  </span>
                </TableCell>
                <TableCell className="hidden text-right font-mono tabular-nums sm:table-cell">
                  {money(opening)}
                </TableCell>
              </TableRow>
              {rows.map((m) => {
                const date = formatIST(m.date);
                return (
                  <TableRow key={m.key}>
                    <TableCell className="hidden text-xs sm:table-cell">{date}</TableCell>
                    <TableCell className="whitespace-normal text-sm">
                      {m.title}
                      {m.note ? (
                        <span className="ml-2 font-mono text-xs text-ink-muted">{m.note}</span>
                      ) : null}
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-muted sm:hidden">
                        <span>{date}</span>
                        <span>{m.by ?? "—"}</span>
                      </span>
                    </TableCell>
                    <TableCell className="hidden text-xs sm:table-cell">{m.by ?? "—"}</TableCell>
                    <TableCell
                      className={`text-right font-mono tabular-nums ${m.amount.lt(0) ? "text-warning" : "text-ink"}`}
                    >
                      {formatINRWithSymbol(m.amount, { paise: true, sign: true })}
                      <span className="mt-0.5 block text-xs font-normal text-ink-muted sm:hidden">
                        {money(m.balance)}
                      </span>
                    </TableCell>
                    <TableCell className="hidden text-right font-mono tabular-nums sm:table-cell">
                      {money(m.balance)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-xs text-ink-muted">
        {rows.length === 0 ? `No movements in ${range.label}. ` : ""}
        The box should hold {money(closing)}.
      </p>

      {legacy.length > 0 ? (
        <Card className="border-[color:var(--warning)]/40 bg-[color:var(--warning)]/8">
          <CardContent className="space-y-3 p-4">
            <p className="text-sm font-medium text-[color:var(--warning)]">
              {legacy.length} rejected {legacy.length === 1 ? "voucher" : "vouchers"} to check
              against the box
            </p>
            {/* Deliberately not a claim that these are all outstanding: the
                repair could not tell which had already been refunded, and
                neither can this. See LEGACY_FLOAT_NOTE. */}
            <p className="text-xs text-ink-muted">
              Raising each of these debited the float. Rejection only refunds that debit for
              vouchers rejected after the refund shipped, and nothing recorded which side of
              that day each one falls on — so some are still debited and some were refunded.
              None of them is counted above and nothing has been adjusted. If the box holds
              more than {money(closing)}, up to {money(legacyTotal)} of the difference is
              here; correct the float only for what the count actually shows.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="hidden sm:table-cell">Date</TableHead>
                  <TableHead>Voucher</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {legacy.map((e) => {
                  const date = formatIST(e.expenseDate);
                  return (
                    <TableRow key={e.id}>
                      <TableCell className="hidden text-xs sm:table-cell">{date}</TableCell>
                      <TableCell className="whitespace-normal text-sm">
                        <Link
                          // The financial year the voucher sits in, so the
                          // expenses list opens on a window that holds it.
                          href={`/expenses?fy=${getFinancialYear(e.expenseDate)}&open=${e.id}`}
                          className="font-mono text-xs hover:underline"
                        >
                          {e.voucherNumber}
                        </Link>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
                          <span className="sm:hidden">{date}</span>
                          <span>{e.vendor?.name ?? e.cashPayeeName ?? "—"}</span>
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {money(e.grossAmount)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
