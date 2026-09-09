import {
  CloudSyncStatus,
  authorizeCloudSync,
  CloudSyncContext,
  CloudSyncDecision,
  statusAfterLocalMutation,
} from './cloudSync';
import { DocumentFileKind, FileCacheEntry, isOpaqueId } from './documentFiles';
import { canUseFeature } from './entitlements';
import {
  currentVersion,
  deriveValidity,
  DocumentKind,
  documentKindLabel,
  isVisibleInSession,
  OperationalDocument,
  DocumentVersion,
  ValidityState,
} from './operationalDocuments';

/**
 * Quick Present — in-person presentation of Road Wallet documents (Pass 2).
 *
 * A PresentationSet is a named list of *logical* OperationalDocument ids.
 * A PresentationSession is an ephemeral exact-version snapshot built after a
 * fresh preflight. Sessions are never persisted and never written to Supabase.
 *
 * Quick Present does not create legal authority, send files, email, portal-
 * submit, or sign. FINANCIAL_SENSITIVE documents are prohibited from every
 * set and every session. LoadDocument / BOL / POD never appear here.
 */

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export const SYSTEM_PRESENTATION_SET_CODES = ['ROADSIDE', 'SHIPPER'] as const;
export type SystemPresentationSetCode = (typeof SYSTEM_PRESENTATION_SET_CODES)[number];

export const SYSTEM_PRESENTATION_SET_KIND: Record<
  SystemPresentationSetCode,
  'SYSTEM_ROADSIDE' | 'SYSTEM_SHIPPER'
> = {
  ROADSIDE: 'SYSTEM_ROADSIDE',
  SHIPPER: 'SYSTEM_SHIPPER',
};

export const PRESENTATION_SET_KINDS = ['SYSTEM_ROADSIDE', 'SYSTEM_SHIPPER', 'CUSTOM'] as const;
export type PresentationSetKind = (typeof PRESENTATION_SET_KINDS)[number];

export const PRESENTATION_SET_LIFECYCLES = ['ACTIVE', 'ARCHIVED'] as const;
export type PresentationSetLifecycle = (typeof PRESENTATION_SET_LIFECYCLES)[number];

export const PRESENTATION_SET_NAME_MAX = 80;

/**
 * Product defaults for the built-in Roadside set. These are suggested from
 * documents already in the wallet — never a legal requirements list.
 */
export const ROADSIDE_CANDIDATE_KINDS: readonly DocumentKind[] = [
  'CDL',
  'MEDICAL_DOCUMENT',
  'VEHICLE_REGISTRATION',
  'TRAILER_REGISTRATION',
  'IRP_CAB_CARD',
  'ANNUAL_INSPECTION',
  'INSURANCE',
  'IFTA',
  'OPERATING_PERMIT',
];

/** Product defaults for the built-in Shipper set. Operational/identity only. */
export const SHIPPER_CANDIDATE_KINDS: readonly DocumentKind[] = [
  'CDL',
  'TWIC',
  'CERTIFICATE_OF_INSURANCE',
  'INSURANCE',
];

export const QUICK_PRESENT_DISCLAIMER =
  'Digital copies may not satisfy every roadside, regulatory, customer or facility requirement. Carry originals where required.';

export const PRESENTATION_SET_CANDIDATE_COPY =
  'Suggested from the documents in your wallet. These are not required documents.';

export const PERSONAL_PRESENT_ACK_COPY = {
  title: 'Present a personal document?',
  body: 'This set includes a personal-sensitive document (for example a CDL, medical card or TWIC). Confirm you intend to show it in person. Quick Present does not share, email or submit the file.',
  confirm: 'I understand — present',
} as const;

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export interface PresentationSet {
  id: string;
  accountOwnerId: string | null;
  setKind: PresentationSetKind;
  name: string;
  lifecycle: PresentationSetLifecycle;
  cloudStatus: CloudSyncStatus;
  createdAt: number;
  updatedAt: number;
}

export interface PresentationSetItem {
  id: string;
  presentationSetId: string;
  accountOwnerId: string | null;
  /** Logical OperationalDocument id — never a version id. */
  operationalDocumentId: string;
  position: number;
  included: boolean;
}

export type PresentationSetPatch = Partial<Pick<PresentationSet, 'name' | 'lifecycle'>>;

