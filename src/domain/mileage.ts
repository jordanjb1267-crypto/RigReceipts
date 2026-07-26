/**
 * Pure mileage aggregation over manually-entered trips. Miles feed cost-per-mile
 * and the RPM Coach, so this closes a real loop with captureMetrics: total
 * expenses ÷ total miles = actual cost per mile.
 *
 * Live GPS trip tracking stays out of scope (it needs on-device background
 * location); this module only cares about loaded/deadhead miles once entered,
 * however they were captured.
 */

import { Dated, DateRange, inDateRange } from './captureMetrics';

export interface TripLike extends Dated {
  loadedMiles: number;
  deadheadMiles: number;
}

export interface MileageSummary {
  tripCount: number;
  totalMiles: number;
  loadedMiles: number;
  deadheadMiles: number;
  /** Deadhead share of total miles (0–1), or null when there are no miles. */
  deadheadPct: number | null;
}

const clampMiles = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0);
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Aggregates trips into loaded/deadhead totals and a deadhead ratio. */
export function summarizeTrips(trips: readonly TripLike[]): MileageSummary {
  let loadedMiles = 0;
  let deadheadMiles = 0;
  for (const t of trips) {
    loadedMiles += clampMiles(t.loadedMiles);
    deadheadMiles += clampMiles(t.deadheadMiles);
  }
  const totalMiles = loadedMiles + deadheadMiles;
  return {
    tripCount: trips.length,
    totalMiles,
    loadedMiles,
    deadheadMiles,
    deadheadPct: totalMiles > 0 ? deadheadMiles / totalMiles : null,
  };
}

/** Filters trips whose effective date falls within the range. */
export function tripsInRange<T extends TripLike>(trips: readonly T[], range: DateRange): T[] {
  return inDateRange(trips, range);
}

/**
 * Actual cost per mile: total expenses ÷ total miles. Null when there are no
 * miles yet (dividing by zero would be a meaningless "infinite" cost).
 */
export function costPerMile(totalExpensesUsd: number, totalMiles: number): number | null {
  if (totalMiles <= 0) return null;
  return round2(totalExpensesUsd / totalMiles);
}
