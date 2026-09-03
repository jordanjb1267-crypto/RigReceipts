import {
  createCarrierReadyReturnProof,
  draftCloudProjection,
  newOpaqueId,
  STANDARD_BROKER_PACKET,
  toRemoteCarrierPacketItemRow,
  toRemoteCarrierPacketRow,
  toRemoteCarrierProfileRow,
} from '@/domain';
import { useAuthStore } from '@/store/auth';
import { useCarrierPacketsStore } from '@/store/carrierPackets';
import { useCarrierProfileStore } from '@/store/carrierProfile';
import { useRoadWalletStore } from '@/store/roadWallet';
import { useSubscriptionStore } from '@/store/subscription';

import type { CarrierPacketStatus } from '@/domain';
import {
  CarrierPacketRemoteConflictError,
  CarrierRemote,
  recoverCarrierPacketsFromCloud,
  syncPendingCarrierPackets,
} from '../carrierPacketSync';

class FakeCarrierRemote implements CarrierRemote {
  profiles: Record<string, unknown>[] = [];
  packets: Record<string, unknown>[] = [];
  items: Record<string, unknown>[] = [];
  upserts: { table: string; row: Record<string, unknown> }[] = [];
  packetWrites: {
    op: 'insert' | 'update';
    row: Record<string, unknown>;
    expectedCurrentStatus?: CarrierPacketStatus;
  }[] = [];
  deletes: string[] = [];
  failItemOnce = false;
  failPacketUpsertWhen: ((row: Record<string, unknown>) => boolean) | null = null;
  onFetchPackets: (() => void) | null = null;
  hidePacketsOnFetch = false;

  async fetchProfiles() {
    return this.profiles;
  }
  async fetchTemplates() {
    return [];
  }
  async fetchPackets() {
    this.onFetchPackets?.();
    if (this.hidePacketsOnFetch) return [];
    return this.packets;
  }
  async fetchItems() {
    return this.items;
  }
  async deleteItem(itemId: string) {
    this.deletes.push(itemId);
    this.items = this.items.filter((row) => row.id !== itemId);
  }
  async upsertProfile(row: Record<string, unknown>) {
    this.upserts.push({ table: 'carrier_profiles', row });
    this.profiles = this.profiles.filter((p) => p.id !== row.id);
    this.profiles.push(row);
  }
  async upsertTemplate(row: Record<string, unknown>) {
    this.upserts.push({ table: 'carrier_packet_templates', row });
  }
  async insertPacketDraft(row: Record<string, unknown>) {
    if (row.status !== 'DRAFT') {
      throw new CarrierPacketRemoteConflictError('invalid_insert_status', String(row.status));
    }
    if (this.packets.some((p) => p.id === row.id)) {
      throw new CarrierPacketRemoteConflictError('duplicate_insert', String(row.id));
    }
    if (this.failPacketUpsertWhen?.(row)) throw new Error('packet upsert crashed');
    this.upserts.push({ table: 'carrier_packets', row });
    this.packetWrites.push({ op: 'insert', row });
    this.packets = [...this.packets, row];
  }
  async updatePacket(row: Record<string, unknown>, expectedCurrentStatus: CarrierPacketStatus) {
    const current = this.packets.find((p) => p.id === row.id);
    if (!current || current.status !== expectedCurrentStatus) {
      throw new CarrierPacketRemoteConflictError(
        'expected_status_miss',
        `${String(row.id)} expected ${expectedCurrentStatus}`,
      );
    }
    if (this.failPacketUpsertWhen?.(row)) throw new Error('packet upsert crashed');
    this.upserts.push({ table: 'carrier_packets', row });
    this.packetWrites.push({ op: 'update', row, expectedCurrentStatus });
    this.packets = this.packets.filter((p) => p.id !== row.id);
    this.packets.push(row);
  }
  async upsertItem(row: Record<string, unknown>) {
    if (this.failItemOnce) {
      this.failItemOnce = false;
      throw new Error('item failed');
    }
    this.upserts.push({ table: 'carrier_packet_items', row });
    this.items = this.items.filter((p) => p.id !== row.id);
    this.items.push(row);
  }
}

const id = (seed: number) =>
  newOpaqueId(() => new Uint8Array(Array.from({ length: 16 }, (_, i) => (i * 41 + seed) & 0xff)));

let remote: FakeCarrierRemote;
const deps = () => ({
  remote,
  ctx: () => ({
    userId: useAuthStore.getState().userId,
    tier: useSubscriptionStore.getState().tier,
    supabaseConfigured: true,
  }),
});

beforeEach(() => {
  useCarrierPacketsStore.getState().clear();
  useCarrierProfileStore.getState().clear();
  useRoadWalletStore.getState().clear();
  remote = new FakeCarrierRemote();
  useAuthStore.setState({ userId: 'user-a', status: 'signed_in', session: null });
  useSubscriptionStore.getState().setTier('owner_operator');
});

