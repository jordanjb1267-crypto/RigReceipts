/**
 * Freight Intelligence domain logic (pure, device- and backend-free).
 *
 * Covers: rate-check metrics, the rate-card privacy sanitizer, approximate date
 * bucketing, verification eligibility, sensitive-data detection for the
 * pre-publish checks, and lane aggregate thresholds/confidence. Everything here
 * is unit-tested and reused by the UI and Edge Functions later.
 */
import { LoadRateVerdict } from './rpm';
import { EquipmentType } from './equipment';

// ---------------------------------------------------------------------------
// Rate statuses & verification levels
// ---------------------------------------------------------------------------

export const RATE_STATUSES = ['offered', 'accepted', 'completed'] as const;
export type RateStatus = (typeof RATE_STATUSES)[number];

/** Section 19. `settlement_verified` is reserved for a future release. */
export const VERIFICATION_LEVELS = [
  'self_entered',
  'document_verified',
  'completed_load',
  'settlement_verified',
] as const;
export type VerificationLevel = (typeof VERIFICATION_LEVELS)[number];

export const CARD_VISIBILITY = ['private', 'external', 'public'] as const;
export type CardVisibility = (typeof CARD_VISIBILITY)[number];

/** Public-feed weighting — higher wins (Section 19). */
const VERIFICATION_WEIGHT: Record<VerificationLevel, number> = {
  self_entered: 0,
  document_verified: 2,
  completed_load: 3,
  settlement_verified: 4,
};

/** Self-entered rates cannot be published to the public board in v1 (Section 19). */
export function isEligibleForPublicBoard(level: VerificationLevel): boolean {
  return level !== 'self_entered';
}

// ---------------------------------------------------------------------------
// Rate-check metrics
// ---------------------------------------------------------------------------

export interface RateCheckInput {
  offeredPay: number;
  loadedMiles: number;
  deadheadMiles: number;
  /** Viewer's break-even all-mile RPM (from rpm.breakEvenAllMileRpm). */
  breakEvenAllMileRpm: number;
  /** Viewer's target all-mile RPM — the rate that clears their profit target. */
  targetAllMileRpm: number;
  /** Known variable cost per mile, for the contribution estimate. */
  variableCostPerMile?: number;
  /** Band around target treated as "on target" (default 2%). */
  tolerance?: number;
}

export interface RateCheckResult {
  loadedRpm: number;
  allMileRpm: number;
  totalMiles: number;
  verdict: LoadRateVerdict;
  /**
   * Dollars left after variable costs across all miles — a contribution toward
   * fixed costs and profit (not net profit). Null when variable cost is unknown.
   */
  contributionUsd: number | null;
  /** All-mile RPM minus the target; negative means below target. */
  allMileRpmVsTarget: number;
}

/**
 * Analyzes an offered load on an ALL-MILE basis — because deadhead is the whole
 * point ("a good loaded rate can still be a bad load", Section 26/30). Break-even
 * and target are both evaluated against the effective all-mile rate.
 */
export function analyzeRateCheck(input: RateCheckInput): RateCheckResult {
  const { offeredPay, loadedMiles, deadheadMiles, tolerance = 0.02 } = input;
  if (loadedMiles <= 0) throw new RangeError('analyzeRateCheck requires loadedMiles > 0');
  if (deadheadMiles < 0) throw new RangeError('analyzeRateCheck requires deadheadMiles >= 0');

  const totalMiles = loadedMiles + deadheadMiles;
  const loadedRpm = offeredPay / loadedMiles;
  const allMileRpm = offeredPay / totalMiles;
  const target = input.targetAllMileRpm;

  let verdict: LoadRateVerdict;
  if (allMileRpm < input.breakEvenAllMileRpm) {
    verdict = 'below_break_even';
  } else if (allMileRpm < target * (1 - tolerance)) {
    verdict = 'below_target';
  } else if (allMileRpm <= target * (1 + tolerance)) {
    verdict = 'on_target';
  } else {
    verdict = 'above_target';
  }

  const contributionUsd =
    input.variableCostPerMile !== undefined
      ? round2(offeredPay - input.variableCostPerMile * totalMiles)
      : null;

  return {
    loadedRpm: round2(loadedRpm),
    allMileRpm: round2(allMileRpm),
    totalMiles,
    verdict,
    contributionUsd,
    allMileRpmVsTarget: round2(allMileRpm - target),
  };
}

// ---------------------------------------------------------------------------
// Approximate date bucketing (never expose an exact load date)
// ---------------------------------------------------------------------------

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

