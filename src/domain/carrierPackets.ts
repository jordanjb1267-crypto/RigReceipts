import {
  authorizeCloudSync,
  CloudSyncContext,
  CloudSyncDecision,
  CloudSyncStatus,
  statusAfterLocalMutation,
} from './cloudSync';
import { isOpaqueId } from './documentFiles';
import { canUseFeature } from './entitlements';
import {
  currentVersion,
  deriveValidity,
  DOCUMENT_KINDS,
  DocumentKind,
  isVisibleInSession,
  OperationalDocument,
  DocumentVersion,
  Sensitivity,
  SENSITIVITIES,
} from './operationalDocuments';

/**
 * Carrier Profile + Carrier Packet foundation (Pass 3).
 *
 * LoadDocument != OperationalDocument != CarrierPacket.
 * PresentationSetItem points at a logical document; CarrierPacketItem freezes
 * an exact DocumentVersion. Combined PDF/ZIP and profile-cover artifacts are
 * deferred. SHARED means only: the user attests this exact snapshot was shared.
 */

export const CARRIER_PACKET_TEMPLATE_SCHEMA_VERSION = 1 as const;
export const CARRIER_PACKET_MAX_REQUIREMENTS = 30;
export const CARRIER_PROFILE_NAME_MAX = 120;
export const CARRIER_PACKET_NAME_MAX = 80;
export const CARRIER_PACKET_RECIPIENT_MAX = 120;
export const STANDARD_BROKER_PACKET_CODE = 'STANDARD_BROKER_PACKET' as const;

export const CARRIER_IDENTITY_SOURCES = ['USER_ENTERED'] as const;
export type CarrierIdentitySource = (typeof CARRIER_IDENTITY_SOURCES)[number];

export const CARRIER_PACKET_STATUSES = ['DRAFT', 'READY', 'SHARED', 'SUPERSEDED'] as const;
export type CarrierPacketStatus = (typeof CARRIER_PACKET_STATUSES)[number];

export const CARRIER_TEMPLATE_SOURCE_KINDS = ['BUILTIN', 'CUSTOM'] as const;
export type CarrierTemplateSourceKind = (typeof CARRIER_TEMPLATE_SOURCE_KINDS)[number];

export const CARRIER_TEMPLATE_LIFECYCLES = ['ACTIVE', 'ARCHIVED'] as const;
export type CarrierTemplateLifecycle = (typeof CARRIER_TEMPLATE_LIFECYCLES)[number];

export const CARRIER_SHARE_METHODS = ['OS_SHARE_SHEET', 'OTHER'] as const;
export type CarrierShareMethod = (typeof CARRIER_SHARE_METHODS)[number];

export const CARRIER_REVIEW_SEVERITIES = ['BLOCKER', 'WARNING'] as const;
export type CarrierReviewSeverity = (typeof CARRIER_REVIEW_SEVERITIES)[number];

export const CARRIER_REVIEW_CODES = [
  'MISSING_CARRIER_PROFILE',
  'MISSING_REQUIRED_DOCUMENT',
  'NO_CURRENT_VERSION',
  'STALE_VERSION',
  'ARCHIVED_DOCUMENT',
  'EXPIRED_REQUIRED_DOCUMENT',
  'INTEGRITY_MISMATCH',
  'FILE_UNAVAILABLE_WITHOUT_RECOVERY',
  'PROFILE_CHANGED',
  'OPTIONAL_DOCUMENT_MISSING',
  'EXPIRING_SOON',
  'PERSONAL_SENSITIVE',
  'FINANCIAL_SENSITIVE',
  'RESTORE_REQUIRED',
  'PROFILE_IDENTIFIER_MISSING',
] as const;
export type CarrierReviewCode = (typeof CARRIER_REVIEW_CODES)[number];

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isEnum = <T extends string>(allowed: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v);
const bounded = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= max;
const optionalBounded = (v: unknown, max: number): v is string | null | undefined =>
  v === null || v === undefined || (typeof v === 'string' && v.length <= max);

/**
 * Optional remote scalar (Pass 3.2 / Road Wallet H0B): accept a non-empty
 * string or null/absent. A number, boolean or object is malformed — do not
 * coerce it to null and accept the row.
 */
const optStrStrict = (v: unknown): string | null | undefined => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.length > 0 ? v : null;
  return undefined;
};

const optShareMethod = (v: unknown): CarrierShareMethod | null | undefined => {
  if (v === null || v === undefined) return null;
  if (isEnum(CARRIER_SHARE_METHODS, v)) return v;
  return undefined;
};

const reqIsoMs = (v: unknown): number | null => {
  if (typeof v !== 'string') return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
};

/** null/absent → null; valid ISO string → ms; anything else → undefined (reject). */
const optIsoMsStrict = (v: unknown): number | null | undefined => {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return undefined;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : undefined;
};

const isFiniteTs = (v: number): boolean => typeof v === 'number' && Number.isFinite(v);

export interface CarrierProfile {
  id: string;
  accountOwnerId: string | null;
  legalName: string;
  dbaName: string | null;
  usdotNumber: string | null;
  mcNumber: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  stateProvince: string | null;
  postalCode: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  equipmentTypes: string[];
  identitySource: CarrierIdentitySource;
  cloudStatus: CloudSyncStatus;
  createdAt: number;
  updatedAt: number;
}

export interface CarrierProfileSnapshot {
  legalName: string;
  dbaName: string | null;
  usdotNumber: string | null;
  mcNumber: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  stateProvince: string | null;
  postalCode: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  equipmentTypes: string[];
  identitySource: CarrierIdentitySource;
  capturedAt: number;
}

export interface CarrierDocumentRequirement {
  key: string;
  documentKind: DocumentKind;
  label: string;
  required: boolean;
  position: number;
}

export interface CarrierPacketTemplateDefinition {
  schemaVersion: typeof CARRIER_PACKET_TEMPLATE_SCHEMA_VERSION;
  name: string;
  requireCarrierProfile: boolean;
  documentRequirements: CarrierDocumentRequirement[];
}

export interface CarrierPacketTemplate {
  id: string;
  accountOwnerId: string | null;
  name: string;
  lifecycle: CarrierTemplateLifecycle;
  definition: CarrierPacketTemplateDefinition;
  cloudStatus: CloudSyncStatus;
  createdAt: number;
  updatedAt: number;
}

export interface CarrierPacket {
  id: string;
  accountOwnerId: string | null;
  status: CarrierPacketStatus;
  name: string;
  templateSourceKind: CarrierTemplateSourceKind;
  templateSourceId: string | null;
  templateCode: string | null;
  templateSnapshot: CarrierPacketTemplateDefinition;
  carrierProfileId: string | null;
  profileSnapshot: CarrierProfileSnapshot | null;
  recipientLabel: string | null;
  shareMethod: CarrierShareMethod | null;
  readyAt: number | null;
  sharedAt: number | null;
  supersedesPacketId: string | null;
  cloudStatus: CloudSyncStatus;
  createdAt: number;
  updatedAt: number;
}

export interface CarrierPacketItem {
  id: string;
  accountOwnerId: string | null;
  carrierPacketId: string;
  requirementKey: string;
  requirementLabel: string;
  required: boolean;
  position: number;
  operationalDocumentId: string;
  documentVersionId: string;
  documentKindSnapshot: DocumentKind;
  sensitivitySnapshot: Sensitivity;
  expiresAtSnapshot: string | null;
  titleSnapshot: string | null;
  createdAt: number;
}

export interface CarrierReviewFinding {
  code: CarrierReviewCode;
  severity: CarrierReviewSeverity;
  requirementKey?: string;
  message: string;
}

export interface CarrierPacketReview {
  findings: CarrierReviewFinding[];
  blockers: CarrierReviewFinding[];
  warnings: CarrierReviewFinding[];
  readyEligible: boolean;
}

export const CARRIER_PACKET_REQUIREMENTS_VARY_COPY =
  'Broker and customer requirements vary. Review the exact documents requested before sharing.';

export const CARRIER_PROFILE_ENTERED_COPY = 'These are the carrier details you entered.';
export const CARRIER_PROFILE_SOURCE_COPY = 'Entered by you';

