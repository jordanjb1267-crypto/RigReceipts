/**
 * Detention owed (Master Build Prompt Loop 6):
 *   owed = max(0, departure − arrival − free time) × hourly rate
 *
 * Billing granularity: prorated to the minute, rounded to cents
 * (docs/DECISIONS.md — carrier-specific rounding is handled via the manual
 * override the spec requires).
 */

/** Spec-mandated copy shown wherever an estimate is displayed. */
export const DETENTION_DISCLAIMER =
  'Estimated detention owed. Confirm with your carrier, broker, or rate confirmation.';

export interface DetentionInputs {
  /** Arrival at the facility (ms epoch or Date). */
  arrivalTime: Date | number;
  /** Departure from the facility (ms epoch or Date). */
  departureTime: Date | number;
  /** Free time allowed before detention starts, in minutes. */
  freeTimeMinutes: number;
  /** Detention rate, USD per hour. */
  hourlyRateUsd: number;
  /** Manually adjusted amount; when set it wins over the estimate. */
  manualOverrideUsd?: number | null;
}

export interface DetentionResult {
  /** Minutes past free time (never negative). */
  billableMinutes: number;
  /** Formula estimate, rounded to cents. */
  estimatedUsd: number;
  /** Amount to record: manual override when provided, else the estimate. */
  owedUsd: number;
  isOverridden: boolean;
}

const toMs = (t: Date | number): number => (t instanceof Date ? t.getTime() : t);

const roundToCents = (usd: number): number => Math.round(usd * 100) / 100;

export function calculateDetention(inputs: DetentionInputs): DetentionResult {
  const { freeTimeMinutes, hourlyRateUsd, manualOverrideUsd } = inputs;
  if (hourlyRateUsd < 0) throw new RangeError('hourlyRateUsd must be >= 0');
  if (freeTimeMinutes < 0) throw new RangeError('freeTimeMinutes must be >= 0');

  const dwellMinutes = (toMs(inputs.departureTime) - toMs(inputs.arrivalTime)) / 60_000;
  const billableMinutes = Math.max(0, dwellMinutes - freeTimeMinutes);
  const estimatedUsd = roundToCents((billableMinutes / 60) * hourlyRateUsd);

  const isOverridden = manualOverrideUsd !== undefined && manualOverrideUsd !== null;
  return {
    billableMinutes,
    estimatedUsd,
    owedUsd: isOverridden ? roundToCents(manualOverrideUsd) : estimatedUsd,
    isOverridden,
  };
}
