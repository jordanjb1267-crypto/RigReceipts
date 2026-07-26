/**
 * Canonical scan types — the Master Build Prompt's 15 (Loop 3),
 * hotel/lodging included per docs/DECISIONS.md (decision 3).
 */
export const SCAN_TYPES = [
  { slug: 'receipt', label: 'Receipt' },
  { slug: 'fuel', label: 'Fuel' },
  { slug: 'repair_invoice', label: 'Repair Invoice' },
  { slug: 'lumper', label: 'Lumper' },
  { slug: 'bol', label: 'BOL' },
  { slug: 'pod', label: 'POD' },
  { slug: 'scale_ticket', label: 'Scale Ticket' },
  { slug: 'toll', label: 'Toll' },
  { slug: 'parking', label: 'Parking' },
  { slug: 'meal', label: 'Meal' },
  { slug: 'shower', label: 'Shower' },
  { slug: 'hotel', label: 'Hotel' },
  { slug: 'permit', label: 'Permit' },
  { slug: 'inspection', label: 'Inspection' },
  { slug: 'other', label: 'Other' },
] as const;

export type ScanTypeSlug = (typeof SCAN_TYPES)[number]['slug'];

/**
 * The expense category an auto-created expense uses for each scan type. Pure
 * document scans (BOL, POD, inspection) are records, not expenses, so they map
 * to `null` and never create an expense row.
 */
export const SCAN_TYPE_TO_CATEGORY: Record<
  ScanTypeSlug,
  import('./categories').ExpenseCategorySlug | null
> = {
  receipt: 'misc',
  fuel: 'fuel',
  repair_invoice: 'repairs',
  lumper: 'lumper',
  bol: null,
  pod: null,
  scale_ticket: 'scales',
  toll: 'tolls',
  parking: 'parking',
  meal: 'meals',
  shower: 'showers',
  hotel: 'lodging',
  permit: 'permits_registration',
  inspection: null,
  other: 'misc',
};

export function scanTypeToExpenseCategory(
  scanType: ScanTypeSlug,
): import('./categories').ExpenseCategorySlug | null {
  return SCAN_TYPE_TO_CATEGORY[scanType];
}
