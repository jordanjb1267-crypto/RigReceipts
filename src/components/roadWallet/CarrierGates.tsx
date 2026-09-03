import { Redirect, useRouter } from 'expo-router';
import { ReactNode, useEffect } from 'react';

import { isFeatureEnabled } from '@/config/flags';
import { canUseFeature, Feature } from '@/domain';
import { useSubscriptionStore } from '@/store/subscription';

function FeatureRouteGate({
  flag,
  feature,
  trigger,
  children,
}: {
  flag: 'carrier_profile_enabled' | 'carrier_packet_builder_enabled';
  feature: Feature;
  trigger: 'carrier_profile' | 'carrier_packet_builder';
  children: ReactNode;
}) {
  const router = useRouter();
  const tier = useSubscriptionStore((s) => s.tier);
  const flagged = isFeatureEnabled('road_wallet_enabled') && isFeatureEnabled(flag);
  const entitled = canUseFeature(tier, feature);

  useEffect(() => {
    if (flagged && !entitled) {
      router.replace({ pathname: '/paywall', params: { trigger } });
    }
  }, [flagged, entitled, router, trigger]);

  if (!flagged) return <Redirect href="/(tabs)/reports" />;
  if (!entitled) return null;
  return <>{children}</>;
}

export function CarrierProfileGate({ children }: { children: ReactNode }) {
  return (
    <FeatureRouteGate
      flag="carrier_profile_enabled"
      feature="carrierProfile"
      trigger="carrier_profile"
    >
      {children}
    </FeatureRouteGate>
  );
}

export function CarrierPacketGate({ children }: { children: ReactNode }) {
  return (
    <FeatureRouteGate
      flag="carrier_packet_builder_enabled"
      feature="carrierPacketBuilder"
      trigger="carrier_packet_builder"
    >
      {children}
    </FeatureRouteGate>
  );
}
