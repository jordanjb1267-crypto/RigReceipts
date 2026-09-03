import { Redirect } from 'expo-router';
import { ReactNode } from 'react';

import { isFeatureEnabled } from '@/config/flags';
import { canUseFeature } from '@/domain';
import { useSubscriptionStore } from '@/store/subscription';

/**
 * Quick Present is gated by BOTH feature flags (default off) and the live
 * `quickPresent` software entitlement. Current tiers all receive the
 * entitlement, so built-in Quick Present is not paywalled. The data-layer
 * session builder remains the final effect boundary.
 */
export function QuickPresentGate({ children }: { children: ReactNode }) {
  const tier = useSubscriptionStore((s) => s.tier);
  if (!isFeatureEnabled('road_wallet_enabled') || !isFeatureEnabled('quick_present_enabled')) {
    return <Redirect href="/(tabs)/reports" />;
  }
  if (!canUseFeature(tier, 'quickPresent')) {
    return <Redirect href="/(tabs)/reports" />;
  }
  return <>{children}</>;
}
