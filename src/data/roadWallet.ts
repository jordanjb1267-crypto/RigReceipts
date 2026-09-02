import {
  canUseFeature,
  CloudSyncContext,
  currentVersion,
  defaultOfflinePinned,
  defaultSensitivityForKind,
  defaultSubjectForKind,
  DocumentKind,
  documentKindLabel,
  DocumentVersion,
  FileCacheEntry,
  markCaching,
  markReady,
  nextVersionNumber,
  notCached,
  OperationalDocument,
  requiredSensitivityForKind,
  requiredShareConfirmation,
  Sensitivity,
  SensitiveShareConfirmation,
  shareConfirmationSatisfies,
  SubjectKind,
  syncBindingFor,
  validateSensitivityForKind,
  validateTruckAssociation,
  visibleDocumentsForSession,
} from '@/domain';
import { ROAD_WALLET_CLOUD_CAPABILITY, useRoadWalletStore } from '@/store/roadWallet';

import { currentCloudSyncContext } from './cloudSyncAuth';
import {
  DocumentFileStore,
  ExpoDocumentFileStore,
  ImportSource,
  newSecureOpaqueId,
  reverifyDocumentFile,
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
  /** Ignored for known-sensitive kinds, whose class is fixed (H5). */
  sensitivity?: Sensitivity;
  offlinePinned?: boolean;
  /**
   * Truck association with its owner so the same-owner rule can fail early
   * here; the database composite FK remains the guarantee (H4).
   */
  truck?: { id: string; ownerId: string | null } | null;
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

  // Cheap invariants first, before any file is copied.
  const truck = input.truck ?? null;
  validateTruckAssociation(binding.accountOwnerId, truck);
  const sensitivity =
    requiredSensitivityForKind(input.documentKind) ??
    input.sensitivity ??
    defaultSensitivityForKind(input.documentKind);
  validateSensitivityForKind(input.documentKind, sensitivity);

  // Import + physical verification: a failure here creates nothing.
  const stored = await deps.fileStore.importFile(source, { documentId, versionId });

  const document: OperationalDocument = {
    id: documentId,
    accountOwnerId: binding.accountOwnerId,
    documentKind: input.documentKind,
    subjectKind: input.subjectKind ?? defaultSubjectForKind(input.documentKind),
    truckId: truck?.id ?? null,
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
    // Internal, narrow rollback of the records generated in THIS call only;
    // it can never touch a committed or synced historical version.
    useRoadWalletStore.setState((s) => ({
      documents: s.documents.filter((d) => !(d.id === documentId && d.cloudStatus !== 'synced')),
      versions: s.versions.filter((v) => !(v.id === versionId && v.cloudStatus !== 'synced')),
    }));
    await deps.fileStore.remove(stored.relativePath).catch(() => {});
    throw err;
  }
  return { document, version };
}

// ---------------------------------------------------------------------------
// Current-runtime readiness refresh (Pass 1B)
// ---------------------------------------------------------------------------

export interface ReadinessRefreshResult {
  checked: number;
  ready: number;
  errored: number;
}

let readinessInFlight: Promise<ReadinessRefreshResult> | null = null;

/**
 * Re-verifies the CURRENT version's physical file for every ACTIVE document
 * visible in this session, against the immutable version's SHA-256 and kind.
 * Only `fileCache` changes — never the immutable evidence, never a new version.
 * Concurrent calls coalesce onto the in-flight run.
 */
export function refreshRoadWalletReadinessForSession(
  sessionUserId: string | null,
  deps: Pick<RoadWalletDeps, 'fileStore' | 'now'> = defaultRoadWalletDeps(),
): Promise<ReadinessRefreshResult> {
  if (readinessInFlight) return readinessInFlight;
  readinessInFlight = (async () => {
    const result: ReadinessRefreshResult = { checked: 0, ready: 0, errored: 0 };
    try {
      const state = useRoadWalletStore.getState();
      const docs = visibleDocumentsForSession(state.documents, sessionUserId).filter(
        (d) => d.lifecycle === 'ACTIVE',
      );
      for (const doc of docs) {
        const current = currentVersion(useRoadWalletStore.getState().versions, doc.id);
        if (!current) continue;
        await refreshVersionReadiness(current, deps);
        result.checked++;
        const after = useRoadWalletStore.getState().versions.find((v) => v.id === current.id);
        if (after?.fileCache.state === 'READY') result.ready++;
        else result.errored++;
      }
      return result;
    } finally {
      readinessInFlight = null;
    }
  })();
  return readinessInFlight;
}

/** Re-verifies one version's physical file and records the result on its cache. */
export async function refreshVersionReadiness(
  version: DocumentVersion,
  deps: Pick<RoadWalletDeps, 'fileStore' | 'now'> = defaultRoadWalletDeps(),
): Promise<FileCacheEntry> {
  const entry = await reverifyDocumentFile(
    deps.fileStore,
    {
      ...version.fileCache,
      relativePath: version.relativePath,
      sha256: version.sha256,
      byteSize: version.byteSize,
      mimeType: version.mimeType,
    },
    version.fileKind,
    deps.now,
  );
  useRoadWalletStore.getState().setVersionFileCache(version.id, entry);
  return entry;
}

