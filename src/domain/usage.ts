import { canUseFeature, FEATURE_MIN_TIER, FREE_LIMITS, Tier } from './entitlements';

/**
 * Monthly usage metering for free-tier caps (Section 40). Pure helpers — the
 * persisted counters live in the subscription store.
 */

/** `2026-07` — counters reset when the month key changes. */
export function currentMonthKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export type MeteredAction = 'rate_check' | 'broker_check' | 'compare_to_costs';

const ACTION_LIMIT: Record<MeteredAction, number> = {
  rate_check: FREE_LIMITS.rateChecksPerMonth,
  broker_check: FREE_LIMITS.brokerChecksPerMonth,
  compare_to_costs: FREE_LIMITS.compareToCostsPerMonth,
};

const ACTION_UNLIMITED_FEATURE: Record<MeteredAction, keyof typeof FEATURE_MIN_TIER> = {
  rate_check: 'unlimitedRateChecks',
  broker_check: 'unlimitedBrokerChecks',
  compare_to_costs: 'unlimitedCompareToCosts',
};

export interface AllowanceResult {
  allowed: boolean;
  /** Remaining uses this month; null means unlimited. */
  remaining: number | null;
}

/** Whether the tier may perform the action given this month's used count. */
export function checkAllowance(
  tier: Tier,
  action: MeteredAction,
  usedThisMonth: number,
): AllowanceResult {
  if (canUseFeature(tier, ACTION_UNLIMITED_FEATURE[action])) {
    return { allowed: true, remaining: null };
  }
  const limit = ACTION_LIMIT[action];
  return { allowed: usedThisMonth < limit, remaining: Math.max(0, limit - usedThisMonth) };
}