describe('carrier packet cloud writes', () => {
  it('stages SHARED as READY then items then SHARED; partial item failure stays pending; retry is idempotent', async () => {
    const packetId = id(1);
    useCarrierPacketsStore.getState().addPacket(
      {
        id: packetId,
        accountOwnerId: 'user-a',
        status: 'SHARED',
        name: 'Pack',
        templateSourceKind: 'BUILTIN',
        templateSourceId: null,
        templateCode: 'STANDARD_BROKER_PACKET',
        templateSnapshot: STANDARD_BROKER_PACKET,
        carrierProfileId: null,
        profileSnapshot: null,
        recipientLabel: 'Broker',
        shareMethod: 'OTHER',
        readyAt: 1,
        sharedAt: 2,
        supersedesPacketId: null,
        cloudStatus: 'pending_sync',
        createdAt: 1,
        updatedAt: 2,
      },
      [
        {
          id: id(2),
          accountOwnerId: 'user-a',
          carrierPacketId: packetId,
          requirementKey: 'w9',
          requirementLabel: 'W-9',
          required: true,
          position: 0,
          operationalDocumentId: id(3),
          documentVersionId: id(4),
          documentKindSnapshot: 'W9',
          sensitivitySnapshot: 'FINANCIAL_SENSITIVE',
          expiresAtSnapshot: null,
          titleSnapshot: 'W-9',
          createdAt: 1,
        },
      ],
    );
    remote.failItemOnce = true;
    const crashed = await syncPendingCarrierPackets(deps());
    expect(crashed.packetsSynced).toBe(0);
    expect(useCarrierPacketsStore.getState().packets[0]?.cloudStatus).toBe('pending_sync');

    const retried = await syncPendingCarrierPackets(deps());
    expect(retried.packetsSynced).toBe(1);
    expect(remote.packets[0]?.status).toBe('SHARED');
    const statuses = remote.upserts
      .filter((u) => u.table === 'carrier_packets')
      .map((u) => u.row.status);
    expect(statuses).toContain('DRAFT');
    expect(statuses).toContain('READY');
    expect(statuses[statuses.length - 1]).toBe('SHARED');
    expect(statuses.indexOf('DRAFT')).toBeLessThan(statuses.indexOf('READY'));
    const packetRows = remote.upserts.filter((u) => u.table === 'carrier_packets').map((u) => u.row);
    const draftRow = packetRows.find((row) => row.status === 'DRAFT')!;
    const readyRow = packetRows.find((row) => row.status === 'READY')!;
    const sharedRow = packetRows.find((row) => row.status === 'SHARED')!;
    expect(draftRow.ready_at).toBeNull();
    expect(draftRow.shared_at).toBeNull();
    expect(draftRow.share_method).toBeNull();
    expect(readyRow.ready_at).toBeTruthy();
    expect(readyRow.shared_at).toBeNull();
    expect(readyRow.share_method).toBeNull();
    expect(sharedRow.ready_at).toBeTruthy();
    expect(sharedRow.shared_at).toBeTruthy();
    expect(sharedRow.share_method).toBe('OTHER');
    expect(useCarrierPacketsStore.getState().packets[0]?.cloudStatus).toBe('synced');

    useCarrierPacketsStore.getState().setPacketCloudStatus(packetId, 'pending_sync');
    const again = await syncPendingCarrierPackets(deps());
    expect(again.packetsSynced).toBe(1);
    expect(
      remote.upserts.filter((u) => u.table === 'carrier_packets' && u.row.status === 'SHARED').length,
    ).toBeGreaterThan(0);
  });

  it('conflicting remote SHARED is an integrity conflict, not an overwrite', async () => {
    const packetId = id(8);
    const local = {
      id: packetId,
      accountOwnerId: 'user-a' as const,
      status: 'SHARED' as const,
      name: 'Local',
      templateSourceKind: 'BUILTIN' as const,
      templateSourceId: null,
      templateCode: 'STANDARD_BROKER_PACKET' as const,
      templateSnapshot: STANDARD_BROKER_PACKET,
      carrierProfileId: null,
      profileSnapshot: null,
      recipientLabel: 'A',
      shareMethod: 'OTHER' as const,
      readyAt: 1,
      sharedAt: 2,
      supersedesPacketId: null,
      cloudStatus: 'synced' as const,
      createdAt: 1,
      updatedAt: 2,
    };
    useCarrierPacketsStore.getState().addPacket(local, []);
    remote.packets.push(
      toRemoteCarrierPacketRow({ ...local, recipientLabel: 'OTHER' }, 'user-a') as unknown as Record<
        string,
        unknown
      >,
    );
    const recovered = await recoverCarrierPacketsFromCloud(deps());
    expect(recovered.integrityConflicts).toBeGreaterThan(0);
    expect(useCarrierPacketsStore.getState().packets[0]?.recipientLabel).toBe('A');
  });

  it('rejects other-owner rows; Free may still recover already-backed-up metadata; pending local is kept', async () => {
    const foreignId = id(9);
    remote.profiles.push({
      id: foreignId,
      owner_id: 'user-b',
      legal_name: 'Other',
      dba_name: null,
      usdot_number: null,
      mc_number: null,
      address_line1: null,
      address_line2: null,
      city: null,
      state_province: null,
      postal_code: null,
      contact_name: null,
      contact_email: null,
      contact_phone: null,
      equipment_types: [],
      identity_source: 'USER_ENTERED',
      created_at: new Date(1).toISOString(),
      updated_at: new Date(1).toISOString(),
    });
    const rejected = await recoverCarrierPacketsFromCloud(deps());
    expect(rejected.integrityConflicts).toBeGreaterThan(0);
    expect(useCarrierProfileStore.getState().profiles).toHaveLength(0);

    const ownId = id(10);
    const own = {
      id: ownId,
      accountOwnerId: 'user-a' as const,
      legalName: 'Recovered',
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
      equipmentTypes: [] as string[],
      identitySource: 'USER_ENTERED' as const,
      cloudStatus: 'synced' as const,
      createdAt: 1,
      updatedAt: 1,
    };
    remote.profiles = [toRemoteCarrierProfileRow(own, 'user-a') as unknown as Record<string, unknown>];
    useSubscriptionStore.getState().setTier('free');
    const recovered = await recoverCarrierPacketsFromCloud(deps());
    expect(recovered.integrityConflicts).toBe(0);
    expect(recovered.profilesRecovered).toBe(1);
    expect(useCarrierProfileStore.getState().profiles[0]?.legalName).toBe('Recovered');

    useCarrierProfileStore.getState().setCloudStatus(ownId, 'pending_sync');
    useCarrierProfileStore.getState().upsertProfile({
      ...own,
      legalName: 'Local pending',
      cloudStatus: 'pending_sync',
      updatedAt: 2,
    });
    remote.profiles = [
      toRemoteCarrierProfileRow({ ...own, legalName: 'Remote newer', updatedAt: 99 }, 'user-a') as unknown as Record<
        string,
        unknown
      >,
    ];
    const kept = await recoverCarrierPacketsFromCloud(deps());
    expect(kept.skippedLocalChanges).toBeGreaterThan(0);
    expect(useCarrierProfileStore.getState().profiles[0]?.legalName).toBe('Local pending');
  });

  it('SHARED → SUPERSEDED sync is a narrow status transition, not a snapshot rewrite', async () => {
    const packetId = id(11);
    const packet = {
      id: packetId,
      accountOwnerId: 'user-a' as const,
      status: 'SHARED' as const,
      name: 'Pack',
      templateSourceKind: 'BUILTIN' as const,
      templateSourceId: null,
      templateCode: 'STANDARD_BROKER_PACKET' as const,
      templateSnapshot: STANDARD_BROKER_PACKET,
      carrierProfileId: null,
      profileSnapshot: null,
      recipientLabel: 'Broker',
      shareMethod: 'OTHER' as const,
      readyAt: 1,
      sharedAt: 2,
      supersedesPacketId: null,
      cloudStatus: 'pending_sync' as const,
      createdAt: 1,
      updatedAt: 2,
    };
    useCarrierPacketsStore.getState().addPacket(packet, []);
    await syncPendingCarrierPackets(deps());
    expect(remote.packets[0]?.status).toBe('SHARED');
    useCarrierPacketsStore.getState().transitionPacket(packetId, 'SUPERSEDED', {
      updatedAt: 3,
      cloudStatus: 'pending_sync',
    });
    const out = await syncPendingCarrierPackets(deps());
    expect(out.integrityConflicts).toBe(0);
    expect(out.packetsSynced).toBe(1);
    expect(remote.packets[0]?.status).toBe('SUPERSEDED');
    expect(remote.packets[0]?.recipient_label).toBe('Broker');
    expect(useCarrierPacketsStore.getState().packets[0]?.status).toBe('SUPERSEDED');
  });

  it('DRAFT membership diff deletes stale remote rows and converges after partial delete', async () => {
    const packetId = id(12);
    const keep = id(13);
    const stale = id(14);
    const docId = id(15);
    const verId = id(16);
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
        cloudStatus: 'pending_sync',
        createdAt: 1,
        updatedAt: 2,
      },
      [
        {
          id: keep,
          accountOwnerId: 'user-a',
          carrierPacketId: packetId,
          requirementKey: 'w9',
          requirementLabel: 'W-9',
          required: true,
          position: 0,
          operationalDocumentId: docId,
          documentVersionId: verId,
          documentKindSnapshot: 'W9',
          sensitivitySnapshot: 'FINANCIAL_SENSITIVE',
          expiresAtSnapshot: null,
          titleSnapshot: 'W-9',
          createdAt: 1,
        },
      ],
    );
    remote.items.push({
      id: stale,
      owner_id: 'user-a',
      carrier_packet_id: packetId,
      requirement_key: 'factoring',
    });
    const out = await syncPendingCarrierPackets(deps());
    expect(out.itemsDeleted).toBe(1);
    expect(remote.deletes).toContain(stale);
    expect(remote.items.some((row) => row.id === stale)).toBe(false);
    expect(remote.items.some((row) => row.id === keep)).toBe(true);
    expect(remote.packets[0]?.status).toBe('DRAFT');
  });

  it('READY first sync stages DRAFT then items then READY; account switch after fetch writes nothing', async () => {
    const packetId = id(17);
    useCarrierPacketsStore.getState().addPacket(
      {
        id: packetId,
        accountOwnerId: 'user-a',
        status: 'READY',
        name: 'Pack',
        templateSourceKind: 'BUILTIN',
        templateSourceId: null,
        templateCode: 'STANDARD_BROKER_PACKET',
        templateSnapshot: STANDARD_BROKER_PACKET,
        carrierProfileId: null,
        profileSnapshot: null,
        recipientLabel: null,
        shareMethod: null,
        readyAt: 1,
        sharedAt: null,
        supersedesPacketId: null,
        cloudStatus: 'pending_sync',
        createdAt: 1,
        updatedAt: 2,
      },
      [],
    );
    const ready = await syncPendingCarrierPackets(deps());
    expect(ready.packetsSynced).toBe(1);
    expect(remote.packets[0]?.status).toBe('READY');
    const staged = remote.upserts.filter((u) => u.table === 'carrier_packets').map((u) => u.row.status);
    expect(staged[0]).toBe('DRAFT');
    expect(staged[staged.length - 1]).toBe('READY');

    useCarrierPacketsStore.getState().setPacketCloudStatus(packetId, 'pending_sync');
    remote.upserts = [];
    remote.onFetchPackets = () => {
      useAuthStore.setState({ userId: 'user-b', status: 'signed_in', session: null });
    };
    const switched = await syncPendingCarrierPackets(deps());
    expect(switched.packetsSynced).toBe(0);
    expect(remote.upserts).toHaveLength(0);

    useAuthStore.setState({ userId: 'user-a', status: 'signed_in', session: null });
    remote.onFetchPackets = () => {
      useSubscriptionStore.getState().setTier('driver_pro');
    };
    useCarrierPacketsStore.getState().setPacketCloudStatus(packetId, 'pending_sync');
    const lost = await syncPendingCarrierPackets(deps());
    expect(lost.packetsSynced).toBe(0);
  });

  it('crash after DRAFT or READY stage recovers a truthful remote lifecycle row', async () => {
    const packetId = id(18);
    const shared = {
      id: packetId,
      accountOwnerId: 'user-a' as const,
      status: 'SHARED' as const,
      name: 'Pack',
      templateSourceKind: 'BUILTIN' as const,
      templateSourceId: null,
      templateCode: 'STANDARD_BROKER_PACKET' as const,
      templateSnapshot: STANDARD_BROKER_PACKET,
      carrierProfileId: null,
      profileSnapshot: null,
      recipientLabel: 'Broker',
      shareMethod: 'OTHER' as const,
      readyAt: 1,
      sharedAt: 2,
      supersedesPacketId: null,
      cloudStatus: 'pending_sync' as const,
      createdAt: 1,
      updatedAt: 2,
    };
    useCarrierPacketsStore.getState().addPacket(shared, []);
    remote.failPacketUpsertWhen = (row) => row.status === 'READY';
    await syncPendingCarrierPackets(deps());
    expect(remote.packets[0]?.status).toBe('DRAFT');
    expect(remote.packets[0]?.ready_at).toBeNull();
    expect(remote.packets[0]?.shared_at).toBeNull();
    expect(remote.packets[0]?.share_method).toBeNull();
    useCarrierPacketsStore.getState().clear();
    remote.failPacketUpsertWhen = null;
    const draftRecovered = await recoverCarrierPacketsFromCloud(deps());
    expect(draftRecovered.packetsRecovered).toBe(1);
    expect(useCarrierPacketsStore.getState().packets[0]?.status).toBe('DRAFT');
    expect(useCarrierPacketsStore.getState().packets[0]?.readyAt).toBeNull();
    expect(useCarrierPacketsStore.getState().packets[0]?.sharedAt).toBeNull();

    useCarrierPacketsStore.getState().clear();
    useCarrierPacketsStore.getState().addPacket(shared, []);
    remote.packets = [];
    remote.upserts = [];
    remote.failPacketUpsertWhen = (row) => row.status === 'SHARED';
    await syncPendingCarrierPackets(deps());
    expect(remote.packets[0]?.status).toBe('READY');
    expect(remote.packets[0]?.ready_at).toBeTruthy();
    expect(remote.packets[0]?.shared_at).toBeNull();
    expect(remote.packets[0]?.share_method).toBeNull();
    useCarrierPacketsStore.getState().clear();
    remote.failPacketUpsertWhen = null;
    const readyRecovered = await recoverCarrierPacketsFromCloud(deps());
    expect(readyRecovered.packetsRecovered).toBe(1);
    expect(useCarrierPacketsStore.getState().packets[0]?.status).toBe('READY');
    expect(useCarrierPacketsStore.getState().packets[0]?.readyAt).toBe(1);
    expect(useCarrierPacketsStore.getState().packets[0]?.sharedAt).toBeNull();
    expect(useCarrierPacketsStore.getState().packets[0]?.shareMethod).toBeNull();
  });

  it('remote READY exact reviewed snapshot promotes to SHARED; mismatch is an integrity conflict', async () => {
    const packetId = id(19);
    const local = {
      id: packetId,
      accountOwnerId: 'user-a' as const,
      status: 'SHARED' as const,
      name: 'Pack',
      templateSourceKind: 'BUILTIN' as const,
      templateSourceId: null,
      templateCode: 'STANDARD_BROKER_PACKET' as const,
      templateSnapshot: STANDARD_BROKER_PACKET,
      carrierProfileId: null,
      profileSnapshot: null,
      recipientLabel: 'Broker Co',
      shareMethod: 'OTHER' as const,
      readyAt: 1,
      sharedAt: 2,
      supersedesPacketId: null,
      cloudStatus: 'pending_sync' as const,
      createdAt: 1,
      updatedAt: 2,
    };
    const readyRemote = {
      ...local,
      status: 'READY' as const,
      sharedAt: null,
      shareMethod: null,
      recipientLabel: null,
    };
    useCarrierPacketsStore.getState().addPacket(local, []);
    remote.packets.push(toRemoteCarrierPacketRow(readyRemote, 'user-a') as unknown as Record<string, unknown>);
    const matched = await syncPendingCarrierPackets(deps());
    expect(matched.integrityConflicts).toBe(0);
    expect(matched.packetsSynced).toBe(1);
    expect(remote.packets[0]?.status).toBe('SHARED');
    expect(remote.packets[0]?.shared_at).toBeTruthy();
    expect(remote.packets[0]?.share_method).toBe('OTHER');

    for (const mutate of [
      { name: 'Other' },
      { readyAt: 99 },
      { templateSnapshot: { ...STANDARD_BROKER_PACKET, name: 'Mutated' } },
      {
        profileSnapshot: {
          legalName: 'Other LLC',
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
          identitySource: 'USER_ENTERED' as const,
          capturedAt: 1,
        },
      },
    ]) {
      useCarrierPacketsStore.getState().clear();
      useCarrierPacketsStore.getState().addPacket(local, []);
      remote.packets = [
        toRemoteCarrierPacketRow(
          { ...readyRemote, ...mutate },
          'user-a',
        ) as unknown as Record<string, unknown>,
      ];
      remote.upserts = [];
      const conflicted = await syncPendingCarrierPackets(deps());
      expect(conflicted.integrityConflicts).toBeGreaterThan(0);
      expect(remote.packets[0]?.status).toBe('READY');
    }
  });
});

