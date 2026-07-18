import { Tier } from '@/domain';

/**
 * Purchases boundary. One subscription system (Section 39): the app talks to
 * this interface; the concrete adapter is RevenueCat once its API keys and a
 * native build exist. Until then a sandbox adapter fulfils purchases locally so
 * the paywall flow is exercisable end-to-end — clearly labeled in the UI.
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

/** Local sandbox adapter — no store transaction happens. */
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

/**
 * RevenueCat adapter placeholder. Implement with react-native-purchases:
 * configure({ apiKey }), getOfferings(), purchasePackage(), restorePurchases(),
 * mapping RC entitlement ids -> Tier. Requires EXPO_PUBLIC_REVENUECAT_KEY and a
 * native (prebuild) binary; do not ship the sandbox adapter to production.
 */
export const REVENUECAT_PENDING = true;
