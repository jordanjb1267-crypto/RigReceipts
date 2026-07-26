/**
 * Live Mileage V1 — the segment/session state model (build prompt §12, §2, §24).
 *
 * Every tracked physical mile belongs to exactly ONE primary accounting
 * category (loaded / deadhead / business_empty / personal / unclassified) —
 * they are mutually exclusive and never double-counted. Trailer configuration
 * (bobtail, empty_trailer, …) is a *secondary* attribute, never its own mileage
 * category. The driver confirms freight status; GPS only measures distance.
 *
 * This module is pure and device-free: the store drives transitions, and the
 * screens read these summaries. Actual miles flow into the existing RPM / rate /
 * grade engines — this file never recomputes RPM.
 */

export const ACCOUNTING_CATEGORIES = [
  'loaded',
  'deadhead',
  'business_empty',
  'personal',
  'unclassified',
] as const;
export type AccountingCategory = (typeof ACCOUNTING_CATEGORIES)[number];

export const BUSINESS_SUBTYPES = ['to_pickup', 'repositioning', 'maintenance', 'other'] as const;
export type BusinessSubtype = (typeof BUSINESS_SUBTYPES)[number];

export const TRAILER_CONFIGURATIONS = [
  'loaded_trailer',
  'empty_trailer',
  'bobtail',
  'unknown',
] as const;
export type TrailerConfiguration = (typeof TRAILER_CONFIGURATIONS)[number];

export const TRACKING_MODES = ['manual', 'gps'] as const;
export type TrackingMode = (typeof TRACKING_MODES)[number];

export const CLASSIFICATION_SOURCES = ['user', 'gps', 'manual', 'system'] as const;
export type ClassificationSource = (typeof CLASSIFICATION_SOURCES)[number];