export const CARRIER_PACKET_DISCLAIMER =
  'A ready packet passed RigReceipts’ bounded checks. It does not mean a broker will accept it, that anyone received it, or that any agreement was signed.';

export const MARK_SHARED_ATTESTATION_COPY =
  'Marking this packet shared records your attestation that this exact packet snapshot was shared. It does not prove delivery, receipt, acceptance, onboarding or agreement.';

export const COMBINED_PACKET_PDF = 'DEFERRED' as const;
export const COMBINED_PACKET_ZIP = 'DEFERRED' as const;
export const PROFILE_COVER_ARTIFACT = 'DEFERRED' as const;

export const CARRIER_PACKET_FORBIDDEN_COPY = [
  'FMCSA verified',
  'Authority active',
  'Broker approved',
  'Accepted everywhere',
  'Submitted',
  'Signed packet',
  'Send to broker',
  'Submit packet',
  'Accept agreement',
] as const;

export const STANDARD_BROKER_PACKET: CarrierPacketTemplateDefinition = {
  schemaVersion: 1,
  name: 'Standard broker packet',
  requireCarrierProfile: true,
  documentRequirements: [
    {
      key: 'w9',
      documentKind: 'W9',
      label: 'W-9',
      required: true,
      position: 0,
    },
    {
      key: 'coi',
      documentKind: 'CERTIFICATE_OF_INSURANCE',
      label: 'Certificate of insurance',
      required: true,
      position: 1,
    },
    {
      key: 'authority',
      documentKind: 'OPERATING_AUTHORITY',
      label: 'Operating authority',
      required: true,
      position: 2,
    },
    {
      key: 'factoring',
      documentKind: 'FACTORING_NOA',
      label: 'Factoring notice of assignment',
      required: false,
      position: 3,
    },
    {
      key: 'banking',
      documentKind: 'BANKING_DOCUMENT',
      label: 'Banking document',
      required: false,
      position: 4,
    },
  ],
};

type CarrierIdentityFields = Pick<
  CarrierProfileSnapshot,
  | 'legalName'
  | 'dbaName'
  | 'usdotNumber'
  | 'mcNumber'
  | 'addressLine1'
  | 'addressLine2'
  | 'city'
  | 'stateProvince'
  | 'postalCode'
  | 'contactName'
  | 'contactEmail'
  | 'contactPhone'
  | 'equipmentTypes'
  | 'identitySource'
>;

const validateCarrierIdentityFields = (row: CarrierIdentityFields): void => {
  if (!bounded(row.legalName.trim(), CARRIER_PROFILE_NAME_MAX)) {
    throw new Error('legalName is required');
  }
  if (row.identitySource !== 'USER_ENTERED') throw new Error('identitySource must be USER_ENTERED');
  if (!Array.isArray(row.equipmentTypes) || row.equipmentTypes.length > 20) {
    throw new Error('equipmentTypes out of bounds');
  }
  for (const eq of row.equipmentTypes) {
    if (!bounded(eq, 40)) throw new Error('equipment type out of bounds');
  }
  for (const [key, max] of [
    ['dbaName', 120],
    ['usdotNumber', 20],
    ['mcNumber', 20],
    ['addressLine1', 120],
    ['addressLine2', 120],
    ['city', 80],
    ['stateProvince', 40],
    ['postalCode', 20],
    ['contactName', 80],
    ['contactEmail', 80],
    ['contactPhone', 40],
  ] as const) {
    if (!optionalBounded(row[key], max)) throw new Error(`${key} out of bounds`);
  }
  if ('ein' in (row as object) || 'ssn' in (row as object) || 'bankAccount' in (row as object)) {
    throw new Error('forbidden financial scalar');
  }
};

export function validateCarrierProfileSnapshot(snapshot: CarrierProfileSnapshot): void {
  validateCarrierIdentityFields(snapshot);
  if (!isFiniteTs(snapshot.capturedAt)) throw new Error('capturedAt must be a finite timestamp');
}

export function validateCarrierProfile(profile: CarrierProfile): void {
  if (!isOpaqueId(profile.id)) throw new Error('carrier profile id is not an opaque id');
  if (profile.accountOwnerId !== null && typeof profile.accountOwnerId !== 'string') {
    throw new Error('invalid account owner');
  }
  validateCarrierIdentityFields(profile);
  if (!isFiniteTs(profile.createdAt) || !isFiniteTs(profile.updatedAt)) {
    throw new Error('profile timestamps must be finite');
  }
}

export function snapshotCarrierProfile(
  profile: CarrierProfile,
  now: number,
): CarrierProfileSnapshot {
  return {
    legalName: profile.legalName,
    dbaName: profile.dbaName,
    usdotNumber: profile.usdotNumber,
    mcNumber: profile.mcNumber,
    addressLine1: profile.addressLine1,
    addressLine2: profile.addressLine2,
    city: profile.city,
    stateProvince: profile.stateProvince,
    postalCode: profile.postalCode,
    contactName: profile.contactName,
    contactEmail: profile.contactEmail,
    contactPhone: profile.contactPhone,
    equipmentTypes: [...profile.equipmentTypes],
    identitySource: profile.identitySource,
    capturedAt: now,
  };
}

export function profileSnapshotEqualsCurrent(
  snapshot: CarrierProfileSnapshot | null,
  profile: CarrierProfile | null,
): boolean {
  if (!snapshot || !profile) return snapshot === null && profile === null;
  const live = snapshotCarrierProfile(profile, snapshot.capturedAt);
  return JSON.stringify({ ...live, capturedAt: 0 }) === JSON.stringify({ ...snapshot, capturedAt: 0 });
}

/**
 * Postgres jsonb does not preserve object key insertion order. Remote rows must
 * be rematerialized into domain field order so existing JSON.stringify evidence
 * comparators keep working. Comparators themselves are unchanged.
 */
export function rematerializeTemplateDefinition(
  def: CarrierPacketTemplateDefinition,
): CarrierPacketTemplateDefinition {
  return {
    schemaVersion: def.schemaVersion,
    name: def.name,
    requireCarrierProfile: def.requireCarrierProfile,
    documentRequirements: def.documentRequirements.map((req) => ({
      key: req.key,
      documentKind: req.documentKind,
      label: req.label,
      required: req.required,
      position: req.position,
    })),
  };
}

export function rematerializeProfileSnapshot(
  snapshot: CarrierProfileSnapshot,
): CarrierProfileSnapshot {
  return {
    legalName: snapshot.legalName,
    dbaName: snapshot.dbaName,
    usdotNumber: snapshot.usdotNumber,
    mcNumber: snapshot.mcNumber,
    addressLine1: snapshot.addressLine1,
    addressLine2: snapshot.addressLine2,
    city: snapshot.city,
    stateProvince: snapshot.stateProvince,
    postalCode: snapshot.postalCode,
    contactName: snapshot.contactName,
    contactEmail: snapshot.contactEmail,
    contactPhone: snapshot.contactPhone,
    equipmentTypes: [...snapshot.equipmentTypes],
    identitySource: snapshot.identitySource,
    capturedAt: snapshot.capturedAt,
  };
}

export function validateTemplateDefinition(def: CarrierPacketTemplateDefinition): void {
  if (def.schemaVersion !== 1) throw new Error('unsupported template schemaVersion');
  if (!bounded(def.name.trim(), CARRIER_PACKET_NAME_MAX)) throw new Error('template name required');
  if (typeof def.requireCarrierProfile !== 'boolean') throw new Error('requireCarrierProfile required');
  if (!Array.isArray(def.documentRequirements)) throw new Error('documentRequirements required');
  if (def.documentRequirements.length > CARRIER_PACKET_MAX_REQUIREMENTS) {
    throw new Error('too many document requirements');
  }
  const keys = new Set<string>();
  const kinds = new Set<DocumentKind>();
  const positions = new Set<number>();
  for (const req of def.documentRequirements) {
    if (!bounded(req.key, 40) || keys.has(req.key)) throw new Error('duplicate or invalid requirement key');
    keys.add(req.key);
    if (!isEnum(DOCUMENT_KINDS, req.documentKind)) throw new Error('unknown documentKind');
    if (kinds.has(req.documentKind)) throw new Error('duplicate documentKind in template');
    kinds.add(req.documentKind);
    if (!bounded(req.label, 80)) throw new Error('requirement label required');
    if (typeof req.required !== 'boolean') throw new Error('required flag missing');
    if (!Number.isSafeInteger(req.position) || req.position < 0 || positions.has(req.position)) {
      throw new Error('requirement position must be a unique safe integer ≥ 0');
    }
    positions.add(req.position);
  }
}

