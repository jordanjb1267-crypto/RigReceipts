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