export interface MileageSegment {
  id: string;
  /** Owning session, or null for a standalone manual segment. */
  sessionId: string | null;
  loadId: string | null;
  startedAt: number;
  /** null while the segment is active (the truck is still on it). */
  endedAt: number | null;
  startLocation: string | null;
  endLocation: string | null;
  /** Original tracked/entered distance — never erased (source-of-truth §13). */
  calculatedMiles: number;
  /** User correction; wins over `calculatedMiles` when present. */
  adjustedMiles: number | null;
  accountingCategory: AccountingCategory;
  businessSubtype: BusinessSubtype | null;
  trailerConfiguration: TrailerConfiguration;
  classificationSource: ClassificationSource;
  classificationConfidence: number | null;
  userConfirmed: boolean;
  note: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface MileageSession {
  id: string;
  vehicleId: string | null;
  startedAt: number;
  endedAt: number | null;
  trackingMode: TrackingMode;
  source: TrackingMode;
  totalTrackedMiles: number;
  reconciliationStatus: 'none' | 'pending' | 'reconciled';
  createdAt: number;
  updatedAt: number;
}

// --- Classification choices (the driver-facing menus) ------------------------

export interface Classification {
  category: AccountingCategory;
  subtype: BusinessSubtype | null;
}

export interface ClassificationChoice extends Classification {
  key: string;
  label: string;
  /** Whether picking this choice should prompt for a load association. */
  needsLoad: boolean;
}

/** "What's the truck doing now?" (build prompt §2 Step 1). */
export const START_CHOICES: readonly ClassificationChoice[] = [
  {
    key: 'hauling_load',
    label: 'Hauling a Load',
    category: 'loaded',
    subtype: null,
    needsLoad: true,
  },
  {
    key: 'going_to_pickup',
    label: 'Going to Pick Up a Load',
    category: 'deadhead',
    subtype: 'to_pickup',
    needsLoad: true,
  },
  {
    key: 'empty_repositioning',
    label: 'Empty / Repositioning',
    category: 'business_empty',
    subtype: 'repositioning',
    needsLoad: false,
  },
  {
    key: 'maintenance',
    label: 'Maintenance / Service',
    category: 'business_empty',
    subtype: 'maintenance',
    needsLoad: false,
  },
  { key: 'personal', label: 'Personal Use', category: 'personal', subtype: null, needsLoad: false },
  {
    key: 'not_sure',
    label: 'Not Sure Yet',
    category: 'unclassified',
    subtype: null,
    needsLoad: false,
  },
];

/** "What's next?" after delivery (build prompt §2 Step 5, §G). */
export const NEXT_CHOICES: readonly ClassificationChoice[] = [
  {
    key: 'next_pickup',
    label: 'Going to My Next Pickup',
    category: 'deadhead',
    subtype: 'to_pickup',
    needsLoad: true,
  },
  {
    key: 'repositioning',
    label: 'Repositioning',
    category: 'business_empty',
    subtype: 'repositioning',
    needsLoad: false,
  },
  {
    key: 'maintenance',
    label: 'Maintenance / Service',
    category: 'business_empty',
    subtype: 'maintenance',
    needsLoad: false,
  },
  { key: 'personal', label: 'Personal Use', category: 'personal', subtype: null, needsLoad: false },
  {
    key: 'decide_later',
    label: 'Decide Later',
    category: 'unclassified',
    subtype: null,
    needsLoad: false,
  },
];

export const ACCOUNTING_LABELS: Record<AccountingCategory, string> = {
  loaded: 'Loaded',
  deadhead: 'Deadhead',
  business_empty: 'Business Empty',
  personal: 'Personal',
  unclassified: 'Unclassified',
};

export const TRAILER_LABELS: Record<TrailerConfiguration, string> = {
  loaded_trailer: 'Loaded trailer',
  empty_trailer: 'Empty trailer',
  bobtail: 'Bobtail',
  unknown: 'Unknown',
};

// --- Pure helpers ------------------------------------------------------------

/** Miles that count: the user's correction if present, else what was tracked. */
export function effectiveMiles(
  seg: Pick<MileageSegment, 'adjustedMiles' | 'calculatedMiles'>,
): number {
  const m = seg.adjustedMiles ?? seg.calculatedMiles;
  return m > 0 ? m : 0;
}

/** The single active (not-yet-closed) segment, if any. */
export function activeSegment(segments: readonly MileageSegment[]): MileageSegment | null {
  return segments.find((s) => s.endedAt === null) ?? null;
}

export const isBusinessCategory = (c: AccountingCategory): boolean =>
  c === 'loaded' || c === 'deadhead' || c === 'business_empty';

export interface MileageBreakdown {
  loaded: number;
  deadhead: number;
  businessEmpty: number;
  personal: number;
  unclassified: number;
  /** Deadhead + other business-empty. */
  totalEmptyBusiness: number;
  /** Loaded + deadhead + business-empty (excludes personal + unclassified). */
  totalBusiness: number;
  /** Everything, all categories. */
  total: number;
  /** Deadhead ÷ total business miles, or null with no business miles (§6). */
  deadheadRate: number | null;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Aggregates segments into the mutually-exclusive category breakdown (§J, §16). */
export function summarizeSegments(segments: readonly MileageSegment[]): MileageBreakdown {
  let loaded = 0;
  let deadhead = 0;
  let businessEmpty = 0;
  let personal = 0;
  let unclassified = 0;
  for (const s of segments) {
    const m = effectiveMiles(s);
    switch (s.accountingCategory) {
      case 'loaded':
        loaded += m;
        break;
      case 'deadhead':
        deadhead += m;
        break;
      case 'business_empty':
        businessEmpty += m;
        break;
      case 'personal':
        personal += m;
        break;
      case 'unclassified':
        unclassified += m;
        break;
    }
  }
  const totalEmptyBusiness = deadhead + businessEmpty;
  const totalBusiness = loaded + deadhead + businessEmpty;
  const total = totalBusiness + personal + unclassified;
  return {
    loaded: round1(loaded),
    deadhead: round1(deadhead),
    businessEmpty: round1(businessEmpty),
    personal: round1(personal),
    unclassified: round1(unclassified),
    totalEmptyBusiness: round1(totalEmptyBusiness),
    totalBusiness: round1(totalBusiness),
    total: round1(total),
    deadheadRate: totalBusiness > 0 ? deadhead / totalBusiness : null,
  };
}

export interface LoadMileage {
  loadedMiles: number;
  deadheadMiles: number;
  otherBusinessMiles: number;
  totalMiles: number;
}

/** Actual miles attributed to a load, for profitability (§3). */
export function loadMileage(segments: readonly MileageSegment[], loadId: string): LoadMileage {
  let loadedMiles = 0;
  let deadheadMiles = 0;
  let otherBusinessMiles = 0;
  for (const s of segments) {
    if (s.loadId !== loadId) continue;
    const m = effectiveMiles(s);
    if (s.accountingCategory === 'loaded') loadedMiles += m;
    else if (s.accountingCategory === 'deadhead') deadheadMiles += m;
    else if (s.accountingCategory === 'business_empty') otherBusinessMiles += m;
  }
  return {
    loadedMiles: round1(loadedMiles),
    deadheadMiles: round1(deadheadMiles),
    otherBusinessMiles: round1(otherBusinessMiles),
    totalMiles: round1(loadedMiles + deadheadMiles + otherBusinessMiles),
  };
}

/** Total unclassified miles still needing review (§H badge). */
export function unclassifiedMiles(segments: readonly MileageSegment[]): number {
  return round1(
    segments
      .filter((s) => s.accountingCategory === 'unclassified')
      .reduce((sum, s) => sum + effectiveMiles(s), 0),
  );
}
