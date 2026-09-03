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
  validateCarrierPacket,
  validateCarrierProfile,
  validatePacketItemAgainstTemplate,
  validateTemplateDefinition,
  writeSafeFromCarrierRecovery,
  fromRemoteCarrierPacketItemRow,
  fromRemoteCarrierPacketRow,
  readySnapshotMatchesSharedTransition,
  draftCloudProjection,
  readyCloudProjection,
  sharedCloudProjection,
  toRemoteCarrierPacketRow,
  carrierPacketPersistedEvidenceExactlyMatches,
  carrierPacketItemsExactlyMatch,
  sharedSnapshotMatchesSupersededTransition,
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
    expect(() =>
      validateCarrierPacket({ ...packet, supersedesPacketId: packet.id }),
    ).toThrow(/cannot supersede itself/);
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

describe('Pass 3.2 — snapshot integrity', () => {
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

  it('enforces DRAFT / READY / SHARED / SUPERSEDED lifecycle timestamp shapes', () => {
    expect(() => validateCarrierPacket(packet)).not.toThrow();
    expect(() =>
      validateCarrierPacket({ ...packet, status: 'DRAFT', readyAt: 1 }),
    ).toThrow(/DRAFT status-shape/);
    expect(() =>
      validateCarrierPacket({
        ...packet,
        status: 'READY',
        readyAt: 1,
        sharedAt: 2,
      }),
    ).toThrow(/READY status-shape/);
    expect(() =>
      validateCarrierPacket({
        ...packet,
        status: 'READY',
        readyAt: 1,
        shareMethod: 'OTHER',
      }),
    ).toThrow(/READY status-shape/);
    expect(() =>
      validateCarrierPacket({
        ...packet,
        status: 'SHARED',
        readyAt: 1,
        sharedAt: 2,
        shareMethod: null,
      }),
    ).toThrow(/SHARED status-shape/);
    expect(() =>
      validateCarrierPacket({
        ...packet,
        status: 'SUPERSEDED',
        readyAt: 1,
        sharedAt: 2,
        shareMethod: 'OTHER',
      }),
    ).not.toThrow();
    expect(() =>
      validateCarrierPacket({
        ...packet,
        status: 'DRAFT',
        recipientLabel: 'Broker before share',
      }),
    ).not.toThrow();
    expect(() =>
      validateCarrierPacket({
        ...packet,
        recipientLabel: 'x'.repeat(121),
      }),
    ).toThrow(/recipientLabel/);
    expect(() =>
      validateCarrierPacket({
        ...packet,
        createdAt: Number.NaN,
      }),
    ).toThrow(/finite/);
  });

  it('rejects a W-9 requirement pointing at INSURANCE or a mutated template field', () => {
    const w9 = doc();
    const insurance = doc({ id: id(11), documentKind: 'CERTIFICATE_OF_INSURANCE', title: 'COI' });
    const vW9 = version(w9.id);
    const vIns = version(insurance.id, { id: id(22) });
    const w9Req = STANDARD_BROKER_PACKET.documentRequirements[0]!;
    const valid = freezePacketItem({
      id: id(30),
      packet,
      requirement: w9Req,
      document: w9,
      version: vW9,
      now: 1,
    });
    expect(validatePacketItemAgainstTemplate(packet, valid, { document: w9, version: vW9 })).toBeNull();

    expect(
      validatePacketItemAgainstTemplate(packet, { ...valid, documentKindSnapshot: 'CERTIFICATE_OF_INSURANCE' })
        ?.code,
    ).toBe('INTEGRITY_MISMATCH');
    expect(
      validatePacketItemAgainstTemplate(packet, valid, { document: insurance, version: vIns })?.code,
    ).toBe('INTEGRITY_MISMATCH');
    expect(
      validatePacketItemAgainstTemplate(packet, { ...valid, requirementLabel: 'Wrong' })?.code,
    ).toBe('INTEGRITY_MISMATCH');
    expect(validatePacketItemAgainstTemplate(packet, { ...valid, required: false })?.code).toBe(
      'INTEGRITY_MISMATCH',
    );
    expect(validatePacketItemAgainstTemplate(packet, { ...valid, position: 9 })?.code).toBe(
      'INTEGRITY_MISMATCH',
    );
    expect(
      validatePacketItemAgainstTemplate(packet, { ...valid, requirementKey: 'not-a-key' })?.code,
    ).toBe('INTEGRITY_MISMATCH');

    const review = reviewCarrierPacket({
      packet,
      items: [{ ...valid, documentKindSnapshot: 'CERTIFICATE_OF_INSURANCE' }],
      profile,
      documents: [w9],
      versions: [vW9],
      now: new Date('2026-09-03'),
    });
    expect(review.blockers.some((f) => f.code === 'INTEGRITY_MISMATCH')).toBe(true);
  });

  it('rejects malformed remote packet scalars/timestamps and does not coerce them', () => {
    const shared = {
      ...packet,
      status: 'SHARED' as const,
      readyAt: 1,
      sharedAt: 2,
      shareMethod: 'OTHER' as const,
    };
    const good = toRemoteCarrierPacketRow(shared, 'user-a');
    expect(fromRemoteCarrierPacketRow(good, 'user-a')?.id).toBe(shared.id);
    expect(fromRemoteCarrierPacketRow({ ...good, recipient_label: 12 }, 'user-a')).toBeNull();
    expect(fromRemoteCarrierPacketRow({ ...good, template_source_id: { id: 'x' } }, 'user-a')).toBeNull();
    expect(fromRemoteCarrierPacketRow({ ...good, ready_at: 1 }, 'user-a')).toBeNull();
    expect(fromRemoteCarrierPacketRow({ ...good, shared_at: 'not-a-date' }, 'user-a')).toBeNull();
    expect(fromRemoteCarrierPacketRow({ ...good, profile_snapshot: [] }, 'user-a')).toBeNull();
    expect(
      fromRemoteCarrierPacketRow({ ...good, status: 'DRAFT', ready_at: good.ready_at }, 'user-a'),
    ).toBeNull();
  });

  it('rejects malformed remote items against the parent template snapshot', () => {
    const itemId = id(40);
    const docId = id(41);
    const verId = id(42);
    const row = {
      id: itemId,
      owner_id: 'user-a',
      carrier_packet_id: packet.id,
      requirement_key: 'w9',
      requirement_label: 'W-9',
      required: true,
      position: 0,
      operational_document_id: docId,
      document_version_id: verId,
      document_kind_snapshot: 'W9',
      sensitivity_snapshot: 'FINANCIAL_SENSITIVE',
      expires_at_snapshot: null,
      title_snapshot: 'W-9',
      created_at: new Date(1).toISOString(),
    };
    expect(fromRemoteCarrierPacketItemRow(row, 'user-a', packet)?.id).toBe(itemId);
    expect(fromRemoteCarrierPacketItemRow({ ...row, required: 'true' }, 'user-a', packet)).toBeNull();
    expect(fromRemoteCarrierPacketItemRow({ ...row, position: '0' }, 'user-a', packet)).toBeNull();
    expect(
      fromRemoteCarrierPacketItemRow({ ...row, requirement_key: 'unknown' }, 'user-a', packet),
    ).toBeNull();
    expect(
      fromRemoteCarrierPacketItemRow({ ...row, requirement_label: 'Wrong' }, 'user-a', packet),
    ).toBeNull();
    expect(
      fromRemoteCarrierPacketItemRow(
        { ...row, document_kind_snapshot: 'CERTIFICATE_OF_INSURANCE' },
        'user-a',
        packet,
      ),
    ).toBeNull();
  });

  it('READY→SHARED comparator allows only mark-shared deltas', () => {
    const ready = { ...packet, status: 'READY' as const, readyAt: 5 };
    const shared = {
      ...ready,
      status: 'SHARED' as const,
      sharedAt: 9,
      shareMethod: 'OS_SHARE_SHEET' as const,
      recipientLabel: 'Broker Co',
      updatedAt: 9,
    };
    expect(readySnapshotMatchesSharedTransition(ready, shared)).toBe(true);
    expect(readySnapshotMatchesSharedTransition({ ...ready, name: 'Other' }, shared)).toBe(false);
    expect(readySnapshotMatchesSharedTransition({ ...ready, readyAt: 6 }, shared)).toBe(false);
    expect(
      readySnapshotMatchesSharedTransition(
        { ...ready, profileSnapshot: snapshotCarrierProfile({ ...profile, legalName: 'Other' }, 1) },
        shared,
      ),
    ).toBe(false);
    expect(
      readySnapshotMatchesSharedTransition(
        {
          ...ready,
          templateSnapshot: {
            ...STANDARD_BROKER_PACKET,
            name: 'Mutated',
          },
        },
        shared,
      ),
    ).toBe(false);
    const draftProj = draftCloudProjection(shared);
    expect(draftProj.status).toBe('DRAFT');
    expect(draftProj.readyAt).toBeNull();
    expect(draftProj.sharedAt).toBeNull();
    expect(draftProj.shareMethod).toBeNull();
    expect(draftProj.templateSnapshot).toBe(shared.templateSnapshot);
    const readyProj = readyCloudProjection(shared);
    expect(readyProj.status).toBe('READY');
    expect(readyProj.readyAt).toBe(5);
    expect(readyProj.sharedAt).toBeNull();
    expect(readyProj.shareMethod).toBeNull();
    const sharedProj = sharedCloudProjection(shared);
    expect(sharedProj.status).toBe('SHARED');
    expect(sharedProj.sharedAt).toBe(9);
    expect(sharedProj.shareMethod).toBe('OS_SHARE_SHEET');
  });
});

