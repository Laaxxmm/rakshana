import "server-only";
import { fromZonedTime } from "date-fns-tz";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/require-permission";
import { IST, formatIST, getFinancialYear } from "@/lib/format/date";

/**
 * The document library: every file the organisation holds, filed into month
 * folders so an auditor can work a month at a time.
 *
 * Three sources feed it, all read through the scoped `prisma` client so a
 * query can only ever see the session's own organisation:
 *   - ExpenseAttachment — uploaded vendor bills, reached via their Expense
 *     (ExpenseAttachment is parent-scoped, so the scoped Expense read is what
 *     proves ownership — see src/lib/db/scoped-models.ts).
 *   - Donation.receiptUrl — the generated 80G receipt.
 *   - OrgDocument — 12A / 80G / trust deed and the rest of the org's papers.
 *
 * WHICH MONTH A FILE FILES UNDER: the date of the thing it evidences, not the
 * moment it was uploaded — a March bill scanned in April belongs in March,
 * which is the same rule `storageKey.expenseBill` uses for the storage prefix.
 * An org document has no such transaction date, so it files under its upload
 * month.
 *
 * Bytes are never read here. Every `url` points at /api/files, which repeats
 * the organisation check before it streams anything.
 */

export type LibraryDoc = {
  /** Prefixed with its source so ids from different tables cannot collide. */
  id: string;
  /** "YYYY-MM", IST. */
  month: string;
  date: Date;
  kind: "Bill" | "Receipt" | "Organisation";
  title: string;
  /** null when the source row never recorded one and the URL has no usable extension. */
  contentType: string | null;
  url: string;
  /** What the file is evidence of, for tracing. */
  attachedTo: string;
  /** In-app link to that source record. */
  href: string | null;
};

export type DocumentMonth = {
  /** "YYYY-MM" — the path segment for /documents/[month]. */
  month: string;
  /** "August 2026". */
  label: string;
  count: number;
};

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isMonthKey(value: string): boolean {
  return MONTH_PATTERN.test(value);
}

/** IST bounds of a "YYYY-MM" month: [start, end). */
export function monthRange(month: string): { start: Date; end: Date } {
  const m = month.match(MONTH_PATTERN);
  if (!m) throw new Error(`Invalid month "${month}" — expected YYYY-MM`);
  const year = Number(m[1]);
  const mon = Number(m[2]);
  const nextYear = mon === 12 ? year + 1 : year;
  const nextMon = mon === 12 ? 1 : mon + 1;
  return {
    start: fromZonedTime(`${month}-01T00:00:00`, IST),
    end: fromZonedTime(
      `${nextYear}-${String(nextMon).padStart(2, "0")}-01T00:00:00`,
      IST,
    ),
  };
}

export function monthLabel(month: string): string {
  return formatIST(monthRange(month).start, "MMMM yyyy");
}

const EXT_MIME: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/**
 * Best-effort content type for rows that never stored one — the legacy
 * `Expense.billUrl` column and OrgDocuments uploaded before `mimeType` was
 * recorded. It only decides which preview to render; the browser is told the
 * real type by /api/files, which reads it from storage.
 */
function mimeFromUrl(url: string): string | null {
  const ext = url.split("?")[0].split(".").pop()?.toLowerCase();
  return ext ? (EXT_MIME[ext] ?? null) : null;
}

/**
 * Every document in the library, newest first. Pass a "YYYY-MM" month to load
 * just that folder.
 *
 * ponytail: the month index counts by loading every row and grouping in JS —
 * fine for one trust's lifetime of paperwork. If it stops being, give
 * `listDocumentMonths` its own three `groupBy` queries.
 */
