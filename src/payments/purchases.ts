import { Platform } from 'react-native';

import { Tier, tierAtLeast } from '@/domain';

/**
 * Purchases boundary. One subscription system (Section 39): the app talks to
 * this interface; the concrete adapter is RevenueCat when a key is configured,
 * otherwise a local sandbox adapter so the paywall stays exercisable. The
 * RevenueCat SDK is required lazily inside the adapter's methods so tests and
 * the Metro bundle never load the native module.
 */

export type BillingTerm = 'monthly' | 'annual' | 'lifetime';

export interface PurchaseResult {
  ok: boolean;
  tier: Tier;
  /** True when this came from the sandbox adapter, not a store transaction. */
  sandbox: boolean;
}

export interface PurchasesAdapter {
  purchase(tier: Tier, term: BillingTerm): Promise<PurchaseResult>;
  restore(): Promise<Tier | null>;
}

/** How purchases are being fulfilled, for honest UI labeling. */
export type PurchasesMode = 'sandbox' | 'test_store' | 'live';

// ---------------------------------------------------------------------------
// Sandbox adapter — no store transaction happens.
// ---------------------------------------------------------------------------

export function createSandboxAdapter(onTierGranted: (tier: Tier) => void): PurchasesAdapter {
  return {
    async purchase(tier) {
      onTierGranted(tier);
      return { ok: true, tier, sandbox: true };
    },
    async restore() {
      return null;
    },
  };
}

// ---------------------------------------------------------------------------
// Key selection (pure)
// ---------------------------------------------------------------------------

export interface RevenueCatKeys {
  ios?: string;
  android?: string;
  /** Platform-agnostic key — a Test Store key (test_...) or a shared override. */
  fallback?: string;
}

/** Reads the RC env keys statically (satisfies expo/no-dynamic-env-var). */
function readRevenueCatKeys(): RevenueCatKeys {
  return {
    ios: process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY,
    android: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY,
    fallback: process.env.EXPO_PUBLIC_REVENUECAT_KEY,
  };
}

/** Picks the platform key, falling back to the shared/Test Store key. */
export function selectRevenueCatKey(os: string, keys: RevenueCatKeys): string | null {
  const platformKey = os === 'ios' ? keys.ios : os === 'android' ? keys.android : undefined;
  const chosen = platformKey?.trim() || keys.fallback?.trim();
  return chosen ? chosen : null;
}

/** Classifies a resolved key (or its absence) into a fulfillment mode. */
export function purchasesModeForKey(key: string | null): PurchasesMode {
  if (!key) return 'sandbox';
  return key.startsWith('test_') ? 'test_store' : 'live';
}

export function isRevenueCatConfigured(): boolean {
  return selectRevenueCatKey(Platform.OS, readRevenueCatKeys()) !== null;
}

export function purchasesMode(): PurchasesMode {
  return purchasesModeForKey(selectRevenueCatKey(Platform.OS, readRevenueCatKeys()));
}

// ---------------------------------------------------------------------------
// Entitlement + package mapping (pure)
// ---------------------------------------------------------------------------

/**
 * RevenueCat entitlement identifier -> app Tier. The dashboard must use these
 * entitlement identifiers so a granted entitlement resolves to the right tier.
 */
export const RC_ENTITLEMENT_TO_TIER: Record<string, Tier> = {
  driver_pro: 'driver_pro',
  owner_operator: 'owner_operator',
  fleet_lite: 'fleet_lite',
  lifetime: 'lifetime',
};

/** Resolves the highest active entitlement to a Tier (`free` when none). */
export function entitlementToTier(activeEntitlementIds: readonly string[]): Tier {
  let best: Tier = 'free';
  for (const id of activeEntitlementIds) {
    const tier = RC_ENTITLEMENT_TO_TIER[id];
    if (tier && tierAtLeast(tier, best)) best = tier;
  }
  return best;
}