describe('Pass 3.3 — persisted evidence comparators', () => {
  const packet = {
    id: id(2),
    accountOwnerId: 'user-a' as string | null,
    status: 'SHARED' as const,
    name: 'Pack',
    templateSourceKind: 'BUILTIN' as const,
    templateSourceId: null,
    templateCode: 'STANDARD_BROKER_PACKET' as const,
    templateSnapshot: STANDARD_BROKER_PACKET,
    carrierProfileId: profile.id,
    profileSnapshot: snapshotCarrierProfile(profile, 1),
    recipientLabel: 'Broker',
    shareMethod: 'OTHER' as const,
    readyAt: 5,
    sharedAt: 9,
    supersedesPacketId: null,
    cloudStatus: 'synced' as const,
    createdAt: 1,
    updatedAt: 9,
  };

  it('exact packet evidence ignores only cloudStatus and updatedAt', () => {
    expect(
      carrierPacketPersistedEvidenceExactlyMatches(packet, {
        ...packet,
        cloudStatus: 'pending_sync',
        updatedAt: 99,
      }),
    ).toBe(true);
    expect(carrierPacketPersistedEvidenceExactlyMatches(packet, { ...packet, readyAt: 6 })).toBe(
      false,
    );
    expect(carrierPacketPersistedEvidenceExactlyMatches(packet, { ...packet, createdAt: 2 })).toBe(
      false,
    );
    expect(
      carrierPacketPersistedEvidenceExactlyMatches(packet, {
        ...packet,
        templateSnapshot: { ...STANDARD_BROKER_PACKET, name: 'Other' },
      }),
    ).toBe(false);
    expect(
      carrierPacketPersistedEvidenceExactlyMatches(packet, {
        ...packet,
        profileSnapshot: snapshotCarrierProfile({ ...profile, legalName: 'Other' }, 1),
      }),
    ).toBe(false);
    expect(
      carrierPacketPersistedEvidenceExactlyMatches(packet, { ...packet, recipientLabel: 'Other' }),
    ).toBe(false);
    expect(
      carrierPacketPersistedEvidenceExactlyMatches(packet, {
        ...packet,
        shareMethod: 'OS_SHARE_SHEET',
      }),
    ).toBe(false);
    expect(carrierPacketPersistedEvidenceExactlyMatches(packet, { ...packet, sharedAt: 10 })).toBe(
      false,
    );
    expect(
      carrierPacketPersistedEvidenceExactlyMatches(packet, {
        ...packet,
        supersedesPacketId: id(99),
      }),
    ).toBe(false);
  });

  it('SHARED→SUPERSEDED comparator ignores only status and keeps readyAt/createdAt', () => {
    const superseded = { ...packet, status: 'SUPERSEDED' as const, updatedAt: 12 };
    expect(sharedSnapshotMatchesSupersededTransition(packet, superseded)).toBe(true);
    expect(sharedSnapshotMatchesSupersededTransition({ ...packet, readyAt: 6 }, superseded)).toBe(
      false,
    );
    expect(sharedSnapshotMatchesSupersededTransition({ ...packet, createdAt: 2 }, superseded)).toBe(
      false,
    );
  });

  it('exact item evidence compares every persisted field regardless of order', () => {
    const item = {
      id: id(40),
      accountOwnerId: 'user-a' as string | null,
      carrierPacketId: packet.id,
      requirementKey: 'w9',
      requirementLabel: 'W-9',
      required: true,
      position: 0,
      operationalDocumentId: id(41),
      documentVersionId: id(42),
      documentKindSnapshot: 'W9' as const,
      sensitivitySnapshot: 'FINANCIAL_SENSITIVE' as const,
      expiresAtSnapshot: '2027-01-01',
      titleSnapshot: 'W-9',
      createdAt: 1,
    };
    const other = { ...item, id: id(43), requirementKey: 'coi', position: 1 };
    expect(carrierPacketItemsExactlyMatch([item, other], [other, item])).toBe(true);
    expect(
      carrierPacketItemsExactlyMatch([item], [{ ...item, requirementLabel: 'Wrong' }]),
    ).toBe(false);
    expect(carrierPacketItemsExactlyMatch([item], [{ ...item, required: false }])).toBe(false);
    expect(carrierPacketItemsExactlyMatch([item], [{ ...item, position: 3 }])).toBe(false);
    expect(
      carrierPacketItemsExactlyMatch(
        [item],
        [{ ...item, documentKindSnapshot: 'CERTIFICATE_OF_INSURANCE' }],
      ),
    ).toBe(false);
    expect(
      carrierPacketItemsExactlyMatch([item], [{ ...item, sensitivitySnapshot: 'STANDARD' }]),
    ).toBe(false);
    expect(
      carrierPacketItemsExactlyMatch([item], [{ ...item, expiresAtSnapshot: '2028-01-01' }]),
    ).toBe(false);
    expect(carrierPacketItemsExactlyMatch([item], [{ ...item, titleSnapshot: 'Other' }])).toBe(
      false,
    );
    expect(carrierPacketItemsExactlyMatch([item], [{ ...item, createdAt: 2 }])).toBe(false);
  });

  it('serializes finite timestamp 0 instead of coercing it to null', () => {
    const ready = { ...packet, status: 'READY' as const, readyAt: 0, sharedAt: null, shareMethod: null };
    const row = toRemoteCarrierPacketRow(ready, 'user-a');
    expect(row.ready_at).toBe(new Date(0).toISOString());
    expect(row.shared_at).toBeNull();
    expect(fromRemoteCarrierPacketRow(row, 'user-a')?.readyAt).toBe(0);
    const shared = { ...packet, readyAt: 0, sharedAt: 0 };
    const sharedRow = toRemoteCarrierPacketRow(shared, 'user-a');
    expect(sharedRow.ready_at).toBe(new Date(0).toISOString());
    expect(sharedRow.shared_at).toBe(new Date(0).toISOString());
    expect(fromRemoteCarrierPacketRow(sharedRow, 'user-a')?.sharedAt).toBe(0);
  });
});