describe('Pass 3.3 — exact historical evidence', () => {
  const sharedPacket = (packetId: string, over: Record<string, unknown> = {}) => ({
    id: packetId,
    accountOwnerId: 'user-a' as const,
    status: 'SHARED' as const,
    name: 'Pack',
    templateSourceKind: 'BUILTIN' as const,
    templateSourceId: null,
    templateCode: 'STANDARD_BROKER_PACKET' as const,
    templateSnapshot: STANDARD_BROKER_PACKET,
    carrierProfileId: null,
    profileSnapshot: null,
    recipientLabel: 'Broker',
    shareMethod: 'OTHER' as const,
    readyAt: 1,
    sharedAt: 2,
    supersedesPacketId: null,
    cloudStatus: 'pending_sync' as const,
    createdAt: 1,
    updatedAt: 2,
    ...over,
  });

  const w9Item = (packetId: string, itemId: string, docId: string, verId: string) => ({
    id: itemId,
    accountOwnerId: 'user-a' as const,
    carrierPacketId: packetId,
    requirementKey: 'w9',
    requirementLabel: 'W-9',
    required: true,
    position: 0,
    operationalDocumentId: docId,
    documentVersionId: verId,
    documentKindSnapshot: 'W9' as const,
    sensitivitySnapshot: 'FINANCIAL_SENSITIVE' as const,
    expiresAtSnapshot: '2027-01-01' as string | null,
    titleSnapshot: 'W-9' as string | null,
    createdAt: 1,
  });

  const seedWallet = (docId: string, verId: string) => {
    useRoadWalletStore.getState().addDocument({
      id: docId,
      accountOwnerId: 'user-a',
      documentKind: 'W9',
      subjectKind: 'CARRIER',
      sensitivity: 'FINANCIAL_SENSITIVE',
      title: 'W-9',
      issuer: null,
      jurisdiction: null,
      maskedReference: null,
      issuedAt: null,
      effectiveAt: null,
      expiresAt: null,
      truckId: null,
      trailerNumber: null,
      offlinePinned: false,
      lifecycle: 'ACTIVE',
      cloudStatus: 'synced',
      createdAt: 1,
      updatedAt: 1,
    } as never);
    useRoadWalletStore.getState().addVersion({
      id: verId,
      operationalDocumentId: docId,
      accountOwnerId: 'user-a',
      versionNumber: 1,
      supersedesVersionId: null,
      fileKind: 'IMAGE',
      mimeType: 'image/jpeg',
      ext: 'jpg',
      relativePath: 'road-wallet/x/y.jpg',
      sha256: 'a'.repeat(64),
      byteSize: 12,
      fileCache: {
        state: 'READY',
        relativePath: 'road-wallet/x/y.jpg',
        sha256: 'a'.repeat(64),
        error: null,
        checkedAt: 1,
      },
      cloudStatus: 'synced',
      remoteStorageBucket: null,
      remoteStoragePath: null,
      createdAt: 1,
    } as never);
  };

  it('remote SHARED exact evidence is idempotent; readyAt or item snapshot mismatch conflicts', async () => {
    const packetId = id(30);
    const itemId = id(31);
    const docId = id(32);
    const verId = id(33);
    const local = sharedPacket(packetId);
    const item = w9Item(packetId, itemId, docId, verId);
    useCarrierPacketsStore.getState().addPacket(local, [item]);
    remote.packets.push(toRemoteCarrierPacketRow(local, 'user-a') as unknown as Record<string, unknown>);
    remote.items.push(toRemoteCarrierPacketItemRow(item, 'user-a') as unknown as Record<string, unknown>);
    const exact = await syncPendingCarrierPackets(deps());
    expect(exact.integrityConflicts).toBe(0);
    expect(exact.packetsSynced).toBe(1);
    expect(remote.upserts.filter((u) => u.table === 'carrier_packets')).toHaveLength(0);

    useCarrierPacketsStore.getState().setPacketCloudStatus(packetId, 'pending_sync');
    remote.packets = [
      toRemoteCarrierPacketRow({ ...local, readyAt: 99 }, 'user-a') as unknown as Record<string, unknown>,
    ];
    const readyAtConflict = await syncPendingCarrierPackets(deps());
    expect(readyAtConflict.integrityConflicts).toBeGreaterThan(0);
    expect(useCarrierPacketsStore.getState().packets[0]?.readyAt).toBe(1);

    useCarrierPacketsStore.getState().setPacketCloudStatus(packetId, 'pending_sync');
    remote.packets = [toRemoteCarrierPacketRow(local, 'user-a') as unknown as Record<string, unknown>];
    remote.items = [
      toRemoteCarrierPacketItemRow(
        { ...item, sensitivitySnapshot: 'STANDARD' },
        'user-a',
      ) as unknown as Record<string, unknown>,
    ];
    const sensitivityConflict = await syncPendingCarrierPackets(deps());
    expect(sensitivityConflict.integrityConflicts).toBeGreaterThan(0);

    remote.items = [
      toRemoteCarrierPacketItemRow(
        { ...item, expiresAtSnapshot: '2028-01-01', titleSnapshot: 'Other' },
        'user-a',
      ) as unknown as Record<string, unknown>,
    ];
    useCarrierPacketsStore.getState().setPacketCloudStatus(packetId, 'pending_sync');
    const snapshotConflict = await syncPendingCarrierPackets(deps());
    expect(snapshotConflict.integrityConflicts).toBeGreaterThan(0);
  });

  it('remote SUPERSEDED exact succeeds; evidence mismatch conflicts; SHARED→SUPERSEDED is status-only', async () => {
    const packetId = id(34);
    const superseded = sharedPacket(packetId, { status: 'SUPERSEDED' });
    useCarrierPacketsStore.getState().addPacket(superseded, []);
    remote.packets.push(
      toRemoteCarrierPacketRow(superseded, 'user-a') as unknown as Record<string, unknown>,
    );
    const exact = await syncPendingCarrierPackets(deps());
    expect(exact.integrityConflicts).toBe(0);
    expect(exact.packetsSynced).toBe(1);

    useCarrierPacketsStore.getState().setPacketCloudStatus(packetId, 'pending_sync');
    remote.packets = [
      toRemoteCarrierPacketRow({ ...superseded, readyAt: 50 }, 'user-a') as unknown as Record<
        string,
        unknown
      >,
    ];
    const mismatch = await syncPendingCarrierPackets(deps());
    expect(mismatch.integrityConflicts).toBeGreaterThan(0);
    expect(remote.packets[0]?.status).toBe('SUPERSEDED');

    useCarrierPacketsStore.getState().clear();
    const localSuperseded = sharedPacket(packetId, { status: 'SUPERSEDED', updatedAt: 8 });
    const remoteShared = sharedPacket(packetId, { status: 'SHARED', cloudStatus: 'synced' });
    useCarrierPacketsStore.getState().addPacket(localSuperseded, []);
    remote.packets = [
      toRemoteCarrierPacketRow(remoteShared, 'user-a') as unknown as Record<string, unknown>,
    ];
    remote.upserts = [];
    const promoted = await syncPendingCarrierPackets(deps());
    expect(promoted.integrityConflicts).toBe(0);
    expect(promoted.packetsSynced).toBe(1);
    expect(remote.packets[0]?.status).toBe('SUPERSEDED');
    expect(remote.packets[0]?.ready_at).toBe(toRemoteCarrierPacketRow(remoteShared, 'user-a').ready_at);
  });

  it('READY local/remote different readyAt is an integrity conflict', async () => {
    const packetId = id(35);
    const ready = {
      ...sharedPacket(packetId, {
        status: 'READY',
        sharedAt: null,
        shareMethod: null,
        recipientLabel: null,
      }),
    };
    useCarrierPacketsStore.getState().addPacket(ready, []);
    remote.packets.push(
      toRemoteCarrierPacketRow({ ...ready, readyAt: 77 }, 'user-a') as unknown as Record<string, unknown>,
    );
    const out = await syncPendingCarrierPackets(deps());
    expect(out.integrityConflicts).toBeGreaterThan(0);
    expect(useCarrierPacketsStore.getState().packets[0]?.readyAt).toBe(1);
    expect(remote.packets[0]?.status).toBe('READY');
  });

  it('recovery never silently accepts changed historical packet or item evidence', async () => {
    const packetId = id(36);
    const itemId = id(37);
    const docId = id(38);
    const verId = id(39);
    seedWallet(docId, verId);
    const local = { ...sharedPacket(packetId), cloudStatus: 'synced' as const };
    const item = w9Item(packetId, itemId, docId, verId);
    useCarrierPacketsStore.getState().addPacket(local, [item]);
    remote.packets.push(
      toRemoteCarrierPacketRow({ ...local, readyAt: 44 }, 'user-a') as unknown as Record<string, unknown>,
    );
    remote.items.push(toRemoteCarrierPacketItemRow(item, 'user-a') as unknown as Record<string, unknown>);
    const readyAt = await recoverCarrierPacketsFromCloud(deps());
    expect(readyAt.integrityConflicts).toBeGreaterThan(0);
    expect(useCarrierPacketsStore.getState().packets[0]?.readyAt).toBe(1);

    remote.packets = [toRemoteCarrierPacketRow(local, 'user-a') as unknown as Record<string, unknown>];
    remote.items = [
      toRemoteCarrierPacketItemRow(
        { ...item, sensitivitySnapshot: 'STANDARD', titleSnapshot: 'Changed' },
        'user-a',
      ) as unknown as Record<string, unknown>,
    ];
    const items = await recoverCarrierPacketsFromCloud(deps());
    expect(items.integrityConflicts).toBeGreaterThan(0);
    expect(useCarrierPacketsStore.getState().items[0]?.sensitivitySnapshot).toBe('FINANCIAL_SENSITIVE');
    expect(useCarrierPacketsStore.getState().items[0]?.titleSnapshot).toBe('W-9');
  });
});

