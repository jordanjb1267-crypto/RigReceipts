import {
  authorizeCarrierPacketCloudWrite,
  authorizeCarrierProfileCloudWrite,
  authorizeCarrierTemplateCloudWrite,
  CarrierPacket,
  CarrierRecoveryResult,
  emptyCarrierRecoveryResult,
  fromRemoteCarrierPacketItemRow,
  fromRemoteCarrierPacketRow,
  fromRemoteCarrierProfileRow,
  fromRemoteCarrierTemplateRow,
  historicalEvidenceMatchesIgnoringStatus,
  historicalItemsMatch,
  historicalPacketSnapshotsMatch,
  itemsForPacket,
  mergeRecoveredCarrierRecord,
  toRemoteCarrierPacketItemRow,
  toRemoteCarrierPacketRow,
  toRemoteCarrierProfileRow,
  toRemoteCarrierTemplateRow,
} from '@/domain';
import { getSupabaseClient } from '@/lib/supabase';
import { useCarrierProfileStore } from '@/store/carrierProfile';
import { useCarrierPacketsStore } from '@/store/carrierPackets';
import { useRoadWalletStore } from '@/store/roadWallet';

import {
  assertRemoteEffectAuthorized,
  CloudSyncDeniedError,
  currentCloudSyncContext,
} from './cloudSyncAuth';

export const CARRIER_CLOUD_CAPABILITY = 'cloudDocumentBackup' as const;

export interface CarrierRemote {
  fetchProfiles(userId: string): Promise<unknown[]>;
  fetchTemplates(userId: string): Promise<unknown[]>;
  fetchPackets(userId: string): Promise<unknown[]>;
  fetchItems(userId: string): Promise<unknown[]>;
  upsertProfile(row: Record<string, unknown>): Promise<void>;
  upsertTemplate(row: Record<string, unknown>): Promise<void>;
  upsertPacket(row: Record<string, unknown>): Promise<void>;
  upsertItem(row: Record<string, unknown>): Promise<void>;
}

const table = (name: string) => getSupabaseClient().from(name);

export const supabaseCarrierRemote: CarrierRemote = {
  async fetchProfiles(userId) {
    const { data, error } = await table('carrier_profiles').select('*').eq('owner_id', userId);
    if (error) throw error;
    return data ?? [];
  },
  async fetchTemplates(userId) {
    const { data, error } = await table('carrier_packet_templates').select('*').eq('owner_id', userId);
    if (error) throw error;
    return data ?? [];
  },
  async fetchPackets(userId) {
    const { data, error } = await table('carrier_packets').select('*').eq('owner_id', userId);
    if (error) throw error;
    return data ?? [];
  },
  async fetchItems(userId) {
    const { data, error } = await table('carrier_packet_items').select('*').eq('owner_id', userId);
    if (error) throw error;
    return data ?? [];
  },
  async upsertProfile(row) {
    const { error } = await table('carrier_profiles').upsert(row, { onConflict: 'id' });
    if (error) throw error;
  },
  async upsertTemplate(row) {
    const { error } = await table('carrier_packet_templates').upsert(row, { onConflict: 'id' });
    if (error) throw error;
  },
  async upsertPacket(row) {
    const { error } = await table('carrier_packets').upsert(row, { onConflict: 'id' });
    if (error) throw error;
  },
  async upsertItem(row) {
    const { error } = await table('carrier_packet_items').upsert(row, { onConflict: 'id' });
    if (error) throw error;
  },
};

export interface CarrierSyncDeps {
  remote: CarrierRemote;
  ctx: () => ReturnType<typeof currentCloudSyncContext>;
}

export const defaultCarrierSyncDeps = (): CarrierSyncDeps => ({
  remote: supabaseCarrierRemote,
  ctx: currentCloudSyncContext,
});

const versionExistsForOwner = (
  documentId: string,
  versionId: string,
  ownerId: string,
): boolean => {
  const wallet = useRoadWalletStore.getState();
  const doc = wallet.documents.find((d) => d.id === documentId);
  const version = wallet.versions.find((v) => v.id === versionId);
  return (
    !!doc &&
    !!version &&
    doc.accountOwnerId === ownerId &&
    version.accountOwnerId === ownerId &&
    version.operationalDocumentId === documentId
  );
};

