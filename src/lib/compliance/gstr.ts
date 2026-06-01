import "server-only";
import { Decimal } from "decimal.js";
import { prismaUnsafe } from "@/lib/db/prisma";
import { storage, storageKey } from "@/lib/storage";
import { buildWorkbook, type ExcelSheet } from "@/lib/exporter/xlsx";

/**
 * GSTR-1 (outward supplies) and GSTR-3B (summary return) aggregators.
 *
 * Trusts that earn taxable revenue (training fees, event tickets, etc.) must
 * file GSTR-1 monthly by the 11th and GSTR-3B monthly by the 20th. Most
 * trusts in our user base are exempt; the GST module is opt-in.
 */

export type GstrPeriodInput = {
  organisationId: string;
  /** Period in YYYY-MM format (matches `GstFiling.period`). */
  period: string;
};

export type GstrAggregate = {
  period: string;
  invoiceCount: number;
  taxableValue: string;
  cgst: string;
  sgst: string;
  igst: string;
  total: string;
  // GSTR-1 breakup
  b2b: { count: number; taxableValue: string; tax: string }[]; // by buyer
  b2cs: { taxableValue: string; tax: string };
  // 3B summary
  outwardTaxable: string;
  outwardNilExempt: string;
  totalTaxLiability: string;
};

function periodBounds(period: string): { start: Date; end: Date } {
  const [y, m] = period.split("-").map(Number);
  const start = new Date(`${y}-${String(m).padStart(2, "0")}-01T00:00:00+05:30`);
  const end =
    m === 12
      ? new Date(`${y + 1}-01-01T00:00:00+05:30`)
      : new Date(`${y}-${String(m + 1).padStart(2, "0")}-01T00:00:00+05:30`);
  return { start, end };
}

export async function aggregateGstr(
  input: GstrPeriodInput,
): Promise<GstrAggregate> {
  const { start, end } = periodBounds(input.period);
  const invoices = await prismaUnsafe.gstInvoice.findMany({
    where: {
      organisationId: input.organisationId,
      invoiceDate: { gte: start, lt: end },
      status: "ISSUED",
    },
  });

  let taxable = new Decimal(0);
  let cgst = new Decimal(0);
  let sgst = new Decimal(0);
  let igst = new Decimal(0);
  let outwardNilExempt = new Decimal(0);

  // B2B (buyer with GSTIN) vs B2CS (buyer without GSTIN)
  const b2bMap = new Map<string, { count: number; taxableValue: Decimal; tax: Decimal }>();
  let b2csTaxable = new Decimal(0);
  let b2csTax = new Decimal(0);

  for (const inv of invoices) {
    if (inv.isExempted) {
      outwardNilExempt = outwardNilExempt.plus(inv.taxableValue.toString());
      continue;
    }
    const t = new Decimal(inv.taxableValue.toString());
    const cg = new Decimal(inv.cgst.toString());
    const sg = new Decimal(inv.sgst.toString());
    const ig = new Decimal(inv.igst.toString());
    taxable = taxable.plus(t);
    cgst = cgst.plus(cg);
    sgst = sgst.plus(sg);
    igst = igst.plus(ig);

    const tax = cg.plus(sg).plus(ig);
    if (inv.buyerGstin) {
      const key = `${inv.buyerGstin}::${inv.buyerName}`;
      const b = b2bMap.get(key) ?? {
        count: 0,
        taxableValue: new Decimal(0),
        tax: new Decimal(0),
      };
      b.count += 1;
      b.taxableValue = b.taxableValue.plus(t);
      b.tax = b.tax.plus(tax);
      b2bMap.set(key, b);
    } else {
      b2csTaxable = b2csTaxable.plus(t);
      b2csTax = b2csTax.plus(tax);
    }
  }

  const total = taxable.plus(cgst).plus(sgst).plus(igst);
  const totalTaxLiability = cgst.plus(sgst).plus(igst);

  return {
    period: input.period,
    invoiceCount: invoices.length,
    taxableValue: taxable.toFixed(2),
    cgst: cgst.toFixed(2),
    sgst: sgst.toFixed(2),
    igst: igst.toFixed(2),
    total: total.toFixed(2),
    b2b: [...b2bMap.entries()].map(([k, v]) => ({
      count: v.count,
      taxableValue: v.taxableValue.toFixed(2),
      tax: v.tax.toFixed(2),
      _key: k,
    })) as never,
    b2cs: { taxableValue: b2csTaxable.toFixed(2), tax: b2csTax.toFixed(2) },
    outwardTaxable: taxable.toFixed(2),
    outwardNilExempt: outwardNilExempt.toFixed(2),
    totalTaxLiability: totalTaxLiability.toFixed(2),
  };
}

export async function exportGstrExcel(
  organisationId: string,
  filingType: "GSTR1" | "GSTR3B",
  agg: GstrAggregate,
): Promise<{ buffer: Buffer; url: string }> {
  const sheets: ExcelSheet[] = [];
  if (filingType === "GSTR1") {
    sheets.push(
      {
        name: "Summary",
        columns: [
          { header: "Field", width: 36 },
          { header: "Value", width: 22 },
        ],
        rows: [
          ["Period", agg.period],
          ["Invoices", String(agg.invoiceCount)],
          ["Taxable Value (₹)", agg.taxableValue],
          ["CGST (₹)", agg.cgst],
          ["SGST (₹)", agg.sgst],
          ["IGST (₹)", agg.igst],
          ["Total Invoice Value (₹)", agg.total],
          ["Nil/Exempt outward (₹)", agg.outwardNilExempt],
        ],
      },
      {
        name: "B2B",
        columns: [
          { header: "Buyer key", width: 36 },
          { header: "Invoices", width: 12 },
          { header: "Taxable Value (₹)", width: 18 },
          { header: "Tax (₹)", width: 16 },
        ],
        rows: agg.b2b.map((b) => [
          (b as unknown as { _key: string })._key,
          b.count,
          b.taxableValue,
          b.tax,
        ]),
      },
      {
        name: "B2CS",
        columns: [
          { header: "Field", width: 28 },
          { header: "Value", width: 20 },
        ],
        rows: [
          ["Taxable Value (₹)", agg.b2cs.taxableValue],
          ["Tax (₹)", agg.b2cs.tax],
        ],
      },
    );
  } else {
    sheets.push({
      name: "GSTR-3B Summary",
      columns: [
        { header: "Field", width: 50 },
        { header: "Value", width: 20 },
      ],
      rows: [
        ["Period", agg.period],
        ["3.1(a) Outward taxable supplies (₹)", agg.outwardTaxable],
        ["3.1(c) Outward Nil/Exempt supplies (₹)", agg.outwardNilExempt],
        ["CGST output (₹)", agg.cgst],
        ["SGST output (₹)", agg.sgst],
        ["IGST output (₹)", agg.igst],
        ["Total tax liability (₹)", agg.totalTaxLiability],
      ],
    });
  }

  const buffer = await buildWorkbook(sheets);
  const key = storageKey.gstrExport(
    organisationId,
    `${filingType}-${agg.period}`,
    "excel",
  );
  const stored = await storage.put(key, buffer, {
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    size: buffer.length,
  });
  return { buffer, url: stored.url };
}
