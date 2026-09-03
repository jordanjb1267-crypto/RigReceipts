import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  assertImmutableCoreUnchanged,
  CloudSyncContext,
  CloudSyncStatus,
  currentVersion,
  DOCUMENT_KINDS,
  DOCUMENT_LIFECYCLES,
  documentFileRelativePath,
  DocumentVersion,
  FileCacheEntry,
  isOpaqueId,
  isSha256Hex,
  OperationalDocument,
  OperationalDocumentPatch,
  rebuildVersionChain,
  reconcileCloudStatus,
  remoteVersionPath,
  requiredSensitivityForKind,
  roadWalletSummary,
  SENSITIVITIES,
  statusAfterLocalMutation,
  SUBJECT_KINDS,
  validateNewVersion,
  validateOperationalDocument,
  versionsForDocument,
  visibleDocumentsForSession,
} from '@/domain';

/**
 * Road Wallet local store (Refinement Pass 1A). Device-persistent and
 * offline-first, but **account-scoped**: every document and version carries
 * `accountOwnerId`, and normal selectors only surface records bound to the
 * current session (unowned records only when signed out). Nothing here ever
 * deletes content on sign-out, account switch, tier change or cloud transition.
 *
 * `DocumentVersion` immutable evidence is protected: the only version
 * mutations exposed touch cache/cloud state, and each asserts the immutable
 * core is unchanged.
 */

/** Cloud capability Road Wallet syncs under — distinct from the capture queue's `cloudBackup`. */
export const ROAD_WALLET_CLOUD_CAPABILITY = 'cloudDocumentBackup' as const;

export const ROAD_WALLET_PERSIST_VERSION = 1;

interface RoadWalletState {
  documents: OperationalDocument[];
  versions: DocumentVersion[];
  hydrated: boolean;
  /** Inserts a validated logical document (rejects duplicate ids). */
  addDocument: (doc: OperationalDocument) => void;
  /** Edits user-editable metadata; cloud status re-derived from `ctx`. */
  updateDocumentMetadata: (
    id: string,
    patch: OperationalDocumentPatch,
    ctx: CloudSyncContext,
    now?: number,
  ) => void;
  archiveDocument: (id: string, ctx: CloudSyncContext, now?: number) => void;
  /** Returns an archived document to ACTIVE; identity, ownership and every version preserved. */
  restoreDocument: (id: string, ctx: CloudSyncContext, now?: number) => void;
  setDocumentCloudStatus: (id: string, status: CloudSyncStatus) => void;
  /** Inserts a validated immutable version (unique number, same-document supersession). */
  addVersion: (version: DocumentVersion) => void;
  setVersionFileCache: (id: string, fileCache: FileCacheEntry) => void;
  setVersionCloudState: (
    id: string,
    state: {
      cloudStatus: CloudSyncStatus;
      remoteStorageBucket?: 'documents' | null;
      remoteStoragePath?: string | null;
    },
  ) => void;
  /** Re-derives every unsynced cloud status from the current context. */
  reconcileCloudStatuses: (ctx: CloudSyncContext) => number;
  /**
   * Cloud recovery (Pass 1B.1): inserts a validated remote document that does
   * not exist locally (`cloudStatus: synced`). Rejects duplicates.
   */
  importRecoveredDocument: (doc: OperationalDocument) => void;
  /**
   * Cloud recovery: replaces editable metadata of a LOCALLY SYNCED document
   * with demonstrably newer remote metadata. Identity, ownership and createdAt
   * are kept from the local record; throws if the local copy is not synced.
   */
  replaceSyncedDocumentMetadata: (remote: OperationalDocument) => void;
  /**
   * Whole-store maintenance primitive (tests / explicit account cleanup only).
   * Never wired to sign-out, account switch or tier changes. There is
   * deliberately no per-version delete: versions are historical evidence.
   */
  clear: () => void;
}

