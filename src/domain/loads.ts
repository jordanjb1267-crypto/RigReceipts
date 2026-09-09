/**
 * Load lifecycle status — the folder-level state of a run, distinct from the
 * `claim_status` used for money owed (detention/reimbursements). Kept small and
 * conservative; document packets (BOL/POD/scale/lumper linked from captures)
 * and detention build on top of this later.
 */
import { Tone } from '@/theme';

/**
 * `evaluated` (Refinement C3): an offer the user evaluated and chose to save,
 * with no evidence in RigReceipts that it was ever booked. It is open but not
 * completed, and never counts as accepted work. `booked` remains a load that is
 * actually booked/accepted.
 */
export const LOAD_STATUSES = [
  { slug: 'evaluated', label: 'Evaluated', tone: 'neutral' },
  { slug: 'booked', label: 'Booked', tone: 'blue' },
  { slug: 'in_transit', label: 'In transit', tone: 'amber' },
  { slug: 'delivered', label: 'Delivered', tone: 'green' },
  { slug: 'paid', label: 'Paid', tone: 'green' },
] as const satisfies readonly { slug: string; label: string; tone: Tone }[];

export type LoadStatus = (typeof LOAD_STATUSES)[number]['slug'];

/** Statuses that count as an open/active load (everything before it is paid). */
export const OPEN_LOAD_STATUSES: readonly LoadStatus[] = LOAD_STATUSES.map((s) => s.slug).filter(
  (s) => s !== 'paid',
);

export const isOpenLoad = (status: LoadStatus): boolean => status !== 'paid';

export function loadStatusLabel(status: LoadStatus): string {
  return LOAD_STATUSES.find((s) => s.slug === status)?.label ?? status;
}

export function loadStatusTone(status: LoadStatus): Tone {
  return LOAD_STATUSES.find((s) => s.slug === status)?.tone ?? 'neutral';
}

/**
 * The next status in the lifecycle. Transitions are explicit so inserting a
 * status never silently changes another edge: an evaluated offer becomes
 * booked; the booked → in_transit → delivered → paid run is unchanged; and the
 * long-standing paid → booked wrap (Loads tab tap-to-cycle) is kept on purpose
 * — a paid load never falls back to "evaluated".
 */
