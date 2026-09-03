/**
 * Refinement Pass 0 — entitlement & capability control plane.
 *
 * Locks the Road Wallet / Quick Present / Carrier Packet software gates, the
 * `basic_external_intelligence` data entitlement, and the invariants the
 * handoff freezes: one ladder, unchanged prices and free caps, Lifetime inherits
 * Owner-Operator software (not Fleet Lite), Lifetime never gets licensed data,
 * and no Free document-count gate.
 */
import {
  canUseFeature,
  DATA_ENTITLEMENTS,
  Feature,
  FEATURE_MIN_TIER,
  FREE_LIMITS,
  hasDataEntitlement,
  Tier,
  TIER_DATA_ENTITLEMENTS,
  TIER_INFO,
  TIERS,
} from '../entitlements';

const ALL_TIERS: readonly Tier[] = TIERS;

const ROAD_WALLET_FREE: readonly Feature[] = ['roadWalletBasic', 'quickPresent'];
const ROAD_WALLET_DRIVER_PRO: readonly Feature[] = [
  'unlimitedRoadWallet',
  'cloudDocumentBackup',
  'documentExpiryAlerts',
  'savedPresentationSets',
  'documentShareExport',
];
const CARRIER_OWNER_OPERATOR: readonly Feature[] = [
  'carrierProfile',
  'carrierPacketBuilder',
  'carrierPacketTemplates',
  'carrierPacketHistory',
];
const FLEET_LITE_ONLY: readonly Feature[] = [
  'multiTruckDocumentWallet',
  'fleetDocumentStatus',
  'multiUnitPacketSupplements',
];

describe('Pass 0 — Free tier', () => {
  it('gets Road Wallet basic + Quick Present', () => {
    for (const f of ROAD_WALLET_FREE) expect(canUseFeature('free', f)).toBe(true);
  });

  it('does not receive Driver Pro cloud backup or the other Driver Pro conveniences', () => {
    expect(canUseFeature('free', 'cloudBackup')).toBe(false);
    for (const f of ROAD_WALLET_DRIVER_PRO) expect(canUseFeature('free', f)).toBe(false);
  });

  it('does not receive Carrier Packet or multi-truck capabilities', () => {
    for (const f of [...CARRIER_OWNER_OPERATOR, ...FLEET_LITE_ONLY]) {
      expect(canUseFeature('free', f)).toBe(false);
    }
  });

  it('has no local document-count gate (owner amendment 1)', () => {
    expect(Object.keys(FREE_LIMITS)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/roadWallet|document/i)]),
    );
  });
});

describe('Pass 0 — Driver Pro', () => {
  it('gets document backup, expiry alerts, saved sets and share/export', () => {
    for (const f of ROAD_WALLET_DRIVER_PRO) expect(canUseFeature('driver_pro', f)).toBe(true);
    expect(canUseFeature('driver_pro', 'cloudBackup')).toBe(true);
  });

  it('does not get Carrier Packet Builder or multi-truck', () => {
    for (const f of [...CARRIER_OWNER_OPERATOR, ...FLEET_LITE_ONLY]) {
      expect(canUseFeature('driver_pro', f)).toBe(false);
    }
  });
});

describe('Pass 0 — Owner-Operator', () => {
  it('gets Carrier Profile + Carrier Packet Builder + templates + history', () => {
    for (const f of CARRIER_OWNER_OPERATOR) expect(canUseFeature('owner_operator', f)).toBe(true);
  });

  it('inherits every Driver Pro Road Wallet capability', () => {
    for (const f of ROAD_WALLET_DRIVER_PRO) expect(canUseFeature('owner_operator', f)).toBe(true);
  });

  it('does not get Fleet Lite multi-truck document capabilities', () => {
    for (const f of FLEET_LITE_ONLY) expect(canUseFeature('owner_operator', f)).toBe(false);
  });
});

describe('Pass 0 — Fleet Lite', () => {
  it('gets multi-truck document wallet, fleet document status and multi-unit supplements', () => {
    for (const f of FLEET_LITE_ONLY) expect(canUseFeature('fleet_lite', f)).toBe(true);
  });

  it('keeps everything below it on the ladder', () => {
    for (const f of [...ROAD_WALLET_FREE, ...ROAD_WALLET_DRIVER_PRO, ...CARRIER_OWNER_OPERATOR]) {
      expect(canUseFeature('fleet_lite', f)).toBe(true);
    }
  });
});