const isEnum = (values: readonly string[], v: unknown): boolean =>
  typeof v === 'string' && values.includes(v);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/**
 * Keeps only structurally sound documents; malformed entries are dropped, never
 * thrown. A known-sensitive kind persisted with a downgraded sensitivity is
 * repaired to its required class (the downgrade is rejected, the record kept).
 * A `synced` claim is retained only for owned documents.
 */
function sanitizeDocument(raw: unknown): OperationalDocument | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== 'string' || !isOpaqueId(raw.id)) return null;
  if (!isEnum(DOCUMENT_KINDS, raw.documentKind)) return null;
  if (!isEnum(SUBJECT_KINDS, raw.subjectKind)) return null;
  if (!isEnum(SENSITIVITIES, raw.sensitivity)) return null;
  if (typeof raw.title !== 'string') return null;
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  const num = (v: unknown, fallback: number) => (typeof v === 'number' ? v : fallback);
  const documentKind = raw.documentKind as OperationalDocument['documentKind'];
  const accountOwnerId = str(raw.accountOwnerId);
  const status: CloudSyncStatus =
    raw.cloudStatus === 'synced' && accountOwnerId !== null ? 'synced' : 'local_only';
  const doc: OperationalDocument = {
    id: raw.id,
    accountOwnerId,
    documentKind,
    subjectKind: raw.subjectKind as OperationalDocument['subjectKind'],
    truckId: str(raw.truckId),
    trailerNumber: str(raw.trailerNumber),
    title: raw.title,
    issuer: str(raw.issuer),
    jurisdiction: str(raw.jurisdiction),
    issuedAt: str(raw.issuedAt),
    effectiveAt: str(raw.effectiveAt),
    expiresAt: str(raw.expiresAt),
    maskedReference: str(raw.maskedReference),
    sensitivity:
      requiredSensitivityForKind(documentKind) ??
      (raw.sensitivity as OperationalDocument['sensitivity']),
    lifecycle: isEnum(DOCUMENT_LIFECYCLES, raw.lifecycle)
      ? (raw.lifecycle as OperationalDocument['lifecycle'])
      : 'ACTIVE',
    offlinePinned: raw.offlinePinned === true,
    cloudStatus: status,
    createdAt: num(raw.createdAt, 0),
    updatedAt: num(raw.updatedAt, num(raw.createdAt, 0)),
  };
  try {
    validateOperationalDocument(doc);
  } catch {
    return null;
  }
  return doc;
}

const EXTENSION_RE = /^[a-z0-9]{1,8}$/;

/**
 * Structural + canonical-identity sanitization of one persisted version against
 * its (already sanitized) parent. Returns null for anything that cannot be
 * proven consistent. Nothing about physical file readiness is trusted: the
 * rebuilt cache entry starts NOT_CACHED with the immutable evidence as its
 * expectations, and only a fresh `reverifyDocumentFile` can make it READY.
 */
