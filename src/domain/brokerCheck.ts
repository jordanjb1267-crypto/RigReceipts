/**
 * Broker Check (gated by `broker_check_enabled`). Summarizes a driver's OWN
 * recorded experience with a broker — how they were paid, on time, and whether
 * detention was honored. It is not a public rating, credit report, or licensed
 * data feed, and it never supports accusations: every figure is derived only
 * from the signed-in driver's own logged loads and is labeled that way in the UI.
 */

export interface BrokerExperience {
  /** ISO date of the load. */
  loadDate: string;
  paidOnTime: boolean;
  /** Days from delivery to payment, when known. */
  daysToPay: number | null;
  /** Whether owed detention was honored, when applicable. */
  detentionHonored: boolean | null;
}

export type BrokerReliability = 'excellent' | 'good' | 'watch' | 'unrated';

export interface BrokerSummary {
  loadCount: number;
  onTimeCount: number;
  /** 0–1, or null with no loads. */
  onTimeRate: number | null;
  avgDaysToPay: number | null;
  reliability: BrokerReliability;
}

/** At least this many logged loads before a reliability label is shown. */
export const MIN_LOADS_TO_RATE = 3;

const round1 = (n: number): number => Math.round(n * 10) / 10;

function classifyReliability(
  loadCount: number,
  onTimeRate: number,
  avgDaysToPay: number | null,
): BrokerReliability {
  if (loadCount < MIN_LOADS_TO_RATE) return 'unrated';
  const slowPay = avgDaysToPay !== null && avgDaysToPay > 45;
  if (onTimeRate >= 0.95 && !slowPay) return 'excellent';
  if (onTimeRate >= 0.85 && (avgDaysToPay === null || avgDaysToPay <= 60)) return 'good';
  return 'watch';
}

/** Aggregates a broker's logged experiences into a driver-private summary. */
export function summarizeBrokerHistory(experiences: readonly BrokerExperience[]): BrokerSummary {
  const loadCount = experiences.length;
  if (loadCount === 0) {
    return {
      loadCount: 0,
      onTimeCount: 0,
      onTimeRate: null,
      avgDaysToPay: null,
      reliability: 'unrated',
    };
  }
  const onTimeCount = experiences.filter((e) => e.paidOnTime).length;
  const onTimeRate = onTimeCount / loadCount;
  const days = experiences.map((e) => e.daysToPay).filter((d): d is number => d !== null && d >= 0);
  const avgDaysToPay = days.length ? round1(days.reduce((a, b) => a + b, 0) / days.length) : null;
  return {
    loadCount,
    onTimeCount,
    onTimeRate,
    avgDaysToPay,
    reliability: classifyReliability(loadCount, onTimeRate, avgDaysToPay),
  };
}

export const RELIABILITY_LABEL: Record<BrokerReliability, string> = {
  excellent: 'Paid you well',
  good: 'Mostly reliable',
  watch: 'Watch pay terms',
  unrated: 'Not enough history',
};
