import { useMemo } from 'react';

import { RoadWalletSummary } from '@/domain';
import { useAuthStore } from '@/store/auth';
import { selectRoadWalletSummary, useRoadWalletStore } from '@/store/roadWallet';

/**
 * Real Road Wallet summary for the current session (Pass 1B §4). Derived only
 * from the Road Wallet store, the signed-in identity, `deriveValidity` and the
 * CURRENT version's runtime readiness — never from `@/mock/board`.
 */
export function useRoadWalletSummary(): RoadWalletSummary {
  const userId = useAuthStore((s) => s.userId);
  const documents = useRoadWalletStore((s) => s.documents);
  const versions = useRoadWalletStore((s) => s.versions);
  return useMemo(
    () => selectRoadWalletSummary({ documents, versions }, userId, new Date()),
    [documents, versions, userId],
  );
}