export function validateCarrierPacketTemplate(template: CarrierPacketTemplate): void {
  if (!isOpaqueId(template.id)) throw new Error('template id is not an opaque id');
  if (template.accountOwnerId !== null && typeof template.accountOwnerId !== 'string') {
    throw new Error('invalid account owner');
  }
  if (!isEnum(CARRIER_TEMPLATE_LIFECYCLES, template.lifecycle)) throw new Error('unknown lifecycle');
  validateTemplateDefinition(template.definition);
}

export function assertCarrierPacketStatusShape(packet: CarrierPacket): void {
  const { status, readyAt, sharedAt, shareMethod } = packet;
  if (status === 'DRAFT') {
    if (readyAt !== null || sharedAt !== null || shareMethod !== null) {
      throw new Error('DRAFT status-shape violation');
    }
    return;
  }
  if (status === 'READY') {
    if (readyAt === null || sharedAt !== null || shareMethod !== null) {
      throw new Error('READY status-shape violation');
    }
    return;
  }
  if (status === 'SHARED' || status === 'SUPERSEDED') {
    if (readyAt === null || sharedAt === null || shareMethod === null) {
      throw new Error(`${status} status-shape violation`);
    }
    return;
  }
  throw new Error('unknown packet status');
}

export function validateCarrierPacket(packet: CarrierPacket): void {
  if (!isOpaqueId(packet.id)) throw new Error('packet id is not an opaque id');
  if (packet.accountOwnerId !== null && typeof packet.accountOwnerId !== 'string') {
    throw new Error('invalid account owner');
  }
  if (!isEnum(CARRIER_PACKET_STATUSES, packet.status)) throw new Error('unknown packet status');
  if (!bounded(packet.name.trim(), CARRIER_PACKET_NAME_MAX)) throw new Error('packet name required');
  if (!isEnum(CARRIER_TEMPLATE_SOURCE_KINDS, packet.templateSourceKind)) {
    throw new Error('unknown template source');
  }
  if (packet.templateSourceKind === 'BUILTIN') {
    if (packet.templateCode !== STANDARD_BROKER_PACKET_CODE || packet.templateSourceId !== null) {
      throw new Error('BUILTIN packets require template_code and no template_source_id');
    }
  } else if (packet.templateSourceKind === 'CUSTOM') {
    if (!packet.templateSourceId || !isOpaqueId(packet.templateSourceId) || packet.templateCode !== null) {
      throw new Error('CUSTOM packets require template_source_id and no template_code');
    }
  }
  validateTemplateDefinition(packet.templateSnapshot);
  if (packet.carrierProfileId !== null && !isOpaqueId(packet.carrierProfileId)) {
    throw new Error('carrierProfileId is not an opaque id');
  }
  if (packet.profileSnapshot !== null) {
    validateCarrierProfileSnapshot(packet.profileSnapshot);
  }
  if (!optionalBounded(packet.recipientLabel, CARRIER_PACKET_RECIPIENT_MAX)) {
    throw new Error('recipientLabel out of bounds');
  }
  if (packet.shareMethod !== null && !isEnum(CARRIER_SHARE_METHODS, packet.shareMethod)) {
    throw new Error('unknown shareMethod');
  }
  if (packet.supersedesPacketId !== null && !isOpaqueId(packet.supersedesPacketId)) {
    throw new Error('supersedesPacketId is not an opaque id');
  }
  if (packet.supersedesPacketId === packet.id) {
    throw new Error('packet cannot supersede itself');
  }
  if (!isFiniteTs(packet.createdAt) || !isFiniteTs(packet.updatedAt)) {
    throw new Error('packet timestamps must be finite');
  }
  if (packet.readyAt !== null && !isFiniteTs(packet.readyAt)) {
    throw new Error('readyAt must be a finite timestamp');
  }
  if (packet.sharedAt !== null && !isFiniteTs(packet.sharedAt)) {
    throw new Error('sharedAt must be a finite timestamp');
  }
  assertCarrierPacketStatusShape(packet);
}

export function validateCarrierPacketItem(item: CarrierPacketItem): void {
  if (!isOpaqueId(item.id)) throw new Error('packet item id is not an opaque id');
  if (!isOpaqueId(item.carrierPacketId)) throw new Error('packet id is not an opaque id');
  if (!isOpaqueId(item.operationalDocumentId)) throw new Error('document id is not an opaque id');
  if (!isOpaqueId(item.documentVersionId)) throw new Error('version id is not an opaque id');
  if (item.accountOwnerId !== null && typeof item.accountOwnerId !== 'string') {
    throw new Error('invalid account owner');
  }
  if (!bounded(item.requirementKey, 40)) throw new Error('requirement key required');
  if (!bounded(item.requirementLabel, 80)) throw new Error('requirement label required');
  if (typeof item.required !== 'boolean') throw new Error('required flag missing');
  if (!Number.isSafeInteger(item.position) || item.position < 0) {
    throw new Error('position must be a safe integer ≥ 0');
  }
  if (!isEnum(DOCUMENT_KINDS, item.documentKindSnapshot)) throw new Error('unknown documentKind');
  if (!isEnum(SENSITIVITIES, item.sensitivitySnapshot)) throw new Error('unknown sensitivity');
  if (!isFiniteTs(item.createdAt)) throw new Error('item createdAt must be a finite timestamp');
}

const itemIntegrityMismatch = (
  requirementKey: string,
  message: string,
): CarrierReviewFinding => ({
  code: 'INTEGRITY_MISMATCH',
  severity: 'BLOCKER',
  requirementKey,
  message,
});

/**
 * Template-requirement ↔ packet-item integrity (Pass 3.2).
 * A W-9 requirement pointing at INSURANCE is never a valid packet item.
 * Live document-kind / exact-version ownership is checked when those records
 * are supplied (review + recovery after Road Wallet resolution).
 */
export function validatePacketItemAgainstTemplate(
  packet: CarrierPacket,
  item: CarrierPacketItem,
  live?: {
    document?: OperationalDocument | null;
    version?: DocumentVersion | null;
  },
): CarrierReviewFinding | null {
  const requirement = packet.templateSnapshot.documentRequirements.find(
    (req) => req.key === item.requirementKey,
  );
  if (!requirement) {
    return itemIntegrityMismatch(
      item.requirementKey,
      `Unknown requirement key ${item.requirementKey}.`,
    );
  }
  if (
    item.requirementLabel !== requirement.label ||
    item.required !== requirement.required ||
    item.position !== requirement.position ||
    item.documentKindSnapshot !== requirement.documentKind
  ) {
    return itemIntegrityMismatch(
      item.requirementKey,
      `Packet item ${requirement.label} does not match the template snapshot.`,
    );
  }
  const document = live?.document;
  if (document) {
    if (document.documentKind !== requirement.documentKind) {
      return itemIntegrityMismatch(
        item.requirementKey,
        `Live document kind for ${requirement.label} does not match the template requirement.`,
      );
    }
    if (document.accountOwnerId !== packet.accountOwnerId) {
      return itemIntegrityMismatch(
        item.requirementKey,
        `Live document owner for ${requirement.label} does not match the packet.`,
      );
    }
    if (document.id !== item.operationalDocumentId) {
      return itemIntegrityMismatch(
        item.requirementKey,
        `Live document id for ${requirement.label} does not match the packet item.`,
      );
    }
  }
  const version = live?.version;
  if (version) {
    if (version.operationalDocumentId !== item.operationalDocumentId) {
      return itemIntegrityMismatch(
        item.requirementKey,
        `Exact version for ${requirement.label} does not belong to the selected document.`,
      );
    }
    if (version.accountOwnerId !== packet.accountOwnerId) {
      return itemIntegrityMismatch(
        item.requirementKey,
        `Exact version owner for ${requirement.label} does not match the packet.`,
      );
    }
    if (document && version.operationalDocumentId !== document.id) {
      return itemIntegrityMismatch(
        item.requirementKey,
        `Exact version for ${requirement.label} no longer matches the wallet record.`,
      );
    }
  }
  return null;
}

