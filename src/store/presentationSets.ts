import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  CloudSyncContext,
  CloudSyncStatus,
  isOpaqueId,
  itemsForSet,
  PresentationSet,
  PresentationSetItem,
  PresentationSetLifecycle,
  reconcilePresentationSetCloudStatus,
  validatePresentationSet,
  validatePresentationSetItem,
  visiblePresentationSetsForSession,
} from '@/domain';

/**
 * Custom Quick Present sets (Pass 2). Device-persistent and account-scoped,
 * matching Road Wallet. System Roadside/Shipper sets are not stored here.
 * PresentationSession is ephemeral and lives outside this store.
 *
 * Sign-out, account switch and tier change never delete sets. A downgrade
 * locks mutation; recovered sets stay on device until the owner is re-entitled.
 */

export const PRESENTATION_SETS_CLOUD_CAPABILITY = 'cloudDocumentBackup' as const;
export const PRESENTATION_SETS_PERSIST_VERSION = 1;

interface PresentationSetsState {
  sets: PresentationSet[];
  items: PresentationSetItem[];
  hydrated: boolean;
  addSet: (set: PresentationSet) => void;
  updateSet: (
    id: string,
    patch: { name?: string; lifecycle?: PresentationSetLifecycle },
    ctx: CloudSyncContext,
    now?: number,
  ) => void;
  archiveSet: (id: string, ctx: CloudSyncContext, now?: number) => void;
  setCloudStatus: (id: string, status: CloudSyncStatus) => void;
  /**
   * Applies the full membership for one set, including included=false
   * tombstones. Never a generic item-delete. Caller has validated entitlement.
   */
  applyPresentationSetSelection: (
    setId: string,
    next: PresentationSetItem[],
    ctx: CloudSyncContext,
    now?: number,
  ) => void;
  importRecoveredSet: (set: PresentationSet) => void;
  replaceSyncedSetMetadata: (remote: PresentationSet) => void;
  /**
   * Recovery of a synced set's items: replaces local items for that set only
   * when the parent is locally synced. Unsynced local item edits are kept by
   * the merge caller skipping this.
   */
  replaceSyncedSetItems: (setId: string, next: PresentationSetItem[]) => void;
  importRecoveredItem: (item: PresentationSetItem) => void;
  reconcileCloudStatuses: (ctx: CloudSyncContext) => number;
  clear: () => void;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function sanitizeSet(raw: unknown): PresentationSet | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== 'string' || !isOpaqueId(raw.id)) return null;
  if (raw.setKind !== 'CUSTOM') return null;
  if (typeof raw.name !== 'string') return null;
  const accountOwnerId = typeof raw.accountOwnerId === 'string' ? raw.accountOwnerId : null;
  const status: CloudSyncStatus =
    raw.cloudStatus === 'synced' && accountOwnerId !== null ? 'synced' : 'local_only';
  const set: PresentationSet = {
    id: raw.id,
    accountOwnerId,
    setKind: 'CUSTOM',
    name: raw.name,
    lifecycle: raw.lifecycle === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE',
    cloudStatus: status,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
  };
  try {
    validatePresentationSet(set);
  } catch {
    return null;
  }
  return set;
}

function sanitizeItem(raw: unknown, parent: PresentationSet): PresentationSetItem | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== 'string' || !isOpaqueId(raw.id)) return null;
  if (raw.presentationSetId !== parent.id) return null;
  if (typeof raw.operationalDocumentId !== 'string' || !isOpaqueId(raw.operationalDocumentId)) {
    return null;
  }
  const accountOwnerId = typeof raw.accountOwnerId === 'string' ? raw.accountOwnerId : null;
  if (accountOwnerId !== parent.accountOwnerId) return null;
  if (
    typeof raw.position !== 'number' ||
    !Number.isInteger(raw.position) ||
    !Number.isSafeInteger(raw.position) ||
    raw.position < 0
  ) {
    return null;
  }
  if (typeof raw.included !== 'boolean') return null;
  const item: PresentationSetItem = {
    id: raw.id,
    presentationSetId: parent.id,
    accountOwnerId,
    operationalDocumentId: raw.operationalDocumentId,
    position: raw.position as number,
    included: raw.included,
  };
  try {
    validatePresentationSetItem(item);
  } catch {
    return null;
  }
  return item;
}

