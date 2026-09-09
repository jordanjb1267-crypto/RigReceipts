import {
  bucketFor,
  DEFAULT_FLAGS,
  FEATURE_FLAGS,
  FeatureFlag,
  FlagConfig,
  isFeatureEnabled,
  resolveFlag,
} from '../flags';

const cfg = (overrides: Partial<Record<FeatureFlag, FlagConfig>>) =>
  ({
    freight_intelligence_enabled: { state: 'off' },
    rate_sharing_cards_enabled: { state: 'off' },
    community_rate_board_enabled: { state: 'off' },
    community_rate_posting_enabled: { state: 'off' },
    lane_aggregates_enabled: { state: 'off' },
    broker_check_enabled: { state: 'off' },
    road_grade_enabled: { state: 'off' },
    live_mileage_core_enabled: { state: 'off' },
    background_mileage_tracking_enabled: { state: 'off' },
    automatic_trip_detection_enabled: { state: 'off' },
    mileage_geofence_suggestions_enabled: { state: 'off' },
    odometer_reconciliation_enabled: { state: 'off' },
    revised_onboarding_enabled: { state: 'off' },
    road_wallet_enabled: { state: 'off' },
    quick_present_enabled: { state: 'off' },
    document_expiry_alerts_enabled: { state: 'off' },
    carrier_profile_enabled: { state: 'off' },
    carrier_packet_builder_enabled: { state: 'off' },
    carrier_packet_history_enabled: { state: 'off' },
    multi_unit_documents_enabled: { state: 'off' },
    ...overrides,
  }) as Record<FeatureFlag, FlagConfig>;

const PASS0_FLAGS: readonly FeatureFlag[] = [
  'road_wallet_enabled',
  'quick_present_enabled',
  'document_expiry_alerts_enabled',
  'carrier_profile_enabled',
  'carrier_packet_builder_enabled',
  'carrier_packet_history_enabled',
  'multi_unit_documents_enabled',
];

describe('Pass 0 flags', () => {
  it('registers every Road Wallet / Quick Present / Carrier Packet flag', () => {
    for (const flag of PASS0_FLAGS) expect(FEATURE_FLAGS).toContain(flag);
  });

  it('defaults every new flag to off and resolves false without an override', () => {
    for (const flag of PASS0_FLAGS) {
      expect(DEFAULT_FLAGS[flag]).toEqual({ state: 'off' });
      expect(isFeatureEnabled(flag)).toBe(false);
      expect(isFeatureEnabled(flag, { isInternal: true, isBeta: true, stableId: 'x' })).toBe(false);
    }
  });

  it('has a default entry for every registered flag', () => {
    for (const flag of FEATURE_FLAGS) expect(DEFAULT_FLAGS[flag]).toBeDefined();
  });
});

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
