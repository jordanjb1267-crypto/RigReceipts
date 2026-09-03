import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  CaptureSyncStatus,
  CloudSyncContext,
  reconcileSyncStatus,
  ScanTypeSlug,
  SyncBinding,
} from '@/domain';
import { OcrEngineName } from '@/ocr';

/**
 * Local, offline-first capture queue. Scans are saved here immediately and
 * persist across app restarts (spec §7: "store local pending records… avoid
 * data loss on app close").
 *
 * Sync state (Refinement C1) is honest about the cloud:
 *   - `local_only`   — kept on this device; this session may not upload it
 *                      (signed out, not entitled, unowned legacy, or bound to
 *                      another account).
 *   - `pending_sync` — bound to the signed-in, entitled user; awaiting upload.
 *   - `synced`       — persisted remotely; terminal.
 * Entitlement / account changes move records between the first two states
 * via {@link reconcileSyncStatus}; nothing is ever deleted by a state change.
 */
export interface Capture {
  id: string;
  scanType: ScanTypeSlug;
  imageUri: string | null;
  engine: OcrEngineName | null;
  rawText: string;
  vendor: string | null;
  totalUsd: number | null;
  date: string | null;
  gallons: number | null;
  status: CaptureSyncStatus;
  /**
   * The account this capture belongs to (the user signed in when it was
   * created). `null` = created signed out or legacy/unowned; such captures are
   * never claimed for whichever account signs in later.
   */
  accountOwnerId: string | null;
  /** The remote document_scans id once synced (null when no image was stored). */
  remoteScanId?: string | null;
  /** Load this scan is filed under, when attached (feeds the Paperwork grade). */
  loadId?: string | null;
  createdAt: number;
}

export type NewCapture = Omit<
  Capture,
  'id' | 'status' | 'accountOwnerId' | 'createdAt' | 'remoteScanId' | 'loadId'
>;

/** Cloud capability the capture queue syncs under (receipts/load documents). */
export const CAPTURE_CLOUD_CAPABILITY = 'cloudBackup' as const;

interface CapturesState {
  captures: Capture[];
  hydrated: boolean;
  /** Saves a capture with an explicit owner binding + initial sync state. */
  addCapture: (draft: NewCapture, binding: SyncBinding) => string;
  markSynced: (id: string, remoteScanId: string | null) => void;
  /**
   * Re-derives every unsynced capture's state from the current cloud context.
   * Returns how many captures changed state. Never removes anything.
   */
  reconcileSyncStates: (ctx: CloudSyncContext) => number;
  /** File a scan under a load (or detach with null). */
  assignCaptureToLoad: (id: string, loadId: string | null) => void;
  removeCapture: (id: string) => void;
  clear: () => void;
}

const makeId = () => `cap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/** Persisted shape version. v1 introduced `accountOwnerId` + `local_only`. */
export const CAPTURES_PERSIST_VERSION = 1;

type LegacyCapture = Omit<Capture, 'status' | 'accountOwnerId'> & {
  status?: string;
  accountOwnerId?: string | null;
};

/**
 * Conservative normalization of a persisted capture from any earlier shape:
 *   - `synced` stays `synced` and keeps its `remoteScanId` (never re-uploaded);
 *   - anything else without an owner binding becomes `local_only` — legacy
 *     unowned content is not claimed for whichever account signs in;
 *   - owned unsynced content becomes `local_only` too and is promoted back to
 *     `pending_sync` by the next reconcile if this session may upload it.
 * Every other field is preserved as-is.
 */
export function normalizeLegacyCapture(raw: LegacyCapture): Capture {
  const accountOwnerId = typeof raw.accountOwnerId === 'string' ? raw.accountOwnerId : null;
  const status: CaptureSyncStatus = raw.status === 'synced' ? 'synced' : 'local_only';
  return {
    ...raw,
    status,
    accountOwnerId,
    remoteScanId: raw.remoteScanId ?? null,
    loadId: raw.loadId ?? null,
  };
}

/**
 * zustand `migrate` hook. Runs only when the stored version is older than
 * {@link CAPTURES_PERSIST_VERSION}; normalization is idempotent so any earlier
 * shape (including v0 with no version field) is handled the same way.
 */
export function migrateCapturesState(
  persisted: unknown,
  _version: number,
): { captures: Capture[] } {
  const state = (persisted ?? {}) as { captures?: LegacyCapture[] };
  const captures = Array.isArray(state.captures) ? state.captures : [];
  return { captures: captures.map(normalizeLegacyCapture) };
}

export const useCapturesStore = create<CapturesState>()(
  persist(
    (set, get) => ({
      captures: [],
      hydrated: false,
      addCapture: (draft, binding) => {
        const id = makeId();
        const capture: Capture = {
          ...draft,
          id,
          status: binding.status,
          accountOwnerId: binding.accountOwnerId,
          loadId: null,
          createdAt: Date.now(),
        };
        set((s) => ({ captures: [capture, ...s.captures] }));
        return id;
      },
      markSynced: (id, remoteScanId) =>
        set((s) => ({
          captures: s.captures.map((c) =>
            c.id === id ? { ...c, status: 'synced', remoteScanId } : c,
          ),
        })),
      reconcileSyncStates: (ctx) => {
        let changed = 0;
        const next = get().captures.map((c) => {
          const r = reconcileSyncStatus(c, ctx, CAPTURE_CLOUD_CAPABILITY);
          if (r !== c) changed++;
          return r;
        });
        if (changed > 0) set({ captures: next });
        return changed;
      },
      assignCaptureToLoad: (id, loadId) =>
        set((s) => ({
          captures: s.captures.map((c) => (c.id === id ? { ...c, loadId } : c)),
        })),
      removeCapture: (id) => set((s) => ({ captures: s.captures.filter((c) => c.id !== id) })),
      clear: () => set({ captures: [] }),
    }),
    {
      name: 'rigreceipts.captures',
      version: CAPTURES_PERSIST_VERSION,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ hydrated: _hydrated, ...rest }) => rest,
      migrate: migrateCapturesState,
      onRehydrateStorage: () => () => {
        useCapturesStore.setState({ hydrated: true });
      },
    },
  ),
);

export const selectPendingSyncCount = (s: CapturesState) =>
  s.captures.filter((c) => c.status === 'pending_sync').length;

export const selectLocalOnlyCount = (s: CapturesState) =>
  s.captures.filter((c) => c.status === 'local_only').length;
