import {
  DocumentVersion,
  emptyRecoveryResult,
  markError,
  OperationalDocument,
  remoteVersionMatches,
  remoteVersionPath,
  ROAD_WALLET_REMOTE_BUCKET,
  RoadWalletRecoveryResult,
  sha256Hex,
  toRemoteDocumentRow,
  toRemoteVersionRow,
  PresentationSetRecoveryResult,
  writeSafeFromRecovery,
} from '@/domain';
import { getSupabaseClient } from '@/lib/supabase';
import { usePresentationSetsStore } from '@/store/presentationSets';
import { ROAD_WALLET_CLOUD_CAPABILITY, useRoadWalletStore } from '@/store/roadWallet';

import {
  assertRemoteEffectAuthorized,
  authorizeRemoteEffect,
  CloudSyncDeniedError,
  currentCloudSyncContext,
  subscribeCloudSyncContext,
} from './cloudSyncAuth';
import { DocumentFileStore, reverifyDocumentFile } from './documentFiles';
import {
  recoverPresentationSetsFromCloud,
  PresentationSetSyncResult,
  syncPendingPresentationSets,
} from './presentationSetSync';
import { roadWalletFileStore } from './roadWallet';
import { recoverRoadWalletFromCloud } from './roadWalletRecovery';

/**
 * Road Wallet cloud synchronization (Refinement Pass 1A) under the
 * `cloudDocumentBackup` capability — never `cloudBackup`.
 *
 * Effect order per document:
 *   1. upsert `operational_documents` metadata (editable; idempotent by id);
 *   2. per version: re-verify the exact local file against the immutable
 *      version's SHA-256 + kind; upload the exact bytes to the private
 *      `documents` bucket at `{uid}/road-wallet/{doc}/{version}.{ext}`;
 *      insert the immutable `document_versions` row (or confirm an identical
 *      existing row); only then mark the version synced.
 * Authorization is re-asserted immediately before every remote effect. A
 * denial or failure never deletes local content.
 */

export class VersionIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VersionIntegrityError';
  }
}

interface SyncDeps {
  fileStore: DocumentFileStore;
}

const deps = (): SyncDeps => ({ fileStore: roadWalletFileStore() });

const POSTGRES_UNIQUE_VIOLATION = '23505';

/** Upserts editable metadata; marks the document synced on success. */
export async function syncOperationalDocument(doc: OperationalDocument): Promise<void> {
  // Effect boundary — re-checked immediately before the DB write.
  const userId = assertRemoteEffectAuthorized(ROAD_WALLET_CLOUD_CAPABILITY, doc.accountOwnerId);
  const row = toRemoteDocumentRow(doc, userId);
  const { error } = await getSupabaseClient()
    .from('operational_documents')
    .upsert(row, { onConflict: 'id' });
  if (error) throw error;
  useRoadWalletStore.getState().setDocumentCloudStatus(doc.id, 'synced');
}

/**
 * Uploads one immutable version. Throws {@link VersionIntegrityError} when the
 * physical file no longer matches the version's evidence or when a remote row
 * with the same id carries different evidence; throws
 * {@link CloudSyncDeniedError} when this session may not upload it.
 */
