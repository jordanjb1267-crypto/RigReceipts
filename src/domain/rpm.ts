/**
 * RPM Coach formulas (Master Build Prompt Loop 8), using the fixed/variable
 * cost decomposition locked in docs/DECISIONS.md (decision 4):
 *
 * - Fixed weekly costs: time-based recurring (truck/trailer payments, insurance,
 *   permits amortized, ELD/software, phone).
 * - Variable cost per mile: fuel, DEF, maintenance/tire reserves, repairs average.
 *
 * The target formulas use the decomposition; `trueCostPerMile` is an ACTUALS
 * metric (period expenses ÷ period miles) and is never fed back into the
 * target formula, so fixed costs are not double-counted.
 *
 * All functions return raw (unrounded) dollars; presentation rounds.
 * These are calculator outputs, not business guarantees (spec: "operating guide").
 */

export interface RpmPlanInputs {
  /** Time-based recurring weekly costs, in USD. */
  fixedWeeklyCosts: number;
  /** Per-mile running cost, in USD per mile. */
  variableCostPerMile: number;
  /** Expected total miles (loaded + deadhead) for the week. */
  projectedTotalMiles: number;
  /** Expected loaded (revenue) miles for the week. */
  expectedLoadedMiles: number;
  /** Weekly pay the driver wants to take home, in USD. */
  desiredDriverPay: number;
  /** Weekly profit / reserve target, in USD. */
  desiredProfitReserve: number;
}

/** Actual cost per mile over a period. Returns null when no miles were run. */
export function trueCostPerMile(totalExpenses: number, totalMiles: number): number | null {
  if (totalMiles <= 0) return null;
  return totalExpenses / totalMiles;
}

/**
 * All-mile rate needed to cover costs alone (no pay, no profit).
 * Returns null when no miles are projected.
 */
export function breakEvenAllMileRpm(
  fixedWeeklyCosts: number,
  variableCostPerMile: number,
  projectedTotalMiles: number,
): number | null {
  if (projectedTotalMiles <= 0) return null;
  return (fixedWeeklyCosts + variableCostPerMile * projectedTotalMiles) / projectedTotalMiles;
}

/** Weekly revenue needed = fixed + variable×miles + driver pay + profit reserve. */
export function weeklyRevenueNeeded(inputs: RpmPlanInputs): number {
  return (
    inputs.fixedWeeklyCosts +
    inputs.variableCostPerMile * inputs.projectedTotalMiles +
    inputs.desiredDriverPay +
    inputs.desiredProfitReserve
  );
}

/** Target loaded RPM = weekly revenue needed ÷ expected loaded miles. Null when no loaded miles. */
export function targetLoadedRpm(inputs: RpmPlanInputs): number | null {
  if (inputs.expectedLoadedMiles <= 0) return null;
  return weeklyRevenueNeeded(inputs) / inputs.expectedLoadedMiles;
}

export type LoadRateVerdict = 'above_target' | 'on_target' | 'below_target' | 'below_break_even';

export interface LoadRateCheckInputs {
  /** Total pay offered for the load, in USD. */
  offeredPay: number;
  loadedMiles: number;
  deadheadMiles: number;
  /** Driver's target loaded RPM (from targetLoadedRpm). */
  targetLoadedRpm: number;
  /** Driver's break-even all-mile RPM (from breakEvenAllMileRpm). */
  breakEvenAllMileRpm: number;
  /**
   * Relative band around target treated as "on target" (default 2%).
   * e.g. 0.02 → within ±2% of target counts as on_target.
   */
  tolerance?: number;
}

export interface LoadRateCheckResult {
  loadedRpm: number;
  allMileRpm: number;
  verdict: LoadRateVerdict;
}

/**
 * Load Rate Check (Loop 8): compares an offered load against the driver's
 * own numbers. Break-even is evaluated on ALL miles (deadhead included);
 * target is evaluated on loaded miles.
 */
export function checkLoadRate(inputs: LoadRateCheckInputs): LoadRateCheckResult {
  const { offeredPay, loadedMiles, deadheadMiles, tolerance = 0.02 } = inputs;
  if (loadedMiles <= 0) {
    throw new RangeError('checkLoadRate requires loadedMiles > 0');
  }
  if (deadheadMiles < 0) {
    throw new RangeError('checkLoadRate requires deadheadMiles >= 0');
  }

  const loadedRpm = offeredPay / loadedMiles;
  const allMileRpm = offeredPay / (loadedMiles + deadheadMiles);

  let verdict: LoadRateVerdict;
  if (allMileRpm < inputs.breakEvenAllMileRpm) {
    verdict = 'below_break_even';
  } else if (loadedRpm < inputs.targetLoadedRpm * (1 - tolerance)) {
    verdict = 'below_target';
  } else if (loadedRpm <= inputs.targetLoadedRpm * (1 + tolerance)) {
    verdict = 'on_target';
  } else {
    verdict = 'above_target';
  }

  return { loadedRpm, allMileRpm, verdict };
}
