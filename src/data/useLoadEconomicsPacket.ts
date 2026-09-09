import { useMemo } from 'react';

import { actionItemsForLoad, buildLoadEconomicsPacket, estimateAllMileTargets } from '@/domain';
import { useCapturesStore } from '@/store/captures';
import { useCostProfileStore } from '@/store/costProfile';
import { useLoadDocsStore } from '@/store/loadDocs';
import { normalizeLoad, useLoadsStore } from '@/store/loads';
import { useMileageStore } from '@/store/mileage';
import { useReceivablesStore } from '@/store/receivables';

import { useActionItems } from './useActionItems';

export function useLoadEconomicsPacket(loadId: string | undefined) {
  const rawLoad = useLoadsStore((s) => s.loads.find((l) => l.id === loadId));
  const docs = useLoadDocsStore((s) => s.docs);
  const captures = useCapturesStore((s) => s.captures);
  const receivables = useReceivablesStore((s) => s.receivables);
  const segments = useMileageStore((s) => s.segments);
  const profile = useCostProfileStore((s) => s.profile);
  const actionItems = useActionItems();

  return useMemo(() => {
    if (!rawLoad) return null;
    const load = normalizeLoad(rawLoad);
    const targets = profile ? estimateAllMileTargets(profile) : null;
    return buildLoadEconomicsPacket({
      load,
      docs,
      captures,
      slots: docs,
      captureRecords: captures.map((c) => ({
        id: c.id,
        loadId: c.loadId,
        scanType: c.scanType,
        intendedDocType: c.intendedDocType,
      })),
      receivables,
      segments,
      targets,
      variableCostPerMile: profile?.variableCostPerMile,
      actionItems: actionItemsForLoad(actionItems, load.id),
      nowMs: Date.now(),
    });
  }, [rawLoad, docs, captures, receivables, segments, profile, actionItems]);
}