export async function syncDocumentVersion(
  version: DocumentVersion,
  d: SyncDeps = deps(),
): Promise<void> {
  const store = useRoadWalletStore.getState();
  const userId = assertRemoteEffectAuthorized(ROAD_WALLET_CLOUD_CAPABILITY, version.accountOwnerId);

  // 1. Mandatory re-verification of the exact local file against immutable evidence.
  const reverified = await reverifyDocumentFile(
    d.fileStore,
    { ...version.fileCache, relativePath: version.relativePath, sha256: version.sha256 },
    version.fileKind,
  );
  store.setVersionFileCache(version.id, reverified);
  if (reverified.state !== 'READY') {
    throw new VersionIntegrityError(
      `local file failed re-verification (${reverified.error ?? 'unknown'}); not uploaded`,
    );
  }

  // 2. Read the exact bytes we are about to upload and hash them once more.
  const bytes = await d.fileStore.readBytes(version.relativePath);
  if (bytes.length !== version.byteSize || sha256Hex(bytes) !== version.sha256) {
    store.setVersionFileCache(version.id, markError(reverified, 'HASH_MISMATCH'));
    throw new VersionIntegrityError('bytes changed between verification and upload; not uploaded');
  }

  const supabase = getSupabaseClient();
  const path = remoteVersionPath(
    userId,
    version.operationalDocumentId,
    version.id,
    version.extension,
  );

  // 3. Upload. Effect boundary re-checked immediately before.
  assertRemoteEffectAuthorized(ROAD_WALLET_CLOUD_CAPABILITY, version.accountOwnerId);
  // `upsert: true` is safe only because the remote key is deterministic per
  // immutable version and the bytes were just re-verified against the version's
  // SHA-256: a retry can only ever rewrite the object with identical content.
  const upload = await supabase.storage
    .from(ROAD_WALLET_REMOTE_BUCKET)
    .upload(path, bytes, { contentType: version.mimeType, upsert: true });
  if (upload.error) throw upload.error;

  // 4. Insert the immutable row. Effect boundary re-checked immediately before.
  assertRemoteEffectAuthorized(ROAD_WALLET_CLOUD_CAPABILITY, version.accountOwnerId);
  const row = toRemoteVersionRow(version, userId);
  const insert = await supabase.from('document_versions').insert(row);
  if (insert.error) {
    if (insert.error.code !== POSTGRES_UNIQUE_VIOLATION) throw insert.error;
    // Idempotent retry: the row may already exist from a run that crashed
    // before the local status was marked synced. It must match exactly.
    const existing = await supabase
      .from('document_versions')
      .select('*')
      .eq('id', version.id)
      .eq('owner_id', userId)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (!existing.data || !remoteVersionMatches(version, userId, existing.data)) {
      throw new VersionIntegrityError(
        'a remote version with this id carries different immutable evidence; refusing to overwrite',
      );
    }
  }

  // 5. Only after all required remote effects succeeded.
  useRoadWalletStore.getState().setVersionCloudState(version.id, {
    cloudStatus: 'synced',
    remoteStorageBucket: ROAD_WALLET_REMOTE_BUCKET,
    remoteStoragePath: path,
  });
}

let inFlight = false;
let rerunRequested = false;

export interface RoadWalletSyncResult {
  documentsSynced: number;
  versionsSynced: number;
  integrityFailures: number;
}

/**
 * Syncs every pending document and version this session is authorized for.
 * Authorization is re-evaluated per item; denials relabel to `local_only` via
 * reconcile and never remove anything. Integrity failures are recorded on the
 * version's cache state and skipped (retry after the user replaces the file).
 */
export async function syncPendingRoadWallet(d: SyncDeps = deps()): Promise<RoadWalletSyncResult> {
  const result: RoadWalletSyncResult = {
    documentsSynced: 0,
    versionsSynced: 0,
    integrityFailures: 0,
  };
  if (inFlight) {
    rerunRequested = true;
    return result;
  }
  inFlight = true;
  try {
    const store = useRoadWalletStore.getState();
    store.reconcileCloudStatuses(currentCloudSyncContext());

    const docs = useRoadWalletStore.getState().documents;
    for (const doc of docs) {
      const decision = authorizeRemoteEffect(ROAD_WALLET_CLOUD_CAPABILITY, doc.accountOwnerId);
      if (!decision.allowed) continue;

      const pendingVersions = useRoadWalletStore
        .getState()
        .versions.filter(
          (v) => v.operationalDocumentId === doc.id && v.cloudStatus === 'pending_sync',
        );
      const docNeedsSync = doc.cloudStatus === 'pending_sync';
      if (!docNeedsSync && pendingVersions.length === 0) continue;

      // Version rows FK the document row, so metadata goes first — also when
      // the document is already synced but a version is pending (idempotent).
      try {
        await syncOperationalDocument(doc);
        if (docNeedsSync) result.documentsSynced++;
      } catch (err) {
        if (err instanceof CloudSyncDeniedError) {
          useRoadWalletStore.getState().reconcileCloudStatuses(currentCloudSyncContext());
        }
        continue; // versions cannot be inserted without their document row
      }

      for (const version of pendingVersions) {
        try {
          await syncDocumentVersion(version, d);
          result.versionsSynced++;
        } catch (err) {
          if (err instanceof VersionIntegrityError) result.integrityFailures++;
          if (err instanceof CloudSyncDeniedError) {
            useRoadWalletStore.getState().reconcileCloudStatuses(currentCloudSyncContext());
            break;
          }
          // Other failures leave the version pending for the next backfill.
        }
      }
    }
    return result;
  } finally {
    inFlight = false;
    if (rerunRequested) {
      rerunRequested = false;
      void syncPendingRoadWallet(d);
    }
  }
}

export interface RoadWalletCloudCycleResult {
  recovery: RoadWalletRecoveryResult;
  writeSafe: boolean;
  writes: RoadWalletSyncResult | null;
  setRecovery: PresentationSetRecoveryResult | null;
  setWrites: PresentationSetSyncResult | null;
}

export interface CloudCycleDeps {
  recoverRoadWallet?: typeof recoverRoadWalletFromCloud;
  syncPendingRoadWallet?: typeof syncPendingRoadWallet;
  recoverPresentationSets?: typeof recoverPresentationSetsFromCloud;
  syncPendingPresentationSets?: typeof syncPendingPresentationSets;
}

