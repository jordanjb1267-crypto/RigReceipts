import {
  CloudSyncContext,
  currentVersion,
  defaultOfflinePinned,
  defaultSensitivityForKind,
  defaultSubjectForKind,
  DocumentKind,
  DocumentVersion,
  markCaching,
  markReady,
  nextVersionNumber,
  notCached,
  OperationalDocument,
  Sensitivity,
  SubjectKind,
  syncBindingFor,
} from '@/domain';
import { ROAD_WALLET_CLOUD_CAPABILITY, useRoadWalletStore } from '@/store/roadWallet';

import { currentCloudSyncContext } from './cloudSyncAuth';
import {
  DocumentFileStore,
  ExpoDocumentFileStore,
  ImportSource,
  newSecureOpaqueId,
  StoredDocumentFile,
} from './documentFiles';

/**
 * Road Wallet create / replace orchestration (Refinement Pass 1A).
 *
 * UI never coordinates ids, file copies, hashing, version numbering or store
 * writes itself. Both operations are local-only (no network) and truthful:
 * a failed import or verification produces no document/version record, and a
 * failed store commit after a copy removes the orphaned file best-effort.
 */

export interface NewOperationalDocumentInput {
  documentKind: DocumentKind;
  title: string;
  subjectKind?: SubjectKind;
  sensitivity?: Sensitivity;
  offlinePinned?: boolean;
  truckId?: string | null;
  trailerNumber?: string | null;
  issuer?: string | null;
  jurisdiction?: string | null;
  issuedAt?: string | null;
  effectiveAt?: string | null;
  expiresAt?: string | null;
  /** Must already be masked (`****1234`); raw identifiers are rejected by the store. */
  maskedReference?: string | null;
}

export interface RoadWalletDeps {
  fileStore: DocumentFileStore;
  ctx: () => CloudSyncContext;
  now: () => number;
  newId: () => string;
}

let defaultFileStore: DocumentFileStore | null = null;

/**
 * Overrides the process-wide file store (tests inject `MemoryDocumentFileStore`).
 * Production leaves this untouched and gets `ExpoDocumentFileStore` lazily.
 */
export function configureRoadWalletFileStore(store: DocumentFileStore | null): void {
  defaultFileStore = store;
}

export function roadWalletFileStore(): DocumentFileStore {
  if (!defaultFileStore) defaultFileStore = new ExpoDocumentFileStore();
  return defaultFileStore;
}

export function defaultRoadWalletDeps(): RoadWalletDeps {
  return {
    fileStore: roadWalletFileStore(),
    ctx: currentCloudSyncContext,
    now: Date.now,
    newId: newSecureOpaqueId,
  };
}

export interface CreatedDocument {
  document: OperationalDocument;
  version: DocumentVersion;
}

function buildVersion(
  stored: StoredDocumentFile,
  args: {
    id: string;
    documentId: string;
    accountOwnerId: string | null;
    versionNumber: number;
    supersedesVersionId: string | null;
    cloudStatus: DocumentVersion['cloudStatus'];
    now: number;
  },
): DocumentVersion {
  const verified = {
    ok: true as const,
    byteSize: stored.byteSize,
    sha256: stored.sha256,
    kind: stored.kind,
  };
  return {
    id: args.id,
    operationalDocumentId: args.documentId,
    accountOwnerId: args.accountOwnerId,
    versionNumber: args.versionNumber,
    supersedesVersionId: args.supersedesVersionId,
    fileKind: stored.kind,
    mimeType: stored.mimeType,
    extension: stored.ext,
    byteSize: stored.byteSize,
    sha256: stored.sha256,
    relativePath: stored.relativePath,
    fileCache: markReady(
      markCaching(notCached(), stored.relativePath),
      verified,
      stored.mimeType,
      args.now,
    ),
    cloudStatus: args.cloudStatus,
    remoteStorageBucket: null,
    remoteStoragePath: null,
    createdAt: args.now,
  };
}