export function normalizePresentationSetsState(persisted: unknown): {
  sets: PresentationSet[];
  items: PresentationSetItem[];
} {
  const state = isRecord(persisted) ? persisted : {};
  const sets = (Array.isArray(state.sets) ? state.sets : [])
    .map(sanitizeSet)
    .filter((s): s is PresentationSet => s !== null);
  const byId = new Map(sets.map((s) => [s.id, s]));
  const seenItemIds = new Set<string>();
  const sanitized: PresentationSetItem[] = [];
  for (const raw of Array.isArray(state.items) ? state.items : []) {
    if (!isRecord(raw) || typeof raw.presentationSetId !== 'string') continue;
    if (typeof raw.id === 'string' && seenItemIds.has(raw.id)) continue;
    const parent = byId.get(raw.presentationSetId);
    if (!parent) continue;
    const item = sanitizeItem(raw, parent);
    if (!item) continue;
    seenItemIds.add(item.id);
    sanitized.push(item);
  }

  // H1A: at most one item per (presentationSetId, operationalDocumentId).
  // Never mint an id during hydration. Prefer a single included=true row;
  // drop conflicting duplicates when a canonical row cannot be established.
  const groups = new Map<string, PresentationSetItem[]>();
  for (const item of sanitized) {
    const key = `${item.presentationSetId}\0${item.operationalDocumentId}`;
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  const items: PresentationSetItem[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      items.push(group[0]!);
      continue;
    }
    const included = group.filter((i) => i.included);
    if (included.length === 1) {
      items.push(included[0]!);
      continue;
    }
    // Unsafe conflict (multiple live rows or multiple distinct tombstones).
  }
  return { sets, items };
}