export function assertPacketMutable(packet: CarrierPacket): void {
  if (packet.status === 'SHARED' || packet.status === 'SUPERSEDED') {
    throw new Error('historical packet is immutable');
  }
}

export function assertPacketDraft(packet: CarrierPacket): void {
  if (packet.status !== 'DRAFT') throw new Error('packet is not DRAFT');
}

export function canTransitionPacket(
  from: CarrierPacketStatus,
  to: CarrierPacketStatus,
): boolean {
  if (from === 'DRAFT' && to === 'READY') return true;
  if (from === 'READY' && to === 'DRAFT') return true;
  if (from === 'READY' && to === 'SHARED') return true;
  if (from === 'SHARED' && to === 'SUPERSEDED') return true;
  return false;
}

/**
 * Lifecycle-specific cloud projections (Pass 3.2).
 * A SHARED/SUPERSEDED local packet must not be staged by flipping `status`
 * alone — DRAFT/READY rows would otherwise carry share-time metadata.
 */
export function draftCloudProjection(packet: CarrierPacket): CarrierPacket {
  return {
    ...packet,
    status: 'DRAFT',
    readyAt: null,
    sharedAt: null,
    shareMethod: null,
  };
}

export function readyCloudProjection(packet: CarrierPacket): CarrierPacket {
  return {
    ...packet,
    status: 'READY',
    readyAt: packet.readyAt,
    sharedAt: null,
    shareMethod: null,
  };
}

export function sharedCloudProjection(packet: CarrierPacket): CarrierPacket {
  return {
    ...packet,
    status: 'SHARED',
    readyAt: packet.readyAt,
    sharedAt: packet.sharedAt,
    shareMethod: packet.shareMethod,
  };
}

export function supersededCloudProjection(packet: CarrierPacket): CarrierPacket {
  return {
    ...packet,
    status: 'SUPERSEDED',
    readyAt: packet.readyAt,
    sharedAt: packet.sharedAt,
    shareMethod: packet.shareMethod,
  };
}

/** Reviewed snapshot fields that READY → SHARED / SUPERSEDED must preserve. */
export function reviewedCarrierPacketSnapshot(packet: CarrierPacket) {
  return {
    id: packet.id,
    accountOwnerId: packet.accountOwnerId,
    createdAt: packet.createdAt,
    name: packet.name,
    templateSourceKind: packet.templateSourceKind,
    templateSourceId: packet.templateSourceId,
    templateCode: packet.templateCode,
    templateSnapshot: packet.templateSnapshot,
    carrierProfileId: packet.carrierProfileId,
    profileSnapshot: packet.profileSnapshot,
    readyAt: packet.readyAt,
    supersedesPacketId: packet.supersedesPacketId,
  };
}

/**
 * Remote READY must match the local SHARED/SUPERSEDED reviewed snapshot
 * before a share-time promotion is written. Status, sharedAt, shareMethod,
 * recipientLabel, and updatedAt are the only legitimate Mark Shared deltas.
 */
export function readySnapshotMatchesSharedTransition(
  remoteReady: CarrierPacket,
  localShared: CarrierPacket,
): boolean {
  if (remoteReady.status !== 'READY') return false;
  if (localShared.status !== 'SHARED' && localShared.status !== 'SUPERSEDED') return false;
  return (
    JSON.stringify(reviewedCarrierPacketSnapshot(remoteReady)) ===
    JSON.stringify(reviewedCarrierPacketSnapshot(localShared))
  );
}

export function carrierPacketPersistedEvidence(packet: CarrierPacket) {
  return {
    id: packet.id,
    accountOwnerId: packet.accountOwnerId,
    status: packet.status,
    name: packet.name,
    templateSourceKind: packet.templateSourceKind,
    templateSourceId: packet.templateSourceId,
    templateCode: packet.templateCode,
    templateSnapshot: packet.templateSnapshot,
    carrierProfileId: packet.carrierProfileId,
    profileSnapshot: packet.profileSnapshot,
    recipientLabel: packet.recipientLabel,
    shareMethod: packet.shareMethod,
    readyAt: packet.readyAt,
    sharedAt: packet.sharedAt,
    supersedesPacketId: packet.supersedesPacketId,
    createdAt: packet.createdAt,
  };
}

export function carrierPacketPersistedEvidenceExactlyMatches(
  a: CarrierPacket,
  b: CarrierPacket,
): boolean {
  return (
    JSON.stringify(carrierPacketPersistedEvidence(a)) ===
    JSON.stringify(carrierPacketPersistedEvidence(b))
  );
}

/**
 * SHARED → SUPERSEDED may change only status (plus local updatedAt/cloudStatus).
 * readyAt and createdAt are part of the historical evidence and must match.
 */
export function sharedSnapshotMatchesSupersededTransition(
  remoteShared: CarrierPacket,
  localSuperseded: CarrierPacket,
): boolean {
  if (remoteShared.status !== 'SHARED') return false;
  if (localSuperseded.status !== 'SUPERSEDED') return false;
  const { status: _rs, ...remoteEvidence } = carrierPacketPersistedEvidence(remoteShared);
  const { status: _ls, ...localEvidence } = carrierPacketPersistedEvidence(localSuperseded);
  return JSON.stringify(remoteEvidence) === JSON.stringify(localEvidence);
}

export function carrierPacketItemPersistedEvidence(item: CarrierPacketItem) {
  return {
    id: item.id,
    accountOwnerId: item.accountOwnerId,
    carrierPacketId: item.carrierPacketId,
    requirementKey: item.requirementKey,
    requirementLabel: item.requirementLabel,
    required: item.required,
    position: item.position,
    operationalDocumentId: item.operationalDocumentId,
    documentVersionId: item.documentVersionId,
    documentKindSnapshot: item.documentKindSnapshot,
    sensitivitySnapshot: item.sensitivitySnapshot,
    expiresAtSnapshot: item.expiresAtSnapshot,
    titleSnapshot: item.titleSnapshot,
    createdAt: item.createdAt,
  };
}

export function carrierPacketItemsExactlyMatch(
  a: readonly CarrierPacketItem[],
  b: readonly CarrierPacketItem[],
): boolean {
  const key = (item: CarrierPacketItem) => JSON.stringify(carrierPacketItemPersistedEvidence(item));
  return a.map(key).sort().join('|') === b.map(key).sort().join('|');
}

export type CarrierPacketPersistedEvidence = ReturnType<typeof carrierPacketPersistedEvidence>;
export type CarrierPacketItemPersistedEvidence = ReturnType<typeof carrierPacketItemPersistedEvidence>;

/**
 * Local-only proof that the user explicitly returned this packet from a
 * specific READY snapshot (IR-03). Never sent to Supabase. Never auto-claimed.
 */
export interface CarrierReadyReturnProof {
  packetId: string;
  accountOwnerId: string;
  readyPacketEvidence: CarrierPacketPersistedEvidence;
  readyItemsEvidence: CarrierPacketItemPersistedEvidence[];
  createdAt: number;
}

export function draftProjectionFromReadyEvidence(
  ready: CarrierPacketPersistedEvidence,
): CarrierPacketPersistedEvidence {
  return {
    ...ready,
    status: 'DRAFT',
    readyAt: null,
    sharedAt: null,
    shareMethod: null,
  };
}

export function carrierPacketMatchesPersistedEvidence(
  packet: CarrierPacket,
  evidence: CarrierPacketPersistedEvidence,
): boolean {
  return JSON.stringify(carrierPacketPersistedEvidence(packet)) === JSON.stringify(evidence);
}

