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

export function validateCarrierProfile(profile: CarrierProfile): void {
  if (!isOpaqueId(profile.id)) throw new Error('carrier profile id is not an opaque id');
  if (profile.accountOwnerId !== null && typeof profile.accountOwnerId !== 'string') {
    throw new Error('invalid account owner');
  }
  if (!bounded(profile.legalName.trim(), CARRIER_PROFILE_NAME_MAX)) {
    throw new Error('legalName is required');
  }
  if (profile.identitySource !== 'USER_ENTERED') throw new Error('identitySource must be USER_ENTERED');
  if (!Array.isArray(profile.equipmentTypes) || profile.equipmentTypes.length > 20) {
    throw new Error('equipmentTypes out of bounds');
  }
  for (const eq of profile.equipmentTypes) {
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
    if (!optionalBounded(profile[key], max)) throw new Error(`${key} out of bounds`);
  }
  if ('ein' in (profile as object) || 'ssn' in (profile as object) || 'bankAccount' in (profile as object)) {
    throw new Error('forbidden financial scalar');
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
  if (packet.shareMethod !== null && !isEnum(CARRIER_SHARE_METHODS, packet.shareMethod)) {
    throw new Error('unknown shareMethod');
  }
  if (packet.supersedesPacketId !== null && !isOpaqueId(packet.supersedesPacketId)) {
    throw new Error('supersedesPacketId is not an opaque id');
  }
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
  if (!Number.isSafeInteger(item.position) || item.position < 0) {
    throw new Error('position must be a safe integer ≥ 0');
  }
  if (!isEnum(DOCUMENT_KINDS, item.documentKindSnapshot)) throw new Error('unknown documentKind');
  if (!isEnum(SENSITIVITIES, item.sensitivitySnapshot)) throw new Error('unknown sensitivity');
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

export function fromRemoteCarrierProfileRow(
  row: unknown,
  sessionUserId: string,
): CarrierProfile | null {
  if (!isRec(row)) return null;
  if (row.owner_id !== sessionUserId) return null;
  if (typeof row.id !== 'string' || !isOpaqueId(row.id)) return null;
  if (typeof row.legal_name !== 'string') return null;
  const createdAt = Date.parse(String(row.created_at));
  const updatedAt = Date.parse(String(row.updated_at));
  if (!Number.isFinite(createdAt) || !Number.isFinite(updatedAt)) return null;
  const profile: CarrierProfile = {
    id: row.id,
    accountOwnerId: sessionUserId,
    legalName: row.legal_name,
    dbaName: typeof row.dba_name === 'string' ? row.dba_name : null,
    usdotNumber: typeof row.usdot_number === 'string' ? row.usdot_number : null,
    mcNumber: typeof row.mc_number === 'string' ? row.mc_number : null,
    addressLine1: typeof row.address_line1 === 'string' ? row.address_line1 : null,
    addressLine2: typeof row.address_line2 === 'string' ? row.address_line2 : null,
    city: typeof row.city === 'string' ? row.city : null,
    stateProvince: typeof row.state_province === 'string' ? row.state_province : null,
    postalCode: typeof row.postal_code === 'string' ? row.postal_code : null,
    contactName: typeof row.contact_name === 'string' ? row.contact_name : null,
    contactEmail: typeof row.contact_email === 'string' ? row.contact_email : null,
    contactPhone: typeof row.contact_phone === 'string' ? row.contact_phone : null,
    equipmentTypes: Array.isArray(row.equipment_types)
      ? row.equipment_types.filter((x): x is string => typeof x === 'string')
      : [],
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
  if (!isRec(row.definition)) return null;
  const createdAt = Date.parse(String(row.created_at));
  const updatedAt = Date.parse(String(row.updated_at));
  if (!Number.isFinite(createdAt) || !Number.isFinite(updatedAt)) return null;
  const template: CarrierPacketTemplate = {
    id: row.id,
    accountOwnerId: sessionUserId,
    name: row.name,
    lifecycle: row.lifecycle,
    definition: row.definition as CarrierPacketTemplateDefinition,
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
    ready_at: packet.readyAt ? new Date(packet.readyAt).toISOString() : null,
    shared_at: packet.sharedAt ? new Date(packet.sharedAt).toISOString() : null,
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
  const createdAt = Date.parse(String(row.created_at));
  const updatedAt = Date.parse(String(row.updated_at));
  if (!Number.isFinite(createdAt) || !Number.isFinite(updatedAt)) return null;
  const packet: CarrierPacket = {
    id: row.id,
    accountOwnerId: sessionUserId,
    status: row.status,
    name: row.name,
    templateSourceKind: row.template_source_kind,
    templateSourceId: typeof row.template_source_id === 'string' ? row.template_source_id : null,
    templateCode: typeof row.template_code === 'string' ? row.template_code : null,
    templateSnapshot: row.template_snapshot as CarrierPacketTemplateDefinition,
    carrierProfileId: typeof row.carrier_profile_id === 'string' ? row.carrier_profile_id : null,
    profileSnapshot: (row.profile_snapshot as CarrierProfileSnapshot | null) ?? null,
    recipientLabel: typeof row.recipient_label === 'string' ? row.recipient_label : null,
    shareMethod: isEnum(CARRIER_SHARE_METHODS, row.share_method) ? row.share_method : null,
    readyAt: row.ready_at ? Date.parse(String(row.ready_at)) : null,
    sharedAt: row.shared_at ? Date.parse(String(row.shared_at)) : null,
    supersedesPacketId:
      typeof row.supersedes_packet_id === 'string' ? row.supersedes_packet_id : null,
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
  const createdAt = Date.parse(String(row.created_at));
  if (!Number.isFinite(createdAt)) return null;
  const item: CarrierPacketItem = {
    id: row.id,
    accountOwnerId: sessionUserId,
    carrierPacketId: parent.id,
    requirementKey: String(row.requirement_key ?? ''),
    requirementLabel: String(row.requirement_label ?? ''),
    required: row.required === true,
    position: typeof row.position === 'number' ? row.position : -1,
    operationalDocumentId: String(row.operational_document_id ?? ''),
    documentVersionId: String(row.document_version_id ?? ''),
    documentKindSnapshot: row.document_kind_snapshot as DocumentKind,
    sensitivitySnapshot: row.sensitivity_snapshot as Sensitivity,
    expiresAtSnapshot: typeof row.expires_at_snapshot === 'string' ? row.expires_at_snapshot : null,
    titleSnapshot: typeof row.title_snapshot === 'string' ? row.title_snapshot : null,
    createdAt,
  };
  try {
    validateCarrierPacketItem(item);
  } catch {
    return null;
  }
  return item;
}

const historicalEvidence = (p: CarrierPacket) => ({
  id: p.id,
  name: p.name,
  templateSourceKind: p.templateSourceKind,
  templateSourceId: p.templateSourceId,
  templateCode: p.templateCode,
  templateSnapshot: p.templateSnapshot,
  carrierProfileId: p.carrierProfileId,
  profileSnapshot: p.profileSnapshot,
  recipientLabel: p.recipientLabel,
  shareMethod: p.shareMethod,
  sharedAt: p.sharedAt,
  supersedesPacketId: p.supersedesPacketId,
});

/** Exact historical SHARED/SUPERSEDED snapshot, including status. */
export function historicalPacketSnapshotsMatch(a: CarrierPacket, b: CarrierPacket): boolean {
  return JSON.stringify({ ...historicalEvidence(a), status: a.status }) ===
    JSON.stringify({ ...historicalEvidence(b), status: b.status });
}

/** Snapshot equality used for the narrow SHARED → SUPERSEDED cloud transition. */
export function historicalEvidenceMatchesIgnoringStatus(a: CarrierPacket, b: CarrierPacket): boolean {
  return JSON.stringify(historicalEvidence(a)) === JSON.stringify(historicalEvidence(b));
}

export function historicalItemsMatch(
  a: CarrierPacketItem[],
  b: CarrierPacketItem[],
): boolean {
  const key = (i: CarrierPacketItem) =>
    `${i.id}:${i.requirementKey}:${i.operationalDocumentId}:${i.documentVersionId}`;
  return a.map(key).sort().join('|') === b.map(key).sort().join('|');
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
