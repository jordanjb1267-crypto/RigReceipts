import {
  authorizePresentationSetCloudWrite,
  CloudSyncContext,
  emptyPresentationSetRecoveryResult,
  fromRemotePresentationSetItemRow,
  fromRemotePresentationSetRow,
  mergeRecoveredPresentationSet,
  PresentationSet,
  PresentationSetRecoveryResult,
  toRemotePresentationSetItemRow,
  toRemotePresentationSetRow,
} from '@/domain';
import { getSupabaseClient } from '@/lib/supabase';
import { usePresentationSetsStore } from '@/store/presentationSets';

import {
  assertRemoteEffectAuthorized,
  CloudSyncDeniedError,
  currentCloudSyncContext,
} from './cloudSyncAuth';

/**
 * Custom presentation-set cloud sync (Pass 2).
 *
 * Recovery of already-backed-up owner metadata is tier-independent (same
 * data-rights rule as Road Wallet 1B.1). New writes require both
 * `savedPresentationSets` and `cloudDocumentBackup`. Unowned sets stay local
 * and are never auto-claimed. Set recovery never mutates DocumentVersion
 * evidence and never overwrites local unsynced sets.
 */

export const PRESENTATION_SET_CLOUD_CAPABILITY = 'cloudDocumentBackup' as const;

export interface PresentationSetRemote {
  fetchSets(userId: string): Promise<unknown[]>;
  fetchItems(userId: string): Promise<unknown[]>;
  upsertSet(row: Record<string, unknown>): Promise<void>;
  upsertItem(row: Record<string, unknown>): Promise<void>;
}

export const supabasePresentationSetRemote: PresentationSetRemote = {
  async fetchSets(userId) {
    const { data, error } = await getSupabaseClient()
      .from('presentation_sets')
      .select('*')
      .eq('owner_id', userId);
    if (error) throw error;
    return data ?? [];
  },
  async fetchItems(userId) {
    const { data, error } = await getSupabaseClient()
      .from('presentation_set_items')
      .select('*')
      .eq('owner_id', userId);
    if (error) throw error;
    return data ?? [];
  },
  async upsertSet(row) {
    const { error } = await getSupabaseClient()
      .from('presentation_sets')
      .upsert(row, { onConflict: 'id' });
    if (error) throw error;
  },
  async upsertItem(row) {
    const { error } = await getSupabaseClient()
      .from('presentation_set_items')
      .upsert(row, { onConflict: 'id' });
    if (error) throw error;
  },
};

export interface SetSyncDeps {
  remote: PresentationSetRemote;
  ctx: () => CloudSyncContext;
}

export const defaultSetSyncDeps = (): SetSyncDeps => ({
  remote: supabasePresentationSetRemote,
  ctx: currentCloudSyncContext,
});

