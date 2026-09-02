import {
  CloudSyncContext,
  currentVersion,
  DocumentVersion,
  emptyRecoveryResult,
  finalizeRecoveryResult,
  fromRemoteDocumentRow,
  fromRemoteVersionRow,
  isVisibleInSession,
  markError,
  mergeRecoveredDocument,
  mergeRecoveredVersion,
  OperationalDocument,
  rebuildVersionChain,
  remoteVersionPath,
  ROAD_WALLET_REMOTE_BUCKET,
  RoadWalletRecoveryResult,
  versionsForDocument,
} from '@/domain';
import { getSupabaseClient } from '@/lib/supabase';
import { useRoadWalletStore } from '@/store/roadWallet';

import { currentCloudSyncContext } from './cloudSyncAuth';
import { DocumentFileStore, verifyBytes } from './documentFiles';
import { refreshVersionReadiness, roadWalletFileStore } from './roadWallet';

/**
 * Road Wallet cloud recovery (Pass 1B.1).
 *
 * Data-rights rule (canonical): a signed-in owner may RECOVER Road Wallet data
 * that already exists in their private cloud account regardless of current
 * tier. `cloudDocumentBackup` governs only NEW cloud writes. Recovery requires
 * an authenticated owner, a configured Supabase, and owner-scoped RLS reads;
 * it grants no writes, no Share/Export, and no access to another owner.
 *
 * Recovery is additive and reconciliatory: it never deletes remote rows or
 * objects, never rewrites remote immutable evidence, never overwrites local
 * unsynced edits, and never claims a file is READY without physical
 * verification of the downloaded bytes.
 */

// ---------------------------------------------------------------------------
// Remote source (default: the owner's own authenticated Supabase session)
// ---------------------------------------------------------------------------

export interface RoadWalletRemote {
  fetchDocuments(userId: string): Promise<unknown[]>;
  fetchVersions(userId: string): Promise<unknown[]>;
  /** Exact object bytes from the private bucket at the given key. */
  downloadBytes(bucket: 'documents', path: string): Promise<Uint8Array>;
}