export function nextLoadStatus(status: LoadStatus): LoadStatus {
  switch (status) {
    case 'evaluated':
      return 'booked';
    case 'booked':
      return 'in_transit';
    case 'in_transit':
      return 'delivered';
    case 'delivered':
      return 'paid';
    case 'paid':
      return 'booked';
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

/** A completed load is one delivered or already paid — it should have paperwork. */
export const isCompletedLoad = (status: LoadStatus): boolean =>
  status === 'delivered' || status === 'paid';

// ---------------------------------------------------------------------------
// Onboarding first-load persistence (Refinement C3)
// ---------------------------------------------------------------------------

/**
 * Fields an onboarding save hands to `useLoadsStore.addLoad`. Structurally a
 * `NewLoad`; declared here so the domain layer stays store-independent.
 */
export interface OnboardingLoadDraft {
  loadNumber: string;
  broker: string | null;
  origin: string | null;
  destination: string | null;
  note: string;
  status: LoadStatus;
  grossRate: number | null;
  fuelSurcharge: number | null;
  loadedMiles: number | null;
  deadheadMiles: number | null;
}

export const DRAFT_LOAD_NUMBER_PREFIX = 'RR-DRAFT-';
const DRAFT_LOAD_NUMBER_RE = /^RR-DRAFT-\d{8}-\d{6}$/;

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * A clearly app-generated placeholder load number, `RR-DRAFT-YYYYMMDD-HHMMSS`
 * (UTC), for loads saved without a broker-supplied number. Deterministic for a
 * given clock; never mistakable for a broker's reference.
 */
export function draftLoadNumber(now: Date = new Date()): string {
  const date = `${now.getUTCFullYear()}${pad2(now.getUTCMonth() + 1)}${pad2(now.getUTCDate())}`;
  const time = `${pad2(now.getUTCHours())}${pad2(now.getUTCMinutes())}${pad2(now.getUTCSeconds())}`;
  return `${DRAFT_LOAD_NUMBER_PREFIX}${date}-${time}`;
}

export const isDraftLoadNumber = (loadNumber: string): boolean =>
  DRAFT_LOAD_NUMBER_RE.test(loadNumber);

/** `City, ST` from user-entered parts; null when nothing was entered. */
export function routeStop(city: string | null | undefined, state: string | null | undefined) {
  const c = city?.trim() ?? '';
  const s = state?.trim() ?? '';
  if (!c && !s) return null;
  return c && s ? `${c}, ${s}` : c || s;
}

export interface RateCheckSaveInput {
  /** Offered pay in USD — the exact value the user entered. */
  offer: number;
  /** Exact loaded-mile input (not reconstructed from the result's totalMiles). */
  loadedMiles: number;
  /** Exact deadhead-mile input. */
  deadheadMiles: number;
  /** Optional lane the user typed under "Add trip details"; null when omitted. */
  trip: {
    originCity: string;
    originState: string;
    destinationCity: string;
    destinationState: string;
  } | null;
  now?: Date;
}

/**
 * The load an onboarding Rate Check saves: an `evaluated` offer carrying only
 * what the user typed. No broker, shipper, MC or surcharge is invented; the
 * load number is an app-generated draft identifier.
 */
export function rateCheckLoadDraft(input: RateCheckSaveInput): OnboardingLoadDraft {
  return {
    loadNumber: draftLoadNumber(input.now),
    broker: null,
    origin: input.trip ? routeStop(input.trip.originCity, input.trip.originState) : null,
    destination: input.trip
      ? routeStop(input.trip.destinationCity, input.trip.destinationState)
      : null,
    note: 'Saved from the onboarding Rate Check. No broker load number was supplied — the load number is a RigReceipts-generated draft ID. Not evidence the load was booked.',
    status: 'evaluated',
    grossRate: input.offer,
    fuelSurcharge: null,
    loadedMiles: input.loadedMiles,
    deadheadMiles: input.deadheadMiles,
  };
}

/** The reviewed fields of a parsed rate confirmation (structural; no OCR import). */
export interface RateConReviewedFields {
  broker: string | null;
  loadNumber: string | null;
  originCity: string | null;
  originState: string | null;
  destinationCity: string | null;
  destinationState: string | null;
  offerUsd: number | null;
  loadedMiles: number | null;
}

/**
 * The load an onboarding Rate Confirmation review saves: `booked`, because the
 * user reviewed an actual rate confirmation. Only reviewed, document-derived
 * values are used; a missing load number gets the same draft identifier rather
 * than a fabricated broker number.
 */
export function rateConLoadDraft(
  scanned: RateConReviewedFields,
  now: Date = new Date(),
): OnboardingLoadDraft {
  const scannedNumber = scanned.loadNumber?.trim() || null;
  const note = scannedNumber
    ? 'Created from the reviewed Rate Confirmation extraction during onboarding.'
    : 'Created from the reviewed Rate Confirmation extraction during onboarding. The document did not include a load number — the load number is a RigReceipts-generated draft ID.';
  return {
    loadNumber: scannedNumber ?? draftLoadNumber(now),
    broker: scanned.broker?.trim() || null,
    origin: routeStop(scanned.originCity, scanned.originState),
    destination: routeStop(scanned.destinationCity, scanned.destinationState),
    note,
    status: 'booked',
    grossRate: scanned.offerUsd ?? null,
    fuelSurcharge: null,
    loadedMiles: scanned.loadedMiles ?? null,
    deadheadMiles: null,
  };
}

export interface FirstLoadSaveDeps {
  /** Persists the draft locally and returns the new load id. */
  addLoad: (draft: OnboardingLoadDraft) => string;
  completeFirstAction: () => void;
  /** Analytics sink; receives only non-private props. */
  trackSaved: (props: Record<string, string | number | boolean>) => void;
  navigateToReveal: () => void;
}

/**
 * Builds an idempotent first-load saver. The first call persists exactly one
 * load, then — only after that succeeded — completes the onboarding action,
 * emits analytics, and navigates. Every later call (double tap, repeated
 * callback, delayed navigation) returns the same id and does nothing else.
 */
export function createFirstLoadSaver(deps: FirstLoadSaveDeps) {
  let savedId: string | null = null;
  return (
    draft: OnboardingLoadDraft,
    analytics: Record<string, string | number | boolean>,
  ): string => {
    if (savedId) return savedId;
    const id = deps.addLoad(draft);
    savedId = id;
    deps.completeFirstAction();
    deps.trackSaved({ ...analytics, load_number_generated: isDraftLoadNumber(draft.loadNumber) });
    deps.navigateToReveal();
    return id;
  };
}

/**
 * Rate status of a load once revenue + miles are known — the same verdict space
 * as the Rate Check (`analyzeRateCheck`), plus `unknown` when the load lacks the
 * revenue/mileage or the driver has no cost targets to compare against.
 */
export const LOAD_RATE_STATUSES = [
  { slug: 'above_target', label: 'Above target', tone: 'green' },
  { slug: 'on_target', label: 'On target', tone: 'green' },
  { slug: 'below_target', label: 'Below target', tone: 'amber' },
  { slug: 'below_break_even', label: 'Below break-even', tone: 'rust' },
  { slug: 'unknown', label: 'Rate unknown', tone: 'neutral' },
] as const satisfies readonly { slug: string; label: string; tone: Tone }[];

export type LoadRateStatus = (typeof LOAD_RATE_STATUSES)[number]['slug'];

export function loadRateStatusLabel(status: LoadRateStatus): string {
  return LOAD_RATE_STATUSES.find((s) => s.slug === status)?.label ?? status;
}

export function loadRateStatusTone(status: LoadRateStatus): Tone {
  return LOAD_RATE_STATUSES.find((s) => s.slug === status)?.tone ?? 'neutral';
}
