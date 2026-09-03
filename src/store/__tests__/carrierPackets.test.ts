import { createCarrierReadyReturnProof, newOpaqueId, STANDARD_BROKER_PACKET } from '@/domain';
import {
  CARRIER_PACKETS_PERSIST_VERSION,
  normalizeCarrierPacketsState,
  useCarrierPacketsStore,
} from '@/store/carrierPackets';
import {
  normalizeCarrierProfileState,
  selectVisibleCarrierProfile,
  useCarrierProfileStore,
} from '@/store/carrierProfile';

const id = (seed: number) =>
  newOpaqueId(() => new Uint8Array(Array.from({ length: 16 }, (_, i) => (i * 13 + seed) & 0xff)));

beforeEach(() => {
  useCarrierPacketsStore.getState().clear();
  useCarrierProfileStore.getState().clear();
});

describe('normalization + SHARED immutability', () => {
  it('keeps one profile per account and drops malformed rows without minting ids', () => {
    const a = id(1);
    const out = normalizeCarrierProfileState({
      profiles: [
        {
          id: a,
          accountOwnerId: 'user-a',
          legalName: 'Acme',
          identitySource: 'USER_ENTERED',
          equipmentTypes: [],
          cloudStatus: 'synced',
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: id(2),
          accountOwnerId: 'user-a',
          legalName: 'Second',
          identitySource: 'USER_ENTERED',
          equipmentTypes: [],
          cloudStatus: 'local_only',
          createdAt: 1,
          updatedAt: 1,
        },
        { id: 'nope', legalName: 'x' },
      ],
    });
    expect(out.profiles).toHaveLength(1);
    expect(out.profiles[0]?.id).toBe(a);
  });

  it('refuses to mutate SHARED packet contents', () => {
    const packetId = id(3);
    useCarrierPacketsStore.getState().addPacket(
      {
        id: packetId,
        accountOwnerId: 'user-a',
        status: 'DRAFT',
        name: 'Pack',
        templateSourceKind: 'BUILTIN',
        templateSourceId: null,
        templateCode: 'STANDARD_BROKER_PACKET',
        templateSnapshot: STANDARD_BROKER_PACKET,
        carrierProfileId: null,
        profileSnapshot: null,
        recipientLabel: null,
        shareMethod: null,
        readyAt: null,
        sharedAt: null,
        supersedesPacketId: null,
        cloudStatus: 'local_only',
        createdAt: 1,
        updatedAt: 1,
      },
      [],
    );
    useCarrierPacketsStore.getState().transitionPacket(packetId, 'READY', { readyAt: 2, updatedAt: 2 });
    useCarrierPacketsStore.getState().transitionPacket(packetId, 'SHARED', {
      sharedAt: 3,
      shareMethod: 'OTHER',
      updatedAt: 3,
    });
    expect(() =>
      useCarrierPacketsStore.getState().updateDraftPacket(packetId, { name: 'Nope', updatedAt: 4 }),
    ).toThrow(/immutable|DRAFT/);
    useCarrierPacketsStore.getState().transitionPacket(packetId, 'SUPERSEDED', { updatedAt: 4 });
    expect(useCarrierPacketsStore.getState().packets[0]?.status).toBe('SUPERSEDED');
    expect(() =>
      useCarrierPacketsStore.getState().transitionPacket(packetId, 'READY', { updatedAt: 5 }),
    ).toThrow(/terminal/);
    const normalized = normalizeCarrierPacketsState({
      packets: useCarrierPacketsStore.getState().packets,
      items: [{ id: 'bad', carrierPacketId: packetId }],
      templates: [],
    });
    expect(normalized.items).toHaveLength(0);
  });

  it('persist keys are stable and visibility is account-scoped', () => {
    expect(useCarrierProfileStore.persist.getOptions().name).toBe('rigreceipts.carrierProfile');
    expect(useCarrierPacketsStore.persist.getOptions().name).toBe('rigreceipts.carrierPackets');
    const a = id(8);
    const b = id(9);
    useCarrierProfileStore.getState().upsertProfile({
      id: a,
      accountOwnerId: 'user-a',
      legalName: 'A',
      dbaName: null,
      usdotNumber: null,
      mcNumber: null,
      addressLine1: null,
      addressLine2: null,
      city: null,
      stateProvince: null,
      postalCode: null,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      equipmentTypes: [],
      identitySource: 'USER_ENTERED',
      cloudStatus: 'local_only',
      createdAt: 1,
      updatedAt: 1,
    });
    useCarrierProfileStore.getState().upsertProfile({
      id: b,
      accountOwnerId: 'user-b',
      legalName: 'B',
      dbaName: null,
      usdotNumber: null,
      mcNumber: null,
      addressLine1: null,
      addressLine2: null,
      city: null,
      stateProvince: null,
      postalCode: null,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      equipmentTypes: [],
      identitySource: 'USER_ENTERED',
      cloudStatus: 'local_only',
      createdAt: 1,
      updatedAt: 1,
    });
    expect(selectVisibleCarrierProfile(useCarrierProfileStore.getState().profiles, 'user-a')?.id).toBe(a);
    expect(selectVisibleCarrierProfile(useCarrierProfileStore.getState().profiles, 'user-b')?.id).toBe(b);
    expect(selectVisibleCarrierProfile(useCarrierProfileStore.getState().profiles, null)).toBeNull();
  });

  it('persists return-to-draft proofs at v2 and discards invalid / orphan / wrong-owner rows', () => {
    expect(CARRIER_PACKETS_PERSIST_VERSION).toBe(2);
    expect(useCarrierPacketsStore.persist.getOptions().version).toBe(2);
    const packetId = id(20);
    const draft = {
      id: packetId,
      accountOwnerId: 'user-a' as const,
      status: 'DRAFT' as const,
      name: 'Pack',
      templateSourceKind: 'BUILTIN' as const,
      templateSourceId: null,
      templateCode: 'STANDARD_BROKER_PACKET' as const,
      templateSnapshot: STANDARD_BROKER_PACKET,
      carrierProfileId: null,
      profileSnapshot: null,
      recipientLabel: null,
      shareMethod: null,
      readyAt: null,
      sharedAt: null,
      supersedesPacketId: null,
      cloudStatus: 'pending_sync' as const,
      createdAt: 1,
      updatedAt: 2,
    };
    const ready = { ...draft, status: 'READY' as const, readyAt: 2, updatedAt: 2 };
    const proof = createCarrierReadyReturnProof({ packet: ready, items: [], now: 3 });
    const foreign = createCarrierReadyReturnProof({
      packet: { ...ready, accountOwnerId: 'user-b' },
      items: [],
      now: 3,
    });
    const orphan = createCarrierReadyReturnProof({
      packet: { ...ready, id: id(21) },
      items: [],
      now: 3,
    });
    const normalized = normalizeCarrierPacketsState({
      packets: [draft],
      items: [],
      templates: [],
      readyReturnProofs: [proof, foreign, orphan, { packetId: 'nope' }],
    });
    expect(normalized.readyReturnProofs).toHaveLength(1);
    expect(normalized.readyReturnProofs[0]?.packetId).toBe(packetId);
    expect(normalized.readyReturnProofs[0]?.readyPacketEvidence.status).toBe('READY');
  });
});