function sanitizeVersion(raw: unknown, parent: OperationalDocument): DocumentVersion | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== 'string' || !isOpaqueId(raw.id)) return null;
  if (raw.operationalDocumentId !== parent.id) return null;
  const accountOwnerId = typeof raw.accountOwnerId === 'string' ? raw.accountOwnerId : null;
  if (accountOwnerId !== parent.accountOwnerId) return null;
  if (!Number.isInteger(raw.versionNumber) || (raw.versionNumber as number) < 1) return null;
  if (typeof raw.sha256 !== 'string' || !isSha256Hex(raw.sha256)) return null;
  if (typeof raw.byteSize !== 'number' || !(raw.byteSize > 0)) return null;
  if (typeof raw.mimeType !== 'string' || !raw.mimeType) return null;
  if (typeof raw.extension !== 'string' || !EXTENSION_RE.test(raw.extension)) return null;
  const fileKind = raw.fileKind;
  if (fileKind !== 'IMAGE' && fileKind !== 'PDF' && fileKind !== 'OTHER') return null;

  let canonicalPath: string;
  try {
    canonicalPath = documentFileRelativePath(parent.id, raw.id, raw.extension);
  } catch {
    return null;
  }
  if (raw.relativePath !== canonicalPath) return null;

  const supersedesVersionId =
    typeof raw.supersedesVersionId === 'string' && isOpaqueId(raw.supersedesVersionId)
      ? raw.supersedesVersionId
      : raw.supersedesVersionId === null || raw.supersedesVersionId === undefined
        ? null
        : undefined;
  if (supersedesVersionId === undefined || supersedesVersionId === raw.id) return null;

  // Remote identity: a synced claim survives only when the recorded remote
  // location is exactly the canonical one for this owned version.
  const expectedRemote =
    accountOwnerId === null
      ? null
      : remoteVersionPath(accountOwnerId, parent.id, raw.id, raw.extension);
  const syncedClaimValid =
    raw.cloudStatus === 'synced' &&
    expectedRemote !== null &&
    raw.remoteStorageBucket === 'documents' &&
    raw.remoteStoragePath === expectedRemote;

  const fileCache: FileCacheEntry = {
    state: 'NOT_CACHED',
    relativePath: canonicalPath,
    mimeType: raw.mimeType,
    byteSize: raw.byteSize,
    sha256: raw.sha256,
    error: null,
    verifiedAt: null,
  };

  return {
    id: raw.id,
    operationalDocumentId: parent.id,
    accountOwnerId,
    versionNumber: raw.versionNumber as number,
    supersedesVersionId,
    fileKind,
    mimeType: raw.mimeType,
    extension: raw.extension,
    byteSize: raw.byteSize,
    sha256: raw.sha256,
    relativePath: canonicalPath,
    fileCache,
    cloudStatus: syncedClaimValid ? 'synced' : 'local_only',
    remoteStorageBucket: syncedClaimValid ? 'documents' : null,
    remoteStoragePath: syncedClaimValid ? expectedRemote : null,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0,
  };
}

/**
 * Normalizes any persisted shape deterministically; never throws.
 *   1. documents are sanitized (malformed dropped, sensitivity repaired);
 *   2. versions are sanitized against their parent (owner, canonical path,
 *      evidence shape, remote identity); orphans and duplicates by id are
 *      dropped entirely;
 *   3. each document's chain is rebuilt with `rebuildVersionChain` so
 *      duplicate numbers and malformed supersession can never yield a
 *      "current" version;
 *   4. every retained version starts NOT_CACHED pending physical re-verification.
 */
export function normalizeRoadWalletState(persisted: unknown): {
  documents: OperationalDocument[];
  versions: DocumentVersion[];
} {
  const state = isRecord(persisted) ? persisted : {};
  const documents = (Array.isArray(state.documents) ? state.documents : [])
    .map(sanitizeDocument)
    .filter((d): d is OperationalDocument => d !== null);
  const byId = new Map(documents.map((d) => [d.id, d]));

  const rawVersions = Array.isArray(state.versions) ? state.versions : [];
  const idCounts = new Map<string, number>();
  for (const raw of rawVersions) {
    if (isRecord(raw) && typeof raw.id === 'string') {
      idCounts.set(raw.id, (idCounts.get(raw.id) ?? 0) + 1);
    }
  }

  const sanitized: DocumentVersion[] = [];
  for (const raw of rawVersions) {
    if (!isRecord(raw) || typeof raw.operationalDocumentId !== 'string') continue;
    if (typeof raw.id === 'string' && (idCounts.get(raw.id) ?? 0) > 1) continue;
    const parent = byId.get(raw.operationalDocumentId);
    if (!parent) continue;
    const v = sanitizeVersion(raw, parent);
    if (v) sanitized.push(v);
  }

  const versions: DocumentVersion[] = [];
  for (const d of documents) {
    versions.push(
      ...rebuildVersionChain(sanitized.filter((v) => v.operationalDocumentId === d.id)),
    );
  }
  return { documents, versions };
}