describe('IR-R1 — atomic recovery and return-to-draft proof', () => {
  const readyPacket = (packetId: string, over: Record<string, unknown> = {}) => ({
    id: packetId,
    accountOwnerId: 'user-a' as const,
    status: 'READY' as const,
    name: 'Pack',
    templateSourceKind: 'BUILTIN' as const,
    templateSourceId: null,
    templateCode: 'STANDARD_BROKER_PACKET' as const,
    templateSnapshot: STANDARD_BROKER_PACKET,
    carrierProfileId: null,
    profileSnapshot: null,
    recipientLabel: null,
    shareMethod: null,
    readyAt: 1,
    sharedAt: null,
    supersedesPacketId: null,
    cloudStatus: 'synced' as const,
    createdAt: 1,
    updatedAt: 2,
    ...over,
  });

  const w9Item = (packetId: string, itemId: string, docId: string, verId: string) => ({
    id: itemId,
    accountOwnerId: 'user-a' as const,
    carrierPacketId: packetId,
    requirementKey: 'w9',
    requirementLabel: 'W-9',
    required: true,
    position: 0,
    operationalDocumentId: docId,
    documentVersionId: verId,
    documentKindSnapshot: 'W9' as const,
    sensitivitySnapshot: 'FINANCIAL_SENSITIVE' as const,
    expiresAtSnapshot: '2027-01-01' as string | null,
    titleSnapshot: 'W-9' as string | null,
    createdAt: 1,
  });

  const seedWallet = (docId: string, verId: string) => {
    useRoadWalletStore.getState().addDocument({
      id: docId,
      accountOwnerId: 'user-a',
      documentKind: 'W9',
      subjectKind: 'CARRIER',
      sensitivity: 'FINANCIAL_SENSITIVE',
      title: 'W-9',
      issuer: null,
      jurisdiction: null,
      maskedReference: null,
      issuedAt: null,
      effectiveAt: null,
      expiresAt: null,
      truckId: null,
      trailerNumber: null,
      offlinePinned: false,
      lifecycle: 'ACTIVE',
      cloudStatus: 'synced',
      createdAt: 1,
      updatedAt: 1,
    } as never);
    useRoadWalletStore.getState().addVersion({
      id: verId,
      operationalDocumentId: docId,
      accountOwnerId: 'user-a',
      versionNumber: 1,
      supersedesVersionId: null,
      fileKind: 'IMAGE',
      mimeType: 'image/jpeg',
      ext: 'jpg',
      relativePath: 'road-wallet/x/y.jpg',
      sha256: 'a'.repeat(64),
      byteSize: 12,
      fileCache: {
        state: 'READY',
        relativePath: 'road-wallet/x/y.jpg',
        sha256: 'a'.repeat(64),
        error: null,
        checkedAt: 1,
      },
      cloudStatus: 'synced',
      remoteStorageBucket: null,
      remoteStoragePath: null,
      createdAt: 1,
    } as never);
  };

  it('READY local exact READY remote + exact items does not mutate membership', async () => {
    const packetId = id(40);
    const itemId = id(41);
    const docId = id(42);
    const verId = id(43);
    seedWallet(docId, verId);
    const local = readyPacket(packetId);
    const item = w9Item(packetId, itemId, docId, verId);
    useCarrierPacketsStore.getState().addPacket(local, [item]);
    remote.packets.push(toRemoteCarrierPacketRow(local, 'user-a') as unknown as Record<string, unknown>);
    remote.items.push(toRemoteCarrierPacketItemRow(item, 'user-a') as unknown as Record<string, unknown>);
    const out = await recoverCarrierPacketsFromCloud(deps());
    expect(out.integrityConflicts).toBe(0);
    expect(useCarrierPacketsStore.getState().items[0]?.id).toBe(itemId);
    expect(useCarrierPacketsStore.getState().packets[0]?.name).toBe('Pack');
  });

  it('READY remote item mismatches and malformed rows conflict without changing local membership', async () => {
    const packetId = id(44);
    const itemId = id(45);
    const docId = id(46);
    const verId = id(47);
    seedWallet(docId, verId);
    const local = readyPacket(packetId);
    const item = w9Item(packetId, itemId, docId, verId);
    const extra = w9Item(packetId, id(48), docId, verId);
    const cases: Record<string, unknown>[] = [
      toRemoteCarrierPacketItemRow({ ...item, sensitivitySnapshot: 'STANDARD' }, 'user-a') as unknown as Record<
        string,
        unknown
      >,
      toRemoteCarrierPacketItemRow({ ...item, titleSnapshot: 'Other' }, 'user-a') as unknown as Record<
        string,
        unknown
      >,
      toRemoteCarrierPacketItemRow({ ...item, expiresAtSnapshot: '2028-01-01' }, 'user-a') as unknown as Record<
        string,
        unknown
      >,
      toRemoteCarrierPacketItemRow({ ...item, sensitivitySnapshot: 'STANDARD' }, 'user-a') as unknown as Record<
        string,
        unknown
      >,
    ];
    for (const remoteItem of cases) {
      useCarrierPacketsStore.getState().clear();
      useCarrierPacketsStore.getState().addPacket(local, [item]);
      remote.packets = [toRemoteCarrierPacketRow(local, 'user-a') as unknown as Record<string, unknown>];
      remote.items = [remoteItem];
      const out = await recoverCarrierPacketsFromCloud(deps());
      expect(out.integrityConflicts).toBeGreaterThan(0);
      expect(useCarrierPacketsStore.getState().items[0]?.id).toBe(itemId);
      expect(useCarrierPacketsStore.getState().items[0]?.titleSnapshot).toBe('W-9');
      expect(useCarrierPacketsStore.getState().items[0]?.sensitivitySnapshot).toBe('FINANCIAL_SENSITIVE');
    }

    useCarrierPacketsStore.getState().clear();
    useCarrierPacketsStore.getState().addPacket(local, [item]);
    remote.packets = [toRemoteCarrierPacketRow(local, 'user-a') as unknown as Record<string, unknown>];
    remote.items = [];
    const missing = await recoverCarrierPacketsFromCloud(deps());
    expect(missing.integrityConflicts).toBeGreaterThan(0);
    expect(useCarrierPacketsStore.getState().items).toHaveLength(1);

    useCarrierPacketsStore.getState().clear();
    useCarrierPacketsStore.getState().addPacket(local, [item]);
    remote.items = [
      toRemoteCarrierPacketItemRow(item, 'user-a') as unknown as Record<string, unknown>,
      toRemoteCarrierPacketItemRow(extra, 'user-a') as unknown as Record<string, unknown>,
    ];
    const extraRow = await recoverCarrierPacketsFromCloud(deps());
    expect(extraRow.integrityConflicts).toBeGreaterThan(0);
    expect(useCarrierPacketsStore.getState().items).toHaveLength(1);

    useCarrierPacketsStore.getState().clear();
    useCarrierPacketsStore.getState().addPacket(local, [item]);
    remote.items = [
      {
        ...(toRemoteCarrierPacketItemRow(item, 'user-a') as unknown as Record<string, unknown>),
        sensitivity_snapshot: 12,
      },
    ];
    const malformed = await recoverCarrierPacketsFromCloud(deps());
    expect(malformed.integrityConflicts).toBeGreaterThan(0);
    expect(useCarrierPacketsStore.getState().items[0]?.sensitivitySnapshot).toBe('FINANCIAL_SENSITIVE');
  });

  it('malformed one-of-N remote items blocks the whole packet import', async () => {
    const packetId = id(49);
    const docId = id(50);
    const verId = id(51);
    seedWallet(docId, verId);
    const remoteReady = readyPacket(packetId);
    const good = w9Item(packetId, id(52), docId, verId);
    remote.packets = [toRemoteCarrierPacketRow(remoteReady, 'user-a') as unknown as Record<string, unknown>];
    remote.items = [
      toRemoteCarrierPacketItemRow(good, 'user-a') as unknown as Record<string, unknown>,
      {
        id: id(53),
        owner_id: 'user-a',
        carrier_packet_id: packetId,
        requirement_key: 'coi',
        requirement_label: 1,
      },
    ];
    const out = await recoverCarrierPacketsFromCloud(deps());
    expect(out.integrityConflicts).toBeGreaterThan(0);
    expect(useCarrierPacketsStore.getState().packets).toHaveLength(0);
    expect(useCarrierPacketsStore.getState().items).toHaveLength(0);
  });

  it('pending local DRAFT keeps local metadata and membership when remote items differ', async () => {
    const packetId = id(54);
    const itemId = id(55);
    const docId = id(56);
    const verId = id(57);
    seedWallet(docId, verId);
    const local = readyPacket(packetId, { status: 'DRAFT', readyAt: null, cloudStatus: 'pending_sync' });
    const item = w9Item(packetId, itemId, docId, verId);
    useCarrierPacketsStore.getState().addPacket(local, [item]);
    remote.packets = [
      toRemoteCarrierPacketRow(
        readyPacket(packetId, { status: 'DRAFT', readyAt: null, name: 'Remote', updatedAt: 99 }),
        'user-a',
      ) as unknown as Record<string, unknown>,
    ];
    remote.items = [
      toRemoteCarrierPacketItemRow({ ...item, titleSnapshot: 'Remote title' }, 'user-a') as unknown as Record<
        string,
        unknown
      >,
    ];
    const out = await recoverCarrierPacketsFromCloud(deps());
    expect(out.skippedLocalChanges).toBeGreaterThan(0);
    expect(useCarrierPacketsStore.getState().packets[0]?.name).toBe('Pack');
    expect(useCarrierPacketsStore.getState().items[0]?.titleSnapshot).toBe('W-9');
  });

  it('synced DRAFT keeps membership when local metadata is kept and replaces both atomically', async () => {
    const packetId = id(58);
    const itemId = id(59);
    const docId = id(60);
    const verId = id(61);
    seedWallet(docId, verId);
    const local = readyPacket(packetId, {
      status: 'DRAFT',
      readyAt: null,
      name: 'Local',
      updatedAt: 50,
      cloudStatus: 'synced',
    });
    const item = w9Item(packetId, itemId, docId, verId);
    useCarrierPacketsStore.getState().addPacket(local, [item]);
    remote.packets = [
      toRemoteCarrierPacketRow(
        readyPacket(packetId, { status: 'DRAFT', readyAt: null, name: 'Older', updatedAt: 10 }),
        'user-a',
      ) as unknown as Record<string, unknown>,
    ];
    remote.items = [
      toRemoteCarrierPacketItemRow({ ...item, titleSnapshot: 'Should not apply' }, 'user-a') as unknown as Record<
        string,
        unknown
      >,
    ];
    const kept = await recoverCarrierPacketsFromCloud(deps());
    expect(kept.integrityConflicts).toBe(0);
    expect(useCarrierPacketsStore.getState().packets[0]?.name).toBe('Local');
    expect(useCarrierPacketsStore.getState().items[0]?.titleSnapshot).toBe('W-9');

    remote.packets = [
      toRemoteCarrierPacketRow(
        readyPacket(packetId, { status: 'DRAFT', readyAt: null, name: 'Newer remote', updatedAt: 80 }),
        'user-a',
      ) as unknown as Record<string, unknown>,
    ];
    const replaced = await recoverCarrierPacketsFromCloud(deps());
    expect(replaced.integrityConflicts).toBe(0);
    expect(useCarrierPacketsStore.getState().packets[0]?.name).toBe('Newer remote');
    expect(useCarrierPacketsStore.getState().items[0]?.titleSnapshot).toBe('Should not apply');
  });

  it('Device B stale DRAFT cannot downgrade remote READY without proof', async () => {
    const packetId = id(62);
    const local = readyPacket(packetId, {
      status: 'DRAFT',
      readyAt: null,
      name: 'Stale',
      cloudStatus: 'pending_sync',
    });
    useCarrierPacketsStore.getState().addPacket(local, []);
    remote.packets = [
      toRemoteCarrierPacketRow(readyPacket(packetId), 'user-a') as unknown as Record<string, unknown>,
    ];
    const recovered = await recoverCarrierPacketsFromCloud(deps());
    expect(recovered.integrityConflicts).toBeGreaterThan(0);
    const synced = await syncPendingCarrierPackets(deps());
    expect(synced.integrityConflicts).toBeGreaterThan(0);
    expect(remote.packets[0]?.status).toBe('READY');
    expect(useCarrierPacketsStore.getState().packets[0]?.status).toBe('DRAFT');
  });

  it('valid proof stages remote READY to base DRAFT then local DRAFT membership', async () => {
    const packetId = id(63);
    const itemId = id(64);
    const docId = id(65);
    const verId = id(66);
    seedWallet(docId, verId);
    const ready = readyPacket(packetId, { cloudStatus: 'pending_sync' });
    const item = w9Item(packetId, itemId, docId, verId);
    const edited = w9Item(packetId, itemId, docId, verId);
    useCarrierPacketsStore.getState().addPacket({ ...ready, status: 'READY' }, [item]);
    const proof = createCarrierReadyReturnProof({
      packet: { ...ready, status: 'READY' },
      items: [item],
      now: 9,
    });
    useCarrierPacketsStore.getState().upsertReadyReturnProof(proof);
    useCarrierPacketsStore.getState().transitionPacket(packetId, 'DRAFT', {
      readyAt: null,
      updatedAt: 20,
      cloudStatus: 'pending_sync',
    });
    useCarrierPacketsStore.getState().updateDraftPacket(packetId, { name: 'Edited', updatedAt: 21 }, [
      { ...edited, titleSnapshot: 'Edited W-9' },
    ]);
    remote.packets = [toRemoteCarrierPacketRow(ready, 'user-a') as unknown as Record<string, unknown>];
    remote.items = [toRemoteCarrierPacketItemRow(item, 'user-a') as unknown as Record<string, unknown>];
    const out = await syncPendingCarrierPackets(deps());
    expect(out.integrityConflicts).toBe(0);
    expect(out.packetsSynced).toBe(1);
    const statuses = remote.upserts.filter((u) => u.table === 'carrier_packets').map((u) => u.row);
    expect(statuses[0]?.status).toBe('DRAFT');
    expect(statuses[0]?.name).toBe('Pack');
    expect(statuses[0]?.ready_at).toBeNull();
    expect(statuses[1]?.name).toBe('Edited');
    expect(remote.packets[0]?.name).toBe('Edited');
    expect(remote.items[0]?.title_snapshot).toBe('Edited W-9');
    expect(useCarrierPacketsStore.getState().readyReturnProofFor(packetId, 'user-a')).toBeNull();
  });

  it('proof mismatch against remote READY is a conflict; crash after base DRAFT retries safely', async () => {
    const packetId = id(67);
    const ready = readyPacket(packetId, { cloudStatus: 'pending_sync' });
    useCarrierPacketsStore.getState().addPacket(ready, []);
    const proof = createCarrierReadyReturnProof({ packet: ready, items: [], now: 9 });
    useCarrierPacketsStore.getState().upsertReadyReturnProof(proof);
    useCarrierPacketsStore.getState().transitionPacket(packetId, 'DRAFT', {
      readyAt: null,
      updatedAt: 20,
      cloudStatus: 'pending_sync',
    });
    remote.packets = [
      toRemoteCarrierPacketRow({ ...ready, name: 'Other READY' }, 'user-a') as unknown as Record<
        string,
        unknown
      >,
    ];
    const mismatch = await syncPendingCarrierPackets(deps());
    expect(mismatch.integrityConflicts).toBeGreaterThan(0);
    expect(remote.packets[0]?.status).toBe('READY');
    expect(useCarrierPacketsStore.getState().readyReturnProofFor(packetId, 'user-a')?.packetId).toBe(
      packetId,
    );

    remote.packets = [
      toRemoteCarrierPacketRow(draftCloudProjection(ready), 'user-a') as unknown as Record<string, unknown>,
    ];
    remote.failPacketUpsertWhen = (row) => row.name === 'Pack' && row.status === 'DRAFT' && false;
    const continued = await syncPendingCarrierPackets(deps());
    expect(continued.integrityConflicts).toBe(0);
    expect(continued.packetsSynced).toBe(1);
    expect(useCarrierPacketsStore.getState().readyReturnProofFor(packetId, 'user-a')).toBeNull();
  });

  it('local DRAFT + remote SHARED/SUPERSEDED is a conflict', async () => {
    const packetId = id(68);
    useCarrierPacketsStore.getState().addPacket(
      readyPacket(packetId, { status: 'DRAFT', readyAt: null, cloudStatus: 'pending_sync' }),
      [],
    );
    remote.packets = [
      toRemoteCarrierPacketRow(
        readyPacket(packetId, {
          status: 'SHARED',
          sharedAt: 3,
          shareMethod: 'OTHER',
          recipientLabel: 'Broker',
        }),
        'user-a',
      ) as unknown as Record<string, unknown>,
    ];
    const out = await syncPendingCarrierPackets(deps());
    expect(out.integrityConflicts).toBeGreaterThan(0);
    expect(remote.packets[0]?.status).toBe('SHARED');
  });
});