/** RevenueCat standard package types keyed by our billing term. */
const STANDARD_PACKAGE_TYPE: Record<BillingTerm, string> = {
  monthly: 'MONTHLY',
  annual: 'ANNUAL',
  lifetime: 'LIFETIME',
};

interface RCPackageLike {
  identifier: string;
  packageType: string;
}

interface RCOfferingLike {
  availablePackages: RCPackageLike[];
}

/**
 * Finds the package to buy for a tier + term. Prefers an explicit
 * `${tier}_${term}` package identifier (so multiple tiers can coexist in one
 * offering), then falls back to the standard package type for the term.
 */
export function findPurchasePackage<T extends RCPackageLike>(
  offering: { availablePackages: T[] } | null | undefined,
  tier: Tier,
  term: BillingTerm,
): T | null {
  if (!offering) return null;
  const explicit = offering.availablePackages.find((p) => p.identifier === `${tier}_${term}`);
  if (explicit) return explicit;
  const byType = offering.availablePackages.find(
    (p) => p.packageType === STANDARD_PACKAGE_TYPE[term],
  );
  return byType ?? null;
}

// ---------------------------------------------------------------------------
// RevenueCat adapter — native SDK required lazily
// ---------------------------------------------------------------------------

interface PurchasesModule {
  configure(config: { apiKey: string }): void;
  getOfferings(): Promise<{ current: RCOfferingLike | null }>;
  purchasePackage(pkg: RCPackageLike): Promise<{ customerInfo: RCCustomerInfoLike }>;
  restorePurchases(): Promise<RCCustomerInfoLike>;
}

interface RCCustomerInfoLike {
  entitlements: { active: Record<string, unknown> };
}

function loadPurchases(): PurchasesModule {
  // Lazy require keeps the native module out of tests and the JS bundle graph
  // until a real purchase path runs on a native build.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('react-native-purchases').default as PurchasesModule;
}

export function createRevenueCatAdapter(
  onTierGranted: (tier: Tier) => void,
  apiKey: string,
): PurchasesAdapter {
  let configured = false;
  const ensure = (): PurchasesModule => {
    const Purchases = loadPurchases();
    if (!configured) {
      Purchases.configure({ apiKey });
      configured = true;
    }
    return Purchases;
  };

  return {
    async purchase(tier, term) {
      try {
        const Purchases = ensure();
        const offerings = await Purchases.getOfferings();
        const pkg = findPurchasePackage(offerings.current, tier, term);
        if (!pkg) return { ok: false, tier: 'free', sandbox: false };
        const { customerInfo } = await Purchases.purchasePackage(pkg);
        const granted = entitlementToTier(Object.keys(customerInfo.entitlements.active));
        if (granted !== 'free') {
          onTierGranted(granted);
          return { ok: true, tier: granted, sandbox: false };
        }
        return { ok: false, tier: 'free', sandbox: false };
      } catch {
        // User cancellation or a store error — keep the caller on their tier.
        return { ok: false, tier: 'free', sandbox: false };
      }
    },
    async restore() {
      try {
        const Purchases = ensure();
        const info = await Purchases.restorePurchases();
        const granted = entitlementToTier(Object.keys(info.entitlements.active));
        if (granted !== 'free') {
          onTierGranted(granted);
          return granted;
        }
        return null;
      } catch {
        return null;
      }
    },
  };
}

/**
 * Returns the RevenueCat adapter when a key is configured (a `test_` key drives
 * RevenueCat's Test Store — a simulated purchase modal, no store setup needed),
 * otherwise the local sandbox adapter.
 */
export function createPurchasesAdapter(onTierGranted: (tier: Tier) => void): PurchasesAdapter {
  const key = selectRevenueCatKey(Platform.OS, readRevenueCatKeys());
  return key ? createRevenueCatAdapter(onTierGranted, key) : createSandboxAdapter(onTierGranted);
}
