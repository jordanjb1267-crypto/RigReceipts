import { CloudSyncStatus } from './cloudSync';
import {
  DocumentFileKind,
  documentFileRelativePath,
  FileCacheEntry,
  isOpaqueId,
} from './documentFiles';
import { isSha256Hex } from './sha256';

/**
 * Road Wallet — OperationalDocument + immutable DocumentVersion domain
 * (Refinement Pass 1A).
 *
 * `LoadDocument != OperationalDocument`. Load paperwork (BOL/POD/…) stays in
 * `documents.ts` / `loadDocs.ts` and feeds the Paperwork grade; Road Wallet
 * holds reusable operational documents (registrations, insurance, credentials,
 * carrier paperwork) and never feeds grades or expenses.
 *
 * Stored documents are records, not proof of compliance. The taxonomy below is
 * a practical baseline plus CUSTOM — it is not a universal legal requirements
 * list — and validity states describe the stored record's dates only.
 */

// ---------------------------------------------------------------------------
// Canonical enumerations
// ---------------------------------------------------------------------------

export const SUBJECT_KINDS = ['DRIVER', 'CARRIER', 'TRUCK', 'TRAILER', 'GENERAL'] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];

export const DOCUMENT_KINDS = [
  'CDL',
  'MEDICAL_DOCUMENT',
  'TWIC',
  'VEHICLE_REGISTRATION',
  'TRAILER_REGISTRATION',
  'IRP_CAB_CARD',
  'ANNUAL_INSPECTION',
  'INSURANCE',
  'IFTA',
  'OPERATING_PERMIT',
  'OPERATING_AUTHORITY',
  'CERTIFICATE_OF_INSURANCE',
  'UCR',
  'W9',
  'FACTORING_NOA',
  'BANKING_DOCUMENT',
  'LEASE_AGREEMENT',
  'CUSTOM',
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const SENSITIVITIES = ['STANDARD', 'PERSONAL_SENSITIVE', 'FINANCIAL_SENSITIVE'] as const;
export type Sensitivity = (typeof SENSITIVITIES)[number];

export const DOCUMENT_LIFECYCLES = ['ACTIVE', 'ARCHIVED'] as const;
export type DocumentLifecycle = (typeof DOCUMENT_LIFECYCLES)[number];

/** Date state of the stored record. Never a compliance or legal judgement. */
export const VALIDITY_STATES = ['NO_EXPIRATION', 'CURRENT', 'EXPIRING_SOON', 'EXPIRED'] as const;
export type ValidityState = (typeof VALIDITY_STATES)[number];

export const EXPIRING_SOON_DAYS = 30;

interface DocumentKindInfo {
  label: string;
  defaultSubject: SubjectKind;
  defaultSensitivity: Sensitivity;
}

export const DOCUMENT_KIND_INFO: Record<DocumentKind, DocumentKindInfo> = {
  CDL: { label: 'CDL', defaultSubject: 'DRIVER', defaultSensitivity: 'PERSONAL_SENSITIVE' },
  MEDICAL_DOCUMENT: {
    label: 'Medical document',
    defaultSubject: 'DRIVER',
    defaultSensitivity: 'PERSONAL_SENSITIVE',
  },
  TWIC: { label: 'TWIC', defaultSubject: 'DRIVER', defaultSensitivity: 'PERSONAL_SENSITIVE' },
  VEHICLE_REGISTRATION: {
    label: 'Vehicle registration',
    defaultSubject: 'TRUCK',
    defaultSensitivity: 'STANDARD',
  },
  TRAILER_REGISTRATION: {
    label: 'Trailer registration',
    defaultSubject: 'TRAILER',
    defaultSensitivity: 'STANDARD',
  },
  IRP_CAB_CARD: { label: 'IRP cab card', defaultSubject: 'TRUCK', defaultSensitivity: 'STANDARD' },
  ANNUAL_INSPECTION: {
    label: 'Annual inspection',
    defaultSubject: 'TRUCK',
    defaultSensitivity: 'STANDARD',
  },
  INSURANCE: { label: 'Insurance', defaultSubject: 'CARRIER', defaultSensitivity: 'STANDARD' },
  IFTA: { label: 'IFTA', defaultSubject: 'CARRIER', defaultSensitivity: 'STANDARD' },
  OPERATING_PERMIT: {
    label: 'Operating permit',
    defaultSubject: 'CARRIER',
    defaultSensitivity: 'STANDARD',
  },
  OPERATING_AUTHORITY: {
    label: 'Operating authority',
    defaultSubject: 'CARRIER',
    defaultSensitivity: 'STANDARD',
  },
  CERTIFICATE_OF_INSURANCE: {
    label: 'Certificate of insurance',
    defaultSubject: 'CARRIER',
    defaultSensitivity: 'STANDARD',
  },
  UCR: { label: 'UCR', defaultSubject: 'CARRIER', defaultSensitivity: 'STANDARD' },
  W9: { label: 'W-9', defaultSubject: 'CARRIER', defaultSensitivity: 'FINANCIAL_SENSITIVE' },
  FACTORING_NOA: {
    label: 'Factoring notice of assignment',
    defaultSubject: 'CARRIER',
    defaultSensitivity: 'FINANCIAL_SENSITIVE',
  },
  BANKING_DOCUMENT: {
    label: 'Banking document',
    defaultSubject: 'CARRIER',
    defaultSensitivity: 'FINANCIAL_SENSITIVE',
  },
  LEASE_AGREEMENT: {
    label: 'Lease agreement',
    defaultSubject: 'CARRIER',
    defaultSensitivity: 'FINANCIAL_SENSITIVE',
  },
  CUSTOM: { label: 'Custom document', defaultSubject: 'GENERAL', defaultSensitivity: 'STANDARD' },
};

export const documentKindLabel = (kind: DocumentKind): string => DOCUMENT_KIND_INFO[kind].label;
export const defaultSubjectForKind = (kind: DocumentKind): SubjectKind =>
  DOCUMENT_KIND_INFO[kind].defaultSubject;
export const defaultSensitivityForKind = (kind: DocumentKind): Sensitivity =>
  DOCUMENT_KIND_INFO[kind].defaultSensitivity;

/**
 * Known-sensitive kinds are safety semantics, not UI defaults (Pass 1A.1 H5):
 * they may never be saved or edited as anything else. Later system Quick
 * Present sets use sensitivity as an exclusion boundary. Mirrored by a DB CHECK
 * in 20260902000014_road_wallet_integrity_hardening.sql.
 */
export const REQUIRED_SENSITIVITY_FOR_KIND: Partial<Record<DocumentKind, Sensitivity>> = {
  CDL: 'PERSONAL_SENSITIVE',
  MEDICAL_DOCUMENT: 'PERSONAL_SENSITIVE',
  TWIC: 'PERSONAL_SENSITIVE',
  W9: 'FINANCIAL_SENSITIVE',
  FACTORING_NOA: 'FINANCIAL_SENSITIVE',
  BANKING_DOCUMENT: 'FINANCIAL_SENSITIVE',
  LEASE_AGREEMENT: 'FINANCIAL_SENSITIVE',
};

/** The fixed class for a known-sensitive kind, or null when the kind is configurable. */
export const requiredSensitivityForKind = (kind: DocumentKind): Sensitivity | null =>
  REQUIRED_SENSITIVITY_FOR_KIND[kind] ?? null;

export const isSensitivityAllowedForKind = (
  kind: DocumentKind,
  sensitivity: Sensitivity,
): boolean => {
  const required = requiredSensitivityForKind(kind);
  return required === null || required === sensitivity;
};

/** Throws when a known-sensitive kind carries any other sensitivity. */
export function validateSensitivityForKind(kind: DocumentKind, sensitivity: Sensitivity): void {
  if (!isSensitivityAllowedForKind(kind, sensitivity)) {
    throw new Error(
      `${kind} must be ${requiredSensitivityForKind(kind)}; ${sensitivity} is not allowed`,
    );
  }
}

/**
 * Application-side same-owner truck check (H4). The database guarantee is the
 * composite FK `(truck_id, owner_id) → trucks (id, owner_id)`; this helper only
 * gives the data layer an early, explicit failure when it knows the truck's
 * owner. It is not a substitute for the DB constraint.
 */
export function validateTruckAssociation(
  documentOwnerId: string | null,
  truck: { id: string; ownerId: string | null } | null,
): void {
  if (truck === null) return;
  if (truck.ownerId === null || truck.ownerId !== documentOwnerId) {
    throw new Error('truck must belong to the same account as the document');
  }
}

/**
 * Offline pin default. FINANCIAL_SENSITIVE defaults off. This is a future
 * presentation/cache preference only — it never deletes or evicts a file, and
 * an imported local-only document always keeps its durable copy.
 */
export function defaultOfflinePinned(sensitivity: Sensitivity): boolean {
  switch (sensitivity) {
    case 'STANDARD':
    case 'PERSONAL_SENSITIVE':
      return true;
    case 'FINANCIAL_SENSITIVE':
      return false;
    default: {
      const exhaustive: never = sensitivity;
      return exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Dates and validity (calendar-day, UTC)
// ---------------------------------------------------------------------------

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` that round-trips through a UTC calendar date. */
export function isIsoDate(value: string | null | undefined): value is string {
  if (!value || !ISO_DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d);
  const date = new Date(t);
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

const DAY_MS = 86_400_000;
const utcDay = (y: number, m: number, d: number) => Math.floor(Date.UTC(y, m, d) / DAY_MS);

/** Whole calendar days from `now`'s UTC date to the expiry date (negative = past). */
export function daysUntilExpiry(expiresAt: string, now: Date): number {
  const [y, m, d] = expiresAt.split('-').map(Number);
  const expiryDay = utcDay(y, m - 1, d);
  const today = utcDay(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return expiryDay - today;
}

/**
 * Date state of a stored record. Boundary rules (calendar days, UTC):
 *   - no/invalid expiry            → NO_EXPIRATION
 *   - expiry day before today      → EXPIRED
 *   - today … today + 30 inclusive → EXPIRING_SOON
 *   - later                        → CURRENT
 * This is not, and must never be read as, a compliance determination.
 */
export function deriveValidity(expiresAt: string | null | undefined, now: Date): ValidityState {
  if (!isIsoDate(expiresAt)) return 'NO_EXPIRATION';
  const days = daysUntilExpiry(expiresAt, now);
  if (days < 0) return 'EXPIRED';
  if (days <= EXPIRING_SOON_DAYS) return 'EXPIRING_SOON';
  return 'CURRENT';
}

// ---------------------------------------------------------------------------
// Masked references (never raw identifiers)
// ---------------------------------------------------------------------------

const MASK = '****';
const MASKED_REFERENCE_RE = /^\*{4}[A-Za-z0-9]{0,4}$/;

/** `****1234` — only the last (up to) four alphanumerics of a reference survive. */
export function maskReference(raw: string | null | undefined, keep = 4): string | null {
  const cleaned = (raw ?? '').replace(/[^A-Za-z0-9]/g, '');
  if (!cleaned) return null;
  return `${MASK}${cleaned.slice(-Math.min(keep, 4))}`;
}

export const isMaskedReference = (value: string): boolean => MASKED_REFERENCE_RE.test(value);

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

/** Durable logical record. Carries no file path and no compliance field. */
export interface OperationalDocument {
  id: string;
  /** Account bound at creation; null = created signed out (never auto-claimed). */
  accountOwnerId: string | null;
  documentKind: DocumentKind;
  subjectKind: SubjectKind;
  truckId: string | null;
  trailerNumber: string | null;
  title: string;
  issuer: string | null;
  jurisdiction: string | null;
  /** `YYYY-MM-DD` */
  issuedAt: string | null;
  effectiveAt: string | null;
  expiresAt: string | null;
  /** Masked (`****1234`) or null — never a raw identifier. */
  maskedReference: string | null;
  sensitivity: Sensitivity;
  lifecycle: DocumentLifecycle;
  offlinePinned: boolean;
  cloudStatus: CloudSyncStatus;
  createdAt: number;
  updatedAt: number;
}

/** Fields a user may edit after creation. */
export type OperationalDocumentPatch = Partial<
  Pick<
    OperationalDocument,
    | 'documentKind'
    | 'subjectKind'
    | 'truckId'
    | 'trailerNumber'
    | 'title'
    | 'issuer'
    | 'jurisdiction'
    | 'issuedAt'
    | 'effectiveAt'
    | 'expiresAt'
    | 'maskedReference'
    | 'sensitivity'
    | 'offlinePinned'
  >
>;

/** Immutable exact-file evidence; the original filename is never persisted. */
export interface DocumentVersion {
  id: string;
  operationalDocumentId: string;
  accountOwnerId: string | null;
  versionNumber: number;
  supersedesVersionId: string | null;
  fileKind: DocumentFileKind;
  mimeType: string;
  extension: string;
  byteSize: number;
  sha256: string;
  /** `road-wallet/{documentId}/{versionId}.{ext}` — app-private, relative. */
  relativePath: string;
  fileCache: FileCacheEntry;
  cloudStatus: CloudSyncStatus;
  remoteStorageBucket: 'documents' | null;
  remoteStoragePath: string | null;
  createdAt: number;
}

export const DOCUMENT_VERSION_IMMUTABLE_FIELDS = [
  'id',
  'operationalDocumentId',
  'accountOwnerId',
  'versionNumber',
  'supersedesVersionId',
  'fileKind',
  'mimeType',
  'extension',
  'byteSize',
  'sha256',
  'createdAt',
] as const satisfies readonly (keyof DocumentVersion)[];

export type DocumentVersionImmutableCore = Pick<
  DocumentVersion,
  (typeof DOCUMENT_VERSION_IMMUTABLE_FIELDS)[number]
>;

export const immutableCore = (v: DocumentVersion): DocumentVersionImmutableCore => ({
  id: v.id,
  operationalDocumentId: v.operationalDocumentId,
  accountOwnerId: v.accountOwnerId,
  versionNumber: v.versionNumber,
  supersedesVersionId: v.supersedesVersionId,
  fileKind: v.fileKind,
  mimeType: v.mimeType,
  extension: v.extension,
  byteSize: v.byteSize,
  sha256: v.sha256,
  createdAt: v.createdAt,
});

export function immutableCoreEquals(
  a: DocumentVersionImmutableCore,
  b: DocumentVersionImmutableCore,
): boolean {
  return DOCUMENT_VERSION_IMMUTABLE_FIELDS.every((k) => a[k] === b[k]);
}

/** Throws when a "mutation" would touch any immutable field. */
export function assertImmutableCoreUnchanged(prev: DocumentVersion, next: DocumentVersion): void {
  for (const k of DOCUMENT_VERSION_IMMUTABLE_FIELDS) {
    if (prev[k] !== next[k]) throw new Error(`DocumentVersion.${k} is immutable`);
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const isEnum = <T extends string>(values: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (values as readonly string[]).includes(v);

export function validateOperationalDocument(doc: OperationalDocument): void {
  if (!isOpaqueId(doc.id)) throw new Error('document id must be an opaque id');
  if (!isEnum(DOCUMENT_KINDS, doc.documentKind)) throw new Error('unknown document kind');
  if (!isEnum(SUBJECT_KINDS, doc.subjectKind)) throw new Error('unknown subject kind');
  if (!isEnum(SENSITIVITIES, doc.sensitivity)) throw new Error('unknown sensitivity');
  validateSensitivityForKind(doc.documentKind, doc.sensitivity);
  if (!isEnum(DOCUMENT_LIFECYCLES, doc.lifecycle)) throw new Error('unknown lifecycle');
  if (!doc.title.trim()) throw new Error('title is required');
  for (const k of ['issuedAt', 'effectiveAt', 'expiresAt'] as const) {
    if (doc[k] !== null && !isIsoDate(doc[k])) throw new Error(`${k} must be YYYY-MM-DD`);
  }
  if (doc.maskedReference !== null && !isMaskedReference(doc.maskedReference)) {
    throw new Error('maskedReference must be masked (****XXXX) — raw identifiers are not stored');
  }
}

export function validateNewVersion(
  candidate: DocumentVersion,
  document: OperationalDocument,
  existing: readonly DocumentVersion[],
): void {
  if (!isOpaqueId(candidate.id)) throw new Error('version id must be an opaque id');
  if (candidate.operationalDocumentId !== document.id) {
    throw new Error('version does not belong to this document');
  }
  if (candidate.accountOwnerId !== document.accountOwnerId) {
    throw new Error('version owner must match document owner');
  }
  if (!Number.isInteger(candidate.versionNumber) || candidate.versionNumber < 1) {
    throw new Error('versionNumber must be a positive integer');
  }
  if (!isSha256Hex(candidate.sha256)) throw new Error('sha256 must be lowercase hex');
  if (!(candidate.byteSize > 0)) throw new Error('byteSize must be > 0');
  const siblings = existing.filter((v) => v.operationalDocumentId === document.id);
  if (siblings.some((v) => v.id === candidate.id)) throw new Error('duplicate version id');
  if (siblings.some((v) => v.versionNumber === candidate.versionNumber)) {
    throw new Error('duplicate versionNumber within document');
  }
  // Chain continuity (Pass 1B-H0): exactly 1 → 2 → 3 …, each superseding the
  // immediately prior CURRENT version. No gaps, no branching, no odd base.
  const current = currentVersion(siblings, document.id);
  if (!current) {
    if (candidate.versionNumber !== 1) throw new Error('the first version must be version 1');
    if (candidate.supersedesVersionId !== null) {
      throw new Error('the first version must not supersede anything');
    }
    return;
  }
  if (candidate.versionNumber !== current.versionNumber + 1) {
    throw new Error(
      `replacement must be version ${current.versionNumber + 1} (current is ${current.versionNumber})`,
    );
  }
  if (candidate.supersedesVersionId !== current.id) {
    throw new Error('a replacement version must supersede the current version');
  }
}

/**
 * Deterministic rebuild of one document's persisted version chain (Pass 1A.1
 * H3, tightened in Pass 1B-H0). Input versions must already be structurally
 * sound and belong to this document. A valid chain is EXACTLY
 * `1 → 2 → 3 …`: version 1 has no supersession, and every version N > 1 has
 * `versionNumber = N-1 + 1` and `supersedesVersionId = previous.id`. Rules:
 *   - duplicate version numbers: every entry sharing the number is dropped;
 *   - the chain must begin at version 1 with `supersedesVersionId = null`;
 *   - each next version must be contiguous and supersede the immediately
 *     prior retained version;
 *   - the first gap/break truncates that version and everything above it, so a
 *     corrupt or out-of-sequence entry can never become "current".
 */
export function rebuildVersionChain(versions: readonly DocumentVersion[]): DocumentVersion[] {
  const counts = new Map<number, number>();
  for (const v of versions) counts.set(v.versionNumber, (counts.get(v.versionNumber) ?? 0) + 1);
  const unique = versions
    .filter((v) => counts.get(v.versionNumber) === 1)
    .sort((a, b) => a.versionNumber - b.versionNumber);

  const retained: DocumentVersion[] = [];
  for (const v of unique) {
    const prev = retained[retained.length - 1];
    if (!prev) {
      if (v.versionNumber !== 1 || v.supersedesVersionId !== null) break;
      retained.push(v);
      continue;
    }
    if (v.versionNumber !== prev.versionNumber + 1 || v.supersedesVersionId !== prev.id) break;
    retained.push(v);
  }
  return retained;
}

// ---------------------------------------------------------------------------
// Pure selectors
// ---------------------------------------------------------------------------

export const versionsForDocument = (
  versions: readonly DocumentVersion[],
  documentId: string,
): DocumentVersion[] =>
  versions
    .filter((v) => v.operationalDocumentId === documentId)
    .sort((a, b) => a.versionNumber - b.versionNumber);

/** Current = highest version number for the logical document. */
export function currentVersion(
  versions: readonly DocumentVersion[],
  documentId: string,
): DocumentVersion | null {
  const list = versionsForDocument(versions, documentId);
  return list.length ? list[list.length - 1] : null;
}

export const nextVersionNumber = (
  versions: readonly DocumentVersion[],
  documentId: string,
): number => (currentVersion(versions, documentId)?.versionNumber ?? 0) + 1;

/**
 * Session visibility: a record is visible only to the account it is bound to;
 * unowned records are visible only in the signed-out (device-only) context.
 */
export const isVisibleInSession = (
  record: { accountOwnerId: string | null },
  sessionUserId: string | null,
): boolean => record.accountOwnerId === sessionUserId;

export const visibleDocumentsForSession = (
  documents: readonly OperationalDocument[],
  sessionUserId: string | null,
): OperationalDocument[] => documents.filter((d) => isVisibleInSession(d, sessionUserId));

// ---------------------------------------------------------------------------
// Product-surface projections (Pass 1B) — derived, never stored
// ---------------------------------------------------------------------------

/**
 * Backup truth for one document: "backed up" requires BOTH the editable
 * metadata and the CURRENT version to be synced. Authentication alone proves
 * nothing.
 */
export type BackupState = 'on_device' | 'backing_up' | 'backed_up';

export function backupState(
  doc: Pick<OperationalDocument, 'cloudStatus'>,
  current: Pick<DocumentVersion, 'cloudStatus'> | null,
): BackupState {
  if (!current) return doc.cloudStatus === 'synced' ? 'backing_up' : 'on_device';
  if (doc.cloudStatus === 'synced' && current.cloudStatus === 'synced') return 'backed_up';
  if (doc.cloudStatus === 'pending_sync' || current.cloudStatus === 'pending_sync') {
    return 'backing_up';
  }
  if (doc.cloudStatus === 'synced' || current.cloudStatus === 'synced') return 'backing_up';
  return 'on_device';
}

export const BACKUP_STATE_LABEL: Record<BackupState, string> = {
  on_device: 'On this device',
  backing_up: 'Backing up',
  backed_up: 'Backed up',
};

/** Current-runtime readiness copy. NOT_CACHED is "checking", never "ready". */
export const READINESS_LABEL: Record<FileCacheEntry['state'], string> = {
  NOT_CACHED: 'Checking file',
  CACHING: 'Checking file',
  READY: 'Ready offline',
  ERROR: 'File unavailable',
};

export const VALIDITY_LABEL: Record<ValidityState, string> = {
  NO_EXPIRATION: 'No expiration',
  CURRENT: 'Current',
  EXPIRING_SOON: 'Expiring soon',
  EXPIRED: 'Expired',
};

/**
 * The only place the app talks about compliance — to say it does not judge it.
 * Screen copy tests allow the words "compliant" / "legally valid" solely here.
 */
export const ROAD_WALLET_DISCLAIMER =
  'RigReceipts stores and organizes your documents. It does not determine whether a document is compliant, legally valid, or accepted by any authority — check that with the issuing agency.';

export interface RoadWalletSummary {
  totalActive: number;
  /** Current version physically verified READY in this process. */
  readyOffline: number;
  /** Active documents whose current version is not READY (checking or error). */
  needsFileCheck: number;
  expiringSoon: number;
  expired: number;
  /** Metadata synced AND current version synced. */
  backedUp: number;
  archived: number;
}

/** Real summary from the store + session identity. Never from mock data. */
export function roadWalletSummary(
  documents: readonly OperationalDocument[],
  versions: readonly DocumentVersion[],
  sessionUserId: string | null,
  now: Date,
): RoadWalletSummary {
  const visible = visibleDocumentsForSession(documents, sessionUserId);
  const summary: RoadWalletSummary = {
    totalActive: 0,
    readyOffline: 0,
    needsFileCheck: 0,
    expiringSoon: 0,
    expired: 0,
    backedUp: 0,
    archived: 0,
  };
  for (const doc of visible) {
    if (doc.lifecycle === 'ARCHIVED') {
      summary.archived++;
      continue;
    }
    summary.totalActive++;
    const current = currentVersion(versions, doc.id);
    if (current?.fileCache.state === 'READY') summary.readyOffline++;
    else summary.needsFileCheck++;
    const validity = deriveValidity(doc.expiresAt, now);
    if (validity === 'EXPIRING_SOON') summary.expiringSoon++;
    if (validity === 'EXPIRED') summary.expired++;
    if (backupState(doc, current) === 'backed_up') summary.backedUp++;
  }
  return summary;
}

/** Confirmation strength a share/export requires for a sensitivity class. */
export type SensitiveShareConfirmation =
  'NONE' | 'PERSONAL_ACKNOWLEDGED' | 'FINANCIAL_ACKNOWLEDGED';

export function requiredShareConfirmation(sensitivity: Sensitivity): SensitiveShareConfirmation {
  switch (sensitivity) {
    case 'STANDARD':
      return 'NONE';
    case 'PERSONAL_SENSITIVE':
      return 'PERSONAL_ACKNOWLEDGED';
    case 'FINANCIAL_SENSITIVE':
      return 'FINANCIAL_ACKNOWLEDGED';
    default: {
      const exhaustive: never = sensitivity;
      return exhaustive;
    }
  }
}

export function shareConfirmationSatisfies(
  given: SensitiveShareConfirmation,
  required: SensitiveShareConfirmation,
): boolean {
  const rank: Record<SensitiveShareConfirmation, number> = {
    NONE: 0,
    PERSONAL_ACKNOWLEDGED: 1,
    FINANCIAL_ACKNOWLEDGED: 2,
  };
  return rank[given] >= rank[required];
}

export const SHARE_CONFIRMATION_COPY: Record<
  Exclude<SensitiveShareConfirmation, 'NONE'>,
  { title: string; body: string; confirm: string }
> = {
  PERSONAL_ACKNOWLEDGED: {
    title: 'Share a personal document?',
    body: 'This document may contain personal identity or medical information. Share only with someone you intend to receive it.',
    confirm: 'Share document',
  },
  FINANCIAL_ACKNOWLEDGED: {
    title: 'Share a financial document?',
    body: 'This document may contain tax, banking, factoring or other financial information. Confirm that you want to share this exact document.',
    confirm: 'Yes, share this exact document',
  },
};

/** Analytics-safe projection: no title, issuer, reference, dates or ids. */
export function analyticsSafeDocumentSummary(
  doc: OperationalDocument,
  now: Date,
): {
  documentKind: DocumentKind;
  subjectKind: SubjectKind;
  sensitivity: Sensitivity;
  hasExpiration: boolean;
  validity: ValidityState;
} {
  return {
    documentKind: doc.documentKind,
    subjectKind: doc.subjectKind,
    sensitivity: doc.sensitivity,
    hasExpiration: doc.expiresAt !== null,
    validity: deriveValidity(doc.expiresAt, now),
  };
}

// ---------------------------------------------------------------------------
// Remote mapping (Supabase rows) — ids are identical locally and remotely
// ---------------------------------------------------------------------------

export const ROAD_WALLET_REMOTE_BUCKET = 'documents' as const;

/** `{userId}/road-wallet/{documentId}/{versionId}.{ext}` — owner folder first. */
export const remoteVersionPath = (
  userId: string,
  documentId: string,
  versionId: string,
  extension: string,
): string => `${userId}/road-wallet/${documentId}/${versionId}.${extension}`;

export interface RemoteOperationalDocumentRow {
  id: string;
  owner_id: string;
  document_kind: DocumentKind;
  subject_kind: SubjectKind;
  truck_id: string | null;
  trailer_number: string | null;
  title: string;
  issuer: string | null;
  jurisdiction: string | null;
  issued_at: string | null;
  effective_at: string | null;
  expires_at: string | null;
  masked_reference: string | null;
  sensitivity: Sensitivity;
  lifecycle: DocumentLifecycle;
  offline_pinned: boolean;
  created_at: string;
  updated_at: string;
}

export function toRemoteDocumentRow(
  doc: OperationalDocument,
  ownerId: string,
): RemoteOperationalDocumentRow {
  return {
    id: doc.id,
    owner_id: ownerId,
    document_kind: doc.documentKind,
    subject_kind: doc.subjectKind,
    truck_id: doc.truckId,
    trailer_number: doc.trailerNumber,
    title: doc.title,
    issuer: doc.issuer,
    jurisdiction: doc.jurisdiction,
    issued_at: doc.issuedAt,
    effective_at: doc.effectiveAt,
    expires_at: doc.expiresAt,
    masked_reference: doc.maskedReference,
    sensitivity: doc.sensitivity,
    lifecycle: doc.lifecycle,
    offline_pinned: doc.offlinePinned,
    created_at: new Date(doc.createdAt).toISOString(),
    updated_at: new Date(doc.updatedAt).toISOString(),
  };
}

export interface RemoteDocumentVersionRow {
  id: string;
  owner_id: string;
  operational_document_id: string;
  version_number: number;
  supersedes_version_id: string | null;
  storage_bucket: 'documents';
  storage_path: string;
  file_kind: DocumentFileKind;
  mime_type: string;
  extension: string;
  byte_size: number;
  sha256: string;
  created_at: string;
}

export function toRemoteVersionRow(
  version: DocumentVersion,
  ownerId: string,
): RemoteDocumentVersionRow {
  return {
    id: version.id,
    owner_id: ownerId,
    operational_document_id: version.operationalDocumentId,
    version_number: version.versionNumber,
    supersedes_version_id: version.supersedesVersionId,
    storage_bucket: ROAD_WALLET_REMOTE_BUCKET,
    storage_path: remoteVersionPath(
      ownerId,
      version.operationalDocumentId,
      version.id,
      version.extension,
    ),
    file_kind: version.fileKind,
    mime_type: version.mimeType,
    extension: version.extension,
    byte_size: version.byteSize,
    sha256: version.sha256,
    created_at: new Date(version.createdAt).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Remote → local recovery mapping (Pass 1B.1) — validated, never trusted
// ---------------------------------------------------------------------------

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const optStr = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const isoToMs = (v: unknown): number | null => {
  if (typeof v !== 'string') return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
};

/**
 * Maps an `operational_documents` row fetched through the owner's own RLS
 * session into a local document. Every field is validated; the row must belong
 * to `sessionUserId` (defensive on top of RLS). Returns null for anything that
 * cannot be proven sound. No local path ever comes from the server.
 */
export function fromRemoteDocumentRow(
  row: unknown,
  sessionUserId: string,
): OperationalDocument | null {
  if (!isRec(row)) return null;
  if (typeof row.id !== 'string' || !isOpaqueId(row.id)) return null;
  if (row.owner_id !== sessionUserId) return null;
  if (!isEnum(DOCUMENT_KINDS, row.document_kind)) return null;
  if (!isEnum(SUBJECT_KINDS, row.subject_kind)) return null;
  if (!isEnum(SENSITIVITIES, row.sensitivity)) return null;
  if (!isEnum(DOCUMENT_LIFECYCLES, row.lifecycle)) return null;
  if (typeof row.title !== 'string' || !row.title.trim()) return null;
  const createdAt = isoToMs(row.created_at);
  const updatedAt = isoToMs(row.updated_at);
  if (createdAt === null || updatedAt === null) return null;
  const doc: OperationalDocument = {
    id: row.id,
    accountOwnerId: sessionUserId,
    documentKind: row.document_kind,
    subjectKind: row.subject_kind,
    truckId: optStr(row.truck_id),
    trailerNumber: optStr(row.trailer_number),
    title: row.title,
    issuer: optStr(row.issuer),
    jurisdiction: optStr(row.jurisdiction),
    issuedAt: optStr(row.issued_at),
    effectiveAt: optStr(row.effective_at),
    expiresAt: optStr(row.expires_at),
    maskedReference: optStr(row.masked_reference),
    sensitivity: row.sensitivity,
    lifecycle: row.lifecycle,
    offlinePinned: row.offline_pinned === true,
    cloudStatus: 'synced',
    createdAt,
    updatedAt,
  };
  try {
    // Enforces opaque id, enum sets, fixed sensitivity for known kinds, ISO
    // dates and masked-reference rules.
    validateOperationalDocument(doc);
  } catch {
    return null;
  }
  return doc;
}

const REMOTE_EXTENSION_RE = /^[a-z0-9]{1,8}$/;

/**
 * Maps a `document_versions` row into local immutable evidence. The parent
 * must already be a validated, session-owned document. The storage path must
 * be exactly the canonical owner-first key; the local relative path is
 * reconstructed (never read from the server); the cache starts NOT_CACHED.
 */
export function fromRemoteVersionRow(
  row: unknown,
  sessionUserId: string,
  parent: OperationalDocument,
): DocumentVersion | null {
  if (!isRec(row)) return null;
  if (typeof row.id !== 'string' || !isOpaqueId(row.id)) return null;
  if (row.owner_id !== sessionUserId) return null;
  if (row.operational_document_id !== parent.id) return null;
  if (parent.accountOwnerId !== sessionUserId) return null;
  const versionNumber = Number(row.version_number);
  if (!Number.isInteger(versionNumber) || versionNumber < 1) return null;
  const supersedes =
    row.supersedes_version_id === null || row.supersedes_version_id === undefined
      ? null
      : typeof row.supersedes_version_id === 'string' && isOpaqueId(row.supersedes_version_id)
        ? row.supersedes_version_id
        : undefined;
  if (supersedes === undefined || supersedes === row.id) return null;
  const fileKind = row.file_kind;
  if (fileKind !== 'IMAGE' && fileKind !== 'PDF' && fileKind !== 'OTHER') return null;
  if (typeof row.mime_type !== 'string' || !row.mime_type) return null;
  if (typeof row.extension !== 'string' || !REMOTE_EXTENSION_RE.test(row.extension)) return null;
  const byteSize = Number(row.byte_size);
  if (!Number.isFinite(byteSize) || byteSize <= 0) return null;
  if (typeof row.sha256 !== 'string' || !isSha256Hex(row.sha256)) return null;
  if (row.storage_bucket !== ROAD_WALLET_REMOTE_BUCKET) return null;
  const expectedPath = remoteVersionPath(sessionUserId, parent.id, row.id, row.extension);
  if (row.storage_path !== expectedPath) return null;
  const createdAt = isoToMs(row.created_at);
  if (createdAt === null) return null;

  let relativePath: string;
  try {
    relativePath = documentFileRelativePath(parent.id, row.id, row.extension);
  } catch {
    return null;
  }

  return {
    id: row.id,
    operationalDocumentId: parent.id,
    accountOwnerId: sessionUserId,
    versionNumber,
    supersedesVersionId: supersedes,
    fileKind,
    mimeType: row.mime_type,
    extension: row.extension,
    byteSize,
    sha256: row.sha256,
    relativePath,
    fileCache: {
      state: 'NOT_CACHED',
      relativePath,
      mimeType: row.mime_type,
      byteSize,
      sha256: row.sha256,
      error: null,
      verifiedAt: null,
    },
    cloudStatus: 'synced',
    remoteStorageBucket: ROAD_WALLET_REMOTE_BUCKET,
    remoteStoragePath: expectedPath,
    createdAt,
  };
}

// ---------------------------------------------------------------------------
// Safe remote/local merge (Pass 1B.1 R3)
// ---------------------------------------------------------------------------

export type DocumentMergeAction =
  'import' | 'keep_local' | 'replace_metadata' | 'keep_synced_local';

/**
 * Recovery never overwrites unsynced local work. Local `pending_sync` /
 * `local_only` metadata is authoritative for this device; a synced local copy
 * is replaced only when the remote row is demonstrably newer. Identity,
 * ownership and creation time are immutable in every branch.
 */
export function mergeRecoveredDocument(
  local: OperationalDocument | undefined,
  remote: OperationalDocument,
): { action: DocumentMergeAction; document: OperationalDocument } {
  if (!local) return { action: 'import', document: remote };
  if (local.cloudStatus !== 'synced') return { action: 'keep_local', document: local };
  if (remote.updatedAt > local.updatedAt) {
    return {
      action: 'replace_metadata',
      document: {
        ...remote,
        id: local.id,
        accountOwnerId: local.accountOwnerId,
        createdAt: local.createdAt,
        cloudStatus: 'synced',
      },
    };
  }
  return { action: 'keep_synced_local', document: local };
}

export type VersionMergeAction = 'import' | 'reconcile' | 'conflict' | 'unchanged';

/**
 * Same version id ⇒ immutable evidence must match exactly. A match only
 * reconciles cloud state (bucket/path/synced) and keeps the local file cache;
 * a mismatch is an integrity conflict and neither side is rewritten.
 */
export function mergeRecoveredVersion(
  local: DocumentVersion | undefined,
  remote: DocumentVersion,
): { action: VersionMergeAction; version?: DocumentVersion } {
  if (!local) return { action: 'import', version: remote };
  if (!immutableCoreEquals(immutableCore(local), immutableCore(remote))) {
    return { action: 'conflict' };
  }
  if (
    local.cloudStatus === 'synced' &&
    local.remoteStorageBucket === remote.remoteStorageBucket &&
    local.remoteStoragePath === remote.remoteStoragePath
  ) {
    return { action: 'unchanged', version: local };
  }
  return {
    action: 'reconcile',
    version: {
      ...local,
      cloudStatus: 'synced',
      remoteStorageBucket: remote.remoteStorageBucket,
      remoteStoragePath: remote.remoteStoragePath,
    },
  };
}

/** Bounded, non-sensitive recovery outcome. */
export interface RoadWalletRecoveryResult {
  documentsRecovered: number;
  versionsRecovered: number;
  filesRestored: number;
  integrityConflicts: number;
  downloadFailures: number;
  skippedLocalChanges: number;
  /** Set when the run was skipped or abandoned; nothing was mutated after this point. */
  outcome: 'completed' | 'signed_out' | 'not_configured' | 'cancelled' | 'fetch_failed';
}

export const emptyRecoveryResult = (
  outcome: RoadWalletRecoveryResult['outcome'] = 'completed',
): RoadWalletRecoveryResult => ({
  documentsRecovered: 0,
  versionsRecovered: 0,
  filesRestored: 0,
  integrityConflicts: 0,
  downloadFailures: 0,
  skippedLocalChanges: 0,
  outcome,
});

/**
 * Whether an already-existing remote version row carries exactly the immutable
 * evidence we hold locally (idempotent-retry check). Any difference is an
 * integrity conflict, never something to overwrite.
 */
export function remoteVersionMatches(
  local: DocumentVersion,
  ownerId: string,
  remote: Partial<RemoteDocumentVersionRow>,
): boolean {
  const expected = toRemoteVersionRow(local, ownerId);
  return (
    remote.id === expected.id &&
    remote.owner_id === expected.owner_id &&
    remote.operational_document_id === expected.operational_document_id &&
    Number(remote.version_number) === expected.version_number &&
    (remote.supersedes_version_id ?? null) === expected.supersedes_version_id &&
    remote.storage_bucket === expected.storage_bucket &&
    remote.storage_path === expected.storage_path &&
    remote.file_kind === expected.file_kind &&
    remote.mime_type === expected.mime_type &&
    remote.extension === expected.extension &&
    Number(remote.byte_size) === expected.byte_size &&
    remote.sha256 === expected.sha256
  );
}