describe('IR-R4 — packet INSERT vs UPDATE write shape', () => {
  const draftPacket = (packetId: string, over: Record<string, unknown> = {}) => ({
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
    ...over,
  });

  it('new local DRAFT inserts DRAFT and never upserts', async () => {
    const packetId = id(80);
    useCarrierPacketsStore.getState().addPacket(draftPacket(packetId), []);
    const out = await syncPendingCarrierPackets(deps());
    expect(out.packetsSynced).toBe(1);
    expect(remote.packetWrites).toEqual([
      expect.objectContaining({ op: 'insert', row: expect.objectContaining({ status: 'DRAFT', id: packetId }) }),
    ]);
    expect(useCarrierPacketsStore.getState().packets[0]?.cloudStatus).toBe('synced');
  });

  it('new local READY inserts DRAFT then updates DRAFT→READY', async () => {
    const packetId = id(81);
    useCarrierPacketsStore.getState().addPacket(
      draftPacket(packetId, { status: 'READY', readyAt: 1, name: 'Ready' }),
      [],
    );
    const out = await syncPendingCarrierPackets(deps());
    expect(out.packetsSynced).toBe(1);
    expect(remote.packetWrites.map((w) => [w.op, w.row.status, w.expectedCurrentStatus])).toEqual([
      ['insert', 'DRAFT', undefined],
      ['update', 'READY', 'DRAFT'],
    ]);
    expect(remote.packets[0]?.status).toBe('READY');
    expect(useCarrierPacketsStore.getState().packets[0]?.cloudStatus).toBe('synced');
  });

  it('existing DRAFT → READY updates with expected DRAFT, never inserts', async () => {
    const packetId = id(82);
    const draft = draftPacket(packetId);
    remote.packets = [toRemoteCarrierPacketRow(draft, 'user-a') as unknown as Record<string, unknown>];
    useCarrierPacketsStore.getState().addPacket(
      draftPacket(packetId, { status: 'READY', readyAt: 9, recipientLabel: 'Broker' }),
      [],
    );
    const out = await syncPendingCarrierPackets(deps());
    expect(out.packetsSynced).toBe(1);
    expect(remote.packetWrites.every((w) => w.op === 'update')).toBe(true);
    expect(remote.packetWrites.map((w) => [w.row.status, w.expectedCurrentStatus])).toEqual([
      ['DRAFT', 'DRAFT'],
      ['READY', 'DRAFT'],
    ]);
    expect(remote.packets[0]?.status).toBe('READY');
  });

  it('existing READY → SHARED updates expected READY', async () => {
    const packetId = id(83);
    const ready = draftPacket(packetId, {
      status: 'READY',
      readyAt: 1,
      recipientLabel: 'Broker',
    });
    remote.packets = [toRemoteCarrierPacketRow(ready, 'user-a') as unknown as Record<string, unknown>];
    useCarrierPacketsStore.getState().addPacket(
      draftPacket(packetId, {
        status: 'SHARED',
        readyAt: 1,
        sharedAt: 2,
        shareMethod: 'OTHER',
        recipientLabel: 'Broker',
      }),
      [],
    );
    const out = await syncPendingCarrierPackets(deps());
    expect(out.integrityConflicts).toBe(0);
    expect(out.packetsSynced).toBe(1);
    expect(remote.packetWrites).toEqual([
      expect.objectContaining({
        op: 'update',
        expectedCurrentStatus: 'READY',
        row: expect.objectContaining({ status: 'SHARED' }),
      }),
    ]);
  });

  it('existing SHARED → SUPERSEDED updates expected SHARED', async () => {
    const packetId = id(84);
    const shared = draftPacket(packetId, {
      status: 'SHARED',
      readyAt: 1,
      sharedAt: 2,
      shareMethod: 'OTHER',
      recipientLabel: 'Broker',
    });
    remote.packets = [toRemoteCarrierPacketRow(shared, 'user-a') as unknown as Record<string, unknown>];
    useCarrierPacketsStore.getState().addPacket({ ...shared, status: 'SUPERSEDED', cloudStatus: 'pending_sync' }, []);
    const out = await syncPendingCarrierPackets(deps());
    expect(out.packetsSynced).toBe(1);
    expect(remote.packetWrites).toEqual([
      expect.objectContaining({
        op: 'update',
        expectedCurrentStatus: 'SHARED',
        row: expect.objectContaining({ status: 'SUPERSEDED' }),
      }),
    ]);
  });

  it('explicit READY return stages UPDATE READY→base DRAFT then UPDATE DRAFT edits', async () => {
    const packetId = id(85);
    const ready = draftPacket(packetId, { status: 'READY', readyAt: 1, name: 'Pack' });
    const proof = createCarrierReadyReturnProof({ packet: ready, items: [], now: 9 });
    useCarrierPacketsStore.getState().addPacket(ready, []);
    useCarrierPacketsStore.getState().upsertReadyReturnProof(proof);
    useCarrierPacketsStore.getState().transitionPacket(packetId, 'DRAFT', {
      readyAt: null,
      updatedAt: 20,
      cloudStatus: 'pending_sync',
    });
    useCarrierPacketsStore.getState().updateDraftPacket(packetId, { name: 'Edited', updatedAt: 21 }, []);
    remote.packets = [toRemoteCarrierPacketRow(ready, 'user-a') as unknown as Record<string, unknown>];
    const out = await syncPendingCarrierPackets(deps());
    expect(out.packetsSynced).toBe(1);
    expect(remote.packetWrites.map((w) => [w.op, w.row.status, w.row.name, w.expectedCurrentStatus])).toEqual([
      ['update', 'DRAFT', 'Pack', 'READY'],
      ['update', 'DRAFT', 'Edited', 'DRAFT'],
    ]);
    expect(useCarrierPacketsStore.getState().readyReturnProofFor(packetId, 'user-a')).toBeNull();
    expect(useCarrierPacketsStore.getState().packets[0]?.cloudStatus).toBe('synced');
  });

  it('expected-status miss does not mark local synced', async () => {
    const packetId = id(86);
    const draft = draftPacket(packetId, { name: 'Still draft' });
    remote.packets = [toRemoteCarrierPacketRow(draft, 'user-a') as unknown as Record<string, unknown>];
    useCarrierPacketsStore.getState().addPacket(draft, []);
    remote.updatePacket = async () => {
      throw new CarrierPacketRemoteConflictError('expected_status_miss', packetId);
    };
    const out = await syncPendingCarrierPackets(deps());
    expect(out.packetsSynced).toBe(0);
    expect(out.integrityConflicts).toBeGreaterThan(0);
    expect(useCarrierPacketsStore.getState().packets[0]?.cloudStatus).toBe('pending_sync');
    expect(remote.packets[0]?.status).toBe('DRAFT');
    expect(remote.packets[0]?.name).toBe('Still draft');
  });

  it('duplicate create race after absent read does not overwrite the existing row', async () => {
    const packetId = id(87);
    const existing = draftPacket(packetId, { name: 'Authoritative remote' });
    remote.packets = [toRemoteCarrierPacketRow(existing, 'user-a') as unknown as Record<string, unknown>];
    remote.hidePacketsOnFetch = true;
    useCarrierPacketsStore.getState().addPacket(draftPacket(packetId, { name: 'Local stale create' }), []);
    const out = await syncPendingCarrierPackets(deps());
    expect(out.packetsSynced).toBe(0);
    expect(out.integrityConflicts).toBeGreaterThan(0);
    expect(useCarrierPacketsStore.getState().packets[0]?.cloudStatus).toBe('pending_sync');
    expect(remote.packets[0]?.name).toBe('Authoritative remote');
    expect(remote.packetWrites).toHaveLength(0);
  });

  it('crash before READY update leaves remote DRAFT and does not increment packetsSynced', async () => {
    const packetId = id(88);
    useCarrierPacketsStore.getState().addPacket(
      draftPacket(packetId, { status: 'READY', readyAt: 1 }),
      [],
    );
    remote.failPacketUpsertWhen = (row) => row.status === 'READY';
    const out = await syncPendingCarrierPackets(deps());
    expect(out.packetsSynced).toBe(0);
    expect(useCarrierPacketsStore.getState().packets[0]?.cloudStatus).toBe('pending_sync');
    expect(remote.packets[0]?.status).toBe('DRAFT');
    expect(remote.packetWrites.map((w) => [w.op, w.row.status])).toEqual([['insert', 'DRAFT']]);
  });

  it('Fake INSERT rejects READY and duplicate id instead of updating', async () => {
    await expect(remote.insertPacketDraft({ id: 'x', status: 'READY' })).rejects.toMatchObject({
      reason: 'invalid_insert_status',
    });
    await remote.insertPacketDraft({ id: 'dup', status: 'DRAFT' });
    await expect(remote.insertPacketDraft({ id: 'dup', status: 'DRAFT', name: 'other' })).rejects.toMatchObject({
      reason: 'duplicate_insert',
    });
    expect(remote.packets).toHaveLength(1);
    expect(remote.packets[0]?.name).toBeUndefined();
  });
});
