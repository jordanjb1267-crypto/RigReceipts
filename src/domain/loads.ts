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

/** A completed load is one delivered or already paid — it should have paperwork. */
export const isCompletedLoad = (status: LoadStatus): boolean =>
  status === 'delivered' || status === 'paid';

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