/** `2026-07-14` → `Mid July 2026`. Returns null for invalid input. */
export function approximateDateBucket(isoDate: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const part = day <= 10 ? 'Early' : day <= 20 ? 'Mid' : 'Late';
  return `${part} ${MONTH_NAMES[month - 1]} ${year}`;
}

// ---------------------------------------------------------------------------
// Rate-card privacy sanitizer (Section 6 / 7)
// ---------------------------------------------------------------------------

/** Everything a rate card *could* be built from — including private fields. */
export interface RateCardSource {
  // allowed structured fields
  originMetro: string;
  originState: string;
  destinationMetro: string;
  destinationState: string;
  equipmentType: EquipmentType;
  rateStatus: RateStatus;
  verificationLevel: VerificationLevel;
  grossRate?: number | null;
  fuelSurchargeIncluded?: boolean;
  loadedMiles?: number | null;
  deadheadMiles?: number | null;
  loadedRpm?: number | null;
  allMileRpm?: number | null;
  /** Exact date — bucketed, never emitted directly. */
  loadDate?: string | null;
  // private fields (must NEVER reach a card) — accepted so callers can pass a
  // whole load object; the sanitizer allow-lists and drops these.
  [privateField: string]: unknown;
}

export interface RateCardVisibility {
  showGrossRate: boolean;
  showLoadedMiles: boolean;
  showDeadhead: boolean;
  showLoadedRpm: boolean;
  showAllMileRpm: boolean;
  showApproxDate: boolean;
}

/** Defaults from Section 6. */
export const DEFAULT_CARD_VISIBILITY: RateCardVisibility = {
  showGrossRate: true,
  showLoadedMiles: true,
  showDeadhead: false,
  showLoadedRpm: true,
  showAllMileRpm: true,
  showApproxDate: true,
};

/** The only fields that may ever appear on a shared card. */
export interface SafeRateCard {
  originMetro: string;
  originState: string;
  destinationMetro: string;
  destinationState: string;
  equipmentType: EquipmentType;
  rateStatus: RateStatus;
  verificationLevel: VerificationLevel;
  fuelSurchargeIncluded: boolean;
  grossRate: number | null;
  loadedMiles: number | null;
  deadheadMiles: number | null;
  loadedRpm: number | null;
  allMileRpm: number | null;
  loadDateBucket: string | null;
}

/**
 * Builds a privacy-safe card by ALLOW-LISTING approved fields — private data is
 * never copied, so shipment/customer/contact/document details cannot leak even
 * if present on the source (Section 7). Optional metrics are gated by the
 * visibility toggles; the exact date is always bucketed. `isPublic` additionally
 * strips broker identity, which must not appear on public cards.
 */
export function sanitizeRateShareCard(
  source: RateCardSource,
  visibility: RateCardVisibility = DEFAULT_CARD_VISIBILITY,
  isPublic = false,
): SafeRateCard {
  void isPublic; // broker name is never allow-listed, so nothing extra to strip today
  return {
    originMetro: source.originMetro,
    originState: source.originState,
    destinationMetro: source.destinationMetro,
    destinationState: source.destinationState,
    equipmentType: source.equipmentType,
    rateStatus: source.rateStatus,
    verificationLevel: source.verificationLevel,
    fuelSurchargeIncluded: source.fuelSurchargeIncluded ?? false,
    grossRate: visibility.showGrossRate ? (source.grossRate ?? null) : null,
    loadedMiles: visibility.showLoadedMiles ? (source.loadedMiles ?? null) : null,
    deadheadMiles: visibility.showDeadhead ? (source.deadheadMiles ?? null) : null,
    loadedRpm: visibility.showLoadedRpm ? (source.loadedRpm ?? null) : null,
    allMileRpm: visibility.showAllMileRpm ? (source.allMileRpm ?? null) : null,
    loadDateBucket:
      visibility.showApproxDate && source.loadDate ? approximateDateBucket(source.loadDate) : null,
  };
}

// ---------------------------------------------------------------------------
// Sensitive-data detection (Section 21 pre-publish checks)
// ---------------------------------------------------------------------------

export type SensitiveFindingType =
  'phone' | 'email' | 'address' | 'future_date' | 'active_load_language';

export interface SensitiveFinding {
  type: SensitiveFindingType;
  match: string;
}

const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const ADDRESS_RE =
  /\b\d{1,6}\s+[A-Za-z0-9.\s]{2,30}\b(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|highway|hwy|way|court|ct|parkway|pkwy)\b/gi;
