import { canUseFeature, FREE_LIMITS, hasDataEntitlement, TIER_INFO } from '../entitlements';

describe('freight free-tier caps (Section 40)', () => {
  it('keeps the stated free rate/broker-check and lane limits', () => {
    expect(FREE_LIMITS.rateChecksPerMonth).toBe(3);
    expect(FREE_LIMITS.brokerChecksPerMonth).toBe(5);
    expect(FREE_LIMITS.watchedLanes).toBe(3);
  });
});

describe('lifetime tier (Section 43)', () => {
  it('is a $149 one-time entitlement', () => {
    expect(TIER_INFO.lifetime.oneTimeUsd).toBe(149);
    expect(TIER_INFO.lifetime.monthlyUsd).toBe(0);
  });

  it('unlocks Owner-Operator-level freight but not fleet multi-truck', () => {
    expect(canUseFeature('lifetime', 'fullFreightIntelligence')).toBe(true);
    expect(canUseFeature('lifetime', 'unlimitedRateChecks')).toBe(true);
    expect(canUseFeature('lifetime', 'rateConScan')).toBe(true);
    expect(canUseFeature('lifetime', 'multiTruck')).toBe(false);
  });

  it('includes only basic community data, never licensed data', () => {
    expect(hasDataEntitlement('lifetime', 'basic_community_intelligence')).toBe(true);
    expect(hasDataEntitlement('lifetime', 'licensed_market_intelligence')).toBe(false);
    expect(hasDataEntitlement('lifetime', 'high_volume_market_intelligence')).toBe(false);
  });
});

describe('freight feature gates', () => {
  it('gives every tier the free safety + card features', () => {
    for (const tier of [
      'free',
      'driver_pro',
      'owner_operator',
      'fleet_lite',
      'lifetime',
    ] as const) {
      expect(canUseFeature(tier, 'rateCardCreate')).toBe(true);
      expect(canUseFeature(tier, 'communityBoardView')).toBe(true);
      expect(canUseFeature(tier, 'eligiblePublicPosting')).toBe(true);
    }
  });

  it('gates rate-con scan + broker watchlist to Driver Pro and up', () => {
    expect(canUseFeature('free', 'rateConScan')).toBe(false);
    expect(canUseFeature('driver_pro', 'rateConScan')).toBe(true);
    expect(canUseFeature('free', 'brokerWatchlist')).toBe(false);
    expect(canUseFeature('driver_pro', 'brokerWatchlist')).toBe(true);
  });

  it('gates full Freight Intelligence + unlimited rate checks to Owner-Operator', () => {
    expect(canUseFeature('driver_pro', 'fullFreightIntelligence')).toBe(false);
    expect(canUseFeature('owner_operator', 'fullFreightIntelligence')).toBe(true);
    expect(canUseFeature('driver_pro', 'unlimitedRateChecks')).toBe(false);
    expect(canUseFeature('owner_operator', 'unlimitedRateChecks')).toBe(true);
  });

  it('does not include full FI in Driver Pro (Section 41)', () => {
    expect(canUseFeature('driver_pro', 'laneHistory90Day')).toBe(false);
    expect(canUseFeature('driver_pro', 'unlimitedCompareToCosts')).toBe(false);
  });
});