export const useRoadWalletStore = create<RoadWalletState>()(
  persist(
    (set, get) => ({
      documents: [],
      versions: [],
      hydrated: false,

      addDocument: (doc) => {
        validateOperationalDocument(doc);
        if (get().documents.some((d) => d.id === doc.id)) throw new Error('duplicate document id');
        set((s) => ({ documents: [doc, ...s.documents] }));
      },

      updateDocumentMetadata: (id, patch, ctx, now = Date.now()) => {
        const existing = get().documents.find((d) => d.id === id);
        if (!existing) throw new Error('document not found');
        const next: OperationalDocument = {
          ...existing,
          ...patch,
          // Identity, ownership, lifecycle and timestamps are not patchable here.
          id: existing.id,
          accountOwnerId: existing.accountOwnerId,
          lifecycle: existing.lifecycle,
          createdAt: existing.createdAt,
          updatedAt: now,
          cloudStatus: statusAfterLocalMutation(
            ctx,
            ROAD_WALLET_CLOUD_CAPABILITY,
            existing.accountOwnerId,
          ),
        };
        validateOperationalDocument(next);
        set((s) => ({ documents: s.documents.map((d) => (d.id === id ? next : d)) }));
      },

      archiveDocument: (id, ctx, now = Date.now()) => {
        const existing = get().documents.find((d) => d.id === id);
        if (!existing) throw new Error('document not found');
        const next: OperationalDocument = {
          ...existing,
          lifecycle: 'ARCHIVED',
          updatedAt: now,
          cloudStatus: statusAfterLocalMutation(
            ctx,
            ROAD_WALLET_CLOUD_CAPABILITY,
            existing.accountOwnerId,
          ),
        };
        set((s) => ({ documents: s.documents.map((d) => (d.id === id ? next : d)) }));
      },

      restoreDocument: (id, ctx, now = Date.now()) => {
        const existing = get().documents.find((d) => d.id === id);
        if (!existing) throw new Error('document not found');
        const next: OperationalDocument = {
          ...existing,
          lifecycle: 'ACTIVE',
          updatedAt: now,
          cloudStatus: statusAfterLocalMutation(
            ctx,
            ROAD_WALLET_CLOUD_CAPABILITY,
            existing.accountOwnerId,
          ),
        };
        set((s) => ({ documents: s.documents.map((d) => (d.id === id ? next : d)) }));
      },

      setDocumentCloudStatus: (id, status) =>
        set((s) => ({
          documents: s.documents.map((d) => (d.id === id ? { ...d, cloudStatus: status } : d)),
        })),

      addVersion: (version) => {
        const document = get().documents.find((d) => d.id === version.operationalDocumentId);
        if (!document) throw new Error('document not found for version');
        validateNewVersion(version, document, get().versions);
        set((s) => ({ versions: [...s.versions, version] }));
      },

      setVersionFileCache: (id, fileCache) =>
        set((s) => ({
          versions: s.versions.map((v) => {
            if (v.id !== id) return v;
            const next = { ...v, fileCache };
            assertImmutableCoreUnchanged(v, next);
            return next;
          }),
        })),

      setVersionCloudState: (id, state) =>
        set((s) => ({
          versions: s.versions.map((v) => {
            if (v.id !== id) return v;
            const next: DocumentVersion = {
              ...v,
              cloudStatus: state.cloudStatus,
              remoteStorageBucket:
                state.remoteStorageBucket === undefined
                  ? v.remoteStorageBucket
                  : state.remoteStorageBucket,
              remoteStoragePath:
                state.remoteStoragePath === undefined
                  ? v.remoteStoragePath
                  : state.remoteStoragePath,
            };
            assertImmutableCoreUnchanged(v, next);
            return next;
          }),
        })),

      importRecoveredDocument: (doc) => {
        validateOperationalDocument(doc);
        if (doc.cloudStatus !== 'synced') throw new Error('recovered document must be synced');
        if (get().documents.some((d) => d.id === doc.id)) throw new Error('duplicate document id');
        set((s) => ({ documents: [doc, ...s.documents] }));
      },

      replaceSyncedDocumentMetadata: (remote) => {
        const local = get().documents.find((d) => d.id === remote.id);
        if (!local) throw new Error('document not found');
        if (local.cloudStatus !== 'synced') {
          throw new Error('local metadata has unsynced changes; not overwritten');
        }
        if (local.accountOwnerId !== remote.accountOwnerId) {
          throw new Error('ownership is immutable');
        }
        const next: OperationalDocument = {
          ...remote,
          id: local.id,
          accountOwnerId: local.accountOwnerId,
          createdAt: local.createdAt,
          cloudStatus: 'synced',
        };
        validateOperationalDocument(next);
        set((s) => ({ documents: s.documents.map((d) => (d.id === local.id ? next : d)) }));
      },

      reconcileCloudStatuses: (ctx) => {
        let changed = 0;
        const documents = get().documents.map((d) => {
          const next = reconcileCloudStatus(
            d.cloudStatus,
            ctx,
            ROAD_WALLET_CLOUD_CAPABILITY,
            d.accountOwnerId,
          );
          if (next === d.cloudStatus) return d;
          changed++;
          return { ...d, cloudStatus: next };
        });
        const versions = get().versions.map((v) => {
          const next = reconcileCloudStatus(
            v.cloudStatus,
            ctx,
            ROAD_WALLET_CLOUD_CAPABILITY,
            v.accountOwnerId,
          );
          if (next === v.cloudStatus) return v;
          changed++;
          return { ...v, cloudStatus: next };
        });
        if (changed > 0) set({ documents, versions });
        return changed;
      },

      clear: () => set({ documents: [], versions: [] }),
    }),
    {
      name: 'rigreceipts.roadWallet',
      version: ROAD_WALLET_PERSIST_VERSION,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ hydrated: _hydrated, ...rest }) => rest,
      migrate: (persisted) => normalizeRoadWalletState(persisted),
      merge: (persisted, current) => ({ ...current, ...normalizeRoadWalletState(persisted) }),
      onRehydrateStorage: () => () => {
        useRoadWalletStore.setState({ hydrated: true });
      },
    },
  ),
);