describe('Pass 0 — Lifetime', () => {
  it('gets Owner-Operator Road Wallet + Carrier Packet software capability', () => {
    for (const f of [...ROAD_WALLET_FREE, ...ROAD_WALLET_DRIVER_PRO, ...CARRIER_OWNER_OPERATOR]) {
      expect(canUseFeature('lifetime', f)).toBe(true);
    }
  });

  it('does not get Fleet Lite multi-truck', () => {
    expect(canUseFeature('lifetime', 'multiTruck')).toBe(false);
    for (const f of FLEET_LITE_ONLY) expect(canUseFeature('lifetime', f)).toBe(false);
  });

  it('does not get licensed or high-volume market data', () => {
    expect(hasDataEntitlement('lifetime', 'licensed_market_intelligence')).toBe(false);
    expect(hasDataEntitlement('lifetime', 'high_volume_market_intelligence')).toBe(false);
  });
});

describe('Pass 0 — data entitlement expansion', () => {
  it('adds basic_external_intelligence beside the existing kinds', () => {
    expect(DATA_ENTITLEMENTS).toEqual([
      'basic_community_intelligence',
      'basic_external_intelligence',
      'licensed_market_intelligence',
      'high_volume_market_intelligence',
    ]);
  });

  it('grants both basic entitlements to every tier', () => {
    for (const tier of ALL_TIERS) {
      expect(hasDataEntitlement(tier, 'basic_community_intelligence')).toBe(true);
      expect(hasDataEntitlement(tier, 'basic_external_intelligence')).toBe(true);
    }
  });

  it('grants licensed / high-volume data to no tier in this candidate', () => {
    for (const tier of ALL_TIERS) {
      expect(hasDataEntitlement(tier, 'licensed_market_intelligence')).toBe(false);
      expect(hasDataEntitlement(tier, 'high_volume_market_intelligence')).toBe(false);
      expect(TIER_DATA_ENTITLEMENTS[tier]).not.toEqual(
        expect.arrayContaining([expect.stringMatching(/^(licensed|high_volume)_/)]),
      );
    }
  });

  it('keeps data entitlements separate from software feature keys', () => {
    for (const entitlement of DATA_ENTITLEMENTS) {
      expect(Object.keys(FEATURE_MIN_TIER)).not.toContain(entitlement);
    }
  });
});

describe('Pass 0 — frozen invariants', () => {
  it('leaves the free rate/broker/lane caps unchanged', () => {
    expect(FREE_LIMITS.rateChecksPerMonth).toBe(3);
    expect(FREE_LIMITS.brokerChecksPerMonth).toBe(5);
    expect(FREE_LIMITS.watchedLanes).toBe(3);
    expect(FREE_LIMITS.gpsTripsPerMonth).toBe(30);
  });

  it('leaves every price unchanged', () => {
    expect(TIER_INFO.free).toEqual({ name: 'Road Log', monthlyUsd: 0, annualUsd: 0 });
    expect(TIER_INFO.driver_pro).toMatchObject({ monthlyUsd: 6.99, annualUsd: 49.99 });
    expect(TIER_INFO.owner_operator).toMatchObject({ monthlyUsd: 9.99, annualUsd: 79.99 });
    expect(TIER_INFO.fleet_lite).toMatchObject({ monthlyUsd: 19.99, annualUsd: 199 });
    expect(TIER_INFO.lifetime).toMatchObject({ monthlyUsd: 0, annualUsd: 0, oneTimeUsd: 149 });
  });

  it('keeps one subscription ladder — no new tiers', () => {
    expect(TIERS).toEqual(['free', 'driver_pro', 'owner_operator', 'fleet_lite', 'lifetime']);
  });

  it('every new gate resolves to one of the five tiers', () => {
    for (const f of [
      ...ROAD_WALLET_FREE,
      ...ROAD_WALLET_DRIVER_PRO,
      ...CARRIER_OWNER_OPERATOR,
      ...FLEET_LITE_ONLY,
      'basicDestinationOutlook' as const,
    ]) {
      expect(TIERS).toContain(FEATURE_MIN_TIER[f]);
    }
  });
});
