/**
 * Pure geodesic distance + a GPS-fix accumulator (Live Mileage build prompt §11,
 * §24). This is the honest core of live distance: it turns a stream of GPS fixes
 * into miles while refusing to fabricate distance.
 *
 * Non-negotiables encoded here:
 *  - A coverage gap (time between fixes too large) resets the reference WITHOUT
 *    adding the straight-line distance across the gap (§24: never fabricate gap
 *    distance; §11: GPS-gap handling).
 *  - Poor-accuracy fixes are discarded, not smoothed into fake movement.
 *  - Stationary jitter below a minimum step is ignored, and the reference point
 *    is held so drift can't slowly accumulate.
 *  - Physically impossible jumps (GPS spikes) are dropped.
 *
 * All functions are deterministic and device-free, so every rule above is unit
 * tested without a GPS radio.
 */

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface GeoFix extends GeoPoint {
  /** Horizontal accuracy in meters, if the platform reported it. */
  accuracyMeters?: number | null;
  /** Epoch milliseconds of the fix. */
  timestampMs: number;
}

/** Mean Earth radius in miles. */
const EARTH_RADIUS_MI = 3958.7613;

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance between two points, in miles (haversine). */
export function haversineMiles(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface AccumulatorConfig {
  /** Discard fixes worse than this horizontal accuracy (meters). */
  maxAccuracyMeters: number;
  /** Ignore movement below this many miles (GPS jitter while stationary). */
  minStepMiles: number;
  /**
   * A time gap larger than this (ms) is a coverage gap: the reference resets
   * without adding the straight-line distance across it (§24).
   */
  maxGapMs: number;
  /** Reject implied speeds above this (mph) as GPS spikes. */
  maxSpeedMph: number;
}

/** Production defaults tuned for highway driving; overridable per call. */
export const DEFAULT_ACCUMULATOR: AccumulatorConfig = {
  maxAccuracyMeters: 50,
  minStepMiles: 0.01, // ~53 ft — below this is stationary jitter
  maxGapMs: 120_000, // 2 min without a fix is treated as a gap
  maxSpeedMph: 120,
};

export interface AccumulatorState {
  /** The last accepted reference fix, or null before the first. */
  last: GeoFix | null;
}

export type FixOutcome = 'first' | 'accepted' | 'poor_accuracy' | 'jitter' | 'gap' | 'spike';

export interface AccumulatorStep {
  state: AccumulatorState;
  /** Miles to add for this fix (always >= 0). */
  deltaMiles: number;
  outcome: FixOutcome;
}

export const initialAccumulator = (): AccumulatorState => ({ last: null });

/**
 * Fold one GPS fix into the accumulator. Returns the next state, the miles to
 * add (0 unless the fix was accepted as real movement), and why.
 *
 * Pure: no mutation of the input state, no side effects.
 */
export function stepAccumulator(
  state: AccumulatorState,
  fix: GeoFix,
  config: AccumulatorConfig = DEFAULT_ACCUMULATOR,
): AccumulatorStep {
  // Poor-accuracy fix: drop it entirely, don't even move the reference.
  if (fix.accuracyMeters != null && fix.accuracyMeters > config.maxAccuracyMeters) {
    return { state, deltaMiles: 0, outcome: 'poor_accuracy' };
  }

  const last = state.last;
  if (!last) {
    return { state: { last: fix }, deltaMiles: 0, outcome: 'first' };
  }

  const dtMs = fix.timestampMs - last.timestampMs;
  // Out-of-order or duplicate timestamp — ignore, keep the reference.
  if (dtMs <= 0) {
    return { state, deltaMiles: 0, outcome: 'jitter' };
  }

  // Coverage gap: re-anchor at the new fix but never fabricate the miles
  // travelled while we had no signal.
  if (dtMs > config.maxGapMs) {
    return { state: { last: fix }, deltaMiles: 0, outcome: 'gap' };
  }

  const miles = haversineMiles(last, fix);

  // Stationary jitter: hold the old reference so tiny wobble can't accumulate.
  if (miles < config.minStepMiles) {
    return { state, deltaMiles: 0, outcome: 'jitter' };
  }

  // GPS spike: an implied speed no truck reaches — drop the point.
  const mph = miles / (dtMs / 3_600_000);
  if (mph > config.maxSpeedMph) {
    return { state, deltaMiles: 0, outcome: 'spike' };
  }

  return { state: { last: fix }, deltaMiles: miles, outcome: 'accepted' };
}

/** Total accepted miles across a sequence of fixes (used in tests + replay). */
export function accumulateMiles(
  fixes: readonly GeoFix[],
  config: AccumulatorConfig = DEFAULT_ACCUMULATOR,
): number {
  let state = initialAccumulator();
  let total = 0;
  for (const fix of fixes) {
    const step = stepAccumulator(state, fix, config);
    state = step.state;
    total += step.deltaMiles;
  }
  return total;
}
