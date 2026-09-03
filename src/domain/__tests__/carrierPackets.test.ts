import { newOpaqueId } from '../documentFiles';
import { canUseFeature } from '../entitlements';
import {
  assertPacketMutable,
  canMutateCarrierPackets,
  canMutateCarrierProfile,
  canMutateCarrierTemplates,
  canTransitionPacket,
  canViewCarrierHistory,
  CARRIER_PACKET_FORBIDDEN_COPY,
  CARRIER_PACKET_REQUIREMENTS_VARY_COPY,
  COMBINED_PACKET_PDF,
  COMBINED_PACKET_ZIP,
  freezePacketItem,
  MARK_SHARED_ATTESTATION_COPY,
  PROFILE_COVER_ARTIFACT,
  reviewCarrierPacket,
  snapshotCarrierProfile,
  STANDARD_BROKER_PACKET,
  validateCarrierProfile,
  validateTemplateDefinition,
  writeSafeFromCarrierRecovery,
} from '../carrierPackets';
import { DocumentVersion, OperationalDocument } from '../operationalDocuments';

const id = (seed: number) =>
  newOpaqueId(() => new Uint8Array(Array.from({ length: 16 }, (_, i) => (i * 17 + seed) & 0xff)));

const profile = {
  id: id(1),
  accountOwnerId: 'user-a' as string | null,
  legalName: 'Acme Hauling LLC',
  dbaName: null,
  usdotNumber: '123456',
  mcNumber: 'MC123',
  addressLine1: null,
  addressLine2: null,
  city: null,
  stateProvince: null,
  postalCode: null,
  contactName: null,
  contactEmail: null,
  contactPhone: null,
  equipmentTypes: [] as string[],
  identitySource: 'USER_ENTERED' as const,
  cloudStatus: 'local_only' as const,
  createdAt: 1,
  updatedAt: 1,
};

const doc = (over: Partial<OperationalDocument> = {}): OperationalDocument =>
  ({
    id: id(10),
    accountOwnerId: 'user-a',
    documentKind: 'W9',
    subjectKind: 'CARRIER',
    sensitivity: 'FINANCIAL_SENSITIVE',
    title: 'W-9',
    issuer: null,
    jurisdiction: null,
    maskedReference: null,
    expiresAt: null,
    truckId: null,
    trailerId: null,
    notes: null,
    offlinePinned: false,
    lifecycle: 'ACTIVE',
    cloudStatus: 'local_only',
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }) as OperationalDocument;

const version = (documentId: string, over: Partial<DocumentVersion> = {}): DocumentVersion =>
  ({
    id: id(20),
    operationalDocumentId: documentId,
    accountOwnerId: 'user-a',
    versionNumber: 1,
    supersedesVersionId: null,
    fileKind: 'IMAGE',
    mimeType: 'image/jpeg',
    ext: 'jpg',
    relativePath: 'road-wallet/x/y.jpg',
    sha256: 'a'.repeat(64),
    byteSize: 12,
    fileCache: { state: 'READY', relativePath: 'road-wallet/x/y.jpg', sha256: 'a'.repeat(64), error: null, checkedAt: 1 },
    cloudStatus: 'local_only',
    remoteStorageBucket: null,
    remoteStoragePath: null,
    createdAt: 1,
    ...over,
  }) as DocumentVersion;

describe('entitlements', () => {
  it('Free and Driver Pro are denied; Owner, Lifetime and Fleet are allowed', () => {
    expect(canMutateCarrierProfile('free')).toBe(false);
    expect(canMutateCarrierProfile('driver_pro')).toBe(false);
    expect(canMutateCarrierProfile('owner_operator')).toBe(true);
    expect(canMutateCarrierProfile('lifetime')).toBe(true);
    expect(canMutateCarrierProfile('fleet_lite')).toBe(true);
    expect(canMutateCarrierPackets('free')).toBe(false);
    expect(canMutateCarrierPackets('driver_pro')).toBe(false);
    expect(canMutateCarrierPackets('owner_operator')).toBe(true);
    expect(canMutateCarrierTemplates('driver_pro')).toBe(false);
    expect(canMutateCarrierTemplates('owner_operator')).toBe(true);
    expect(canViewCarrierHistory('owner_operator')).toBe(true);
    expect(canUseFeature('driver_pro', 'documentShareExport')).toBe(true);
    expect(canUseFeature('free', 'documentShareExport')).toBe(false);
  });
});