export async function recoverCarrierPacketsFromCloud(
  deps: CarrierSyncDeps = defaultCarrierSyncDeps(),
): Promise<CarrierRecoveryResult> {
  const ctx = deps.ctx();
  if (!ctx.userId) return emptyCarrierRecoveryResult('signed_out');
  if (!ctx.supabaseConfigured) return emptyCarrierRecoveryResult('not_configured');
  const userId = ctx.userId;
  const result = emptyCarrierRecoveryResult();
  const stillActive = () => deps.ctx().userId === userId;

  let profileRows: unknown[];
  let templateRows: unknown[];
  let packetRows: unknown[];
  let itemRows: unknown[];
  try {
    [profileRows, templateRows, packetRows, itemRows] = await Promise.all([
      deps.remote.fetchProfiles(userId),
      deps.remote.fetchTemplates(userId),
      deps.remote.fetchPackets(userId),
      deps.remote.fetchItems(userId),
    ]);
  } catch {
    return emptyCarrierRecoveryResult('fetch_failed');
  }
  if (!stillActive()) return emptyCarrierRecoveryResult('cancelled');

  for (const row of profileRows) {
    const remote = fromRemoteCarrierProfileRow(row, userId);
    if (!remote) {
      result.integrityConflicts++;
      continue;
    }
    const local = useCarrierProfileStore.getState().profiles.find((p) => p.id === remote.id);
    const merged = mergeRecoveredCarrierRecord(local, remote, false, () => true);
    if (merged.action === 'import') {
      useCarrierProfileStore.getState().importRecoveredProfile(merged.record);
      result.profilesRecovered++;
    } else if (merged.action === 'replace_metadata') {
      try {
        useCarrierProfileStore.getState().replaceSyncedProfile(merged.record);
        result.profilesRecovered++;
      } catch {
        result.integrityConflicts++;
      }
    } else if (merged.action === 'keep_local') {
      result.skippedLocalChanges++;
    }
  }

  for (const row of templateRows) {
    const remote = fromRemoteCarrierTemplateRow(row, userId);
    if (!remote) {
      result.integrityConflicts++;
      continue;
    }
    const local = useCarrierPacketsStore.getState().templates.find((t) => t.id === remote.id);
    const merged = mergeRecoveredCarrierRecord(local, remote, false, () => true);
    if (merged.action === 'import') {
      useCarrierPacketsStore.getState().importRecoveredTemplate(merged.record);
      result.templatesRecovered++;
    } else if (merged.action === 'replace_metadata') {
      try {
        useCarrierPacketsStore.getState().replaceSyncedTemplate(merged.record);
        result.templatesRecovered++;
      } catch {
        result.integrityConflicts++;
      }
    } else if (merged.action === 'keep_local') {
      result.skippedLocalChanges++;
    }
  }

  const recoveredPackets: CarrierPacket[] = [];
  for (const row of packetRows) {
    if (!stillActive()) return { ...result, outcome: 'cancelled' };
    const remote = fromRemoteCarrierPacketRow(row, userId);
    if (!remote) {
      result.integrityConflicts++;
      continue;
    }
    const local = useCarrierPacketsStore.getState().packets.find((p) => p.id === remote.id);
    const immutable = remote.status === 'SHARED' || remote.status === 'SUPERSEDED';
    const merged = mergeRecoveredCarrierRecord(local, remote, immutable, historicalPacketSnapshotsMatch);
    if (merged.action === 'conflict') {
      result.integrityConflicts++;
      continue;
    }
    if (merged.action === 'import') {
      recoveredPackets.push(merged.record);
      result.packetsRecovered++;
    } else if (merged.action === 'replace_metadata') {
      try {
        useCarrierPacketsStore.getState().replaceSyncedPacketMetadata(merged.record);
        recoveredPackets.push(merged.record);
        result.packetsRecovered++;
      } catch {
        result.integrityConflicts++;
      }
    } else if (merged.action === 'keep_local') {
      result.skippedLocalChanges++;
    } else {
      recoveredPackets.push(merged.record);
    }
  }

  for (const parent of recoveredPackets) {
    const mapped = [];
    for (const row of itemRows) {
      if (!isRecord(row) || row.carrier_packet_id !== parent.id) continue;
      const item = fromRemoteCarrierPacketItemRow(row, userId, parent);
      if (!item) {
        result.integrityConflicts++;
        continue;
      }
      if (!versionExistsForOwner(item.operationalDocumentId, item.documentVersionId, userId)) {
        result.integrityConflicts++;
        continue;
      }
      mapped.push(item);
    }
    const local = useCarrierPacketsStore.getState().packets.find((p) => p.id === parent.id);
    if (local && (local.cloudStatus === 'pending_sync' || local.cloudStatus === 'local_only')) {
      continue;
    }
    if (parent.status === 'SHARED' || parent.status === 'SUPERSEDED') {
      const existingItems = itemsForPacket(useCarrierPacketsStore.getState().items, parent.id);
      if (existingItems.length > 0 && !historicalItemsMatch(existingItems, mapped)) {
        result.integrityConflicts++;
        continue;
      }
      if (!useCarrierPacketsStore.getState().packets.some((p) => p.id === parent.id)) {
        useCarrierPacketsStore.getState().importRecoveredPacket(parent, mapped);
        result.itemsRecovered += mapped.length;
      }
      continue;
    }
    if (!useCarrierPacketsStore.getState().packets.some((p) => p.id === parent.id)) {
      useCarrierPacketsStore.getState().importRecoveredPacket(parent, mapped);
      result.itemsRecovered += mapped.length;
    } else {
      try {
        useCarrierPacketsStore.getState().replaceSyncedPacketItems(parent.id, mapped);
        result.itemsRecovered += mapped.length;
      } catch {
        result.integrityConflicts++;
      }
    }
  }

  return result;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

export interface CarrierSyncResult {
  profilesSynced: number;
  templatesSynced: number;
  packetsSynced: number;
  itemsSynced: number;
  integrityConflicts: number;
}

export async function syncPendingCarrierPackets(
  deps: CarrierSyncDeps = defaultCarrierSyncDeps(),
): Promise<CarrierSyncResult> {
  const result: CarrierSyncResult = {
    profilesSynced: 0,
    templatesSynced: 0,
    packetsSynced: 0,
    itemsSynced: 0,
    integrityConflicts: 0,
  };
  const ctx = deps.ctx();
  useCarrierProfileStore.getState().reconcileCloudStatuses(ctx);
  useCarrierPacketsStore.getState().reconcileCloudStatuses(ctx);

  for (const profile of useCarrierProfileStore.getState().profiles) {
    if (profile.cloudStatus !== 'pending_sync') continue;
    const decision = authorizeCarrierProfileCloudWrite(deps.ctx(), profile.accountOwnerId);
    if (!decision.allowed) continue;
    try {
      assertRemoteEffectAuthorized(CARRIER_CLOUD_CAPABILITY, profile.accountOwnerId, deps.ctx());
      await deps.remote.upsertProfile(
        toRemoteCarrierProfileRow(profile, decision.userId) as unknown as Record<string, unknown>,
      );
      useCarrierProfileStore.getState().setCloudStatus(profile.id, 'synced');
      result.profilesSynced++;
    } catch (err) {
      if (err instanceof CloudSyncDeniedError) {
        useCarrierProfileStore.getState().reconcileCloudStatuses(deps.ctx());
      }
    }
  }

  for (const template of useCarrierPacketsStore.getState().templates) {
    if (template.cloudStatus !== 'pending_sync') continue;
    const decision = authorizeCarrierTemplateCloudWrite(deps.ctx(), template.accountOwnerId);
    if (!decision.allowed) continue;
    try {
      assertRemoteEffectAuthorized(CARRIER_CLOUD_CAPABILITY, template.accountOwnerId, deps.ctx());
      await deps.remote.upsertTemplate(
        toRemoteCarrierTemplateRow(template, decision.userId) as unknown as Record<string, unknown>,
      );
      useCarrierPacketsStore.getState().setTemplateCloudStatus(template.id, 'synced');
      result.templatesSynced++;
    } catch (err) {
      if (err instanceof CloudSyncDeniedError) {
        useCarrierPacketsStore.getState().reconcileCloudStatuses(deps.ctx());
      }
    }
  }

  for (const packet of useCarrierPacketsStore.getState().packets) {
    if (packet.cloudStatus !== 'pending_sync') continue;
    const decision = authorizeCarrierPacketCloudWrite(deps.ctx(), packet.accountOwnerId);
    if (!decision.allowed) continue;
    const membership = itemsForPacket(useCarrierPacketsStore.getState().items, packet.id);
    try {
      assertRemoteEffectAuthorized(CARRIER_CLOUD_CAPABILITY, packet.accountOwnerId, deps.ctx());
      if (packet.status === 'SHARED' || packet.status === 'SUPERSEDED') {
        const remotePackets = await deps.remote.fetchPackets(decision.userId);
        const remoteItems = await deps.remote.fetchItems(decision.userId);
        const existing = remotePackets
          .map((row) => fromRemoteCarrierPacketRow(row, decision.userId))
          .find((p) => p?.id === packet.id);
        if (existing && (existing.status === 'SHARED' || existing.status === 'SUPERSEDED')) {
          const existingItems = remoteItems
            .map((row) => fromRemoteCarrierPacketItemRow(row, decision.userId, existing))
            .filter((i): i is NonNullable<typeof i> => !!i && i.carrierPacketId === packet.id);
          if (
            packet.status === 'SUPERSEDED' &&
            existing.status === 'SHARED' &&
            historicalEvidenceMatchesIgnoringStatus(existing, packet) &&
            historicalItemsMatch(existingItems, membership)
          ) {
            await deps.remote.upsertPacket(
              toRemoteCarrierPacketRow(packet, decision.userId) as unknown as Record<
                string,
                unknown
              >,
            );
            useCarrierPacketsStore.getState().setPacketCloudStatus(packet.id, 'synced');
            result.packetsSynced++;
            continue;
          }
          if (
            historicalPacketSnapshotsMatch(existing, packet) &&
            historicalItemsMatch(existingItems, membership)
          ) {
            useCarrierPacketsStore.getState().setPacketCloudStatus(packet.id, 'synced');
            result.packetsSynced++;
            continue;
          }
          result.integrityConflicts++;
          continue;
        }
        const readyProjection = { ...packet, status: 'READY' as const };
        await deps.remote.upsertPacket(
          toRemoteCarrierPacketRow(readyProjection, decision.userId) as unknown as Record<
            string,
            unknown
          >,
        );
        for (const item of membership) {
          assertRemoteEffectAuthorized(CARRIER_CLOUD_CAPABILITY, item.accountOwnerId, deps.ctx());
          await deps.remote.upsertItem(
            toRemoteCarrierPacketItemRow(item, decision.userId) as unknown as Record<string, unknown>,
          );
          result.itemsSynced++;
        }
        if (packet.status === 'SUPERSEDED') {
          await deps.remote.upsertPacket(
            toRemoteCarrierPacketRow(
              { ...packet, status: 'SHARED' },
              decision.userId,
            ) as unknown as Record<string, unknown>,
          );
        }
        await deps.remote.upsertPacket(
          toRemoteCarrierPacketRow(packet, decision.userId) as unknown as Record<string, unknown>,
        );
        useCarrierPacketsStore.getState().setPacketCloudStatus(packet.id, 'synced');
        result.packetsSynced++;
        continue;
      }

      await deps.remote.upsertPacket(
        toRemoteCarrierPacketRow(packet, decision.userId) as unknown as Record<string, unknown>,
      );
      for (const item of membership) {
        assertRemoteEffectAuthorized(CARRIER_CLOUD_CAPABILITY, item.accountOwnerId, deps.ctx());
        await deps.remote.upsertItem(
          toRemoteCarrierPacketItemRow(item, decision.userId) as unknown as Record<string, unknown>,
        );
        result.itemsSynced++;
      }
      useCarrierPacketsStore.getState().setPacketCloudStatus(packet.id, 'synced');
      result.packetsSynced++;
    } catch (err) {
      if (err instanceof CloudSyncDeniedError) {
        useCarrierPacketsStore.getState().reconcileCloudStatuses(deps.ctx());
      }
    }
  }

  return result;
}