export function carrierPacketItemsMatchPersistedEvidence(
  items: readonly CarrierPacketItem[],
  evidence: readonly CarrierPacketItemPersistedEvidence[],
): boolean {
  const key = (row: CarrierPacketItemPersistedEvidence) => JSON.stringify(row);
  return (
    items.map((item) => key(carrierPacketItemPersistedEvidence(item))).sort().join('|') ===
    [...evidence].map(key).sort().join('|')
  );
}

export function createCarrierReadyReturnProof(input: {
  packet: CarrierPacket;
  items: readonly CarrierPacketItem[];
  now: number;
}): CarrierReadyReturnProof {
  if (input.packet.status !== 'READY') {
    throw new Error('return-to-draft proof requires a READY packet');
  }
  if (!input.packet.accountOwnerId) {
    throw new Error('return-to-draft proof requires an account-scoped packet');
  }
  return {
    packetId: input.packet.id,
    accountOwnerId: input.packet.accountOwnerId,
    readyPacketEvidence: carrierPacketPersistedEvidence(input.packet),
    readyItemsEvidence: input.items.map(carrierPacketItemPersistedEvidence),
    createdAt: input.now,
  };
}

const isPersistedPacketEvidence = (v: unknown): v is CarrierPacketPersistedEvidence => {
  if (!isRec(v)) return false;
  if (typeof v.id !== 'string' || !isOpaqueId(v.id)) return false;
  if (typeof v.accountOwnerId !== 'string' || !v.accountOwnerId) return false;
  if (!isEnum(CARRIER_PACKET_STATUSES, v.status)) return false;
  if (typeof v.name !== 'string') return false;
  if (!isEnum(CARRIER_TEMPLATE_SOURCE_KINDS, v.templateSourceKind)) return false;
  if (v.templateSourceId !== null && typeof v.templateSourceId !== 'string') return false;
  if (v.templateCode !== null && typeof v.templateCode !== 'string') return false;
  if (!isRec(v.templateSnapshot) || Array.isArray(v.templateSnapshot)) return false;
  if (v.carrierProfileId !== null && typeof v.carrierProfileId !== 'string') return false;
  if (v.profileSnapshot !== null && (!isRec(v.profileSnapshot) || Array.isArray(v.profileSnapshot))) {
    return false;
  }
  if (v.recipientLabel !== null && typeof v.recipientLabel !== 'string') return false;
  if (v.shareMethod !== null && !isEnum(CARRIER_SHARE_METHODS, v.shareMethod)) return false;
  if (v.readyAt !== null && (typeof v.readyAt !== 'number' || !Number.isFinite(v.readyAt))) return false;
  if (v.sharedAt !== null && (typeof v.sharedAt !== 'number' || !Number.isFinite(v.sharedAt))) return false;
  if (v.supersedesPacketId !== null && typeof v.supersedesPacketId !== 'string') return false;
  if (typeof v.createdAt !== 'number' || !Number.isFinite(v.createdAt)) return false;
  return true;
};

const isPersistedItemEvidence = (v: unknown): v is CarrierPacketItemPersistedEvidence => {
  if (!isRec(v)) return false;
  if (typeof v.id !== 'string' || !isOpaqueId(v.id)) return false;
  if (typeof v.accountOwnerId !== 'string' || !v.accountOwnerId) return false;
  if (typeof v.carrierPacketId !== 'string' || !isOpaqueId(v.carrierPacketId)) return false;
  if (typeof v.requirementKey !== 'string') return false;
  if (typeof v.requirementLabel !== 'string') return false;
  if (typeof v.required !== 'boolean') return false;
  if (typeof v.position !== 'number' || !Number.isSafeInteger(v.position)) return false;
  if (typeof v.operationalDocumentId !== 'string' || !isOpaqueId(v.operationalDocumentId)) return false;
  if (typeof v.documentVersionId !== 'string' || !isOpaqueId(v.documentVersionId)) return false;
  if (!isEnum(DOCUMENT_KINDS, v.documentKindSnapshot)) return false;
  if (!isEnum(SENSITIVITIES, v.sensitivitySnapshot)) return false;
  if (v.expiresAtSnapshot !== null && typeof v.expiresAtSnapshot !== 'string') return false;
  if (v.titleSnapshot !== null && typeof v.titleSnapshot !== 'string') return false;
  if (typeof v.createdAt !== 'number' || !Number.isFinite(v.createdAt)) return false;
  return true;
};

/** Hydration: discard invalid / incomplete proofs. Never mint a proof id. */
export function sanitizeReadyReturnProof(raw: unknown): CarrierReadyReturnProof | null {
  if (!isRec(raw)) return null;
  if (typeof raw.packetId !== 'string' || !isOpaqueId(raw.packetId)) return null;
  if (typeof raw.accountOwnerId !== 'string' || !raw.accountOwnerId) return null;
  if (!isPersistedPacketEvidence(raw.readyPacketEvidence)) return null;
  if (raw.readyPacketEvidence.id !== raw.packetId) return null;
  if (raw.readyPacketEvidence.accountOwnerId !== raw.accountOwnerId) return null;
  if (raw.readyPacketEvidence.status !== 'READY') return null;
  if (!Array.isArray(raw.readyItemsEvidence)) return null;
  const items: CarrierPacketItemPersistedEvidence[] = [];
  for (const row of raw.readyItemsEvidence) {
    if (!isPersistedItemEvidence(row)) return null;
    if (row.carrierPacketId !== raw.packetId) return null;
    if (row.accountOwnerId !== raw.accountOwnerId) return null;
    items.push(row);
  }
  if (typeof raw.createdAt !== 'number' || !Number.isFinite(raw.createdAt)) return null;
  return {
    packetId: raw.packetId,
    accountOwnerId: raw.accountOwnerId,
    readyPacketEvidence: raw.readyPacketEvidence,
    readyItemsEvidence: items,
    createdAt: raw.createdAt,
  };
}

export function readyReturnProofMatchesRemoteReady(
  proof: CarrierReadyReturnProof,
  remoteReady: CarrierPacket,
  remoteItems: readonly CarrierPacketItem[],
): boolean {
  return (
    proof.packetId === remoteReady.id &&
    proof.accountOwnerId === remoteReady.accountOwnerId &&
    remoteReady.status === 'READY' &&
    carrierPacketMatchesPersistedEvidence(remoteReady, proof.readyPacketEvidence) &&
    carrierPacketItemsMatchPersistedEvidence(remoteItems, proof.readyItemsEvidence)
  );
}

export function remoteDraftIsProvenReadyProjection(
  proof: CarrierReadyReturnProof,
  remoteDraft: CarrierPacket,
  remoteItems: readonly CarrierPacketItem[],
): boolean {
  return (
    proof.packetId === remoteDraft.id &&
    proof.accountOwnerId === remoteDraft.accountOwnerId &&
    remoteDraft.status === 'DRAFT' &&
    carrierPacketMatchesPersistedEvidence(
      remoteDraft,
      draftProjectionFromReadyEvidence(proof.readyPacketEvidence),
    ) &&
    carrierPacketItemsMatchPersistedEvidence(remoteItems, proof.readyItemsEvidence)
  );
}

export function freezePacketItem(input: {
  id: string;
  packet: CarrierPacket;
  requirement: CarrierDocumentRequirement;
  document: OperationalDocument;
  version: DocumentVersion;
  now: number;
}): CarrierPacketItem {
  if (input.document.accountOwnerId !== input.packet.accountOwnerId) {
    throw new Error('document owner mismatch');
  }
  if (input.version.operationalDocumentId !== input.document.id) {
    throw new Error('version does not belong to document');
  }
  if (input.version.accountOwnerId !== input.document.accountOwnerId) {
    throw new Error('version owner mismatch');
  }
  return {
    id: input.id,
    accountOwnerId: input.packet.accountOwnerId,
    carrierPacketId: input.packet.id,
    requirementKey: input.requirement.key,
    requirementLabel: input.requirement.label,
    required: input.requirement.required,
    position: input.requirement.position,
    operationalDocumentId: input.document.id,
    documentVersionId: input.version.id,
    documentKindSnapshot: input.document.documentKind,
    sensitivitySnapshot: input.document.sensitivity,
    expiresAtSnapshot: input.document.expiresAt,
    titleSnapshot: input.document.title,
    createdAt: input.now,
  };
}

