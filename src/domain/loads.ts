/**
 * Load lifecycle status — the folder-level state of a run, distinct from the
 * `claim_status` used for money owed (detention/reimbursements). Kept small and
 * conservative; document packets (BOL/POD/scale/lumper linked from captures)
 * and detention build on top of this later.
 */
import { Tone } from '@/theme';

export const LOAD_STATUSES = [
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

/** The next status in the lifecycle, wrapping paid → booked. */
export function nextLoadStatus(status: LoadStatus): LoadStatus {
  const i = LOAD_STATUSES.findIndex((s) => s.slug === status);
  const next = LOAD_STATUSES[(i + 1) % LOAD_STATUSES.length];
  return next.slug;
}