export async function recoverPresentationSetsFromCloud(
  deps: SetSyncDeps = defaultSetSyncDeps(),
): Promise<PresentationSetRecoveryResult> {
  const ctx = deps.ctx();
  if (!ctx.userId) return emptyPresentationSetRecoveryResult('signed_out');
  if (!ctx.supabaseConfigured) return emptyPresentationSetRecoveryResult('not_configured');
  const userId = ctx.userId;
  const result = emptyPresentationSetRecoveryResult();
  const stillActive = () => deps.ctx().userId === userId;

  let setRows: unknown[];
  let itemRows: unknown[];
  try {
    [setRows, itemRows] = await Promise.all([
      deps.remote.fetchSets(userId),
      deps.remote.fetchItems(userId),
    ]);
  } catch {
    return emptyPresentationSetRecoveryResult('fetch_failed');
  }
  if (!stillActive()) return emptyPresentationSetRecoveryResult('cancelled');

  const recovered = new Map<string, PresentationSet>();
  for (const row of setRows) {
    const remote = fromRemotePresentationSetRow(row, userId);
    if (!remote) {
      result.integrityConflicts++;
      continue;
    }
    if (!stillActive()) return { ...result, outcome: 'cancelled' };
    const store = usePresentationSetsStore.getState();
    const local = store.sets.find((s) => s.id === remote.id);
    if (local && local.accountOwnerId !== userId) {
      result.integrityConflicts++;
      continue;
    }
    let merged;
    try {
      merged = mergeRecoveredPresentationSet(local, remote);
    } catch {
      result.integrityConflicts++;
      continue;
    }
    switch (merged.action) {
      case 'import':
        store.importRecoveredSet(merged.set);
        result.setsRecovered++;
        break;
      case 'replace_metadata':
        store.replaceSyncedSetMetadata(merged.set);
        result.setsRecovered++;
        break;
      case 'keep_local':
        result.skippedLocalChanges++;
        break;
      case 'keep_synced_local':
        break;
      default: {
        const exhaustive: never = merged.action;
        return exhaustive;
      }
    }
    recovered.set(
      remote.id,
      usePresentationSetsStore.getState().sets.find((s) => s.id === remote.id)!,
    );
  }

  for (const parent of recovered.values()) {
    if (!stillActive()) return { ...result, outcome: 'cancelled' };
    const store = usePresentationSetsStore.getState();
    const live = store.sets.find((s) => s.id === parent.id);
    if (!live) continue;

    const mapped: import('@/domain').PresentationSetItem[] = [];
    for (const row of itemRows) {
      if (!(typeof row === 'object' && row !== null)) continue;
      if ((row as { presentation_set_id?: unknown }).presentation_set_id !== parent.id) continue;
      const item = fromRemotePresentationSetItemRow(row, userId, live);
      if (!item) {
        result.integrityConflicts++;
        continue;
      }
      mapped.push(item);
    }

    if (live.cloudStatus === 'pending_sync' || live.cloudStatus === 'local_only') {
      // Keep local items; do not overwrite unsynced edits.
      continue;
    }
    const uniqueDocs = new Set(mapped.map((i) => i.operationalDocumentId));
    if (uniqueDocs.size !== mapped.length) {
      result.integrityConflicts++;
      continue;
    }
    try {
      store.replaceSyncedSetItems(live.id, mapped);
      result.itemsRecovered += mapped.length;
    } catch {
      result.integrityConflicts++;
    }
  }

  return result;
}

export interface PresentationSetSyncResult {
  setsSynced: number;
  itemsSynced: number;
}

/**
 * Writes pending custom-set metadata. Authorization is re-checked per set:
 * both `savedPresentationSets` and `cloudDocumentBackup`, plus owner match.
 */
export async function syncPendingPresentationSets(
  deps: SetSyncDeps = defaultSetSyncDeps(),
): Promise<PresentationSetSyncResult> {
  const result: PresentationSetSyncResult = { setsSynced: 0, itemsSynced: 0 };
  const ctx = deps.ctx();
  usePresentationSetsStore.getState().reconcileCloudStatuses(ctx);

  for (const set of usePresentationSetsStore.getState().sets) {
    const decision = authorizePresentationSetCloudWrite(deps.ctx(), set.accountOwnerId);
    if (!decision.allowed) continue;
    const membership = usePresentationSetsStore
      .getState()
      .items.filter((i) => i.presentationSetId === set.id);
    if (set.cloudStatus !== 'pending_sync') continue;

    try {
      assertRemoteEffectAuthorized(
        PRESENTATION_SET_CLOUD_CAPABILITY,
        set.accountOwnerId,
        deps.ctx(),
      );
      if (!authorizePresentationSetCloudWrite(deps.ctx(), set.accountOwnerId).allowed) {
        continue;
      }
      await deps.remote.upsertSet(
        toRemotePresentationSetRow(set, decision.userId) as unknown as Record<string, unknown>,
      );
      // H1B: every membership row, including included=false tombstones,
      // must land remotely before the parent may be marked synced.
      for (const item of membership) {
        assertRemoteEffectAuthorized(
          PRESENTATION_SET_CLOUD_CAPABILITY,
          item.accountOwnerId,
          deps.ctx(),
        );
        await deps.remote.upsertItem(
          toRemotePresentationSetItemRow(item, decision.userId) as unknown as Record<
            string,
            unknown
          >,
        );
        result.itemsSynced++;
      }
      usePresentationSetsStore.getState().setCloudStatus(set.id, 'synced');
      result.setsSynced++;
    } catch (err) {
      // Partial failure: parent stays pending_sync. Do not mark synced.
      if (err instanceof CloudSyncDeniedError) {
        usePresentationSetsStore.getState().reconcileCloudStatuses(deps.ctx());
      }
    }
  }
  return result;
}

export function __resetPresentationSetSyncForTests(): void {
  // Module has no coalescing state of its own; cycle coalescing lives in documentSync.
}
