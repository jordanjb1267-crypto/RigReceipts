import { EquipmentType } from './equipment';
import { RateStatus, VerificationLevel } from './freight';

/**
 * Community Rate Board post — the privacy-safe published snapshot (mirrors the
 * `rate_board_posts` table). Contributor identity is an opaque id used only for
 * blocking and aggregate de-domination; it is never shown (Section 15).
 */
export interface CommunityRatePost {
  id: string;
  contributorId: string;
  originMetro: string;
  originState: string;
  destinationMetro: string;
  destinationState: string;
  equipmentType: EquipmentType;
  rateStatus: RateStatus;
  verificationLevel: VerificationLevel;
  grossRate: number | null;
  loadedMiles: number | null;
  deadheadMiles: number | null;
  loadedRpm: number | null;
  allMileRpm: number | null;
  loadDateBucket: string | null;
  postedDaysAgo: number;
}

export type BoardTab = 'for_you' | 'recent' | 'watched' | 'completed';

export interface BoardFilters {
  equipmentType?: EquipmentType;
  originState?: string;
  destinationState?: string;
  completedOnly?: boolean;
  minAllMileRpm?: number;
  maxAllMileRpm?: number;
  /** Only posts within this many days. */
  maxDaysAgo?: number;
}

export interface BoardContext {
  hiddenIds: readonly string[];
  blockedContributors: readonly string[];
  watchedLanes: readonly string[];
}

/** Stable key for a lane (origin/destination metro + equipment). */
export function laneKey(p: {
  originMetro: string;
  originState: string;
  destinationMetro: string;
  destinationState: string;
  equipmentType: EquipmentType;
}): string {
  return [p.originMetro, p.originState, p.destinationMetro, p.destinationState, p.equipmentType]
    .map((s) => s.toLowerCase().trim())
    .join('|');
}

/** Verification weight for feed ordering (higher first). */
const WEIGHT: Record<VerificationLevel, number> = {
  self_entered: 0,
  document_verified: 2,
  completed_load: 3,
  settlement_verified: 4,
};

/**
 * Filters and orders board posts for a tab. Hidden posts and blocked
 * contributors are always removed. Ordering is by recency and verification only
 * — never by engagement/controversy (Section 13).
 */
export function filterCommunityPosts(
  posts: readonly CommunityRatePost[],
  tab: BoardTab,
  filters: BoardFilters,
  ctx: BoardContext,
): CommunityRatePost[] {
  const hidden = new Set(ctx.hiddenIds);
  const blocked = new Set(ctx.blockedContributors);
  const watched = new Set(ctx.watchedLanes);

  const result = posts.filter((p) => {
    if (hidden.has(p.id) || blocked.has(p.contributorId)) return false;

    // Tab scoping
    if (tab === 'completed' && p.rateStatus !== 'completed') return false;
    if (tab === 'watched' && !watched.has(laneKey(p))) return false;

    // Filters
    if (filters.equipmentType && p.equipmentType !== filters.equipmentType) return false;
    if (filters.originState && p.originState !== filters.originState) return false;
    if (filters.destinationState && p.destinationState !== filters.destinationState) return false;
    if (filters.completedOnly && p.rateStatus !== 'completed') return false;
    if (filters.maxDaysAgo !== undefined && p.postedDaysAgo > filters.maxDaysAgo) return false;
    if (
      filters.minAllMileRpm !== undefined &&
      (p.allMileRpm === null || p.allMileRpm < filters.minAllMileRpm)
    ) {
      return false;
    }
    if (
      filters.maxAllMileRpm !== undefined &&
      (p.allMileRpm === null || p.allMileRpm > filters.maxAllMileRpm)
    ) {
      return false;
    }
    return true;
  });

  if (tab === 'for_you') {
    // Personalized-ish: verification first, then recency. (Mock heuristic.)
    return result.sort(
      (a, b) =>
        WEIGHT[b.verificationLevel] - WEIGHT[a.verificationLevel] ||
        a.postedDaysAgo - b.postedDaysAgo,
    );
  }
  // Recent / watched / completed: newest first.
  return result.sort((a, b) => a.postedDaysAgo - b.postedDaysAgo);
}