describe('profile + standard template', () => {
  it('requires legalName, USER_ENTERED, no EIN/bank fields, one snapshot shape', () => {
    expect(() => validateCarrierProfile({ ...profile, legalName: '' })).toThrow(/legalName/);
    expect(profile.identitySource).toBe('USER_ENTERED');
    expect(profile).not.toHaveProperty('ein');
    expect(profile).not.toHaveProperty('ssn');
    expect(snapshotCarrierProfile(profile, 9).identitySource).toBe('USER_ENTERED');
  });

  it('STANDARD_BROKER_PACKET has the accepted required/optional kinds and vary copy', () => {
    expect(STANDARD_BROKER_PACKET.documentRequirements.map((r) => [r.documentKind, r.required])).toEqual([
      ['W9', true],
      ['CERTIFICATE_OF_INSURANCE', true],
      ['OPERATING_AUTHORITY', true],
      ['FACTORING_NOA', false],
      ['BANKING_DOCUMENT', false],
    ]);
    expect(STANDARD_BROKER_PACKET.requireCarrierProfile).toBe(true);
    expect(CARRIER_PACKET_REQUIREMENTS_VARY_COPY).toMatch(/requirements vary/i);
    expect(() =>
      validateTemplateDefinition({
        ...STANDARD_BROKER_PACKET,
        documentRequirements: [
          ...STANDARD_BROKER_PACKET.documentRequirements,
          { key: 'w9-2', documentKind: 'W9', label: 'dup', required: true, position: 5 },
        ],
      }),
    ).toThrow(/duplicate documentKind/);
    expect(COMBINED_PACKET_PDF).toBe('DEFERRED');
    expect(COMBINED_PACKET_ZIP).toBe('DEFERRED');
    expect(PROFILE_COVER_ARTIFACT).toBe('DEFERRED');
  });
});

describe('review + transitions', () => {
  const packet = {
    id: id(2),
    accountOwnerId: 'user-a' as string | null,
    status: 'DRAFT' as const,
    name: 'Pack',
    templateSourceKind: 'BUILTIN' as const,
    templateSourceId: null,
    templateCode: 'STANDARD_BROKER_PACKET' as const,
    templateSnapshot: STANDARD_BROKER_PACKET,
    carrierProfileId: profile.id,
    profileSnapshot: snapshotCarrierProfile(profile, 1),
    recipientLabel: null,
    shareMethod: null,
    readyAt: null,
    sharedAt: null,
    supersedesPacketId: null,
    cloudStatus: 'local_only' as const,
    createdAt: 1,
    updatedAt: 1,
  };

  it('missing required item is a blocker; financial is a warning; optional missing is a warning', () => {
    const review = reviewCarrierPacket({
      packet,
      items: [],
      profile,
      documents: [],
      versions: [],
      now: new Date('2026-09-03'),
    });
    expect(review.readyEligible).toBe(false);
    expect(review.blockers.some((f) => f.code === 'MISSING_REQUIRED_DOCUMENT')).toBe(true);
    expect(review.warnings.some((f) => f.code === 'OPTIONAL_DOCUMENT_MISSING')).toBe(true);
  });

  it('expired required item blocks; stale version blocks; financial does not blanket-block', () => {
    const w9 = doc({ expiresAt: '2020-01-01' });
    const v1 = version(w9.id);
    const item = freezePacketItem({
      id: id(30),
      packet,
      requirement: STANDARD_BROKER_PACKET.documentRequirements[0]!,
      document: w9,
      version: v1,
      now: 1,
    });
    const expired = reviewCarrierPacket({
      packet,
      items: [item],
      profile,
      documents: [w9],
      versions: [v1],
      now: new Date('2026-09-03'),
    });
    expect(expired.blockers.some((f) => f.code === 'EXPIRED_REQUIRED_DOCUMENT')).toBe(true);
    expect(expired.warnings.some((f) => f.code === 'FINANCIAL_SENSITIVE')).toBe(true);

    const v2 = version(w9.id, { id: id(21), versionNumber: 2, supersedesVersionId: v1.id });
    const stale = reviewCarrierPacket({
      packet,
      items: [item],
      profile,
      documents: [{ ...w9, expiresAt: null }],
      versions: [v1, v2],
      now: new Date('2026-09-03'),
    });
    expect(stale.blockers.some((f) => f.code === 'STALE_VERSION')).toBe(true);
  });

  it('canonical transitions only', () => {
    expect(canTransitionPacket('DRAFT', 'SHARED')).toBe(false);
    expect(canTransitionPacket('DRAFT', 'READY')).toBe(true);
    expect(canTransitionPacket('READY', 'DRAFT')).toBe(true);
    expect(canTransitionPacket('READY', 'SHARED')).toBe(true);
    expect(canTransitionPacket('SHARED', 'DRAFT')).toBe(false);
    expect(canTransitionPacket('SHARED', 'SUPERSEDED')).toBe(true);
    expect(canTransitionPacket('SUPERSEDED', 'READY')).toBe(false);
    expect(() => assertPacketMutable({ ...packet, status: 'SHARED' })).toThrow(/immutable/);
  });

  it('attestation copy does not claim delivery and writeSafeFromCarrierRecovery is strict', () => {
    expect(MARK_SHARED_ATTESTATION_COPY).toMatch(/does not prove delivery/);
    expect(
      writeSafeFromCarrierRecovery({
        profilesRecovered: 0,
        templatesRecovered: 0,
        packetsRecovered: 0,
        itemsRecovered: 0,
        integrityConflicts: 0,
        skippedLocalChanges: 0,
        outcome: 'completed',
      }),
    ).toBe(true);
    expect(
      writeSafeFromCarrierRecovery({
        profilesRecovered: 0,
        templatesRecovered: 0,
        packetsRecovered: 0,
        itemsRecovered: 0,
        integrityConflicts: 1,
        skippedLocalChanges: 0,
        outcome: 'completed',
      }),
    ).toBe(false);
    for (const phrase of CARRIER_PACKET_FORBIDDEN_COPY) {
      expect(MARK_SHARED_ATTESTATION_COPY.toLowerCase()).not.toContain(phrase.toLowerCase());
    }
  });
});
