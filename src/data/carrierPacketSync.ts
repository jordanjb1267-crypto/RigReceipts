import {
  authorizeCarrierPacketCloudWrite,
  authorizeCarrierProfileCloudWrite,
  authorizeCarrierTemplateCloudWrite,
  CarrierPacket,
  CarrierPacketItem,
  CarrierReadyReturnProof,
  CarrierRecoveryResult,
  carrierPacketItemsExactlyMatch,
  carrierPacketItemsMatchPersistedEvidence,
  carrierPacketPersistedEvidenceExactlyMatches,
  draftCloudProjection,
  emptyCarrierRecoveryResult,
  fromRemoteCarrierPacketItemRow,
  fromRemoteCarrierPacketRow,
  fromRemoteCarrierProfileRow,
  fromRemoteCarrierTemplateRow,
  itemsForPacket,
  mergeRecoveredCarrierRecord,
  readyCloudProjection,
  readyReturnProofMatchesRemoteReady,
  readySnapshotMatchesSharedTransition,
  remoteDraftIsProvenReadyProjection,
  sharedCloudProjection,
  sharedSnapshotMatchesSupersededTransition,
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

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

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

/**
 * IR-R1 multi-writer recovery / sync rules (explicit):
 *
 * READY local + READY remote, same id:
 *   exact persisted packet evidence AND exact item membership → keep local
 *   content / reconcile sync state only. Any mismatch is an integrity conflict.
 *   Remote READY never replaces local READY membership. updatedAt is ignored.
 *
 * Remote READY with no local packet:
 *   import only after the entire packet + item set validates.
 *
 * DRAFT local pending_sync / local_only:
 *   preserve local packet metadata AND local membership. Remote items never
 *   overwrite. Exception: local pending DRAFT + remote READY is an integrity
 *   conflict unless a valid local return-to-draft proof matches that READY.
 *
 * DRAFT local synced + DRAFT remote:
 *   if the safe mutable merge keeps local metadata, keep local membership.
 *   if remote metadata is adopted, replace membership atomically with the
 *   fully-valid remote set. Never keep local metadata + unrelated remote items.
 *
 * DRAFT local synced + newer remote READY:
 *   adopt the remote READY only when the complete remote packet+items validate
 *   and no local changes are pending.
 *
 * READY local + remote DRAFT:
 *   conflict unless the remote DRAFT is the proven READY→DRAFT projection
 *   (local return proof). Timestamp-only heuristics are forbidden.
 *
 * LOCAL DRAFT + remote SHARED / SUPERSEDED: integrity conflict.
 * REMOTE READY is never downgraded by a local DRAFT without valid proof.
 */

export type RecoveredPacketCandidate = {
  remotePacket: CarrierPacket;
  localPacket: CarrierPacket | undefined;
  rawItemCount: number;
  mappedItems: CarrierPacketItem[];
  itemMappingValid: boolean;
};

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

const mapRemoteItemSet = (
  rawRows: unknown[],
  parent: CarrierPacket,
  userId: string,
): { mappedItems: CarrierPacketItem[]; itemMappingValid: boolean } => {
  const mappedItems: CarrierPacketItem[] = [];
  for (const row of rawRows) {
    if (!isRecord(row)) return { mappedItems, itemMappingValid: false };
    const item = fromRemoteCarrierPacketItemRow(row, userId, parent);
    if (!item) return { mappedItems, itemMappingValid: false };
    if (!versionExistsForOwner(item.operationalDocumentId, item.documentVersionId, userId)) {
      return { mappedItems, itemMappingValid: false };
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
      return { mappedItems, itemMappingValid: false };
    }
    mappedItems.push(item);
  }
  return { mappedItems, itemMappingValid: true };
};

const localItemsOf = (packetId: string): CarrierPacketItem[] =>
  itemsForPacket(useCarrierPacketsStore.getState().items, packetId);

const proofFor = (packetId: string, ownerId: string): CarrierReadyReturnProof | null =>
  useCarrierPacketsStore.getState().readyReturnProofFor(packetId, ownerId);

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

  for (const row of packetRows) {
    if (!stillActive()) return { ...result, outcome: 'cancelled' };
    const remotePacket = fromRemoteCarrierPacketRow(row, userId);
    if (!remotePacket) {
      result.integrityConflicts++;
      continue;
    }
    const rawRows = itemRows.filter(
      (itemRow) => isRecord(itemRow) && itemRow.carrier_packet_id === remotePacket.id,
    );
    const { mappedItems, itemMappingValid } = mapRemoteItemSet(rawRows, remotePacket, userId);
    const candidate: RecoveredPacketCandidate = {
      remotePacket,
      localPacket: useCarrierPacketsStore.getState().packets.find((p) => p.id === remotePacket.id),
      rawItemCount: rawRows.length,
      mappedItems,
      itemMappingValid,
    };
    if (!candidate.itemMappingValid) {
      result.integrityConflicts++;
      continue;
    }

    const local = candidate.localPacket;
    const remote = candidate.remotePacket;
    const mapped = candidate.mappedItems;
    const localItems = local ? localItemsOf(local.id) : [];
    const pendingLocal =
      !!local && (local.cloudStatus === 'pending_sync' || local.cloudStatus === 'local_only');
    const proof = local ? proofFor(local.id, userId) : null;

    if (!local) {
      useCarrierPacketsStore.getState().importRecoveredPacket(
        { ...remote, cloudStatus: 'synced' },
        mapped,
      );
      result.packetsRecovered++;
      result.itemsRecovered += mapped.length;
      continue;
    }

    if (local.status === 'READY' && remote.status === 'READY') {
      if (
        carrierPacketPersistedEvidenceExactlyMatches(local, remote) &&
        carrierPacketItemsExactlyMatch(localItems, mapped)
      ) {
        useCarrierPacketsStore.getState().setPacketCloudStatus(local.id, 'synced');
        continue;
      }
      result.integrityConflicts++;
      continue;
    }

    if (local.status === 'READY' && remote.status === 'DRAFT') {
      if (proof && remoteDraftIsProvenReadyProjection(proof, remote, mapped)) {
        continue;
      }
      result.integrityConflicts++;
      continue;
    }

    if (local.status === 'DRAFT' && remote.status === 'READY') {
      if (proof && readyReturnProofMatchesRemoteReady(proof, remote, mapped)) {
        continue;
      }
      result.integrityConflicts++;
      continue;
    }

    if (
      local.status === 'DRAFT' &&
      (remote.status === 'SHARED' || remote.status === 'SUPERSEDED')
    ) {
      result.integrityConflicts++;
      continue;
    }

    if (
      (local.status === 'READY' && (remote.status === 'SHARED' || remote.status === 'SUPERSEDED')) ||
      ((local.status === 'SHARED' || local.status === 'SUPERSEDED') &&
        remote.status !== local.status)
    ) {
      result.integrityConflicts++;
      continue;
    }

    if (local.status === 'SHARED' || local.status === 'SUPERSEDED') {
      if (
        carrierPacketPersistedEvidenceExactlyMatches(local, remote) &&
        carrierPacketItemsExactlyMatch(localItems, mapped)
      ) {
        continue;
      }
      result.integrityConflicts++;
      continue;
    }

    if (local.status === 'DRAFT' && remote.status === 'DRAFT') {
      if (pendingLocal) {
        result.skippedLocalChanges++;
        continue;
      }
      const merged = mergeRecoveredCarrierRecord(
        local,
        remote,
        false,
        carrierPacketPersistedEvidenceExactlyMatches,
      );
      if (merged.action === 'keep_synced_local' || merged.action === 'keep_local') {
        continue;
      }
      if (merged.action === 'replace_metadata') {
        try {
          useCarrierPacketsStore.getState().applySyncedPacketAndItems(
            { ...merged.record, cloudStatus: 'synced' },
            mapped,
          );
          result.packetsRecovered++;
          result.itemsRecovered += mapped.length;
        } catch {
          result.integrityConflicts++;
        }
        continue;
      }
      result.integrityConflicts++;
      continue;
    }

    result.integrityConflicts++;
  }

  return result;
}


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

      const exactPersisted =
        !!existing &&
        carrierPacketPersistedEvidenceExactlyMatches(existing, packet) &&
        carrierPacketItemsExactlyMatch(existingItems, membership);

      if (packet.status === 'DRAFT') {
        if (existing?.status === 'SHARED' || existing?.status === 'SUPERSEDED') {
          result.integrityConflicts++;
          continue;
        }
        const proof = packet.accountOwnerId
          ? useCarrierPacketsStore.getState().readyReturnProofFor(packet.id, packet.accountOwnerId)
          : null;

        if (existing?.status === 'READY') {
          if (!proof || !readyReturnProofMatchesRemoteReady(proof, existing, existingItems)) {
            result.integrityConflicts++;
            continue;
          }
          await upsertPacketNow(draftCloudProjection(existing), deps);
          await upsertPacketNow(draftCloudProjection(packet), deps);
          await reconcileDraftMembership(packet, membership, remoteItemRows, result, deps);
          useCarrierPacketsStore.getState().clearReadyReturnProof(packet.id);
          useCarrierPacketsStore.getState().setPacketCloudStatus(packet.id, 'synced');
          result.packetsSynced++;
          continue;
        }

        if (existing?.status === 'DRAFT' && proof) {
          const remoteIsBase = remoteDraftIsProvenReadyProjection(proof, existing, existingItems);
          const remoteIsLocalMeta = carrierPacketPersistedEvidenceExactlyMatches(existing, packet);
          const remoteItemsAreLocal = carrierPacketItemsExactlyMatch(existingItems, membership);
          const itemsMatchProof = carrierPacketItemsMatchPersistedEvidence(
            existingItems,
            proof.readyItemsEvidence,
          );
          if (remoteIsBase) {
            await upsertPacketNow(draftCloudProjection(packet), deps);
            await reconcileDraftMembership(packet, membership, remoteItemRows, result, deps);
            useCarrierPacketsStore.getState().clearReadyReturnProof(packet.id);
            useCarrierPacketsStore.getState().setPacketCloudStatus(packet.id, 'synced');
            result.packetsSynced++;
            continue;
          }
          if (remoteIsLocalMeta && (itemsMatchProof || remoteItemsAreLocal)) {
            if (!remoteItemsAreLocal) {
              await reconcileDraftMembership(packet, membership, remoteItemRows, result, deps);
            }
            useCarrierPacketsStore.getState().clearReadyReturnProof(packet.id);
            useCarrierPacketsStore.getState().setPacketCloudStatus(packet.id, 'synced');
            result.packetsSynced++;
            continue;
          }
          result.integrityConflicts++;
          continue;
        }

        if (!existing || existing.status === 'DRAFT') {
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
        if (existing?.status === 'READY' && exactPersisted) {
          useCarrierPacketsStore.getState().setPacketCloudStatus(packet.id, 'synced');
          result.packetsSynced++;
          continue;
        }
        if (existing && existing.status !== 'DRAFT' && existing.status !== 'READY') {
          result.integrityConflicts++;
          continue;
        }
        if (existing?.status === 'READY' && !exactPersisted) {
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
        if (existing?.status === 'SHARED' && exactPersisted) {
          useCarrierPacketsStore.getState().setPacketCloudStatus(packet.id, 'synced');
          result.packetsSynced++;
          continue;
        }
        if (existing?.status === 'SHARED' && !exactPersisted) {
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
        if (existing?.status === 'SUPERSEDED' && exactPersisted) {
          useCarrierPacketsStore.getState().setPacketCloudStatus(packet.id, 'synced');
          result.packetsSynced++;
          continue;
        }
        if (existing?.status === 'SUPERSEDED' && !exactPersisted) {
          result.integrityConflicts++;
          continue;
        }
        if (
          existing?.status === 'SHARED' &&
          sharedSnapshotMatchesSupersededTransition(existing, packet) &&
          carrierPacketItemsExactlyMatch(existingItems, membership)
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
