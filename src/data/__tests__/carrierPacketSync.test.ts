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
  failItemOnce = false;

  async fetchProfiles() {
    return this.profiles;
  }
  async fetchTemplates() {
    return [];
  }
  async fetchPackets() {
    return this.packets;
  }
  async fetchItems() {
    return this.items;
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
});
