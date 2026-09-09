import { useMemo } from 'react';

import { isFeatureEnabled } from '@/config/flags';
import { deriveActionItems, visiblePacketsForSession } from '@/domain';
import { useAuthStore } from '@/store/auth';
import { useCapturesStore } from '@/store/captures';
import { useCarrierPacketsStore } from '@/store/carrierPackets';
import { useLoadDocsStore } from '@/store/loadDocs';
import { normalizeLoad, useLoadsStore } from '@/store/loads';
import { useMileageStore } from '@/store/mileage';
import { useReceivablesStore } from '@/store/receivables';

import { useRoadWalletSummary } from './useRoadWalletSummary';

/** Derived Today / Needs Action items from current product stores. */
export function useActionItems() {
  const loads = useLoadsStore((s) => s.loads);
  const docs = useLoadDocsStore((s) => s.docs);
  const captures = useCapturesStore((s) => s.captures);
  const receivables = useReceivablesStore((s) => s.receivables);
  const segments = useMileageStore((s) => s.segments);
  const packets = useCarrierPacketsStore((s) => s.packets);
  const userId = useAuthStore((s) => s.userId);
  const roadWalletEnabled = isFeatureEnabled('road_wallet_enabled');
  const packetEnabled = isFeatureEnabled('carrier_packet_builder_enabled');
  const roadWallet = useRoadWalletSummary();

  return useMemo(
    () =>
      deriveActionItems({
        loads: loads.map(normalizeLoad),
        docs,
        captures,
        receivables,
        segments,
        roadWallet: roadWalletEnabled ? roadWallet : null,
        packets: packetEnabled
          ? visiblePacketsForSession(packets, userId).map((p) => ({
              id: p.id,
              name: p.name,
              status: p.status,
            }))
          : null,
        nowMs: Date.now(),
      }),
    [
      loads,
      docs,
      captures,
      receivables,
      segments,
      packets,
      userId,
      roadWalletEnabled,
      packetEnabled,
      roadWallet,
    ],
  );
}
