import "server-only";
import ExcelJS from "exceljs";

/**
 * Shared Excel export helper. Used by ITR-7 figures, GSTR-1/3B, Form 26Q,
 * 10BD summary, and any future compliance export.
 *
 * Each `Sheet` provides a name, an optional list of column headers, and a
 * matrix of rows. We keep the API tiny and the formatting consistent:
 *  - header row bolded
 *  - currency columns get tabular-nums via the font setting (no per-cell
 *    formatting — that lives in the consumer code if needed)
 */

export type ExcelCellValue = string | number | boolean | Date | null;

export type ExcelSheet = {
  name: string;
  columns?: { header: string; width?: number; key?: string }[];
  rows: ExcelCellValue[][];
  /** Optional rows pinned at the top before the header (e.g. titles). */
  preHeaderRows?: ExcelCellValue[][];
};

export async function buildWorkbook(sheets: ExcelSheet[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Rakshana";
  wb.created = new Date();

  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name.slice(0, 31)); // Excel sheet-name limit
    if (sheet.columns) {
      ws.columns = sheet.columns.map((c) => ({
        header: c.header,
        width: c.width ?? 18,
        key: c.key,
      }));
      ws.getRow(1).font = { bold: true };
    }
    if (sheet.preHeaderRows?.length) {
      // Insert rows BEFORE the header row (which exceljs put at row 1).
      sheet.preHeaderRows.slice().reverse().forEach((r) => ws.spliceRows(1, 0, r));
      // Re-bold the (now-shifted) header row
      const headerRowIdx = sheet.preHeaderRows.length + 1;
      ws.getRow(headerRowIdx).font = { bold: true };
    }
    for (const row of sheet.rows) ws.addRow(row);
  }

  const buffer = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  return Buffer.from(buffer);
}
