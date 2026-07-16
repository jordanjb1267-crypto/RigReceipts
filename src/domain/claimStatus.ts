/**
 * Canonical money-owed claim statuses — shared by lumper reimbursements and
 * detention claims (docs/DECISIONS.md, decision 2). Mirrors the Postgres
 * `claim_status` enum in supabase/migrations.
 */
export const CLAIM_STATUSES = ['pending', 'submitted', 'approved', 'reimbursed', 'denied'] as const;

export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/** Statuses that still count as money owed (not yet collected or written off). */
export const OPEN_CLAIM_STATUSES: readonly ClaimStatus[] = ['pending', 'submitted', 'approved'];

export const isOpenClaim = (status: ClaimStatus): boolean => OPEN_CLAIM_STATUSES.includes(status);