export interface RemotePresentationSetRow {
  id: string;
  owner_id: string;
  set_kind: 'CUSTOM';
  name: string;
  lifecycle: PresentationSetLifecycle;
  created_at: string;
  updated_at: string;
}

export interface RemotePresentationSetItemRow {
  id: string;
  owner_id: string;
  presentation_set_id: string;
  operational_document_id: string;
  position: number;
  included: boolean;
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

/** FINANCIAL_SENSITIVE is prohibited from Quick Present (known kinds + CUSTOM). */
export function isFinancialBlockedFromQuickPresent(doc: OperationalDocument): boolean {
  return doc.sensitivity === 'FINANCIAL_SENSITIVE';
}

/**
 * A document may be selected into a set / session when it is ACTIVE, visible
 * in this session, and not financial-sensitive. Later archive/financial/
 * missing is reported at preflight — the stored set is not silently rewritten.
 */
export function isQuickPresentEligibleDocument(
  doc: OperationalDocument,
  sessionUserId: string | null,
): boolean {
  return (
    isVisibleInSession(doc, sessionUserId) &&
    doc.lifecycle === 'ACTIVE' &&
    !isFinancialBlockedFromQuickPresent(doc)
  );
}

export function systemSetLabel(code: SystemPresentationSetCode): string {
  return code === 'ROADSIDE' ? 'Roadside' : 'Shipper';
}

export function systemCandidateKinds(code: SystemPresentationSetCode): readonly DocumentKind[] {
  return code === 'ROADSIDE' ? ROADSIDE_CANDIDATE_KINDS : SHIPPER_CANDIDATE_KINDS;
}

/**
 * Suggests logical document ids already in the wallet that match a system set
 * and are eligible. Order follows the product candidate list, then title.
 * Never includes FINANCIAL_SENSITIVE, archived, or another owner's documents.
 */
export function suggestSystemSetItems(
  code: SystemPresentationSetCode,
  documents: OperationalDocument[],
  sessionUserId: string | null,
): OperationalDocument[] {
  const kinds = systemCandidateKinds(code);
  const eligible = documents.filter(
    (d) => isQuickPresentEligibleDocument(d, sessionUserId) && kinds.includes(d.documentKind),
  );
  const rank = new Map(kinds.map((k, i) => [k, i]));
  return [...eligible].sort((a, b) => {
    const ra = rank.get(a.documentKind) ?? 99;
    const rb = rank.get(b.documentKind) ?? 99;
    if (ra !== rb) return ra - rb;
    return a.title.localeCompare(b.title);
  });
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const isEnum = (values: readonly string[], v: unknown): boolean =>
  typeof v === 'string' && values.includes(v);

export function validatePresentationSetName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > PRESENTATION_SET_NAME_MAX) {
    throw new Error(`presentation set name must be 1–${PRESENTATION_SET_NAME_MAX} characters`);
  }
  return trimmed;
}

export function validatePresentationSet(set: PresentationSet): void {
  if (!isOpaqueId(set.id)) throw new Error('presentation set id is not an opaque id');
  if (set.accountOwnerId !== null && typeof set.accountOwnerId !== 'string') {
    throw new Error('invalid account owner');
  }
  if (!isEnum(PRESENTATION_SET_KINDS, set.setKind)) throw new Error('unknown set kind');
  // Persisted / synced sets are CUSTOM only. System kinds exist for ephemeral
  // review objects and are never written to the store or Supabase.
  if (set.setKind !== 'CUSTOM' && set.cloudStatus !== 'local_only') {
    throw new Error('system presentation sets are not persisted');
  }
  validatePresentationSetName(set.name);
  if (!isEnum(PRESENTATION_SET_LIFECYCLES, set.lifecycle)) throw new Error('unknown lifecycle');
  if (set.cloudStatus !== 'local_only' && set.cloudStatus !== 'pending_sync' && set.cloudStatus !== 'synced') {
    throw new Error('unknown cloud status');
  }
  if (typeof set.createdAt !== 'number' || typeof set.updatedAt !== 'number') {
    throw new Error('timestamps required');
  }
}

