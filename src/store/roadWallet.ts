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
  DocumentVersion,
  FileCacheEntry,
  isOpaqueId,
  OperationalDocument,
  OperationalDocumentPatch,
  reconcileCloudStatus,
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
  /** Removes a version's local file evidence only when the import failed (no READY record). */
  removeVersion: (id: string) => void;
  clear: () => void;
}

const isEnum = (values: readonly string[], v: unknown): boolean =>
  typeof v === 'string' && values.includes(v);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Keeps only structurally sound documents; malformed entries are dropped, never thrown. */
function sanitizeDocument(raw: unknown): OperationalDocument | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== 'string' || !isOpaqueId(raw.id)) return null;
  if (!isEnum(DOCUMENT_KINDS, raw.documentKind)) return null;
  if (!isEnum(SUBJECT_KINDS, raw.subjectKind)) return null;
  if (!isEnum(SENSITIVITIES, raw.sensitivity)) return null;
  if (typeof raw.title !== 'string') return null;
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  const num = (v: unknown, fallback: number) => (typeof v === 'number' ? v : fallback);
  const status: CloudSyncStatus = raw.cloudStatus === 'synced' ? 'synced' : 'local_only';
  const doc: OperationalDocument = {
    id: raw.id,
    accountOwnerId: str(raw.accountOwnerId),
    documentKind: raw.documentKind as OperationalDocument['documentKind'],
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
    sensitivity: raw.sensitivity as OperationalDocument['sensitivity'],
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

function sanitizeVersion(raw: unknown): DocumentVersion | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== 'string' || !isOpaqueId(raw.id)) return null;
  if (typeof raw.operationalDocumentId !== 'string' || !isOpaqueId(raw.operationalDocumentId)) {
    return null;
  }
  if (typeof raw.versionNumber !== 'number' || typeof raw.sha256 !== 'string') return null;
  if (typeof raw.byteSize !== 'number' || typeof raw.relativePath !== 'string') return null;
  if (typeof raw.mimeType !== 'string' || typeof raw.extension !== 'string') return null;
  const fileKind = raw.fileKind;
  if (fileKind !== 'IMAGE' && fileKind !== 'PDF' && fileKind !== 'OTHER') return null;
  const cache = isRecord(raw.fileCache) ? raw.fileCache : {};
  const cacheState = cache.state;
  const fileCache: FileCacheEntry = {
    // A persisted READY claim is not trusted blindly; re-verification restores it.
    state: cacheState === 'READY' ? 'READY' : 'NOT_CACHED',
    relativePath: typeof cache.relativePath === 'string' ? cache.relativePath : raw.relativePath,
    mimeType: typeof cache.mimeType === 'string' ? cache.mimeType : raw.mimeType,
    byteSize: typeof cache.byteSize === 'number' ? cache.byteSize : raw.byteSize,
    sha256: typeof cache.sha256 === 'string' ? cache.sha256 : raw.sha256,
    error: null,
    verifiedAt: typeof cache.verifiedAt === 'number' ? cache.verifiedAt : null,
  };
  return {
    id: raw.id,
    operationalDocumentId: raw.operationalDocumentId,
    accountOwnerId: typeof raw.accountOwnerId === 'string' ? raw.accountOwnerId : null,
    versionNumber: raw.versionNumber,
    supersedesVersionId:
      typeof raw.supersedesVersionId === 'string' ? raw.supersedesVersionId : null,
    fileKind,
    mimeType: raw.mimeType,
    extension: raw.extension,
    byteSize: raw.byteSize,
    sha256: raw.sha256,
    relativePath: raw.relativePath,
    fileCache,
    cloudStatus: raw.cloudStatus === 'synced' ? 'synced' : 'local_only',
    remoteStorageBucket: raw.remoteStorageBucket === 'documents' ? 'documents' : null,
    remoteStoragePath: typeof raw.remoteStoragePath === 'string' ? raw.remoteStoragePath : null,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0,
  };
}

/** Normalizes any persisted shape; never throws. Versions without a document are dropped. */
export function normalizeRoadWalletState(persisted: unknown): {
  documents: OperationalDocument[];
  versions: DocumentVersion[];
} {
  const state = isRecord(persisted) ? persisted : {};
  const documents = (Array.isArray(state.documents) ? state.documents : [])
    .map(sanitizeDocument)
    .filter((d): d is OperationalDocument => d !== null);
  const docIds = new Set(documents.map((d) => d.id));
  const versions = (Array.isArray(state.versions) ? state.versions : [])
    .map(sanitizeVersion)
    .filter((v): v is DocumentVersion => v !== null && docIds.has(v.operationalDocumentId));
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

      removeVersion: (id) => set((s) => ({ versions: s.versions.filter((v) => v.id !== id) })),

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
