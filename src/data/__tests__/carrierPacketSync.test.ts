import {
  newOpaqueId,
  STANDARD_BROKER_PACKET,
  toRemoteCarrierPacketRow,
  toRemoteCarrierProfileRow,
} from '@/domain';
import { useAuthStore } from '@/store/auth';
import { useCarrierPacketsStore } from '@/store/carrierPackets';
import { useCarrierProfileStore } from '@/store/carrierProfile';
import { useSubscriptionStore } from '@/store/subscription';

import { CarrierRemote, recoverCarrierPacketsFromCloud, syncPendingCarrierPackets } from '../carrierPacketSync';

class FakeCarrierRemote implements CarrierRemote {
  profiles: Record<string, unknown>[] = [];
  packets: Record<string, unknown>[] = [];
  items: Record<string, unknown>[] = [];
  upserts: { table: string; row: Record<string, unknown> }[] = [];
  deletes: string[] = [];
  failItemOnce = false;
  failPacketUpsertWhen: ((row: Record<string, unknown>) => boolean) | null = null;
  onFetchPackets: (() => void) | null = null;

  async fetchProfiles() {
    return this.profiles;
  }
  async fetchTemplates() {
    return [];
  }
  async fetchPackets() {
    this.onFetchPackets?.();
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
  async upsertPacket(row: Record<string, unknown>) {
    if (this.failPacketUpsertWhen?.(row)) throw new Error('packet upsert crashed');
    this.upserts.push({ table: 'carrier_packets', row });
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