export function validatePresentationSetItem(item: PresentationSetItem): void {
  if (!isOpaqueId(item.id)) throw new Error('presentation set item id is not an opaque id');
  if (!isOpaqueId(item.presentationSetId)) throw new Error('presentation set id is not an opaque id');
  if (!isOpaqueId(item.operationalDocumentId)) {
    throw new Error('operational document id is not an opaque id');
  }
  if (item.accountOwnerId !== null && typeof item.accountOwnerId !== 'string') {
    throw new Error('invalid account owner');
  }
  if (
    typeof item.position !== 'number' ||
    !Number.isInteger(item.position) ||
    !Number.isSafeInteger(item.position) ||
    item.position < 0
  ) {
    throw new Error('position must be a safe integer ≥ 0');
  }
  if (typeof item.included !== 'boolean') throw new Error('included must be boolean');
}

// ---------------------------------------------------------------------------
// Cloud authorization helpers (savedPresentationSets ∩ cloudDocumentBackup)
// ---------------------------------------------------------------------------

/**
 * Custom-set *mutation* entitlement. Distinct from cloud write: Free cannot
 * create/edit/archive even locally. Downgrade does not delete existing data.
 */
export function canMutateCustomPresentationSets(tier: CloudSyncContext['tier']): boolean {
  return canUseFeature(tier, 'savedPresentationSets');
}

/**
 * Cloud write of custom-set metadata requires both product entitlement and
 * the Road Wallet backup capability. Recovery is not gated by either.
 */
export function authorizePresentationSetCloudWrite(
  ctx: CloudSyncContext,
  contentOwnerId: string | null | undefined,
): CloudSyncDecision {
  if (!canMutateCustomPresentationSets(ctx.tier)) {
    return { allowed: false, userId: null, reason: 'not_entitled' };
  }
  return authorizeCloudSync(ctx, 'cloudDocumentBackup', contentOwnerId);
}

export function presentationSetStatusAfterMutation(
  ctx: CloudSyncContext,
  contentOwnerId: string | null | undefined,
): Extract<CloudSyncStatus, 'local_only' | 'pending_sync'> {
  if (!canMutateCustomPresentationSets(ctx.tier)) return 'local_only';
  return statusAfterLocalMutation(ctx, 'cloudDocumentBackup', contentOwnerId);
}

export function reconcilePresentationSetCloudStatus(
  current: CloudSyncStatus,
  ctx: CloudSyncContext,
  contentOwnerId: string | null | undefined,
): CloudSyncStatus {
  if (current === 'synced') return 'synced';
  return authorizePresentationSetCloudWrite(ctx, contentOwnerId).allowed
    ? 'pending_sync'
    : 'local_only';
}

// ---------------------------------------------------------------------------
// Remote mapping
// ---------------------------------------------------------------------------

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isoToMs = (v: unknown): number | null => {
  if (typeof v !== 'string') return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
};
const isSafeNonNegativeInteger = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && Number.isSafeInteger(v) && v >= 0;

export function toRemotePresentationSetRow(
  set: PresentationSet,
  ownerId: string,
): RemotePresentationSetRow {
  return {
    id: set.id,
    owner_id: ownerId,
    set_kind: 'CUSTOM',
    name: set.name,
    lifecycle: set.lifecycle,
    created_at: new Date(set.createdAt).toISOString(),
    updated_at: new Date(set.updatedAt).toISOString(),
  };
}

export function toRemotePresentationSetItemRow(
  item: PresentationSetItem,
  ownerId: string,
): RemotePresentationSetItemRow {
  return {
    id: item.id,
    owner_id: ownerId,
    presentation_set_id: item.presentationSetId,
    operational_document_id: item.operationalDocumentId,
    position: item.position,
    included: item.included,
  };
}

export function fromRemotePresentationSetRow(
  row: unknown,
  sessionUserId: string,
): PresentationSet | null {
  if (!isRec(row)) return null;
  if (typeof row.id !== 'string' || !isOpaqueId(row.id)) return null;
  if (row.owner_id !== sessionUserId) return null;
  if (row.set_kind !== 'CUSTOM') return null;
  if (typeof row.name !== 'string') return null;
  if (!isEnum(PRESENTATION_SET_LIFECYCLES, row.lifecycle)) return null;
  const createdAt = isoToMs(row.created_at);
  const updatedAt = isoToMs(row.updated_at);
  if (createdAt === null || updatedAt === null) return null;
  let name: string;
  try {
    name = validatePresentationSetName(row.name);
  } catch {
    return null;
  }
  const set: PresentationSet = {
    id: row.id,
    accountOwnerId: sessionUserId,
    setKind: 'CUSTOM',
    name,
    lifecycle: row.lifecycle as PresentationSetLifecycle,
    cloudStatus: 'synced',
    createdAt,
    updatedAt,
  };
  try {
    validatePresentationSet(set);
  } catch {
    return null;
  }
  return set;
}

