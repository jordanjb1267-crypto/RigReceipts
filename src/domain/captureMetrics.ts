/**
 * Pure spend aggregation over the driver's local captures. This is the first
 * real-data (non-mock) metric layer: the capture queue is the on-device source
 * of truth for scanned receipts, so month-to-date spend, record counts, and a
 * category breakdown can all be computed here without a backend round-trip.
 *
 * Kept dependency-free and device-free (no store import) so it unit-tests
 * headless. Screens pass their `Capture[]` in; the shape below is the subset
 * this module reads.
 */

import { ExpenseCategorySlug, expenseCategoryLabel } from './categories';
import { ScanTypeSlug, scanTypeToExpenseCategory } from './scanTypes';

export interface ExpenseLike {
  scanType: ScanTypeSlug;
  /** Parsed amount in USD, or null when OCR/entry left it blank. */
  totalUsd: number | null;
  gallons: number | null;
  /** ISO `YYYY-MM-DD` of the receipt, or null to fall back to `createdAt`. */
  date: string | null;
  /** Epoch ms the capture was recorded. */
  createdAt: number;
}

export interface CategorySpend {
  category: ExpenseCategorySlug;
  label: string;
  totalUsd: number;
  count: number;
}

export interface SpendSummary {
  totalUsd: number;
  /** Captures that represent money out (scan type maps to an expense category). */
  expenseCount: number;
  /** Captures that are pure documents (BOL / POD / inspection). */
  documentCount: number;
  fuelGallons: number;
  /** Category breakdown, highest spend first. Only money-type captures appear. */
  byCategory: CategorySpend[];
  topCategory: CategorySpend | null;
}

export interface DateRange {
  /** Inclusive lower bound (epoch ms). */
  startMs: number;
  /** Exclusive upper bound (epoch ms). */
  endMs: number;
  /** Human label, e.g. "July 2026". Present for month ranges. */
  label?: string;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * The instant a capture is attributed to. Prefers the receipt date (parsed in
 * local time so it lines up with locally-constructed month boundaries) and
 * falls back to when it was recorded.
 */
export function effectiveDateMs(e: ExpenseLike): number {
  if (e.date) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(e.date);
    if (m) {
      return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
    }
    const parsed = Date.parse(e.date);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return e.createdAt;
}

/** The calendar-month range containing `now` (local time). */
export function monthRange(now: Date): DateRange {
  const y = now.getFullYear();
  const m = now.getMonth();
  return {
    startMs: new Date(y, m, 1).getTime(),
    endMs: new Date(y, m + 1, 1).getTime(),
    label: `${MONTH_NAMES[m]} ${y}`,
  };
}

/** The trailing 7-day window ending at `now` (inclusive of the last 7 days). */
export function last7dRange(now: Date): DateRange {
  const endMs = now.getTime();
  return { startMs: endMs - 7 * 24 * 60 * 60 * 1000, endMs };
}

/** Filters captures whose effective date falls within `[startMs, endMs)`. */
export function expensesInRange<T extends ExpenseLike>(
  expenses: readonly T[],
  range: DateRange,
): T[] {
  return expenses.filter((e) => {
    const ms = effectiveDateMs(e);
    return ms >= range.startMs && ms < range.endMs;
  });
}

/** Aggregates a set of captures into a spend summary. */
export function summarizeSpend(expenses: readonly ExpenseLike[]): SpendSummary {
  const byCat = new Map<ExpenseCategorySlug, CategorySpend>();
  let totalUsd = 0;
  let expenseCount = 0;
  let documentCount = 0;
  let fuelGallons = 0;

  for (const e of expenses) {
    const category = scanTypeToExpenseCategory(e.scanType);
    if (category === null) {
      documentCount += 1;
      continue;
    }
    expenseCount += 1;
    const amount = e.totalUsd ?? 0;
    totalUsd += amount;
    if (e.scanType === 'fuel' && e.gallons) fuelGallons += e.gallons;

    const existing = byCat.get(category);
    if (existing) {
      existing.totalUsd += amount;
      existing.count += 1;
    } else {
      byCat.set(category, {
        category,
        label: expenseCategoryLabel(category),
        totalUsd: amount,
        count: 1,
      });
    }
  }

  const byCategory = [...byCat.values()].sort(
    (a, b) => b.totalUsd - a.totalUsd || b.count - a.count,
  );

  return {
    totalUsd: Math.round(totalUsd * 100) / 100,
    expenseCount,
    documentCount,
    fuelGallons: Math.round(fuelGallons * 100) / 100,
    byCategory,
    topCategory: byCategory[0] ?? null,
  };
}

/** Convenience: summarize just the captures in the given range. */
export function summarizeRange(expenses: readonly ExpenseLike[], range: DateRange): SpendSummary {
  return summarizeSpend(expensesInRange(expenses, range));
}