/**
 * Creates a logical document and its version 1 from a source file.
 * Order: ids → durable private copy + verification → local records.
 */
export async function createOperationalDocumentFromFile(
  source: ImportSource,
  input: NewOperationalDocumentInput,
  deps: RoadWalletDeps = defaultRoadWalletDeps(),
): Promise<CreatedDocument> {
  const ctx = deps.ctx();
  const binding = syncBindingFor(ctx, ROAD_WALLET_CLOUD_CAPABILITY);
  const documentId = deps.newId();
  const versionId = deps.newId();
  const now = deps.now();

  // Import + physical verification first: a failure here creates nothing.
  const stored = await deps.fileStore.importFile(source, { documentId, versionId });

  const sensitivity = input.sensitivity ?? defaultSensitivityForKind(input.documentKind);
  const document: OperationalDocument = {
    id: documentId,
    accountOwnerId: binding.accountOwnerId,
    documentKind: input.documentKind,
    subjectKind: input.subjectKind ?? defaultSubjectForKind(input.documentKind),
    truckId: input.truckId ?? null,
    trailerNumber: input.trailerNumber ?? null,
    title: input.title.trim(),
    issuer: input.issuer ?? null,
    jurisdiction: input.jurisdiction ?? null,
    issuedAt: input.issuedAt ?? null,
    effectiveAt: input.effectiveAt ?? null,
    expiresAt: input.expiresAt ?? null,
    maskedReference: input.maskedReference ?? null,
    sensitivity,
    lifecycle: 'ACTIVE',
    offlinePinned: input.offlinePinned ?? defaultOfflinePinned(sensitivity),
    cloudStatus: binding.status,
    createdAt: now,
    updatedAt: now,
  };
  const version = buildVersion(stored, {
    id: versionId,
    documentId,
    accountOwnerId: binding.accountOwnerId,
    versionNumber: 1,
    supersedesVersionId: null,
    cloudStatus: binding.status,
    now,
  });

  const store = useRoadWalletStore.getState();
  try {
    store.addDocument(document);
    store.addVersion(version);
  } catch (err) {
    // Roll back to a truthful state: no half-created document, no orphan file.
    useRoadWalletStore.setState((s) => ({
      documents: s.documents.filter((d) => d.id !== documentId),
      versions: s.versions.filter((v) => v.id !== versionId),
    }));
    await deps.fileStore.remove(stored.relativePath).catch(() => {});
    throw err;
  }
  return { document, version };
}

/**
 * Replaces the current file of an existing document with a brand-new
 * immutable version N+1 that supersedes the prior current version. The prior
 * version and its file evidence are left untouched.
 */
export async function replaceOperationalDocumentFile(
  documentId: string,
  source: ImportSource,
  deps: RoadWalletDeps = defaultRoadWalletDeps(),
): Promise<DocumentVersion> {
  const ctx = deps.ctx();
  const state = useRoadWalletStore.getState();
  const document = state.documents.find((d) => d.id === documentId);
  if (!document) throw new Error('document not found');
  if (document.accountOwnerId !== ctx.userId) {
    throw new Error('document is not visible in this session');
  }
  const prior = currentVersion(state.versions, documentId);
  if (!prior) throw new Error('document has no current version');

  const binding = syncBindingFor(ctx, ROAD_WALLET_CLOUD_CAPABILITY);
  const versionId = deps.newId();
  const now = deps.now();
  const stored = await deps.fileStore.importFile(source, { documentId, versionId });

  const version = buildVersion(stored, {
    id: versionId,
    documentId,
    accountOwnerId: document.accountOwnerId,
    versionNumber: nextVersionNumber(state.versions, documentId),
    supersedesVersionId: prior.id,
    cloudStatus: binding.status,
    now,
  });

  try {
    useRoadWalletStore.getState().addVersion(version);
  } catch (err) {
    await deps.fileStore.remove(stored.relativePath).catch(() => {});
    throw err;
  }
  return version;
}
