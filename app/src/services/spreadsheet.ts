/**
 * Spreadsheet parsing / serialization service.
 *
 * Uses SheetJS (xlsx) loaded lazily so it doesn't bloat the initial bundle.
 * Supports reading CSV, TSV, XLSX, XLS and ODS files.
 * Writing back is only supported for CSV/TSV (text round-trip);
 * XLSX editing should be exported to CSV via `serializeSheetToCSV`.
 */

import { readFile as tauriReadFile, readTextFile } from './fs';

export interface SheetTab {
  name: string;
  /** Column header labels (row 0 of the sheet). */
  headers: string[];
  /** Data rows (excluding the header row). Each inner array aligns with headers. */
  rows: string[][];
  /**
   * Formula strings for XLSX cells, keyed as "rowIndex,colIndex" (0-based, relative to rows[]).
   * If a cell has formula `=SUM(A1:A3)`, the display value is in rows[][] but the formula
   * is here so the editor can show it when the user double-clicks.
   */
  formulas?: Record<string, string>;
  /**
   * Cell types keyed as "rowIndex,colIndex". Values: 'n' (number), 'd' (date), 's' (string), 'b' (bool).
   * Used for right-alignment of numeric cells.
   */
  cellTypes?: Record<string, string>;
}

export interface SheetData {
  filename: string;
  /** All worksheet tabs. CSV files always have exactly one tab. */
  sheets: SheetTab[];
}

/** Extensions that are binary — must be read with readFile, not readTextFile. */
const BINARY_EXTS = new Set(['xlsx', 'xls', 'ods', 'xlsm', 'xlsb']);

/** Lazily-loaded SheetJS module (singleton). */
let xlsxModule: typeof import('xlsx') | null = null;
async function getXlsx() {
  if (!xlsxModule) xlsxModule = await import('xlsx');
  return xlsxModule;
}

/**
 * Parse any supported spreadsheet file into a structured SheetData object.
 * `absPath` is the absolute path to the file on disk.
 * `ext` is the lowercase file extension (without the dot, e.g. "xlsx", "csv").
 */
export async function parseSpreadsheetFile(absPath: string, ext: string): Promise<SheetData> {
  const filename = absPath.split('/').pop() ?? absPath;
  const XLSX = await getXlsx();

  let workbook: import('xlsx').WorkBook;

  if (BINARY_EXTS.has(ext)) {
    const bytes = await tauriReadFile(absPath);
    workbook = XLSX.read(bytes, { type: 'array', cellText: true, cellDates: true });
  } else {
    // CSV / TSV — plain text
    const text = await readTextFile(absPath);
    const delimiter = ext === 'tsv' ? '\t' : ',';
    workbook = XLSX.read(text, { type: 'string', FS: delimiter, cellText: true });
  }

  const sheets: SheetTab[] = workbook.SheetNames.map((sheetName) => {
    const ws = workbook.Sheets[sheetName];
    // sheet_to_json with header: 1 gives us a string[][] (first row = headers)
    const raw = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '', raw: false });

    if (raw.length === 0) {
      return { name: sheetName, headers: [], rows: [] };
    }

    const headers = (raw[0] ?? []).map(String);
    const rows = raw.slice(1).map((row) => {
      // Pad or trim each row to match header count
      const cells = row.map(String);
      while (cells.length < headers.length) cells.push('');
      return cells.slice(0, Math.max(headers.length, 1));
    });

    // Extract formula strings and cell types from the raw worksheet cells
    const formulas: Record<string, string> = {};
    const cellTypes: Record<string, string> = {};
    const ref = ws['!ref'];
    if (ref) {
      const range = XLSX.utils.decode_range(ref);
      for (let r = range.s.r + 1; r <= range.e.r; r++) { // skip header row (r=0)
        for (let c = range.s.c; c <= range.e.c; c++) {
          const cellAddr = XLSX.utils.encode_cell({ r, c });
          const cell = ws[cellAddr];
          if (!cell) continue;
          const rowIdx = r - range.s.r - 1; // 0-based data row index
          const colIdx = c - range.s.c;     // 0-based col index
          if (colIdx < headers.length) {
            const key = `${rowIdx},${colIdx}`;
            if (cell.f) formulas[key] = `=${cell.f}`;
            if (cell.t) cellTypes[key] = cell.t;
          }
        }
      }
    }

    return {
      name: sheetName,
      headers,
      rows,
      formulas: Object.keys(formulas).length > 0 ? formulas : undefined,
      cellTypes: Object.keys(cellTypes).length > 0 ? cellTypes : undefined,
    };
  });

  return { filename, sheets };
}

/**
 * Serialize a single SheetTab back to CSV text (comma-separated, UTF-8).
 * Uses SheetJS to handle proper quoting of values that contain commas/newlines.
 */
export async function serializeSheetToCSV(sheet: SheetTab): Promise<string> {
  const XLSX = await getXlsx();
  const allRows = [sheet.headers, ...sheet.rows];
  const ws = XLSX.utils.aoa_to_sheet(allRows);
  return XLSX.utils.sheet_to_csv(ws);
}

/**
 * Serialize a single SheetTab back to TSV text (tab-separated).
 */
export async function serializeSheetToTSV(sheet: SheetTab): Promise<string> {
  const escapeCell = (v: string) => v.replace(/\t/g, ' ').replace(/\n/g, ' ');
  const lines = [sheet.headers, ...sheet.rows].map((row) =>
    row.map(escapeCell).join('\t'),
  );
  return lines.join('\n');
}

/**
 * Convert a SheetTab to a Markdown table string for AI consumption.
 * Truncates to `maxRows` data rows (default 200) to avoid overflowing context.
 */
export function sheetToMarkdownTable(sheet: SheetTab, maxRows = 200): string {
  const headers = sheet.headers.length > 0 ? sheet.headers : ['(empty)'];
  const rows = sheet.rows.slice(0, maxRows);
  const truncated = sheet.rows.length > maxRows;

  const sep = headers.map(() => '---');
  const lines: string[] = [
    `| ${headers.join(' | ')} |`,
    `| ${sep.join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ];

  if (truncated) {
    lines.push(`\n_… ${sheet.rows.length - maxRows} more rows not shown (use max_rows to increase)_`);
  }

  return lines.join('\n');
}
