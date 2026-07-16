import { bucketFor, FeatureFlag, FlagConfig, resolveFlag } from '../flags';

const cfg = (overrides: Partial<Record<FeatureFlag, FlagConfig>>) =>
  ({
    freight_intelligence_enabled: { state: 'off' },
    rate_sharing_cards_enabled: { state: 'off' },
    community_rate_board_enabled: { state: 'off' },
    community_rate_posting_enabled: { state: 'off' },
    lane_aggregates_enabled: { state: 'off' },
    broker_check_enabled: { state: 'off' },
    revised_onboarding_enabled: { state: 'off' },
    ...overrides,
  }) as Record<FeatureFlag, FlagConfig>;

describe('resolveFlag', () => {
  it('off is always false, production always true', () => {
    expect(resolveFlag('broker_check_enabled', {}, cfg({}))).toBe(false);
    expect(
      resolveFlag(
        'broker_check_enabled',
        {},
        cfg({ broker_check_enabled: { state: 'production' } }),
      ),
    ).toBe(true);
  });

  it('internal requires an internal audience', () => {
    const c = cfg({ freight_intelligence_enabled: { state: 'internal' } });
    expect(resolveFlag('freight_intelligence_enabled', {}, c)).toBe(false);
    expect(resolveFlag('freight_intelligence_enabled', { isInternal: true }, c)).toBe(true);
  });

  it('beta lets internal/beta audiences in regardless of percentage', () => {
    const c = cfg({ community_rate_board_enabled: { state: 'beta', rolloutPct: 0 } });
    expect(resolveFlag('community_rate_board_enabled', { isBeta: true }, c)).toBe(true);
    expect(resolveFlag('community_rate_board_enabled', { isInternal: true }, c)).toBe(true);
  });

  it('beta percentage rollout is deterministic per stable id', () => {
    const c = cfg({ community_rate_board_enabled: { state: 'beta', rolloutPct: 100 } });
    expect(resolveFlag('community_rate_board_enabled', { stableId: 'user-1' }, c)).toBe(true);
    const c0 = cfg({ community_rate_board_enabled: { state: 'beta', rolloutPct: 0 } });
    expect(resolveFlag('community_rate_board_enabled', { stableId: 'user-1' }, c0)).toBe(false);
  });

  it('bucketFor is stable and within range', () => {
    const a = bucketFor('lane_aggregates_enabled', 'abc');
    const b = bucketFor('lane_aggregates_enabled', 'abc');
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(100);
  });
});
