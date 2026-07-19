/**
 * Load-linked receivables (Money Owed grade). A general child model for money a
 * driver is owed on a load — detention, lumper, reimbursement, layover, TONU,
 * accessorial. Coexists with the narrower `detention_claims` / `reimbursements`
 * tables; this is the model the grade reads.
 */

export const RECEIVABLE_TYPES = [
  'detention',
  'lumper',
  'reimbursement',
  'layover',
  'tonu',
  'accessorial',
  'other',
] as const;
export type ReceivableType = (typeof RECEIVABLE_TYPES)[number];

export const RECEIVABLE_STATUSES = [
  'expected',
  'submitted',
  'pending',
  'partially_paid',
  'paid',
  'overdue',
  'disputed',
  'written_off',
] as const;
export type ReceivableStatus = (typeof RECEIVABLE_STATUSES)[number];

const TYPE_LABELS: Record<ReceivableType, string> = {
  detention: 'Detention',
  lumper: 'Lumper',
  reimbursement: 'Reimbursement',
  layover: 'Layover',
  tonu: 'TONU',
  accessorial: 'Accessorial',
  other: 'Other',
};

const STATUS_LABELS: Record<ReceivableStatus, string> = {
  expected: 'Expected',
  submitted: 'Submitted',
  pending: 'Pending',
  partially_paid: 'Partially paid',
  paid: 'Paid',
  overdue: 'Overdue',
  disputed: 'Disputed',
  written_off: 'Written off',
};

export const receivableTypeLabel = (t: ReceivableType): string => TYPE_LABELS[t] ?? t;
export const receivableStatusLabel = (s: ReceivableStatus): string => STATUS_LABELS[s] ?? s;

/** Terminal statuses no longer counted as outstanding. */
export const TERMINAL_RECEIVABLE_STATUSES: readonly ReceivableStatus[] = ['paid', 'written_off'];

export const isTerminalReceivable = (s: ReceivableStatus): boolean =>
  TERMINAL_RECEIVABLE_STATUSES.includes(s);

/** Unpaid balance on a receivable (never negative). Terminal items owe nothing. */
export function receivableOutstanding(r: {
  amountExpected: number;
  amountReceived: number;
  status: ReceivableStatus;
}): number {
  if (isTerminalReceivable(r.status)) return 0;
  return Math.max(0, r.amountExpected - r.amountReceived);
}

/**
 * Whether a receivable is overdue: explicitly flagged `overdue`, or aged past
 * `graceDays` while still unresolved. Disputed items are unresolved but not
 * treated as the driver's aging fault.
 */
export function isReceivableOverdue(
  r: { status: ReceivableStatus },
  ageDays: number,
  graceDays = 30,
): boolean {
  if (isTerminalReceivable(r.status) || r.status === 'disputed') return false;
  return r.status === 'overdue' || ageDays > graceDays;
}
