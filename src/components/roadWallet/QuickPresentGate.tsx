import { Redirect } from 'expo-router';
import { ReactNode } from 'react';

import { isFeatureEnabled } from '@/config/flags';

/**
 * Quick Present is gated by BOTH `road_wallet_enabled` and
 * `quick_present_enabled` (both default off). Direct navigation while either
 * flag is off must not expose the product surface.
 */
export function QuickPresentGate({ children }: { children: ReactNode }) {
  if (!isFeatureEnabled('road_wallet_enabled') || !isFeatureEnabled('quick_present_enabled')) {
    return <Redirect href="/(tabs)/reports" />;
  }
  return <>{children}</>;
}