/** Re-verifies the current version of one document (Document Detail open). */
export async function refreshDocumentReadiness(
  documentId: string,
  deps: Pick<RoadWalletDeps, 'fileStore' | 'now'> = defaultRoadWalletDeps(),
): Promise<FileCacheEntry | null> {
  const current = currentVersion(useRoadWalletStore.getState().versions, documentId);
  if (!current) return null;
  return refreshVersionReadiness(current, deps);
}

// ---------------------------------------------------------------------------
// Share / Export effect boundary (Pass 1B)
// ---------------------------------------------------------------------------

export type ShareDenialReason =
  | 'NOT_FOUND'
  | 'NOT_VISIBLE'
  | 'ARCHIVED'
  | 'NO_VERSION'
  | 'NOT_ENTITLED'
  | 'CONFIRMATION_REQUIRED'
  | 'FILE_UNAVAILABLE'
  | 'SHARE_UNAVAILABLE';

export class ShareDeniedError extends Error {
  readonly reason: ShareDenialReason;
  /** Verification failure detail when `reason` is FILE_UNAVAILABLE. */
  readonly fileError: FileCacheEntry['error'];

  constructor(reason: ShareDenialReason, fileError: FileCacheEntry['error'] = null) {
    super(`share denied: ${reason}${fileError ? ` (${fileError})` : ''}`);
    this.name = 'ShareDeniedError';
    this.reason = reason;
    this.fileError = fileError;
  }
}

export interface ShareDocumentVersionInput {
  documentId: string;
  /** Defaults to the current version. */
  versionId?: string;
  /** Explicit user acknowledgement for PERSONAL / FINANCIAL sensitive documents. */
  sensitiveConfirmation: SensitiveShareConfirmation;
}

export interface ShareDeps extends Pick<RoadWalletDeps, 'fileStore' | 'ctx' | 'now'> {
  /** Called immediately before the share effect; lets tests observe the late re-check. */
  beforeShare?: () => void;
}

const assertShareAuthorized = (ctx: CloudSyncContext, doc: OperationalDocument): void => {
  if (doc.accountOwnerId !== ctx.userId) throw new ShareDeniedError('NOT_VISIBLE');
  if (!canUseFeature(ctx.tier, 'documentShareExport')) throw new ShareDeniedError('NOT_ENTITLED');
};

/**
 * The only path that may open the platform share sheet for a Road Wallet file.
 * A path existing is never enough:
 *   1. resolve the CURRENT session;
 *   2. the document must be visible in this session (and not archived);
 *   3. resolve the exact version (default: current);
 *   4. the current tier must permit `documentShareExport`;
 *   5. re-verify the physical file against the version's immutable SHA-256 + kind;
 *   6. record the fresh verification on `fileCache`;
 *   7. the platform share capability must be available;
 *   8. immediately before the effect: re-check ownership and entitlement;
 *   9. `DocumentFileStore.share()`.
 * Non-STANDARD documents additionally require the matching explicit confirmation.
 */
export async function shareOperationalDocumentVersion(
  input: ShareDocumentVersionInput,
  deps: ShareDeps = defaultRoadWalletDeps(),
): Promise<{ versionId: string; mimeType: string }> {
  const ctx = deps.ctx();
  const state = useRoadWalletStore.getState();
  const doc = state.documents.find((d) => d.id === input.documentId);
  if (!doc) throw new ShareDeniedError('NOT_FOUND');
  assertShareAuthorized(ctx, doc);
  if (doc.lifecycle === 'ARCHIVED') throw new ShareDeniedError('ARCHIVED');

  const version = input.versionId
    ? (state.versions.find((v) => v.id === input.versionId && v.operationalDocumentId === doc.id) ??
      null)
    : currentVersion(state.versions, doc.id);
  if (!version) throw new ShareDeniedError('NO_VERSION');

  const required = requiredShareConfirmation(doc.sensitivity);
  if (!shareConfirmationSatisfies(input.sensitiveConfirmation, required)) {
    throw new ShareDeniedError('CONFIRMATION_REQUIRED');
  }

  const verified = await refreshVersionReadiness(version, deps);
  if (verified.state !== 'READY') throw new ShareDeniedError('FILE_UNAVAILABLE', verified.error);

  const capability = await deps.fileStore.shareCapability();
  if (!capability.available) throw new ShareDeniedError('SHARE_UNAVAILABLE');

  // Late re-check: ownership and entitlement may have changed while verifying.
  deps.beforeShare?.();
  assertShareAuthorized(deps.ctx(), doc);

  await deps.fileStore.share(version.relativePath, {
    mimeType: version.mimeType,
    dialogTitle: `${documentKindLabel(doc.documentKind)} — version ${version.versionNumber}`,
  });
  return { versionId: version.id, mimeType: version.mimeType };
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