const ACTIVE_LOAD_RE =
  /\b(available load|load available|need a truck|truck needed|booking|book (?:it|this|now)|dispatch|call me|text me|available now|ready to book|who wants)\b/gi;

/** Scans free text for information that must not be published (Section 21). */
export function detectSensitiveText(text: string, now: Date = new Date()): SensitiveFinding[] {
  const findings: SensitiveFinding[] = [];
  const push = (type: SensitiveFindingType, re: RegExp) => {
    for (const m of text.matchAll(re)) findings.push({ type, match: m[0] });
  };
  push('phone', PHONE_RE);
  push('email', EMAIL_RE);
  push('address', ADDRESS_RE);
  push('active_load_language', ACTIVE_LOAD_RE);

  // Future dates suggest an active/available load, not a historical rate.
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
    if (!Number.isNaN(d.getTime()) && d.getTime() > now.getTime()) {
      findings.push({ type: 'future_date', match: m[0] });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Lane aggregates (Section 18)
// ---------------------------------------------------------------------------

export const MIN_AGGREGATE_POSTS = 7;
export const MIN_AGGREGATE_CONTRIBUTORS = 3;

export interface EligiblePost {
  contributorId: string;
  loadedRpm: number;
  allMileRpm: number;
  deadheadMiles: number;
  verificationLevel: VerificationLevel;
}

export type LaneConfidence = 'limited' | 'developing' | 'moderate' | 'strong';

export interface LaneAggregate {
  postCount: number;
  contributorCount: number;
  medianLoadedRpm: number;
  medianAllMileRpm: number;
  medianDeadheadMiles: number;
  lowAllMileRpm: number;
  highAllMileRpm: number;
  confidence: LaneConfidence;
}

/** Thresholds from Section 18: ≥7 eligible verified posts AND ≥3 contributors. */
export function canComputeLaneAggregate(posts: EligiblePost[]): boolean {
  const eligible = posts.filter((p) => isEligibleForPublicBoard(p.verificationLevel));
  const contributors = new Set(eligible.map((p) => p.contributorId));
  return eligible.length >= MIN_AGGREGATE_POSTS && contributors.size >= MIN_AGGREGATE_CONTRIBUTORS;
}

export function laneConfidence(contributorCount: number, postCount: number): LaneConfidence {
  if (postCount < MIN_AGGREGATE_POSTS || contributorCount < MIN_AGGREGATE_CONTRIBUTORS) {
    return 'limited';
  }
  if (contributorCount >= 8 && postCount >= 20) return 'strong';
  if (contributorCount >= 5 && postCount >= 12) return 'moderate';
  return 'developing';
}

/**
 * Computes a lane aggregate, or null when below threshold. Prevents any single
 * account from dominating: each contributor is reduced to their own median post
 * (weighted by verification), so the lane median reflects distinct drivers.
 */
export function computeLaneAggregate(posts: EligiblePost[]): LaneAggregate | null {
  if (!canComputeLaneAggregate(posts)) return null;
  const eligible = posts.filter((p) => isEligibleForPublicBoard(p.verificationLevel));

  // One representative post per contributor (their best-verified, median-RPM row).
  const byContributor = new Map<string, EligiblePost[]>();
  for (const p of eligible) {
    const arr = byContributor.get(p.contributorId) ?? [];
    arr.push(p);
    byContributor.set(p.contributorId, arr);
  }
  const representatives: EligiblePost[] = [];
  for (const arr of byContributor.values()) {
    arr.sort(
      (a, b) =>
        VERIFICATION_WEIGHT[b.verificationLevel] - VERIFICATION_WEIGHT[a.verificationLevel] ||
        a.allMileRpm - b.allMileRpm,
    );
    representatives.push(arr[Math.floor(arr.length / 2)]);
  }

  const allMile = representatives.map((p) => p.allMileRpm).sort((a, b) => a - b);
  return {
    postCount: eligible.length,
    contributorCount: byContributor.size,
    medianLoadedRpm: round2(median(representatives.map((p) => p.loadedRpm))),
    medianAllMileRpm: round2(median(allMile)),
    medianDeadheadMiles: Math.round(median(representatives.map((p) => p.deadheadMiles))),
    lowAllMileRpm: round2(allMile[0]),
    highAllMileRpm: round2(allMile[allMile.length - 1]),
    confidence: laneConfidence(byContributor.size, eligible.length),
  };
}

// ---------------------------------------------------------------------------

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