export const usePresentationSetsStore = create<PresentationSetsState>()(
  persist(
    (set, get) => ({
      sets: [],
      items: [],
      hydrated: false,

      addSet: (next) => {
        validatePresentationSet(next);
        if (next.setKind !== 'CUSTOM') throw new Error('only custom sets are persisted');
        if (get().sets.some((s) => s.id === next.id)) throw new Error('duplicate presentation set id');
        set((s) => ({ sets: [next, ...s.sets] }));
      },

      updateSet: (id, patch, ctx, now = Date.now()) => {
        const existing = get().sets.find((s) => s.id === id);
        if (!existing) throw new Error('presentation set not found');
        const next: PresentationSet = {
          ...existing,
          name: patch.name ?? existing.name,
          lifecycle: patch.lifecycle ?? existing.lifecycle,
          id: existing.id,
          accountOwnerId: existing.accountOwnerId,
          setKind: 'CUSTOM',
          createdAt: existing.createdAt,
          updatedAt: now,
          cloudStatus: reconcilePresentationSetCloudStatus(
            'pending_sync',
            ctx,
            existing.accountOwnerId,
          ) === 'pending_sync'
            ? 'pending_sync'
            : 'local_only',
        };
        validatePresentationSet(next);
        set((s) => ({ sets: s.sets.map((x) => (x.id === id ? next : x)) }));
      },

      archiveSet: (id, ctx, now = Date.now()) => {
        get().updateSet(id, { lifecycle: 'ARCHIVED' }, ctx, now);
      },

      setCloudStatus: (id, status) =>
        set((s) => ({
          sets: s.sets.map((x) => (x.id === id ? { ...x, cloudStatus: status } : x)),
        })),

      applyPresentationSetSelection: (setId, next, ctx, now = Date.now()) => {
        const existing = get().sets.find((s) => s.id === setId);
        if (!existing) throw new Error('presentation set not found');
        for (const item of next) {
          if (item.presentationSetId !== setId) throw new Error('item set mismatch');
          if (item.accountOwnerId !== existing.accountOwnerId) throw new Error('item owner mismatch');
          validatePresentationSetItem(item);
        }
        const ids = new Set(next.map((i) => i.id));
        if (ids.size !== next.length) throw new Error('duplicate item id');
        const docs = new Set(next.map((i) => i.operationalDocumentId));
        if (docs.size !== next.length) throw new Error('duplicate document in set');
        const cloudStatus =
          reconcilePresentationSetCloudStatus('pending_sync', ctx, existing.accountOwnerId) ===
          'pending_sync'
            ? 'pending_sync'
            : 'local_only';
        set((s) => ({
          items: [...s.items.filter((i) => i.presentationSetId !== setId), ...next],
          sets: s.sets.map((x) =>
            x.id === setId ? { ...x, updatedAt: now, cloudStatus } : x,
          ),
        }));
      },

      importRecoveredSet: (next) => {
        validatePresentationSet(next);
        if (next.cloudStatus !== 'synced') throw new Error('recovered set must be synced');
        if (get().sets.some((s) => s.id === next.id)) throw new Error('duplicate presentation set id');
        set((s) => ({ sets: [next, ...s.sets] }));
      },

      replaceSyncedSetMetadata: (remote) => {
        const local = get().sets.find((s) => s.id === remote.id);
        if (!local) throw new Error('presentation set not found');
        if (local.cloudStatus !== 'synced') {
          throw new Error('local metadata has unsynced changes; not overwritten');
        }
        if (local.accountOwnerId !== remote.accountOwnerId) {
          throw new Error('ownership is immutable');
        }
        const next: PresentationSet = {
          ...remote,
          id: local.id,
          accountOwnerId: local.accountOwnerId,
          createdAt: local.createdAt,
          setKind: 'CUSTOM',
          cloudStatus: 'synced',
        };
        validatePresentationSet(next);
        set((s) => ({ sets: s.sets.map((x) => (x.id === local.id ? next : x)) }));
      },

      replaceSyncedSetItems: (setId, next) => {
        const local = get().sets.find((s) => s.id === setId);
        if (!local) throw new Error('presentation set not found');
        if (local.cloudStatus !== 'synced') {
          throw new Error('local set has unsynced changes; items not overwritten');
        }
        for (const item of next) {
          if (item.presentationSetId !== setId) throw new Error('item set mismatch');
          if (item.accountOwnerId !== local.accountOwnerId) throw new Error('item owner mismatch');
          validatePresentationSetItem(item);
        }
        const ids = new Set(next.map((i) => i.id));
        if (ids.size !== next.length) throw new Error('duplicate item id');
        const docs = new Set(next.map((i) => i.operationalDocumentId));
        if (docs.size !== next.length) throw new Error('duplicate document in set');
        set((s) => ({
          items: [...s.items.filter((i) => i.presentationSetId !== setId), ...next],
        }));
      },

      importRecoveredItem: (item) => {
        validatePresentationSetItem(item);
        if (get().items.some((i) => i.id === item.id)) return;
        if (
          get().items.some(
            (i) =>
              i.presentationSetId === item.presentationSetId &&
              i.operationalDocumentId === item.operationalDocumentId,
          )
        ) {
          throw new Error('duplicate document in set');
        }
        set((s) => ({ items: [...s.items, item] }));
      },

      reconcileCloudStatuses: (ctx) => {
        let changed = 0;
        const sets = get().sets.map((s) => {
          const next = reconcilePresentationSetCloudStatus(s.cloudStatus, ctx, s.accountOwnerId);
          if (next === s.cloudStatus) return s;
          changed++;
          return { ...s, cloudStatus: next };
        });
        if (changed > 0) set({ sets });
        return changed;
      },

      clear: () => set({ sets: [], items: [] }),
    }),
    {
      name: 'rigreceipts.presentationSets',
      version: PRESENTATION_SETS_PERSIST_VERSION,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ hydrated: _hydrated, ...rest }) => rest,
      migrate: (persisted) => normalizePresentationSetsState(persisted),
      merge: (persisted, current) => ({
        ...current,
        ...normalizePresentationSetsState(persisted),
      }),
      onRehydrateStorage: () => () => {
        usePresentationSetsStore.setState({ hydrated: true });
      },
    },
  ),
);

type S = Pick<PresentationSetsState, 'sets' | 'items'>;

export const selectVisiblePresentationSets = (s: S, sessionUserId: string | null) =>
  visiblePresentationSetsForSession(s.sets, sessionUserId);

export const selectActiveVisiblePresentationSets = (s: S, sessionUserId: string | null) =>
  selectVisiblePresentationSets(s, sessionUserId).filter((x) => x.lifecycle === 'ACTIVE');

export const selectItemsForSet = (s: S, setId: string) => itemsForSet(s.items, setId);

export const selectSetById = (s: S, id: string, sessionUserId: string | null) => {
  const set = s.sets.find((x) => x.id === id);
  return set && set.accountOwnerId === sessionUserId ? set : null;
};