export function fromRemotePresentationSetItemRow(
  row: unknown,
  sessionUserId: string,
  parent: PresentationSet,
): PresentationSetItem | null {
  if (!isRec(row)) return null;
  if (typeof row.id !== 'string' || !isOpaqueId(row.id)) return null;
  if (row.owner_id !== sessionUserId) return null;
  if (parent.accountOwnerId !== sessionUserId) return null;
  if (row.presentation_set_id !== parent.id) return null;
  if (typeof row.operational_document_id !== 'string' || !isOpaqueId(row.operational_document_id)) {
    return null;
  }
  if (!isSafeNonNegativeInteger(row.position)) return null;
  if (typeof row.included !== 'boolean') return null;
  const item: PresentationSetItem = {
    id: row.id,
    presentationSetId: parent.id,
    accountOwnerId: sessionUserId,
    operationalDocumentId: row.operational_document_id,
    position: row.position,
    included: row.included,
  };
  try {
    validatePresentationSetItem(item);
  } catch {
    return null;
  }
  return item;
}

// ---------------------------------------------------------------------------
// Merge (same shape as Road Wallet metadata)
// ---------------------------------------------------------------------------

export type PresentationSetMergeAction =
  'import' | 'keep_local' | 'replace_metadata' | 'keep_synced_local';

export function mergeRecoveredPresentationSet(
  local: PresentationSet | undefined,
  remote: PresentationSet,
): { action: PresentationSetMergeAction; set: PresentationSet } {
  if (!local) return { action: 'import', set: { ...remote, cloudStatus: 'synced' } };
  if (local.accountOwnerId !== remote.accountOwnerId) {
    throw new Error('ownership is immutable');
  }
  if (local.cloudStatus === 'pending_sync' || local.cloudStatus === 'local_only') {
    return { action: 'keep_local', set: local };
  }
  if (remote.updatedAt > local.updatedAt) {
    return {
      action: 'replace_metadata',
      set: {
        ...remote,
        id: local.id,
        accountOwnerId: local.accountOwnerId,
        createdAt: local.createdAt,
        cloudStatus: 'synced',
      },
    };
  }
  return { action: 'keep_synced_local', set: local };
}

export interface PresentationSetRecoveryResult {
  setsRecovered: number;
  itemsRecovered: number;
  integrityConflicts: number;
  skippedLocalChanges: number;
  outcome: 'completed' | 'signed_out' | 'not_configured' | 'cancelled' | 'fetch_failed';
}

export const emptyPresentationSetRecoveryResult = (
  outcome: PresentationSetRecoveryResult['outcome'] = 'completed',
): PresentationSetRecoveryResult => ({
  setsRecovered: 0,
  itemsRecovered: 0,
  integrityConflicts: 0,
  skippedLocalChanges: 0,
  outcome,
});

export const finalizePresentationSetRecovery = (
  result: PresentationSetRecoveryResult,
): PresentationSetRecoveryResult => result;

/** Pass 2.1 H2 — set writes need their own completed, conflict-free recovery. */
export function writeSafeFromSetRecovery(
  result: PresentationSetRecoveryResult | null | undefined,
): boolean {
  return !!result && result.outcome === 'completed' && result.integrityConflicts === 0;
}

/**
 * Stable membership identity for one set + document (Pass 2.1 H1).
 * Selected documents keep/create an included=true row; omitted documents keep
 * their existing row as included=false. Never mints a replacement id for
 * reorder, remove, or re-add.
 */
