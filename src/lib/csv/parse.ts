/**
 * Tiny RFC 4180-ish CSV parser.
 *
 * We use this instead of pulling in `papaparse` because the import flows
 * we care about — donors, vendors, beneficiaries — are all well-formed
 * spreadsheets that a trust accountant exports from Excel/Tally. We don't
 * need streaming, type inference, or auto-detection of delimiters.
 *
 * Handles:
 *   - Quoted cells (with embedded commas / newlines)
 *   - Escaped quotes (`""`)
 *   - CRLF or LF line endings
 *   - BOM at start of file
 *   - Blank lines (skipped)
 *
 * Returns `{ headers, rows }` where rows are arrays of strings matching
 * the header positions. Empty fields come through as `""`.
 */

export type ParsedCsv = {
  headers: string[];
  rows: string[][];
};

export function parseCsv(text: string): ParsedCsv {
  // Strip BOM if present
  const cleaned = text.replace(/^﻿/, "");

  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    const next = cleaned[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      cur.push(field);
      field = "";
      continue;
    }
    if (ch === "\r") {
      // Swallow; the LF that follows triggers row close.
      continue;
    }
    if (ch === "\n") {
      cur.push(field);
      field = "";
      // Skip rows that are entirely empty
      if (cur.some((c) => c.trim().length > 0)) rows.push(cur);
      cur = [];
      continue;
    }
    field += ch;
  }
  // Flush trailing partial line
  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    if (cur.some((c) => c.trim().length > 0)) rows.push(cur);
  }

  if (rows.length === 0) return { headers: [], rows: [] };

  const [headerRow, ...dataRows] = rows;
  return {
    headers: headerRow.map((h) => h.trim()),
    rows: dataRows,
  };
}

/**
 * Convert parsed rows to objects keyed by header name. Handy when the
 * downstream code wants `{ name: "Ankita", pan: "ABCDE1234F" }` not
 * a positional array.
 */
export function rowsToObjects(parsed: ParsedCsv): Record<string, string>[] {
  return parsed.rows.map((row) => {
    const obj: Record<string, string> = {};
    for (let i = 0; i < parsed.headers.length; i += 1) {
      obj[parsed.headers[i]] = (row[i] ?? "").trim();
    }
    return obj;
  });
}
