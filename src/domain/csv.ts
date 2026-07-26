/**
 * Minimal, correct CSV builder for record exports (monthly closeout). Pure and
 * dependency-free. Uses RFC-4180 quoting (double quotes, doubled inner quotes)
 * and CRLF line endings so the file opens cleanly in Excel/Sheets.
 */

/** Quotes a cell when it contains a comma, quote, or newline; else passes through. */
export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

/** Builds a CSV string from a column spec and rows. Header row is always first. */
export function buildCsv<T>(columns: readonly CsvColumn<T>[], rows: readonly T[]): string {
  const header = columns.map((c) => escapeCsvCell(c.header)).join(',');
  const body = rows.map((row) => columns.map((c) => escapeCsvCell(c.value(row))).join(','));
  return [header, ...body].join('\r\n');
}