let cycleInFlight: Promise<RoadWalletCloudCycleResult> | null = null;
let cycleRerunRequested = false;

const emptyCycle = (recovery: RoadWalletRecoveryResult): RoadWalletCloudCycleResult => ({
  recovery,
  writeSafe: writeSafeFromRecovery(recovery),
  writes: null,
  setRecovery: null,
  setWrites: null,
});

/**
 * One full cloud cycle (Pass 2 H0 — READ BEFORE WRITE):
 *   1. current authenticated context;
 *   2. signed-out / not configured → local reconcile only, no remote I/O;
 *   3. signed in + configured → recover Road Wallet owner metadata;
 *   4. writeSafe = recovery.outcome === 'completed' && integrityConflicts === 0
 *      (downloadFailures during optional file restore do NOT flip writeSafe);
 *   5. recover custom presentation sets (failure does not mutate versions or
 *      overwrite local unsynced sets);
 *   6. reconcile local cloud states;
 *   7. pending WRITE sync only when writeSafe AND the relevant capability
 *      authorizes it (Road Wallet: cloudDocumentBackup; sets: that plus
 *      savedPresentationSets).
 * fetch_failed, cancelled, session change, or unresolved integrity conflicts
 * skip remote writes. Concurrent cycles coalesce.
 */
export function runRoadWalletCloudCycle(
  extras: CloudCycleDeps = {},
): Promise<RoadWalletCloudCycleResult> {
  if (cycleInFlight) {
    cycleRerunRequested = true;
    return cycleInFlight;
  }
  const recoverRw = extras.recoverRoadWallet ?? recoverRoadWalletFromCloud;
  const syncRw = extras.syncPendingRoadWallet ?? syncPendingRoadWallet;
  const recoverSets = extras.recoverPresentationSets ?? recoverPresentationSetsFromCloud;
  const syncSets = extras.syncPendingPresentationSets ?? syncPendingPresentationSets;

  cycleInFlight = (async () => {
    try {
      const ctx = currentCloudSyncContext();
      if (!ctx.userId || !ctx.supabaseConfigured) {
        await syncRw();
        return emptyCycle(emptyRecoveryResult(ctx.userId ? 'not_configured' : 'signed_out'));
      }

      let recovery: RoadWalletRecoveryResult;
      try {
        recovery = await recoverRw();
      } catch {
        recovery = emptyRecoveryResult('fetch_failed');
      }
      const writeSafe = writeSafeFromRecovery(recovery);

      let setRecovery: PresentationSetRecoveryResult | null = null;
      try {
        setRecovery = await recoverSets();
      } catch {
        setRecovery = {
          setsRecovered: 0,
          itemsRecovered: 0,
          integrityConflicts: 0,
          skippedLocalChanges: 0,
          outcome: 'fetch_failed',
        };
      }

      useRoadWalletStore.getState().reconcileCloudStatuses(currentCloudSyncContext());
      usePresentationSetsStore.getState().reconcileCloudStatuses(currentCloudSyncContext());

      let writes: RoadWalletSyncResult | null = null;
      let setWrites: PresentationSetSyncResult | null = null;
      if (writeSafe) {
        writes = await syncRw();
        setWrites = await syncSets();
      }

      return { recovery, writeSafe, writes, setRecovery, setWrites };
    } finally {
      cycleInFlight = null;
      if (cycleRerunRequested) {
        cycleRerunRequested = false;
        void runRoadWalletCloudCycle(extras);
      }
    }
  })();
  return cycleInFlight;
}

let started = false;

/**
 * Keeps Road Wallet cloud state honest on hydration, auth changes and tier
 * changes by running {@link runRoadWalletCloudCycle}. Device-only mode
 * reconciles everything to `local_only` and makes no remote calls. Never
 * depends on a screen being visited; never deletes local content; no polling.
 */
export function initDocumentSync(): void {
  if (started) return;
  started = true;
  const bothHydrated = () =>
    useRoadWalletStore.persist.hasHydrated() && usePresentationSetsStore.persist.hasHydrated();
  const run = () => {
    void runRoadWalletCloudCycle();
  };
  const runWhenReady = () => {
    if (bothHydrated()) run();
  };
  if (bothHydrated()) run();
  useRoadWalletStore.persist.onFinishHydration(runWhenReady);
  usePresentationSetsStore.persist.onFinishHydration(runWhenReady);
  subscribeCloudSyncContext(run);
}

/** Test-only: resets module state between cases. */
export function __resetDocumentSyncForTests(): void {
  inFlight = false;
  rerunRequested = false;
  cycleInFlight = null;
  cycleRerunRequested = false;
  started = false;
}