async function blobToBytes(blob: unknown, bucket: string, path: string): Promise<Uint8Array> {
  const maybe = blob as { arrayBuffer?: () => Promise<ArrayBuffer> } | null;
  if (maybe && typeof maybe.arrayBuffer === 'function') {
    return new Uint8Array(await maybe.arrayBuffer());
  }
  // React Native Blob may lack arrayBuffer(); fall back to a short-lived signed
  // URL fetched through the fetch API (same private bucket, same owner key).
  const signed = await getSupabaseClient().storage.from(bucket).createSignedUrl(path, 60);
  if (signed.error || !signed.data?.signedUrl) throw signed.error ?? new Error('no signed url');
  const res = await fetch(signed.data.signedUrl);
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

export const supabaseRoadWalletRemote: RoadWalletRemote = {
  async fetchDocuments(userId) {
    const { data, error } = await getSupabaseClient()
      .from('operational_documents')
      .select('*')
      .eq('owner_id', userId);
    if (error) throw error;
    return data ?? [];
  },
  async fetchVersions(userId) {
    const { data, error } = await getSupabaseClient()
      .from('document_versions')
      .select('*')
      .eq('owner_id', userId);
    if (error) throw error;
    return data ?? [];
  },
  async downloadBytes(bucket, path) {
    const { data, error } = await getSupabaseClient().storage.from(bucket).download(path);
    if (error || !data) throw error ?? new Error('download failed');
    return blobToBytes(data, bucket, path);
  },
};

export interface RecoveryDeps {
  fileStore: DocumentFileStore;
  remote: RoadWalletRemote;
  ctx: () => CloudSyncContext;
  now: () => number;
}

export const defaultRecoveryDeps = (): RecoveryDeps => ({
  fileStore: roadWalletFileStore(),
  remote: supabaseRoadWalletRemote,
  ctx: currentCloudSyncContext,
  now: Date.now,
});

// ---------------------------------------------------------------------------
// Restore exact bytes of one version to this device
// ---------------------------------------------------------------------------

export type RestoreDenialReason =
  | 'SIGNED_OUT'
  | 'NOT_CONFIGURED'
  | 'NOT_FOUND'
  | 'NOT_VISIBLE'
  | 'NO_VERSION'
  | 'NOT_BACKED_UP'
  | 'REMOTE_PATH_INVALID'
  | 'DOWNLOAD_FAILED'
  | 'BYTES_MISMATCH'
  | 'WRITE_FAILED'
  | 'VERIFY_FAILED'
  | 'SESSION_CHANGED';

export class RestoreError extends Error {
  readonly reason: RestoreDenialReason;
  constructor(reason: RestoreDenialReason, detail?: string) {
    super(`restore denied: ${reason}${detail ? ` (${detail})` : ''}`);
    this.name = 'RestoreError';
    this.reason = reason;
  }
}

/**
 * Downloads the exact bytes of one backed-up version into the canonical
 * app-private path and marks it READY only after the durable file has been
 * re-read and re-verified. Downloaded bytes must satisfy the immutable version
 * (length, SHA-256, content kind) — they never redefine it. Available to the
 * signed-in owner regardless of tier; requires no Share/Export entitlement.
 */
export async function restoreDocumentVersionToDevice(
  documentId: string,
  versionId?: string,
  deps: RecoveryDeps = defaultRecoveryDeps(),
): Promise<DocumentVersion> {
  const ctx = deps.ctx();
  if (!ctx.userId) throw new RestoreError('SIGNED_OUT');
  if (!ctx.supabaseConfigured) throw new RestoreError('NOT_CONFIGURED');
  const userId = ctx.userId;

  const state = useRoadWalletStore.getState();
  const doc = state.documents.find((d) => d.id === documentId);
  if (!doc) throw new RestoreError('NOT_FOUND');
  if (!isVisibleInSession(doc, userId)) throw new RestoreError('NOT_VISIBLE');
  const version = versionId
    ? (state.versions.find((v) => v.id === versionId && v.operationalDocumentId === doc.id) ?? null)
    : currentVersion(state.versions, doc.id);
  if (!version) throw new RestoreError('NO_VERSION');
  if (version.accountOwnerId !== userId) throw new RestoreError('NOT_VISIBLE');
  if (version.cloudStatus !== 'synced') throw new RestoreError('NOT_BACKED_UP');

  const canonicalPath = remoteVersionPath(userId, doc.id, version.id, version.extension);
  if (
    version.remoteStorageBucket !== ROAD_WALLET_REMOTE_BUCKET ||
    version.remoteStoragePath !== canonicalPath
  ) {
    throw new RestoreError('REMOTE_PATH_INVALID');
  }

  let bytes: Uint8Array;
  try {
    bytes = await deps.remote.downloadBytes(ROAD_WALLET_REMOTE_BUCKET, canonicalPath);
  } catch {
    throw new RestoreError('DOWNLOAD_FAILED');
  }

  // The session may have changed while the download was in flight.
  if (deps.ctx().userId !== userId) throw new RestoreError('SESSION_CHANGED');

  // Accept the bytes only if they satisfy the immutable version exactly.
  const check = verifyBytes(bytes, {
    expectedKind: version.fileKind,
    expectedSha256: version.sha256,
  });
  if (!check.ok || check.byteSize !== version.byteSize) {
    throw new RestoreError('BYTES_MISMATCH', check.ok ? 'byte length' : check.reason);
  }

  try {
    await deps.fileStore.writeBytes(version.relativePath, bytes, version.mimeType);
  } catch {
    await deps.fileStore.remove(version.relativePath).catch(() => {});
    throw new RestoreError('WRITE_FAILED');
  }

  // Re-read and re-verify the durable physical file; only that yields READY.
  const entry = await refreshVersionReadiness(version, deps);
  if (entry.state !== 'READY') {
    await deps.fileStore.remove(version.relativePath).catch(() => {});
    useRoadWalletStore
      .getState()
      .setVersionFileCache(version.id, markError(entry, entry.error ?? 'UNREADABLE'));
    throw new RestoreError('VERIFY_FAILED', entry.error ?? undefined);
  }
  return useRoadWalletStore.getState().versions.find((v) => v.id === version.id) ?? version;
}

// ---------------------------------------------------------------------------
// Metadata recovery + safe merge + auto-restore of pinned current versions
// ---------------------------------------------------------------------------

/**
 * Recovers the signed-in owner's Road Wallet metadata from their private cloud
 * account and merges it safely into the local store, then auto-restores the
 * current version of ACTIVE documents that are `offlinePinned` and not yet
 * present on this device. Every remote phase re-checks the active user; a
 * session change discards the stale result before any local mutation.
 */
export async function recoverRoadWalletFromCloud(
  deps: RecoveryDeps = defaultRecoveryDeps(),
): Promise<RoadWalletRecoveryResult> {
  const ctx = deps.ctx();
  if (!ctx.userId) return emptyRecoveryResult('signed_out');
  if (!ctx.supabaseConfigured) return emptyRecoveryResult('not_configured');
  const userId = ctx.userId;
  const result = emptyRecoveryResult();
  const stillActive = () => deps.ctx().userId === userId;

  let docRows: unknown[];
  let versionRows: unknown[];
  try {
    [docRows, versionRows] = await Promise.all([
      deps.remote.fetchDocuments(userId),
      deps.remote.fetchVersions(userId),
    ]);
  } catch {
    return emptyRecoveryResult('fetch_failed');
  }
  if (!stillActive()) return emptyRecoveryResult('cancelled');

  // ---- documents ---------------------------------------------------------
  const recoveredDocs = new Map<string, OperationalDocument>();
  for (const row of docRows) {
    const remote = fromRemoteDocumentRow(row, userId);
    if (!remote) {
      result.integrityConflicts++;
      continue;
    }
    if (!stillActive()) return finalizeRecoveryResult({ ...result, outcome: 'cancelled' });
    const store = useRoadWalletStore.getState();
    const local = store.documents.find((d) => d.id === remote.id);
    if (local && local.accountOwnerId !== userId) {
      // Same opaque id bound to a different account on this device — never merge.
      result.integrityConflicts++;
      continue;
    }
    const merged = mergeRecoveredDocument(local, remote);
    switch (merged.action) {
      case 'import':
        store.importRecoveredDocument(merged.document);
        result.documentsRecovered++;
        break;
      case 'replace_metadata':
        store.replaceSyncedDocumentMetadata(merged.document);
        result.documentsRecovered++;
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
    recoveredDocs.set(
      remote.id,
      useRoadWalletStore.getState().documents.find((d) => d.id === remote.id)!,
    );
  }

  // ---- versions (per document, H0 chain rebuilt on the local+remote union) --
  for (const parent of recoveredDocs.values()) {
    if (!stillActive()) return finalizeRecoveryResult({ ...result, outcome: 'cancelled' });
    const store = useRoadWalletStore.getState();
    const localVersions = versionsForDocument(store.versions, parent.id);
    const localById = new Map(localVersions.map((v) => [v.id, v]));

    const remoteVersions: DocumentVersion[] = [];
    for (const row of versionRows) {
      if (!(typeof row === 'object' && row !== null)) continue;
      if ((row as { operational_document_id?: unknown }).operational_document_id !== parent.id)
        continue;
      const mapped = fromRemoteVersionRow(row, userId, parent);
      if (!mapped) {
        result.integrityConflicts++;
        continue;
      }
      remoteVersions.push(mapped);
    }

    // Union candidates: local evidence wins any collision; a remote row that
    // reuses a local id with different evidence, or a local version number
    // with a different id, is a conflict and is quarantined (never imported).
    const candidates: DocumentVersion[] = [...localVersions];
    const toApply: { action: 'import' | 'reconcile'; version: DocumentVersion }[] = [];
    for (const remote of remoteVersions) {
      const local = localById.get(remote.id);
      const merged = mergeRecoveredVersion(local, remote);
      if (merged.action === 'conflict') {
        result.integrityConflicts++;
        continue;
      }
      if (merged.action === 'unchanged') continue;
      if (
        merged.action === 'import' &&
        localVersions.some((v) => v.versionNumber === remote.versionNumber)
      ) {
        result.integrityConflicts++;
        continue;
      }
      if (merged.action === 'import') candidates.push(remote);
      toApply.push({ action: merged.action, version: merged.version! });
    }

    // Only the valid contiguous chain may be imported; a malformed remote row
    // never becomes current merely because it exists remotely.
    const chain = rebuildVersionChain(candidates);
    const retained = new Set(chain.map((v) => v.id));
    for (const item of toApply) {
      if (!stillActive()) return finalizeRecoveryResult({ ...result, outcome: 'cancelled' });
      if (item.action === 'import' && !retained.has(item.version.id)) {
        result.integrityConflicts++;
        continue;
      }
      const s = useRoadWalletStore.getState();
      if (item.action === 'import') {
        try {
          s.addVersion(item.version);
          result.versionsRecovered++;
        } catch {
          result.integrityConflicts++;
        }
      } else {
        s.setVersionCloudState(item.version.id, {
          cloudStatus: 'synced',
          remoteStorageBucket: item.version.remoteStorageBucket,
          remoteStoragePath: item.version.remoteStoragePath,
        });
      }
    }
  }

  // ---- auto-restore: ACTIVE + offlinePinned + current version not on device --
  for (const parent of recoveredDocs.values()) {
    if (!stillActive()) return finalizeRecoveryResult({ ...result, outcome: 'cancelled' });
    const s = useRoadWalletStore.getState();
    const doc = s.documents.find((d) => d.id === parent.id);
    if (!doc || doc.lifecycle !== 'ACTIVE' || !doc.offlinePinned) continue;
    const current = currentVersion(s.versions, doc.id);
    if (!current || current.cloudStatus !== 'synced') continue;
    if (current.fileCache.state === 'READY') continue;
    if (await deps.fileStore.exists(current.relativePath)) {
      // A file is present but unverified in this process: verify, do not download.
      const entry = await refreshVersionReadiness(current, deps);
      if (entry.state === 'READY') continue;
    }
    try {
      await restoreDocumentVersionToDevice(doc.id, current.id, deps);
      result.filesRestored++;
    } catch (err) {
      if (err instanceof RestoreError && err.reason === 'SESSION_CHANGED') {
        return finalizeRecoveryResult({ ...result, outcome: 'cancelled' });
      }
      result.downloadFailures++;
    }
  }

  return finalizeRecoveryResult(result);
}