export function matchingDocumentsForKind(
  kind: DocumentKind,
  documents: readonly OperationalDocument[],
  sessionUserId: string | null,
): OperationalDocument[] {
  return documents.filter(
    (d) =>
      d.documentKind === kind &&
      d.lifecycle === 'ACTIVE' &&
      isVisibleInSession(d, sessionUserId),
  );
}

export function reviewCarrierPacket(input: {
  packet: CarrierPacket;
  items: CarrierPacketItem[];
  profile: CarrierProfile | null;
  documents: readonly OperationalDocument[];
  versions: readonly DocumentVersion[];
  now: Date;
}): CarrierPacketReview {
  const findings: CarrierReviewFinding[] = [];
  const def = input.packet.templateSnapshot;
  if (def.requireCarrierProfile && !input.packet.profileSnapshot && !input.profile) {
    findings.push({
      code: 'MISSING_CARRIER_PROFILE',
      severity: 'BLOCKER',
      message: 'Carrier Profile is missing.',
    });
  }
  if (
    (input.packet.status === 'READY' || input.packet.status === 'SHARED') &&
    input.packet.profileSnapshot &&
    input.profile &&
    !profileSnapshotEqualsCurrent(input.packet.profileSnapshot, input.profile)
  ) {
    findings.push({
      code: 'PROFILE_CHANGED',
      severity: 'BLOCKER',
      message: 'Carrier Profile changed after this packet was reviewed. Return to draft and refresh.',
    });
  }
  const snap = input.packet.profileSnapshot ?? (input.profile ? snapshotCarrierProfile(input.profile, 0) : null);
  if (snap && (!snap.usdotNumber || !snap.mcNumber)) {
    findings.push({
      code: 'PROFILE_IDENTIFIER_MISSING',
      severity: 'WARNING',
      message: 'USDOT or MC is not filled in. Entered by you — not verified.',
    });
  }

  for (const req of def.documentRequirements) {
    const item = input.items.find((i) => i.requirementKey === req.key);
    if (!item) {
      findings.push({
        code: req.required ? 'MISSING_REQUIRED_DOCUMENT' : 'OPTIONAL_DOCUMENT_MISSING',
        severity: req.required ? 'BLOCKER' : 'WARNING',
        requirementKey: req.key,
        message: req.required
          ? `Required document missing: ${req.label}.`
          : `Optional document not included: ${req.label}.`,
      });
      continue;
    }
    const doc = input.documents.find((d) => d.id === item.operationalDocumentId);
    const version = input.versions.find((v) => v.id === item.documentVersionId);
    const templateMismatch = validatePacketItemAgainstTemplate(input.packet, item, {
      document: doc,
      version,
    });
    if (templateMismatch) {
      findings.push(templateMismatch);
      continue;
    }
    if (
      !doc ||
      !version ||
      version.operationalDocumentId !== doc.id ||
      doc.accountOwnerId !== input.packet.accountOwnerId ||
      version.accountOwnerId !== doc.accountOwnerId
    ) {
      findings.push({
        code: 'INTEGRITY_MISMATCH',
        severity: 'BLOCKER',
        requirementKey: req.key,
        message: `Exact version for ${req.label} no longer matches the wallet record.`,
      });
      continue;
    }
    if (doc.lifecycle === 'ARCHIVED') {
      findings.push({
        code: 'ARCHIVED_DOCUMENT',
        severity: 'BLOCKER',
        requirementKey: req.key,
        message: `${req.label} is archived.`,
      });
    }
    const liveCurrent = currentVersion(input.versions, doc.id);
    if (!liveCurrent) {
      findings.push({
        code: 'NO_CURRENT_VERSION',
        severity: 'BLOCKER',
        requirementKey: req.key,
        message: `${req.label} has no current version.`,
      });
    } else if (liveCurrent.id !== item.documentVersionId) {
      findings.push({
        code: 'STALE_VERSION',
        severity: 'BLOCKER',
        requirementKey: req.key,
        message: 'Newer wallet version available. Return to draft and refresh this item.',
      });
    }
    const validity = deriveValidity(doc.expiresAt, input.now);
    if (req.required && validity === 'EXPIRED') {
      findings.push({
        code: 'EXPIRED_REQUIRED_DOCUMENT',
        severity: 'BLOCKER',
        requirementKey: req.key,
        message: `${req.label} is expired.`,
      });
    } else if (validity === 'EXPIRING_SOON') {
      findings.push({
        code: 'EXPIRING_SOON',
        severity: 'WARNING',
        requirementKey: req.key,
        message: `${req.label} is expiring soon.`,
      });
    }
    if (doc.sensitivity === 'PERSONAL_SENSITIVE') {
      findings.push({
        code: 'PERSONAL_SENSITIVE',
        severity: 'WARNING',
        requirementKey: req.key,
        message: `${req.label} is personal-sensitive. Share/Export still needs its own acknowledgement.`,
      });
    }
    if (doc.sensitivity === 'FINANCIAL_SENSITIVE') {
      findings.push({
        code: 'FINANCIAL_SENSITIVE',
        severity: 'WARNING',
        requirementKey: req.key,
        message: `${req.label} is financial-sensitive. Share/Export still needs its own acknowledgement.`,
      });
    }
    if (version.fileCache.state !== 'READY') {
      if (version.cloudStatus === 'synced') {
        findings.push({
          code: 'RESTORE_REQUIRED',
          severity: 'WARNING',
          requirementKey: req.key,
          message: `${req.label} is backed up but not on this device. Restore the exact version to share.`,
        });
      } else {
        findings.push({
          code: 'FILE_UNAVAILABLE_WITHOUT_RECOVERY',
          severity: 'BLOCKER',
          requirementKey: req.key,
          message: `${req.label} is not available on this device and has no backup to restore.`,
        });
      }
    }
  }

  for (const item of input.items) {
    if (!def.documentRequirements.some((req) => req.key === item.requirementKey)) {
      findings.push(
        itemIntegrityMismatch(
          item.requirementKey,
          `Unknown requirement key ${item.requirementKey}.`,
        ),
      );
    }
  }

  const blockers = findings.filter((f) => f.severity === 'BLOCKER');
  const warnings = findings.filter((f) => f.severity === 'WARNING');
  return {
    findings,
    blockers,
    warnings,
    readyEligible: blockers.length === 0,
  };
}

export function canMutateCarrierProfile(tier: CloudSyncContext['tier']): boolean {
  return canUseFeature(tier, 'carrierProfile');
}
export function canMutateCarrierTemplates(tier: CloudSyncContext['tier']): boolean {
  return canUseFeature(tier, 'carrierPacketTemplates');
}
export function canMutateCarrierPackets(tier: CloudSyncContext['tier']): boolean {
  return canUseFeature(tier, 'carrierPacketBuilder');
}
export function canViewCarrierHistory(tier: CloudSyncContext['tier']): boolean {
  return canUseFeature(tier, 'carrierPacketHistory');
}

const authorizeFeatureWrite = (
  ctx: CloudSyncContext,
  entitled: boolean,
  contentOwnerId: string | null | undefined,
): CloudSyncDecision => {
  if (!entitled) return { allowed: false, userId: null, reason: 'not_entitled' };
  return authorizeCloudSync(ctx, 'cloudDocumentBackup', contentOwnerId);
};

export function authorizeCarrierProfileCloudWrite(
  ctx: CloudSyncContext,
  contentOwnerId: string | null | undefined,
): CloudSyncDecision {
  return authorizeFeatureWrite(ctx, canMutateCarrierProfile(ctx.tier), contentOwnerId);
}
export function authorizeCarrierTemplateCloudWrite(
  ctx: CloudSyncContext,
  contentOwnerId: string | null | undefined,
): CloudSyncDecision {
  return authorizeFeatureWrite(ctx, canMutateCarrierTemplates(ctx.tier), contentOwnerId);
}
export function authorizeCarrierPacketCloudWrite(
  ctx: CloudSyncContext,
  contentOwnerId: string | null | undefined,
): CloudSyncDecision {
  return authorizeFeatureWrite(ctx, canMutateCarrierPackets(ctx.tier), contentOwnerId);
}

