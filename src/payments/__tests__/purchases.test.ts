import {
  createSandboxAdapter,
  entitlementToTier,
  findPurchasePackage,
  purchasesModeForKey,
  RC_ENTITLEMENT_TO_TIER,
  selectRevenueCatKey,
} from '../purchases';

describe('selectRevenueCatKey', () => {
  it('prefers the platform key over the shared fallback', () => {
    const keys = { ios: 'appl_ios', android: 'goog_android', fallback: 'test_shared' };
    expect(selectRevenueCatKey('ios', keys)).toBe('appl_ios');
    expect(selectRevenueCatKey('android', keys)).toBe('goog_android');
  });

  it('falls back to the shared key when the platform key is missing', () => {
    expect(selectRevenueCatKey('ios', { fallback: 'test_shared' })).toBe('test_shared');
    expect(selectRevenueCatKey('web', { fallback: 'test_shared' })).toBe('test_shared');
  });

  it('returns null when nothing is configured', () => {
    expect(selectRevenueCatKey('ios', {})).toBeNull();
    expect(selectRevenueCatKey('ios', { ios: '  ' })).toBeNull();
  });
});

describe('purchasesModeForKey', () => {
  it('classifies the fulfillment mode', () => {
    expect(purchasesModeForKey(null)).toBe('sandbox');
    expect(purchasesModeForKey('test_abc')).toBe('test_store');
    expect(purchasesModeForKey('appl_abc')).toBe('live');
    expect(purchasesModeForKey('goog_abc')).toBe('live');
  });
});

describe('entitlementToTier', () => {
  it('maps a single active entitlement to its tier', () => {
    expect(entitlementToTier(['driver_pro'])).toBe('driver_pro');
    expect(entitlementToTier(['lifetime'])).toBe('lifetime');
  });

  it('resolves the highest tier when several are active', () => {
    expect(entitlementToTier(['driver_pro', 'owner_operator'])).toBe('owner_operator');
    expect(entitlementToTier(['fleet_lite', 'driver_pro'])).toBe('fleet_lite');
  });

  it('returns free for unknown or empty entitlements', () => {
    expect(entitlementToTier([])).toBe('free');
    expect(entitlementToTier(['some_unknown_id'])).toBe('free');
  });

  it('only maps identifiers that exist in the tier map', () => {
    for (const [id, tier] of Object.entries(RC_ENTITLEMENT_TO_TIER)) {
      expect(entitlementToTier([id])).toBe(tier);
    }
  });
});

describe('findPurchasePackage', () => {
  const offering = {
    availablePackages: [
      { identifier: '$rc_monthly', packageType: 'MONTHLY' },
      { identifier: 'owner_operator_annual', packageType: 'ANNUAL' },
      { identifier: '$rc_lifetime', packageType: 'LIFETIME' },
    ],
  };

  it('prefers an explicit tier_term package identifier', () => {
    expect(findPurchasePackage(offering, 'owner_operator', 'annual')?.identifier).toBe(
      'owner_operator_annual',
    );
  });

  it('falls back to the standard package type for the term', () => {
    expect(findPurchasePackage(offering, 'driver_pro', 'monthly')?.identifier).toBe('$rc_monthly');
    expect(findPurchasePackage(offering, 'lifetime', 'lifetime')?.identifier).toBe('$rc_lifetime');
  });

  it('returns null when nothing matches or the offering is absent', () => {
    expect(findPurchasePackage({ availablePackages: [] }, 'driver_pro', 'monthly')).toBeNull();
    expect(findPurchasePackage(null, 'driver_pro', 'monthly')).toBeNull();
  });
});

describe('createSandboxAdapter', () => {
  it('grants the tier locally and flags the result as sandbox', async () => {
    const granted: string[] = [];
    const adapter = createSandboxAdapter((t) => granted.push(t));
    const result = await adapter.purchase('owner_operator', 'monthly');
    expect(result).toEqual({ ok: true, tier: 'owner_operator', sandbox: true });
    expect(granted).toEqual(['owner_operator']);
    expect(await adapter.restore()).toBeNull();
  });
});
