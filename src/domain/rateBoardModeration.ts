/**
 * Community Rate Board publication checks and moderation state (Sections 20-22,
 * 51). Pure and unit-tested. The actual queue/admin lives server-side
 * (`rate_board_moderation_cases`, service-role only); these helpers are the
 * shared rules the client pre-publish flow and the Edge Functions both use.
 */
import { detectSensitiveText, isEligibleForPublicBoard, VerificationLevel } from './freight';

/** Bumped when the community terms change; consent is re-collected. */
export const COMMUNITY_TERMS_VERSION = '2026-07-01';

/** A per-total-mile rate outside this band is treated as abnormal (Section 21). */
export const ABNORMAL_ALL_MILE_RPM_MIN = 0.5;
export const ABNORMAL_ALL_MILE_RPM_MAX = 8;

/** Reports at or above this count auto-flag a post for review (Section 22/51). */
export const AUTO_FLAG_REPORT_THRESHOLD = 3;

export type PublishBlockType =
  'not_verified' | 'abnormal_rate' | 'duplicate' | 'sensitive_info' | 'future_date';

export interface PublishBlock {
  type: PublishBlockType;
  message: string;
}

export interface ExistingPostRef {
  laneKey: string;
  loadDateBucket: string | null;
  grossRate: number | null;
}

export interface PublishCheckInput {
  verificationLevel: VerificationLevel;
  allMileRpm: number | null;
  laneKey: string;
  loadDateBucket: string | null;
  grossRate: number | null;
  /** Any user-entered free text (cards have none in v1, but rate cons might). */
  freeText?: string;
  /** The user's already-published posts, for duplicate detection. */
  existingPosts?: readonly ExistingPostRef[];
  now?: Date;
}

export interface PublishCheckResult {
  ok: boolean;
  blocks: PublishBlock[];
}

/**
 * Runs the Section-21 automated checks before a card may be posted publicly.
 * Returns every block found so the review screen can list them.
 */
export function validateRateBoardPost(input: PublishCheckInput): PublishCheckResult {
  const blocks: PublishBlock[] = [];

  if (!isEligibleForPublicBoard(input.verificationLevel)) {
    blocks.push({
      type: 'not_verified',
      message:
        'Self-entered rates can’t be posted publicly. Verify with a document or completed load.',
    });
  }

  if (
    input.allMileRpm !== null &&
    (input.allMileRpm < ABNORMAL_ALL_MILE_RPM_MIN || input.allMileRpm > ABNORMAL_ALL_MILE_RPM_MAX)
  ) {
    blocks.push({
      type: 'abnormal_rate',
      message: 'This rate looks unusually high or low. Double-check the numbers before posting.',
    });
  }

  const existing = input.existingPosts ?? [];
  if (
    existing.some(
      (p) =>
        p.laneKey === input.laneKey &&
        p.loadDateBucket === input.loadDateBucket &&
        p.grossRate === input.grossRate,
    )
  ) {
    blocks.push({
      type: 'duplicate',
      message: 'You already posted this lane and rate.',
    });
  }

  if (input.freeText && input.freeText.trim().length > 0) {
    const findings = detectSensitiveText(input.freeText, input.now);
    if (findings.some((f) => f.type === 'future_date')) {
      blocks.push({
        type: 'future_date',
        message: 'A future date suggests an active load. The board is for historical rates only.',
      });
    }
    if (findings.some((f) => f.type !== 'future_date')) {
      blocks.push({
        type: 'sensitive_info',
        message: 'Remove contact info, addresses, or active-load language before posting.',
      });
    }
  }

  return { ok: blocks.length === 0, blocks };
}

export type RateModerationStatus = 'none' | 'flagged' | 'under_review' | 'approved' | 'removed';

/**
 * Advances a post's moderation status as reports arrive. A removed or
 * under-review post is left as-is (a human decides next); otherwise crossing the
 * report threshold flags it for the queue.
 */
export function moderationStatusFromReports(
  reportCount: number,
  current: RateModerationStatus,
): RateModerationStatus {
  if (current === 'removed' || current === 'under_review') return current;
  return reportCount >= AUTO_FLAG_REPORT_THRESHOLD ? 'flagged' : current;
}

/** A removed post is never shown; anything else that isn't removed may render. */
export function isPubliclyVisible(status: RateModerationStatus): boolean {
  return status !== 'removed';
}
