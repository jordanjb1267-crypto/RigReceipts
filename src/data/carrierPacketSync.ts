import {
  authorizeCarrierPacketCloudWrite,
  authorizeCarrierProfileCloudWrite,
  authorizeCarrierTemplateCloudWrite,
  CarrierPacket,
  CarrierRecoveryResult,
  carrierPacketItemsExactlyMatch,
  draftCloudProjection,
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
  readyCloudProjection,
  readySnapshotMatchesSharedTransition,
  sharedCloudProjection,
  supersededCloudProjection,
  toRemoteCarrierPacketItemRow,
  toRemoteCarrierPacketRow,
  toRemoteCarrierProfileRow,
  toRemoteCarrierTemplateRow,
  validatePacketItemAgainstTemplate,
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
  deleteItem(itemId: string): Promise<void>;
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
  async deleteItem(itemId) {
    const { error } = await table('carrier_packet_items').delete().eq('id', itemId);
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
      const wallet = useRoadWalletStore.getState();
      const document = wallet.documents.find((d) => d.id === item.operationalDocumentId);
      const version = wallet.versions.find((v) => v.id === item.documentVersionId);
      if (
        validatePacketItemAgainstTemplate(parent, item, {
          document,
          version,
        })
      ) {
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
  itemsDeleted: number;
  integrityConflicts: number;
}

const liveWriteUserId = (
  authorize:
    | typeof authorizeCarrierPacketCloudWrite
    | typeof authorizeCarrierProfileCloudWrite
    | typeof authorizeCarrierTemplateCloudWrite,
  contentOwnerId: string | null | undefined,
  deps: CarrierSyncDeps,
): string => {
  const ctx = deps.ctx();
  const decision = authorize(ctx, contentOwnerId);
  if (!decision.allowed) {
    throw new CloudSyncDeniedError(CARRIER_CLOUD_CAPABILITY, decision.reason);
  }
  return assertRemoteEffectAuthorized(CARRIER_CLOUD_CAPABILITY, contentOwnerId, ctx);
};

const upsertPacketNow = async (
  projected: CarrierPacket,
  deps: CarrierSyncDeps,
): Promise<void> => {
  const userId = liveWriteUserId(authorizeCarrierPacketCloudWrite, projected.accountOwnerId, deps);
  await deps.remote.upsertPacket(
    toRemoteCarrierPacketRow(projected, userId) as unknown as Record<string, unknown>,
  );
};

const reconcileDraftMembership = async (
  packet: CarrierPacket,
  membership: ReturnType<typeof itemsForPacket>,
  remoteItemRows: unknown[],
  result: CarrierSyncResult,
  deps: CarrierSyncDeps,
): Promise<void> => {
  const userId = liveWriteUserId(authorizeCarrierPacketCloudWrite, packet.accountOwnerId, deps);
  const remoteForPacket = remoteItemRows.filter(
    (row) => isRecord(row) && row.carrier_packet_id === packet.id && row.owner_id === userId,
  );
  const localIds = new Set(membership.map((item) => item.id));
  for (const row of remoteForPacket) {
    if (!isRecord(row) || typeof row.id !== 'string' || localIds.has(row.id)) continue;
    liveWriteUserId(authorizeCarrierPacketCloudWrite, packet.accountOwnerId, deps);
    await deps.remote.deleteItem(row.id);
    result.itemsDeleted++;
  }
  for (const item of membership) {
    const itemUser = liveWriteUserId(authorizeCarrierPacketCloudWrite, item.accountOwnerId, deps);
    await deps.remote.upsertItem(
      toRemoteCarrierPacketItemRow(item, itemUser) as unknown as Record<string, unknown>,
    );
    result.itemsSynced++;
  }
};

const remoteItemsFor = (
  rows: unknown[],
  parent: CarrierPacket,
  userId: string,
) =>
  rows
    .map((row) => fromRemoteCarrierPacketItemRow(row, userId, parent))
    .filter((i): i is NonNullable<typeof i> => !!i && i.carrierPacketId === parent.id);

export async function syncPendingCarrierPackets(
  deps: CarrierSyncDeps = defaultCarrierSyncDeps(),
): Promise<CarrierSyncResult> {
  const result: CarrierSyncResult = {
    profilesSynced: 0,
    templatesSynced: 0,
    packetsSynced: 0,
    itemsSynced: 0,
    itemsDeleted: 0,
    integrityConflicts: 0,
  };
  const ctx = deps.ctx();
  useCarrierProfileStore.getState().reconcileCloudStatuses(ctx);
  useCarrierPacketsStore.getState().reconcileCloudStatuses(ctx);

  for (const profile of useCarrierProfileStore.getState().profiles) {
    if (profile.cloudStatus !== 'pending_sync') continue;
    try {
      const userId = liveWriteUserId(
        authorizeCarrierProfileCloudWrite,
        profile.accountOwnerId,
        deps,
      );
      await deps.remote.upsertProfile(
        toRemoteCarrierProfileRow(profile, userId) as unknown as Record<string, unknown>,
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
    try {
      const userId = liveWriteUserId(
        authorizeCarrierTemplateCloudWrite,
        template.accountOwnerId,
        deps,
      );
      await deps.remote.upsertTemplate(
        toRemoteCarrierTemplateRow(template, userId) as unknown as Record<string, unknown>,
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
    const membership = itemsForPacket(useCarrierPacketsStore.getState().items, packet.id);
    try {
      liveWriteUserId(authorizeCarrierPacketCloudWrite, packet.accountOwnerId, deps);
      const remotePacketRows = await deps.remote.fetchPackets(packet.accountOwnerId ?? '');
      const remoteItemRows = await deps.remote.fetchItems(packet.accountOwnerId ?? '');
      const userId = liveWriteUserId(
        authorizeCarrierPacketCloudWrite,
        packet.accountOwnerId,
        deps,
      );
      const existing = remotePacketRows
        .map((row) => fromRemoteCarrierPacketRow(row, userId))
        .find((p) => p?.id === packet.id);
      const existingItems = existing ? remoteItemsFor(remoteItemRows, existing, userId) : [];

      const exactHistorical =
        !!existing &&
        historicalPacketSnapshotsMatch(existing, packet) &&
        historicalItemsMatch(existingItems, membership);

      if (packet.status === 'DRAFT') {
        if (!existing || existing.status === 'DRAFT' || existing.status === 'READY') {
          if (existing?.status === 'SHARED' || existing?.status === 'SUPERSEDED') {
            result.integrityConflicts++;
            continue;
          }
          await upsertPacketNow(draftCloudProjection(packet), deps);
          await reconcileDraftMembership(packet, membership, remoteItemRows, result, deps);
          useCarrierPacketsStore.getState().setPacketCloudStatus(packet.id, 'synced');
          result.packetsSynced++;
          continue;
        }
        result.integrityConflicts++;
        continue;
      }

      if (packet.status === 'READY') {
        if (existing?.status === 'READY' && exactHistorical) {
          useCarrierPacketsStore.getState().setPacketCloudStatus(packet.id, 'synced');
          result.packetsSynced++;
          continue;
        }
        if (existing && existing.status !== 'DRAFT' && existing.status !== 'READY') {
          result.integrityConflicts++;
          continue;
        }
        if (existing?.status === 'READY' && !exactHistorical) {
          result.integrityConflicts++;
          continue;
        }
        await upsertPacketNow(draftCloudProjection(packet), deps);
        await reconcileDraftMembership(packet, membership, remoteItemRows, result, deps);
        await upsertPacketNow(readyCloudProjection(packet), deps);
        useCarrierPacketsStore.getState().setPacketCloudStatus(packet.id, 'synced');
        result.packetsSynced++;
        continue;
      }

      if (packet.status === 'SHARED') {
        if (existing?.status === 'SHARED' && exactHistorical) {
          useCarrierPacketsStore.getState().setPacketCloudStatus(packet.id, 'synced');
          result.packetsSynced++;
          continue;
        }
        if (existing?.status === 'SHARED' && !exactHistorical) {
          result.integrityConflicts++;
          continue;
        }
        if (existing?.status === 'SUPERSEDED') {
          result.integrityConflicts++;
          continue;
        }
        if (existing?.status === 'READY') {
          if (
            !readySnapshotMatchesSharedTransition(existing, packet) ||
            !carrierPacketItemsExactlyMatch(existingItems, membership)
          ) {
            result.integrityConflicts++;
            continue;
          }
          await upsertPacketNow(sharedCloudProjection(packet), deps);
          useCarrierPacketsStore.getState().setPacketCloudStatus(packet.id, 'synced');
          result.packetsSynced++;
          continue;
        }
        await upsertPacketNow(draftCloudProjection(packet), deps);
        await reconcileDraftMembership(packet, membership, remoteItemRows, result, deps);
        await upsertPacketNow(readyCloudProjection(packet), deps);
        await upsertPacketNow(sharedCloudProjection(packet), deps);
        useCarrierPacketsStore.getState().setPacketCloudStatus(packet.id, 'synced');
        result.packetsSynced++;
        continue;
      }

      if (packet.status === 'SUPERSEDED') {
        if (existing?.status === 'SUPERSEDED' && exactHistorical) {
          useCarrierPacketsStore.getState().setPacketCloudStatus(packet.id, 'synced');
          result.packetsSynced++;
          continue;
        }
        if (existing?.status === 'SUPERSEDED' && !exactHistorical) {
          result.integrityConflicts++;
          continue;
        }
        if (
          existing?.status === 'SHARED' &&
          historicalEvidenceMatchesIgnoringStatus(existing, packet) &&
          historicalItemsMatch(existingItems, membership)
        ) {
          await upsertPacketNow(supersededCloudProjection(packet), deps);
          useCarrierPacketsStore.getState().setPacketCloudStatus(packet.id, 'synced');
          result.packetsSynced++;
          continue;
        }
        if (existing?.status === 'SHARED') {
          result.integrityConflicts++;
          continue;
        }
        if (existing?.status === 'READY') {
          if (
            !readySnapshotMatchesSharedTransition(existing, packet) ||
            !carrierPacketItemsExactlyMatch(existingItems, membership)
          ) {
            result.integrityConflicts++;
            continue;
          }
          await upsertPacketNow(sharedCloudProjection(packet), deps);
          await upsertPacketNow(supersededCloudProjection(packet), deps);
          useCarrierPacketsStore.getState().setPacketCloudStatus(packet.id, 'synced');
          result.packetsSynced++;
          continue;
        }
        await upsertPacketNow(draftCloudProjection(packet), deps);
        await reconcileDraftMembership(packet, membership, remoteItemRows, result, deps);
        await upsertPacketNow(readyCloudProjection(packet), deps);
        await upsertPacketNow(sharedCloudProjection(packet), deps);
        await upsertPacketNow(supersededCloudProjection(packet), deps);
        useCarrierPacketsStore.getState().setPacketCloudStatus(packet.id, 'synced');
        result.packetsSynced++;
        continue;
      }
    } catch (err) {
      if (err instanceof CloudSyncDeniedError) {
        useCarrierPacketsStore.getState().reconcileCloudStatuses(deps.ctx());
      }
    }
  }

  return result;
}