export function applySelectionToMembership(
  existing: PresentationSetItem[],
  selectedDocumentIds: string[],
  set: PresentationSet,
  newId: () => string,
): PresentationSetItem[] {
  const byDoc = new Map<string, PresentationSetItem>();
  for (const item of existing) {
    if (item.presentationSetId !== set.id) continue;
    if (!byDoc.has(item.operationalDocumentId)) byDoc.set(item.operationalDocumentId, item);
  }
  const seen = new Set<string>();
  const next: PresentationSetItem[] = [];
  let position = 0;
  for (const docId of selectedDocumentIds) {
    if (seen.has(docId)) continue;
    seen.add(docId);
    const prev = byDoc.get(docId);
    if (prev) {
      next.push({
        ...prev,
        accountOwnerId: set.accountOwnerId,
        included: true,
        position,
      });
    } else {
      next.push({
        id: newId(),
        presentationSetId: set.id,
        accountOwnerId: set.accountOwnerId,
        operationalDocumentId: docId,
        position,
        included: true,
      });
    }
    position++;
  }
  for (const [docId, prev] of byDoc) {
    if (seen.has(docId)) continue;
    next.push({
      ...prev,
      accountOwnerId: set.accountOwnerId,
      included: false,
    });
  }
  return next;
}

// ---------------------------------------------------------------------------
// Preflight (pure evaluation of an already-reverified cache)
// ---------------------------------------------------------------------------

export const PREFLIGHT_ITEM_STATES = [
  'READY',
  'NO_VERSION',
  'NOT_CACHED',
  'MISSING_FILE',
  'UNREADABLE',
  'HASH_MISMATCH',
  'CONTENT_MISMATCH',
  'ARCHIVED',
  'NOT_VISIBLE',
  'FINANCIAL_BLOCKED',
  'PDF_EXTERNAL_ONLY',
] as const;
export type PreflightItemState = (typeof PREFLIGHT_ITEM_STATES)[number];

export const PREFLIGHT_OVERALL_STATES = ['EMPTY', 'READY', 'PARTIAL'] as const;
export type PreflightOverall = (typeof PREFLIGHT_OVERALL_STATES)[number];

export interface PreflightItem {
  logicalDocumentId: string;
  title: string;
  documentKind: DocumentKind;
  state: PreflightItemState;
  exactVersionId: string | null;
  fileKind: DocumentFileKind | null;
  /** Missing/not-cached current version that is already backed up. */
  canRestore: boolean;
  personalSensitive: boolean;
}

export interface PreflightResult {
  overall: PreflightOverall;
  items: PreflightItem[];
  readyCount: number;
  notReadyCount: number;
  needsPersonalAck: boolean;
}

const cacheErrorToState = (error: FileCacheEntry['error']): PreflightItemState => {
  switch (error) {
    case 'HASH_MISMATCH':
    case 'HASH_FAILED':
      return 'HASH_MISMATCH';
    case 'CONTENT_MISMATCH':
      return 'CONTENT_MISMATCH';
    case 'MISSING':
    case 'EMPTY':
      return 'MISSING_FILE';
    case 'UNREADABLE':
    case 'IMPORT_FAILED':
    default:
      return 'UNREADABLE';
  }
};

export function evaluatePreflightItem(
  logicalDocumentId: string,
  sessionUserId: string | null,
  documents: OperationalDocument[],
  versions: DocumentVersion[],
): PreflightItem {
  const doc = documents.find((d) => d.id === logicalDocumentId);
  if (!doc || !isVisibleInSession(doc, sessionUserId)) {
    return {
      logicalDocumentId,
      title: 'Document',
      documentKind: 'CUSTOM',
      state: 'NOT_VISIBLE',
      exactVersionId: null,
      fileKind: null,
      canRestore: false,
      personalSensitive: false,
    };
  }
  const base = {
    logicalDocumentId: doc.id,
    title: doc.title,
    documentKind: doc.documentKind,
    exactVersionId: null as string | null,
    fileKind: null as DocumentFileKind | null,
    canRestore: false,
    personalSensitive: doc.sensitivity === 'PERSONAL_SENSITIVE',
  };
  if (isFinancialBlockedFromQuickPresent(doc)) {
    return { ...base, state: 'FINANCIAL_BLOCKED' };
  }
  if (doc.lifecycle === 'ARCHIVED') {
    return { ...base, state: 'ARCHIVED' };
  }
  const version = currentVersion(versions, doc.id);
  if (!version) {
    return { ...base, state: 'NO_VERSION' };
  }
  const withVersion = {
    ...base,
    exactVersionId: version.id,
    fileKind: version.fileKind,
    canRestore: version.cloudStatus === 'synced',
  };
  const cache = version.fileCache;
  if (cache.state === 'READY') {
    if (version.fileKind === 'IMAGE') {
      return { ...withVersion, canRestore: false, state: 'READY' };
    }
    if (version.fileKind === 'PDF') {
      return { ...withVersion, canRestore: false, state: 'PDF_EXTERNAL_ONLY' };
    }
    return { ...withVersion, canRestore: false, state: 'UNREADABLE' };
  }
  if (cache.state === 'NOT_CACHED' || cache.state === 'CACHING') {
    return { ...withVersion, state: 'NOT_CACHED' };
  }
  return { ...withVersion, state: cacheErrorToState(cache.error) };
}