export function carrierStatusAfterMutation(
  ctx: CloudSyncContext,
  entitled: boolean,
  contentOwnerId: string | null | undefined,
): Extract<CloudSyncStatus, 'local_only' | 'pending_sync'> {
  if (!entitled) return 'local_only';
  return statusAfterLocalMutation(ctx, 'cloudDocumentBackup', contentOwnerId);
}

export function reconcileCarrierCloudStatus(
  current: CloudSyncStatus,
  writeAllowed: boolean,
): CloudSyncStatus {
  if (current === 'synced') return 'synced';
  return writeAllowed ? 'pending_sync' : 'local_only';
}

export interface CarrierRecoveryResult {
  profilesRecovered: number;
  templatesRecovered: number;
  packetsRecovered: number;
  itemsRecovered: number;
  integrityConflicts: number;
  skippedLocalChanges: number;
  outcome: 'completed' | 'signed_out' | 'not_configured' | 'cancelled' | 'fetch_failed';
}

export const emptyCarrierRecoveryResult = (
  outcome: CarrierRecoveryResult['outcome'] = 'completed',
): CarrierRecoveryResult => ({
  profilesRecovered: 0,
  templatesRecovered: 0,
  packetsRecovered: 0,
  itemsRecovered: 0,
  integrityConflicts: 0,
  skippedLocalChanges: 0,
  outcome,
});

export function writeSafeFromCarrierRecovery(
  result: CarrierRecoveryResult | null | undefined,
): boolean {
  return !!result && result.outcome === 'completed' && result.integrityConflicts === 0;
}

export interface RemoteCarrierProfileRow {
  id: string;
  owner_id: string;
  legal_name: string;
  dba_name: string | null;
  usdot_number: string | null;
  mc_number: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state_province: string | null;
  postal_code: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  equipment_types: string[];
  identity_source: 'USER_ENTERED';
  created_at: string;
  updated_at: string;
}

export function toRemoteCarrierProfileRow(
  profile: CarrierProfile,
  ownerId: string,
): RemoteCarrierProfileRow {
  return {
    id: profile.id,
    owner_id: ownerId,
    legal_name: profile.legalName,
    dba_name: profile.dbaName,
    usdot_number: profile.usdotNumber,
    mc_number: profile.mcNumber,
    address_line1: profile.addressLine1,
    address_line2: profile.addressLine2,
    city: profile.city,
    state_province: profile.stateProvince,
    postal_code: profile.postalCode,
    contact_name: profile.contactName,
    contact_email: profile.contactEmail,
    contact_phone: profile.contactPhone,
    equipment_types: profile.equipmentTypes,
    identity_source: 'USER_ENTERED',
    created_at: new Date(profile.createdAt).toISOString(),
    updated_at: new Date(profile.updatedAt).toISOString(),
  };
}

/** Optional profile scalar: string or null only. Number/object/boolean reject the row. */
const optProfileScalar = (v: unknown): string | null | undefined => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  return undefined;
};

const reqEquipmentTypes = (v: unknown): string[] | null => {
  if (!Array.isArray(v)) return null;
  if (!v.every((x): x is string => typeof x === 'string')) return null;
  return v;
};

export function fromRemoteCarrierProfileRow(
  row: unknown,
  sessionUserId: string,
): CarrierProfile | null {
  if (!isRec(row)) return null;
  if (row.owner_id !== sessionUserId) return null;
  if (typeof row.id !== 'string' || !isOpaqueId(row.id)) return null;
  if (typeof row.legal_name !== 'string') return null;
  if (row.identity_source !== 'USER_ENTERED') return null;
  const createdAt = reqIsoMs(row.created_at);
  const updatedAt = reqIsoMs(row.updated_at);
  if (createdAt === null || updatedAt === null) return null;
  const dbaName = optProfileScalar(row.dba_name);
  const usdotNumber = optProfileScalar(row.usdot_number);
  const mcNumber = optProfileScalar(row.mc_number);
  const addressLine1 = optProfileScalar(row.address_line1);
  const addressLine2 = optProfileScalar(row.address_line2);
  const city = optProfileScalar(row.city);
  const stateProvince = optProfileScalar(row.state_province);
  const postalCode = optProfileScalar(row.postal_code);
  const contactName = optProfileScalar(row.contact_name);
  const contactEmail = optProfileScalar(row.contact_email);
  const contactPhone = optProfileScalar(row.contact_phone);
  if (
    dbaName === undefined ||
    usdotNumber === undefined ||
    mcNumber === undefined ||
    addressLine1 === undefined ||
    addressLine2 === undefined ||
    city === undefined ||
    stateProvince === undefined ||
    postalCode === undefined ||
    contactName === undefined ||
    contactEmail === undefined ||
    contactPhone === undefined
  ) {
    return null;
  }
  const equipmentTypes = reqEquipmentTypes(row.equipment_types);
  if (equipmentTypes === null) return null;
  const profile: CarrierProfile = {
    id: row.id,
    accountOwnerId: sessionUserId,
    legalName: row.legal_name,
    dbaName,
    usdotNumber,
    mcNumber,
    addressLine1,
    addressLine2,
    city,
    stateProvince,
    postalCode,
    contactName,
    contactEmail,
    contactPhone,
    equipmentTypes,
    identitySource: 'USER_ENTERED',
    cloudStatus: 'synced',
    createdAt,
    updatedAt,
  };
  try {
    validateCarrierProfile(profile);
  } catch {
    return null;
  }
  return profile;
}

export function toRemoteCarrierTemplateRow(template: CarrierPacketTemplate, ownerId: string) {
  return {
    id: template.id,
    owner_id: ownerId,
    name: template.name,
    lifecycle: template.lifecycle,
    definition: template.definition,
    created_at: new Date(template.createdAt).toISOString(),
    updated_at: new Date(template.updatedAt).toISOString(),
  };
}

export function fromRemoteCarrierTemplateRow(
  row: unknown,
  sessionUserId: string,
): CarrierPacketTemplate | null {
  if (!isRec(row)) return null;
  if (row.owner_id !== sessionUserId) return null;
  if (typeof row.id !== 'string' || !isOpaqueId(row.id)) return null;
  if (typeof row.name !== 'string') return null;
  if (!isEnum(CARRIER_TEMPLATE_LIFECYCLES, row.lifecycle)) return null;
  if (!isRec(row.definition) || Array.isArray(row.definition)) return null;
  const createdAt = reqIsoMs(row.created_at);
  const updatedAt = reqIsoMs(row.updated_at);
  if (createdAt === null || updatedAt === null) return null;
  let definition: CarrierPacketTemplateDefinition;
  try {
    definition = rematerializeTemplateDefinition(
      row.definition as unknown as CarrierPacketTemplateDefinition,
    );
    validateTemplateDefinition(definition);
  } catch {
    return null;
  }
  const template: CarrierPacketTemplate = {
    id: row.id,
    accountOwnerId: sessionUserId,
    name: row.name,
    lifecycle: row.lifecycle,
    definition,
    cloudStatus: 'synced',
    createdAt,
    updatedAt,
  };
  try {
    validateCarrierPacketTemplate(template);
  } catch {
    return null;
  }
  return template;
}

export function toRemoteCarrierPacketRow(packet: CarrierPacket, ownerId: string) {
  return {
    id: packet.id,
    owner_id: ownerId,
    status: packet.status,
    name: packet.name,
    template_source_kind: packet.templateSourceKind,
    template_source_id: packet.templateSourceId,
    template_code: packet.templateCode,
    template_snapshot: packet.templateSnapshot,
    carrier_profile_id: packet.carrierProfileId,
    profile_snapshot: packet.profileSnapshot,
    recipient_label: packet.recipientLabel,
    share_method: packet.shareMethod,
    ready_at: packet.readyAt !== null ? new Date(packet.readyAt).toISOString() : null,
    shared_at: packet.sharedAt !== null ? new Date(packet.sharedAt).toISOString() : null,
    supersedes_packet_id: packet.supersedesPacketId,
    created_at: new Date(packet.createdAt).toISOString(),
    updated_at: new Date(packet.updatedAt).toISOString(),
  };
}

