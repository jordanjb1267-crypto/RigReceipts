import { Redirect } from 'expo-router';
import { ReactNode } from 'react';

import { isFeatureEnabled } from '@/config/flags';

/**
 * Road Wallet routes are feature-flagged (`road_wallet_enabled`, default off).
 * Direct navigation while the flag is off must not expose the product surface,
 * so every Road Wallet screen renders through this gate and redirects to the
 * Reports tab instead.
 */
export function RoadWalletGate({ children }: { children: ReactNode }) {
  if (!isFeatureEnabled('road_wallet_enabled')) {
    return <Redirect href="/(tabs)/reports" />;
  }
  return <>{children}</>;
}