export function summarizePreflight(items: PreflightItem[]): PreflightResult {
  const ready = items.filter((i) => i.state === 'READY');
  const overall: PreflightOverall =
    items.length === 0 || ready.length === 0 ? 'EMPTY' : ready.length === items.length ? 'READY' : 'PARTIAL';
  return {
    overall,
    items,
    readyCount: ready.length,
    notReadyCount: items.length - ready.length,
    needsPersonalAck: ready.some((i) => i.personalSensitive),
  };
}

export function sessionNeedsPersonalAck(items: PreflightItem[]): boolean {
  return items.some((i) => i.state === 'READY' && i.personalSensitive);
}

export function preflightStateCopy(state: PreflightItemState): string {
  switch (state) {
    case 'READY':
      return 'Ready to present';
    case 'NO_VERSION':
      return 'No file on this document';
    case 'NOT_CACHED':
      return 'Not verified on this device';
    case 'MISSING_FILE':
      return 'File is not on this device';
    case 'UNREADABLE':
      return 'File could not be read';
    case 'HASH_MISMATCH':
      return 'File no longer matches the stored copy';
    case 'CONTENT_MISMATCH':
      return 'File contents no longer match';
    case 'ARCHIVED':
      return 'Archived — not presented';
    case 'NOT_VISIBLE':
      return 'Not available in this account';
    case 'FINANCIAL_BLOCKED':
      return 'Financial documents stay out of Quick Present';
    case 'PDF_EXTERNAL_ONLY':
      return 'PDF cannot be shown in a swipe session';
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Session (shape only — construction is a live data-layer check)
// ---------------------------------------------------------------------------

export interface PresentationSessionItem {
  logicalDocumentId: string;
  exactVersionId: string;
  title: string;
  documentKind: DocumentKind;
  kindLabel: string;
  validity: ValidityState;
  expiresAt: string | null;
  privateUri: string;
}

export interface PresentationSession {
  id: string;
  setId: string;
  setKind: PresentationSetKind;
  setName: string;
  items: PresentationSessionItem[];
  personalAcknowledged: boolean;
  builtAt: number;
}

export function sessionItemFromReady(
  doc: OperationalDocument,
  version: DocumentVersion,
  privateUri: string,
  now: Date,
): PresentationSessionItem {
  return {
    logicalDocumentId: doc.id,
    exactVersionId: version.id,
    title: doc.title,
    documentKind: doc.documentKind,
    kindLabel: documentKindLabel(doc.documentKind),
    validity: deriveValidity(doc.expiresAt, now),
    expiresAt: doc.expiresAt,
    privateUri,
  };
}

/** Visible custom sets for a session (unowned only when signed out). */
export function visiblePresentationSetsForSession(
  sets: PresentationSet[],
  sessionUserId: string | null,
): PresentationSet[] {
  return sets.filter((s) => s.accountOwnerId === sessionUserId);
}

export function itemsForSet(
  items: PresentationSetItem[],
  setId: string,
): PresentationSetItem[] {
  return items
    .filter((i) => i.presentationSetId === setId)
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

export function includedItemsForSet(
  items: PresentationSetItem[],
  setId: string,
): PresentationSetItem[] {
  return itemsForSet(items, setId).filter((i) => i.included);
}

/** Kinds that must never appear in Quick Present product copy as "required". */
export const QUICK_PRESENT_FORBIDDEN_COPY = [
  'Roadside compliant',
  'DOT approved',
  'Accepted everywhere',
  'Legally valid',
  'All documents ready',
  'Required documents',
] as const;
