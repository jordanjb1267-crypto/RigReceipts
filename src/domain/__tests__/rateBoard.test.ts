import { BoardContext, CommunityRatePost, filterCommunityPosts, laneKey } from '../rateBoard';

const post = (over: Partial<CommunityRatePost>): CommunityRatePost => ({
  id: 'p',
  contributorId: 'c',
  originMetro: 'Chicago',
  originState: 'IL',
  destinationMetro: 'Atlanta',
  destinationState: 'GA',
  equipmentType: 'dry_van',
  rateStatus: 'completed',
  verificationLevel: 'completed_load',
  grossRate: 2150,
  loadedMiles: 720,
  deadheadMiles: 90,
  loadedRpm: 2.99,
  allMileRpm: 2.63,
  loadDateBucket: 'Mid July 2026',
  postedDaysAgo: 2,
  ...over,
});

const EMPTY_CTX: BoardContext = { hiddenIds: [], blockedContributors: [], watchedLanes: [] };

describe('laneKey', () => {
  it('is stable and case-insensitive', () => {
    expect(laneKey(post({ originMetro: 'Chicago' }))).toBe(
      laneKey(post({ originMetro: 'CHICAGO' })),
    );
  });
});

describe('filterCommunityPosts', () => {
  const posts = [
    post({
      id: 'a',
      postedDaysAgo: 5,
      rateStatus: 'completed',
      verificationLevel: 'completed_load',
    }),
    post({
      id: 'b',
      postedDaysAgo: 1,
      rateStatus: 'offered',
      verificationLevel: 'document_verified',
    }),
    post({ id: 'c', postedDaysAgo: 3, contributorId: 'spammer', allMileRpm: 1.2 }),
  ];

  it('removes hidden posts and blocked contributors', () => {
    const ctx: BoardContext = {
      hiddenIds: ['a'],
      blockedContributors: ['spammer'],
      watchedLanes: [],
    };
    const out = filterCommunityPosts(posts, 'recent', {}, ctx);
    expect(out.map((p) => p.id)).toEqual(['b']);
  });

  it('recent is newest-first', () => {
    const out = filterCommunityPosts(posts, 'recent', {}, EMPTY_CTX);
    expect(out.map((p) => p.id)).toEqual(['b', 'c', 'a']);
  });

  it('completed tab shows only completed loads', () => {
    const out = filterCommunityPosts(posts, 'completed', {}, EMPTY_CTX);
    expect(out.every((p) => p.rateStatus === 'completed')).toBe(true);
    expect(out.map((p) => p.id)).not.toContain('b');
  });

  it('watched tab shows only saved lanes', () => {
    const ctx: BoardContext = {
      hiddenIds: [],
      blockedContributors: [],
      watchedLanes: [laneKey(posts[0])],
    };
    const out = filterCommunityPosts(posts, 'watched', {}, ctx);
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((p) => laneKey(p) === laneKey(posts[0]))).toBe(true);
  });

  it('for_you orders by verification then recency, not engagement', () => {
    const out = filterCommunityPosts(posts, 'for_you', {}, EMPTY_CTX);
    // completed_load (weight 3) before document_verified (2)
    expect(out[0].verificationLevel).toBe('completed_load');
  });

  it('applies equipment and rpm-range filters', () => {
    const mixed = [
      post({ id: 'van', equipmentType: 'dry_van', allMileRpm: 2.6 }),
      post({ id: 'reefer', equipmentType: 'reefer', allMileRpm: 3.1 }),
    ];
    expect(
      filterCommunityPosts(mixed, 'recent', { equipmentType: 'reefer' }, EMPTY_CTX).map(
        (p) => p.id,
      ),
    ).toEqual(['reefer']);
    expect(
      filterCommunityPosts(mixed, 'recent', { minAllMileRpm: 3.0 }, EMPTY_CTX).map((p) => p.id),
    ).toEqual(['reefer']);
  });
});
