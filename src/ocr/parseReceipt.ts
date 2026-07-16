import { ParsedReceipt } from './types';

/**
 * Heuristic receipt/invoice parser. Turns raw OCR text into structured fields
 * so the review sheet can pre-fill amount, vendor, date, and (for fuel) gallons.
 *
 * Deliberately conservative: it never invents data. Anything it cannot find is
 * returned as null, and the spec requires the user to confirm/edit before any
 * financial record is saved — so wrong guesses are corrected, not trusted.
 *
 * Pure and Hermes-safe (no regex lookbehind), which keeps it unit-testable.
 */
export function parseReceipt(rawText: string): ParsedReceipt {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  return {
    totalUsd: parseTotal(lines),
    vendor: parseVendor(lines),
    date: parseDate(rawText),
    gallons: parseGallons(rawText),
    rawText,
  };
}

// --- money -----------------------------------------------------------------

const MONEY_RE = /\d[\d,]*\.\d{2}/g;

function moneyValues(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(MONEY_RE)) {
    const n = Number(m[0].replace(/,/g, ''));
    if (!Number.isNaN(n)) out.push(n);
  }
  return out;
}

/** Last money value on a line — totals usually sit at the right edge. */
function lastMoneyOnLine(line: string): number | null {
  const vals = moneyValues(line);
  return vals.length ? vals[vals.length - 1] : null;
}

// Priority of total-like labels (highest first). Lookbehind-free: we exclude
// subtotal/tax lines explicitly rather than with `(?<!sub)`.
const TOTAL_KEYS = ['grand total', 'amount due', 'balance due', 'total due', 'total'];

function parseTotal(lines: string[]): number | null {
  const candidates: { priority: number; value: number }[] = [];

  lines.forEach((line, i) => {
    const lc = line.toLowerCase();
    if (lc.includes('subtotal') || lc.includes('sub total') || lc.includes('tax')) return;

    const priority = TOTAL_KEYS.findIndex((k) => lc.includes(k));
    if (priority === -1) return;

    // Money on this line, or the following line if the label stands alone.
    const value = lastMoneyOnLine(line) ?? (lines[i + 1] ? lastMoneyOnLine(lines[i + 1]) : null);
    if (value !== null) candidates.push({ priority, value });
  });

  if (candidates.length > 0) {
    // Lower priority index = stronger label; on a tie prefer the larger amount.
    candidates.sort((a, b) => a.priority - b.priority || b.value - a.value);
    return candidates[0].value;
  }

  // Fallback: the largest currency amount anywhere.
  const all = moneyValues(lines.join('\n'));
  return all.length ? Math.max(...all) : null;
}

// --- vendor ----------------------------------------------------------------

function parseVendor(lines: string[]): string | null {
  for (const line of lines) {
    const letters = (line.match(/[A-Za-z]/g) ?? []).length;
    const digits = (line.match(/\d/g) ?? []).length;
    if (letters < 3) continue;
    if (digits > letters) continue; // skip address / receipt-number lines
    if (isDateLine(line)) continue;
    if (/^(receipt|invoice|order|ticket|store|reg|cashier)\b/i.test(line)) continue;
    return line.replace(/\s{2,}/g, ' ').slice(0, 60);
  }
  return null;
}

// --- date ------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const NUMERIC_DATE_RE = /\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b/;
const ISO_DATE_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/;
const MONTH_DAY_YEAR_RE = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/;
const DAY_MONTH_YEAR_RE = /\b(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})\b/;

function isDateLine(line: string): boolean {
  return (
    ISO_DATE_RE.test(line) ||
    NUMERIC_DATE_RE.test(line) ||
    MONTH_DAY_YEAR_RE.test(line) ||
    DAY_MONTH_YEAR_RE.test(line)
  );
}

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const yyyy = y < 100 ? 2000 + y : y;
  return `${yyyy}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseDate(text: string): string | null {
  const isoM = text.match(ISO_DATE_RE);
  if (isoM) {
    const r = iso(Number(isoM[1]), Number(isoM[2]), Number(isoM[3]));
    if (r) return r;
  }

  const mdy = text.match(MONTH_DAY_YEAR_RE);
  if (mdy) {
    const mon = MONTHS[mdy[1].slice(0, 3).toLowerCase()];
    if (mon) {
      const r = iso(Number(mdy[3]), mon, Number(mdy[2]));
      if (r) return r;
    }
  }

  const dmy = text.match(DAY_MONTH_YEAR_RE);
  if (dmy) {
    const mon = MONTHS[dmy[2].slice(0, 3).toLowerCase()];
    if (mon) {
      const r = iso(Number(dmy[3]), mon, Number(dmy[1]));
      if (r) return r;
    }
  }

  // Numeric MM/DD/YY(YY) — assume US month-first ordering.
  const num = text.match(NUMERIC_DATE_RE);
  if (num) {
    const r = iso(Number(num[3]), Number(num[1]), Number(num[2]));
    if (r) return r;
  }

  return null;
}

// --- gallons ---------------------------------------------------------------

function parseGallons(text: string): number | null {
  // "GAL 69.400" / "GALLONS: 69.4"
  const labelFirst = text.match(/\bgal(?:lons?)?\b\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
  if (labelFirst) return round3(Number(labelFirst[1]));
  // "69.400 GAL"
  const numFirst = text.match(/(\d+(?:\.\d+)?)\s*gal(?:lons?)?\b/i);
  if (numFirst) return round3(Number(numFirst[1]));
  return null;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