// ---------------------------------------------------------------------------
// Selectors (session-scoped)
// ---------------------------------------------------------------------------

type S = Pick<RoadWalletState, 'documents' | 'versions'>;

export const selectVisibleDocuments = (s: S, sessionUserId: string | null) =>
  visibleDocumentsForSession(s.documents, sessionUserId);

export const selectActiveVisibleDocuments = (s: S, sessionUserId: string | null) =>
  selectVisibleDocuments(s, sessionUserId).filter((d) => d.lifecycle === 'ACTIVE');

export const selectVersionsForDocument = (s: S, documentId: string) =>
  versionsForDocument(s.versions, documentId);

export const selectCurrentVersion = (s: S, documentId: string) =>
  currentVersion(s.versions, documentId);

export const selectDocumentById = (s: S, id: string, sessionUserId: string | null) => {
  const doc = s.documents.find((d) => d.id === id);
  return doc && doc.accountOwnerId === sessionUserId ? doc : null;
};

export const selectArchivedVisibleDocuments = (s: S, sessionUserId: string | null) =>
  selectVisibleDocuments(s, sessionUserId).filter((d) => d.lifecycle === 'ARCHIVED');

/** Real Road Wallet summary for the session — never from mock board data. */
export const selectRoadWalletSummary = (s: S, sessionUserId: string | null, now: Date) =>
  roadWalletSummary(s.documents, s.versions, sessionUserId, now);
