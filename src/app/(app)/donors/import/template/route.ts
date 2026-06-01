/**
 * Sample CSV template for donor bulk import. Served as
 * `/donors/import/template` so the import page can link to it directly.
 *
 * Keep the column order aligned with `SAMPLE_HEADERS` in actions.ts so the
 * downloaded file is the canonical shape the importer expects.
 */
import { NextResponse } from "next/server";

const HEADERS = [
  "donorType",
  "name",
  "pan",
  "phone",
  "whatsapp",
  "email",
  "addressLine1",
  "addressLine2",
  "city",
  "district",
  "state",
  "pincode",
  "country",
  "is80GEligible",
  "isFcraEligible",
  "isCsrDonor",
  "csrCompanyCin",
  "internalNotes",
];

// Two illustrative sample rows so importers see how each donorType is laid out.
const SAMPLES: Record<string, string>[] = [
  {
    donorType: "INDIVIDUAL",
    name: "Ankita Sharma",
    pan: "ABCDE1234F",
    phone: "+91 98765 43210",
    whatsapp: "+91 98765 43210",
    email: "ankita@example.com",
    addressLine1: "12 Lavelle Road",
    addressLine2: "",
    city: "Bengaluru",
    district: "Bengaluru Urban",
    state: "Karnataka",
    pincode: "560001",
    country: "India",
    is80GEligible: "true",
    isFcraEligible: "false",
    isCsrDonor: "false",
    csrCompanyCin: "",
    internalNotes: "Long-time donor; prefers email receipts.",
  },
  {
    donorType: "CORPORATE",
    name: "Acme India Pvt Ltd",
    pan: "AAACE1234G",
    phone: "+91 80 4567 8900",
    whatsapp: "",
    email: "csr@acme.in",
    addressLine1: "Block A, IT Park",
    addressLine2: "EPIP Zone",
    city: "Bengaluru",
    district: "Bengaluru Urban",
    state: "Karnataka",
    pincode: "560066",
    country: "India",
    is80GEligible: "true",
    isFcraEligible: "false",
    isCsrDonor: "true",
    csrCompanyCin: "U72200KA2005PTC036000",
    internalNotes: "CSR donor — quarterly reporting required.",
  },
];

function escapeCell(v: string): string {
  if (v === "") return "";
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function GET(): NextResponse {
  const lines: string[] = [];
  lines.push(HEADERS.map(escapeCell).join(","));
  for (const row of SAMPLES) {
    lines.push(HEADERS.map((h) => escapeCell(row[h] ?? "")).join(","));
  }
  return new NextResponse(lines.join("\n") + "\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition":
        'attachment; filename="rakshana-donor-import-template.csv"',
    },
  });
}