export async function loadLibrary(month?: string): Promise<LibraryDoc[]> {
  await requirePermission("documents.view");

  const range = month ? monthRange(month) : null;
  const within = range ? { gte: range.start, lt: range.end } : undefined;

  const [expenses, donations, orgDocs] = await Promise.all([
    prisma.expense.findMany({
      where: {
        ...(within ? { expenseDate: within } : {}),
        OR: [{ attachments: { some: {} } }, { billUrl: { not: null } }],
      },
      select: {
        id: true,
        expenseDate: true,
        voucherNumber: true,
        billUrl: true,
        cashPayeeName: true,
        vendor: { select: { name: true } },
        attachments: {
          orderBy: { uploadedAt: "asc" },
          select: {
            id: true,
            fileUrl: true,
            originalName: true,
            contentType: true,
            pageLabel: true,
          },
        },
      },
      orderBy: { expenseDate: "desc" },
    }),
    prisma.donation.findMany({
      where: {
        ...(within ? { donationDate: within } : {}),
        receiptUrl: { not: null },
      },
      select: {
        id: true,
        donationDate: true,
        receiptNumber: true,
        receiptUrl: true,
        donor: { select: { name: true } },
      },
      orderBy: { donationDate: "desc" },
    }),
    prisma.orgDocument.findMany({
      // Soft-deleted papers stay out; superseded ones (`replacedById` set) stay
      // in, because the version in force during the year under audit is
      // exactly what an auditor asks for.
      where: { ...(within ? { createdAt: within } : {}), deletedAt: null },
      select: {
        id: true,
        title: true,
        category: true,
        fileUrl: true,
        mimeType: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const docs: LibraryDoc[] = [];

  for (const e of expenses) {
    const payee = e.vendor?.name ?? e.cashPayeeName ?? "No payee";
    const attachedTo = `Voucher ${e.voucherNumber} · ${payee}`;
    // The expenses list filters by financial year, so the year has to travel
    // with the link or the drawer opens on a page that never loaded the row.
    const href = `/expenses?fy=${getFinancialYear(e.expenseDate)}&open=${e.id}`;
    const month = formatIST(e.expenseDate, "yyyy-MM");

    for (const a of e.attachments) {
      docs.push({
        id: `att:${a.id}`,
        month,
        date: e.expenseDate,
        kind: "Bill",
        title: a.pageLabel ? `${a.originalName} — ${a.pageLabel}` : a.originalName,
        contentType: a.contentType,
        url: a.fileUrl,
        attachedTo,
        href,
      });
    }

    // Vouchers recorded before ExpenseAttachment existed carry their single
    // bill on the expense row itself. `listExpenseAttachments` in
    // src/app/(app)/expenses/actions.ts falls back the same way.
    if (e.attachments.length === 0 && e.billUrl) {
      docs.push({
        id: `bill:${e.id}`,
        month,
        date: e.expenseDate,
        kind: "Bill",
        title: e.billUrl.split("/").pop() || e.billUrl,
        contentType: mimeFromUrl(e.billUrl),
        url: e.billUrl,
        attachedTo,
        href,
      });
    }
  }

  for (const d of donations) {
    docs.push({
      id: `rcpt:${d.id}`,
      month: formatIST(d.donationDate, "yyyy-MM"),
      date: d.donationDate,
      kind: "Receipt",
      title: `80G receipt ${d.receiptNumber}`,
      contentType: "application/pdf",
      url: d.receiptUrl as string,
      attachedTo: `Donation ${d.receiptNumber} · ${d.donor.name}`,
      href: `/donations?fy=${getFinancialYear(d.donationDate)}&open=${d.id}`,
    });
  }

  for (const o of orgDocs) {
    docs.push({
      id: `org:${o.id}`,
      month: formatIST(o.createdAt, "yyyy-MM"),
      date: o.createdAt,
      kind: "Organisation",
      title: o.title,
      contentType: o.mimeType ?? mimeFromUrl(o.fileUrl),
      url: o.fileUrl,
      attachedTo: o.category.replace(/_/g, " "),
      href: `/settings/organisation/documents/${o.id}`,
    });
  }

  docs.sort(
    (a, b) => b.date.getTime() - a.date.getTime() || a.title.localeCompare(b.title),
  );
  return docs;
}

/** Month folders, newest first, with how many documents each holds. */
export async function listDocumentMonths(): Promise<DocumentMonth[]> {
  const docs = await loadLibrary();
  const counts = new Map<string, number>();
  for (const d of docs) counts.set(d.month, (counts.get(d.month) ?? 0) + 1);

  return [...counts.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, count]) => ({ month, label: monthLabel(month), count }));
}
