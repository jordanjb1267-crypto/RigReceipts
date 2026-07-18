import { CommunityRatePost } from '@/domain';

/**
 * Sample Community Rate Board data — stands in for the Supabase feed until it is
 * wired. All fields are already the privacy-safe published snapshot; contributor
 * ids are opaque and never rendered. The UI labels this "Sample."
 *
 * The Chicago→Atlanta dry-van lane intentionally has ≥7 posts from ≥3
 * contributors so lane aggregates clear the Section-18 threshold; other lanes
 * stay below it to exercise the "Limited Community Data" state.
 */

let n = 0;
const id = () => `post_${(n++).toString(36)}`;

const chiAtl = (
  contributorId: string,
  allMileRpm: number,
  postedDaysAgo: number,
  extra: Partial<CommunityRatePost> = {},
): CommunityRatePost => ({
  id: id(),
  contributorId,
  originMetro: 'Chicago',
  originState: 'IL',
  destinationMetro: 'Atlanta',
  destinationState: 'GA',
  equipmentType: 'dry_van',
  rateStatus: 'completed',
  verificationLevel: 'completed_load',
  grossRate: Math.round(allMileRpm * 818),
  loadedMiles: 720,
  deadheadMiles: 98,
  loadedRpm: Math.round((allMileRpm + 0.36) * 100) / 100,
  allMileRpm,
  loadDateBucket: 'Mid July 2026',
  postedDaysAgo,
  ...extra,
});

export const MOCK_RATE_BOARD: CommunityRatePost[] = [
  // Chicago → Atlanta (aggregate-eligible: 7 posts, 4 contributors)
  chiAtl('drv-1', 2.63, 2),
  chiAtl('drv-2', 2.71, 3),
  chiAtl('drv-3', 2.55, 5),
  chiAtl('drv-1', 2.6, 6),
  chiAtl('drv-4', 2.82, 7),
  chiAtl('drv-2', 2.49, 9, { verificationLevel: 'document_verified', rateStatus: 'accepted' }),
  chiAtl('drv-3', 2.9, 11),

  // Other lanes (below aggregate threshold)
  {
    id: id(),
    contributorId: 'drv-5',
    originMetro: 'Dallas',
    originState: 'TX',
    destinationMetro: 'Memphis',
    destinationState: 'TN',
    equipmentType: 'reefer',
    rateStatus: 'completed',
    verificationLevel: 'completed_load',
    grossRate: 1480,
    loadedMiles: 452,
    deadheadMiles: 40,
    loadedRpm: 3.27,
    allMileRpm: 3.01,
    loadDateBucket: 'Early July 2026',
    postedDaysAgo: 1,
  },
  {
    id: id(),
    contributorId: 'drv-6',
    originMetro: 'Laredo',
    originState: 'TX',
    destinationMetro: 'Atlanta',
    destinationState: 'GA',
    equipmentType: 'dry_van',
    rateStatus: 'offered',
    verificationLevel: 'document_verified',
    grossRate: 2100,
    loadedMiles: 1015,
    deadheadMiles: 120,
    loadedRpm: 2.07,
    allMileRpm: 1.85,
    loadDateBucket: 'Mid July 2026',
    postedDaysAgo: 4,
  },
];