export function fromRemoteCarrierPacketRow(
  row: unknown,
  sessionUserId: string,
): CarrierPacket | null {
  if (!isRec(row)) return null;
  if (row.owner_id !== sessionUserId) return null;
  if (typeof row.id !== 'string' || !isOpaqueId(row.id)) return null;
  if (!isEnum(CARRIER_PACKET_STATUSES, row.status)) return null;
  if (typeof row.name !== 'string') return null;
  if (!isEnum(CARRIER_TEMPLATE_SOURCE_KINDS, row.template_source_kind)) return null;
  const createdAt = reqIsoMs(row.created_at);
  const updatedAt = reqIsoMs(row.updated_at);
  if (createdAt === null || updatedAt === null) return null;
  const templateSourceId = optStrStrict(row.template_source_id);
  const templateCode = optStrStrict(row.template_code);
  const carrierProfileId = optStrStrict(row.carrier_profile_id);
  const supersedesPacketId = optStrStrict(row.supersedes_packet_id);
  const recipientLabel = optStrStrict(row.recipient_label);
  const shareMethod = optShareMethod(row.share_method);
  const readyAt = optIsoMsStrict(row.ready_at);
  const sharedAt = optIsoMsStrict(row.shared_at);
  if (
    templateSourceId === undefined ||
    templateCode === undefined ||
    carrierProfileId === undefined ||
    supersedesPacketId === undefined ||
    recipientLabel === undefined ||
    shareMethod === undefined ||
    readyAt === undefined ||
    sharedAt === undefined
  ) {
    return null;
  }
  if (!isRec(row.template_snapshot) || Array.isArray(row.template_snapshot)) return null;
  let templateSnapshot: CarrierPacketTemplateDefinition;
  try {
    templateSnapshot = rematerializeTemplateDefinition(
      row.template_snapshot as unknown as CarrierPacketTemplateDefinition,
    );
    validateTemplateDefinition(templateSnapshot);
  } catch {
    return null;
  }
  let profileSnapshot: CarrierProfileSnapshot | null = null;
  if (row.profile_snapshot !== null && row.profile_snapshot !== undefined) {
    if (!isRec(row.profile_snapshot) || Array.isArray(row.profile_snapshot)) return null;
    try {
      profileSnapshot = rematerializeProfileSnapshot(
        row.profile_snapshot as unknown as CarrierProfileSnapshot,
      );
      validateCarrierProfileSnapshot(profileSnapshot);
    } catch {
      return null;
    }
  }
  const packet: CarrierPacket = {
    id: row.id,
    accountOwnerId: sessionUserId,
    status: row.status,
    name: row.name,
    templateSourceKind: row.template_source_kind,
    templateSourceId,
    templateCode,
    templateSnapshot,
    carrierProfileId,
    profileSnapshot,
    recipientLabel,
    shareMethod,
    readyAt,
    sharedAt,
    supersedesPacketId,
    cloudStatus: 'synced',
    createdAt,
    updatedAt,
  };
  try {
    validateCarrierPacket(packet);
  } catch {
    return null;
  }
  return packet;
}

export function toRemoteCarrierPacketItemRow(item: CarrierPacketItem, ownerId: string) {
  return {
    id: item.id,
    owner_id: ownerId,
    carrier_packet_id: item.carrierPacketId,
    requirement_key: item.requirementKey,
    requirement_label: item.requirementLabel,
    required: item.required,
    position: item.position,
    operational_document_id: item.operationalDocumentId,
    document_version_id: item.documentVersionId,
    document_kind_snapshot: item.documentKindSnapshot,
    sensitivity_snapshot: item.sensitivitySnapshot,
    expires_at_snapshot: item.expiresAtSnapshot,
    title_snapshot: item.titleSnapshot,
    created_at: new Date(item.createdAt).toISOString(),
  };
}

export function fromRemoteCarrierPacketItemRow(
  row: unknown,
  sessionUserId: string,
  parent: CarrierPacket,
): CarrierPacketItem | null {
  if (!isRec(row)) return null;
  if (row.owner_id !== sessionUserId || parent.accountOwnerId !== sessionUserId) return null;
  if (row.carrier_packet_id !== parent.id) return null;
  if (typeof row.id !== 'string' || !isOpaqueId(row.id)) return null;
  if (typeof row.requirement_key !== 'string') return null;
  if (typeof row.requirement_label !== 'string') return null;
  if (typeof row.required !== 'boolean') return null;
  if (typeof row.position !== 'number' || !Number.isSafeInteger(row.position) || row.position < 0) {
    return null;
  }
  if (typeof row.operational_document_id !== 'string' || !isOpaqueId(row.operational_document_id)) {
    return null;
  }
  if (typeof row.document_version_id !== 'string' || !isOpaqueId(row.document_version_id)) {
    return null;
  }
  if (!isEnum(DOCUMENT_KINDS, row.document_kind_snapshot)) return null;
  if (!isEnum(SENSITIVITIES, row.sensitivity_snapshot)) return null;
  const expiresAtSnapshot = optStrStrict(row.expires_at_snapshot);
  const titleSnapshot = optStrStrict(row.title_snapshot);
  if (expiresAtSnapshot === undefined || titleSnapshot === undefined) return null;
  const createdAt = reqIsoMs(row.created_at);
  if (createdAt === null) return null;
  const item: CarrierPacketItem = {
    id: row.id,
    accountOwnerId: sessionUserId,
    carrierPacketId: parent.id,
    requirementKey: row.requirement_key,
    requirementLabel: row.requirement_label,
    required: row.required,
    position: row.position,
    operationalDocumentId: row.operational_document_id,
    documentVersionId: row.document_version_id,
    documentKindSnapshot: row.document_kind_snapshot,
    sensitivitySnapshot: row.sensitivity_snapshot,
    expiresAtSnapshot,
    titleSnapshot,
    createdAt,
  };
  try {
    validateCarrierPacketItem(item);
  } catch {
    return null;
  }
  if (validatePacketItemAgainstTemplate(parent, item)) return null;
  return item;
}

/** @deprecated Use carrierPacketPersistedEvidenceExactlyMatches — this is the same exact comparator. */
export function historicalPacketSnapshotsMatch(a: CarrierPacket, b: CarrierPacket): boolean {
  return carrierPacketPersistedEvidenceExactlyMatches(a, b);
}

export type CarrierMergeAction = 'import' | 'replace_metadata' | 'keep_local' | 'keep_synced_local' | 'conflict';

export function mergeRecoveredCarrierRecord<T extends { cloudStatus: CloudSyncStatus; updatedAt: number }>(
  local: T | undefined,
  remote: T,
  immutable: boolean,
  snapshotsEqual: (a: T, b: T) => boolean,
): { action: CarrierMergeAction; record: T } {
  if (!local) return { action: 'import', record: { ...remote, cloudStatus: 'synced' } };
  if (immutable) {
    return snapshotsEqual(local, remote)
      ? { action: 'keep_synced_local', record: local }
      : { action: 'conflict', record: local };
  }
  if (local.cloudStatus === 'pending_sync' || local.cloudStatus === 'local_only') {
    return { action: 'keep_local', record: local };
  }
  if (remote.updatedAt > local.updatedAt) return { action: 'replace_metadata', record: remote };
  return { action: 'keep_synced_local', record: local };
}

export function visibleProfilesForSession(
  profiles: readonly CarrierProfile[],
  sessionUserId: string | null,
): CarrierProfile[] {
  return profiles.filter((p) => p.accountOwnerId === sessionUserId);
}

export function visiblePacketsForSession(
  packets: readonly CarrierPacket[],
  sessionUserId: string | null,
): CarrierPacket[] {
  return packets.filter((p) => p.accountOwnerId === sessionUserId);
}

export function itemsForPacket(
  items: readonly CarrierPacketItem[],
  packetId: string,
): CarrierPacketItem[] {
  return items.filter((i) => i.carrierPacketId === packetId).sort((a, b) => a.position - b.position);
}
