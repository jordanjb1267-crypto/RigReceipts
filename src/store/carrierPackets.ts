import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  assertPacketMutable,
  authorizeCarrierPacketCloudWrite,
  authorizeCarrierTemplateCloudWrite,
  CarrierPacket,
  CarrierPacketItem,
  CarrierPacketStatus,
  CarrierPacketTemplate,
  CloudSyncContext,
  CloudSyncStatus,
  isOpaqueId,
  itemsForPacket,
  reconcileCarrierCloudStatus,
  sanitizeReadyReturnProof,
  validateCarrierPacket,
  validateCarrierPacketItem,
  validateCarrierPacketTemplate,
  visiblePacketsForSession,
  CarrierReadyReturnProof,
} from '@/domain';

export const CARRIER_PACKETS_PERSIST_VERSION = 2;

interface CarrierPacketsState {
  templates: CarrierPacketTemplate[];
  packets: CarrierPacket[];
  items: CarrierPacketItem[];
  readyReturnProofs: CarrierReadyReturnProof[];
  hydrated: boolean;
  upsertTemplate: (template: CarrierPacketTemplate) => void;
  archiveTemplate: (id: string, now: number, cloudStatus: CloudSyncStatus) => void;
  setTemplateCloudStatus: (id: string, status: CloudSyncStatus) => void;
  importRecoveredTemplate: (template: CarrierPacketTemplate) => void;
  replaceSyncedTemplate: (template: CarrierPacketTemplate) => void;
  addPacket: (packet: CarrierPacket, items: CarrierPacketItem[]) => void;
  updateDraftPacket: (
    id: string,
    patch: Partial<
      Pick<
        CarrierPacket,
        | 'name'
        | 'profileSnapshot'
        | 'carrierProfileId'
        | 'recipientLabel'
        | 'cloudStatus'
        | 'updatedAt'
      >
    >,
    items?: CarrierPacketItem[],
  ) => void;
  transitionPacket: (
    id: string,
    status: CarrierPacketStatus,
    patch: Partial<
      Pick<
        CarrierPacket,
        | 'readyAt'
        | 'sharedAt'
        | 'shareMethod'
        | 'recipientLabel'
        | 'profileSnapshot'
        | 'cloudStatus'
        | 'updatedAt'
      >
    >,
  ) => void;
  setPacketCloudStatus: (id: string, status: CloudSyncStatus) => void;
  importRecoveredPacket: (packet: CarrierPacket, items: CarrierPacketItem[]) => void;
  replaceSyncedPacketMetadata: (packet: CarrierPacket) => void;
  replaceSyncedPacketItems: (packetId: string, items: CarrierPacketItem[]) => void;
  applySyncedPacketAndItems: (packet: CarrierPacket, items: CarrierPacketItem[]) => void;
  upsertReadyReturnProof: (proof: CarrierReadyReturnProof) => void;
  clearReadyReturnProof: (packetId: string) => void;
  readyReturnProofFor: (packetId: string, accountOwnerId: string) => CarrierReadyReturnProof | null;
  reconcileCloudStatuses: (ctx: CloudSyncContext) => number;
  clear: () => void;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function sanitizeTemplate(raw: unknown): CarrierPacketTemplate | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !isOpaqueId(raw.id)) return null;
  const accountOwnerId = typeof raw.accountOwnerId === 'string' ? raw.accountOwnerId : null;
  const template = {
    id: raw.id,
    accountOwnerId,
    name: typeof raw.name === 'string' ? raw.name : '',
    lifecycle: raw.lifecycle === 'ARCHIVED' ? ('ARCHIVED' as const) : ('ACTIVE' as const),
    definition: raw.definition,
    cloudStatus:
      raw.cloudStatus === 'synced' && accountOwnerId !== null
        ? ('synced' as const)
        : ('local_only' as const),
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
  } as CarrierPacketTemplate;
  try {
    validateCarrierPacketTemplate(template);
  } catch {
    return null;
  }
  return template;
}

function sanitizePacket(raw: unknown): CarrierPacket | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !isOpaqueId(raw.id)) return null;
  const accountOwnerId = typeof raw.accountOwnerId === 'string' ? raw.accountOwnerId : null;
  const packet = {
    ...raw,
    accountOwnerId,
    cloudStatus:
      raw.cloudStatus === 'synced' && accountOwnerId !== null ? 'synced' : 'local_only',
  } as CarrierPacket;
  try {
    validateCarrierPacket(packet);
  } catch {
    return null;
  }
  return packet;
}

function sanitizeItem(raw: unknown, parent: CarrierPacket): CarrierPacketItem | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !isOpaqueId(raw.id)) return null;
  if (raw.carrierPacketId !== parent.id) return null;
  if (typeof raw.accountOwnerId === 'string' && raw.accountOwnerId !== parent.accountOwnerId) {
    return null;
  }
  const item = { ...raw, accountOwnerId: parent.accountOwnerId } as CarrierPacketItem;
  try {
    validateCarrierPacketItem(item);
  } catch {
    return null;
  }
  return item;
}

export function normalizeCarrierPacketsState(persisted: unknown): {
  templates: CarrierPacketTemplate[];
  packets: CarrierPacket[];
  items: CarrierPacketItem[];
  readyReturnProofs: CarrierReadyReturnProof[];
} {
  const state = isRecord(persisted) ? persisted : {};
  const templates = (Array.isArray(state.templates) ? state.templates : [])
    .map(sanitizeTemplate)
    .filter((t): t is CarrierPacketTemplate => t !== null);
  const packets = (Array.isArray(state.packets) ? state.packets : [])
    .map(sanitizePacket)
    .filter((p): p is CarrierPacket => p !== null);
  const byId = new Map(packets.map((p) => [p.id, p]));
  const seenItem = new Set<string>();
  const rel = new Set<string>();
  const items: CarrierPacketItem[] = [];
  for (const raw of Array.isArray(state.items) ? state.items : []) {
    if (!isRecord(raw) || typeof raw.carrierPacketId !== 'string') continue;
    const parent = byId.get(raw.carrierPacketId);
    if (!parent) continue;
    const item = sanitizeItem(raw, parent);
    if (!item || seenItem.has(item.id)) continue;
    const key = `${item.carrierPacketId}:${item.requirementKey}:${item.operationalDocumentId}`;
    if (rel.has(key)) continue;
    seenItem.add(item.id);
    rel.add(key);
    items.push(item);
  }
  const seenProof = new Set<string>();
  const readyReturnProofs: CarrierReadyReturnProof[] = [];
  for (const raw of Array.isArray(state.readyReturnProofs) ? state.readyReturnProofs : []) {
    const proof = sanitizeReadyReturnProof(raw);
    if (!proof || seenProof.has(proof.packetId)) continue;
    const parent = byId.get(proof.packetId);
    if (!parent) continue;
    if (parent.accountOwnerId !== proof.accountOwnerId) continue;
    seenProof.add(proof.packetId);
    readyReturnProofs.push(proof);
  }
  return { templates, packets, items, readyReturnProofs };
}

export const useCarrierPacketsStore = create<CarrierPacketsState>()(
  persist(
    (set, get) => ({
      templates: [],
      packets: [],
      items: [],
      readyReturnProofs: [],
      hydrated: false,

      upsertTemplate: (next) => {
        validateCarrierPacketTemplate(next);
        set((s) => ({
          templates: s.templates.some((t) => t.id === next.id)
            ? s.templates.map((t) => (t.id === next.id ? next : t))
            : [next, ...s.templates],
        }));
      },

      archiveTemplate: (id, now, cloudStatus) =>
        set((s) => ({
          templates: s.templates.map((t) =>
            t.id === id ? { ...t, lifecycle: 'ARCHIVED', updatedAt: now, cloudStatus } : t,
          ),
        })),

      setTemplateCloudStatus: (id, status) =>
        set((s) => ({
          templates: s.templates.map((t) => (t.id === id ? { ...t, cloudStatus: status } : t)),
        })),

      importRecoveredTemplate: (next) => {
        validateCarrierPacketTemplate(next);
        if (get().templates.some((t) => t.id === next.id)) return;
        set((s) => ({ templates: [next, ...s.templates] }));
      },

      replaceSyncedTemplate: (remote) => {
        const local = get().templates.find((t) => t.id === remote.id);
        if (!local) throw new Error('template not found');
        if (local.cloudStatus !== 'synced') throw new Error('local template has unsynced changes');
        validateCarrierPacketTemplate(remote);
        set((s) => ({
          templates: s.templates.map((t) => (t.id === local.id ? { ...remote, cloudStatus: 'synced' } : t)),
        }));
      },

      addPacket: (packet, items) => {
        validateCarrierPacket(packet);
        if (get().packets.some((p) => p.id === packet.id)) throw new Error('duplicate packet id');
        for (const item of items) {
          if (item.carrierPacketId !== packet.id) throw new Error('item packet mismatch');
          if (item.accountOwnerId !== packet.accountOwnerId) throw new Error('item owner mismatch');
          validateCarrierPacketItem(item);
        }
        const reqs = new Set(items.map((i) => i.requirementKey));
        if (reqs.size !== items.length) throw new Error('duplicate requirement in packet');
        set((s) => ({ packets: [packet, ...s.packets], items: [...s.items, ...items] }));
      },

      updateDraftPacket: (id, patch, items) => {
        const existing = get().packets.find((p) => p.id === id);
        if (!existing) throw new Error('packet not found');
        assertPacketMutable(existing);
        if (existing.status !== 'DRAFT') throw new Error('only DRAFT packets may change contents');
        const next = { ...existing, ...patch, id: existing.id, status: 'DRAFT' as const };
        validateCarrierPacket(next);
        if (items) {
          for (const item of items) {
            if (item.carrierPacketId !== id) throw new Error('item packet mismatch');
            validateCarrierPacketItem(item);
          }
          const reqs = new Set(items.map((i) => i.requirementKey));
          if (reqs.size !== items.length) throw new Error('duplicate requirement in packet');
        }
        set((s) => ({
          packets: s.packets.map((p) => (p.id === id ? next : p)),
          items: items
            ? [...s.items.filter((i) => i.carrierPacketId !== id), ...items]
            : s.items,
        }));
      },

      transitionPacket: (id, status, patch) => {
        const existing = get().packets.find((p) => p.id === id);
        if (!existing) throw new Error('packet not found');
        if (existing.status === 'SUPERSEDED') throw new Error('superseded packet is terminal');
        if (existing.status === 'SHARED' && status !== 'SUPERSEDED') {
          throw new Error('shared packet may only become SUPERSEDED');
        }
        if (existing.status === 'SHARED' && status === 'SUPERSEDED') {
          const next = {
            ...existing,
            status: 'SUPERSEDED' as const,
            updatedAt: patch.updatedAt ?? existing.updatedAt,
            cloudStatus: patch.cloudStatus ?? existing.cloudStatus,
          };
          validateCarrierPacket(next);
          set((s) => ({ packets: s.packets.map((p) => (p.id === id ? next : p)) }));
          return;
        }
        assertPacketMutable(existing);
        const next = { ...existing, ...patch, status };
        validateCarrierPacket(next);
        set((s) => ({ packets: s.packets.map((p) => (p.id === id ? next : p)) }));
      },

      setPacketCloudStatus: (id, status) =>
        set((s) => ({
          packets: s.packets.map((p) => (p.id === id ? { ...p, cloudStatus: status } : p)),
        })),

      importRecoveredPacket: (packet, items) => {
        validateCarrierPacket(packet);
        if (get().packets.some((p) => p.id === packet.id)) throw new Error('duplicate packet id');
        for (const item of items) validateCarrierPacketItem(item);
        set((s) => ({ packets: [packet, ...s.packets], items: [...s.items, ...items] }));
      },

      replaceSyncedPacketMetadata: (remote) => {
        const local = get().packets.find((p) => p.id === remote.id);
        if (!local) throw new Error('packet not found');
        if (local.cloudStatus !== 'synced') throw new Error('local packet has unsynced changes');
        if (local.status !== 'DRAFT') {
          throw new Error('only DRAFT packet metadata may be replaced');
        }
        validateCarrierPacket(remote);
        set((s) => ({
          packets: s.packets.map((p) => (p.id === local.id ? { ...remote, cloudStatus: 'synced' } : p)),
        }));
      },

      replaceSyncedPacketItems: (packetId, items) => {
        const local = get().packets.find((p) => p.id === packetId);
        if (!local) throw new Error('packet not found');
        if (local.cloudStatus !== 'synced') throw new Error('local packet has unsynced changes');
        if (local.status !== 'DRAFT') {
          throw new Error('only DRAFT packet items may be replaced');
        }
        for (const item of items) {
          if (item.carrierPacketId !== packetId) throw new Error('item packet mismatch');
          validateCarrierPacketItem(item);
        }
        set((s) => ({
          items: [...s.items.filter((i) => i.carrierPacketId !== packetId), ...items],
        }));
      },

      applySyncedPacketAndItems: (remote, items) => {
        const local = get().packets.find((p) => p.id === remote.id);
        if (!local) throw new Error('packet not found');
        if (local.cloudStatus !== 'synced') throw new Error('local packet has unsynced changes');
        if (local.status === 'READY' || local.status === 'SHARED' || local.status === 'SUPERSEDED') {
          throw new Error('READY and historical packets cannot be replaced from remote membership');
        }
        validateCarrierPacket(remote);
        for (const item of items) {
          if (item.carrierPacketId !== remote.id) throw new Error('item packet mismatch');
          if (item.accountOwnerId !== remote.accountOwnerId) throw new Error('item owner mismatch');
          validateCarrierPacketItem(item);
        }
        set((s) => ({
          packets: s.packets.map((p) => (p.id === local.id ? { ...remote, cloudStatus: 'synced' } : p)),
          items: [...s.items.filter((i) => i.carrierPacketId !== remote.id), ...items],
        }));
      },

      upsertReadyReturnProof: (proof) => {
        const clean = sanitizeReadyReturnProof(proof);
        if (!clean) throw new Error('invalid return-to-draft proof');
        set((s) => ({
          readyReturnProofs: [
            clean,
            ...s.readyReturnProofs.filter((p) => p.packetId !== clean.packetId),
          ],
        }));
      },

      clearReadyReturnProof: (packetId) =>
        set((s) => ({
          readyReturnProofs: s.readyReturnProofs.filter((p) => p.packetId !== packetId),
        })),

      readyReturnProofFor: (packetId, accountOwnerId) =>
        get().readyReturnProofs.find(
          (p) => p.packetId === packetId && p.accountOwnerId === accountOwnerId,
        ) ?? null,

      reconcileCloudStatuses: (ctx) => {
        let changed = 0;
        const templates = get().templates.map((t) => {
          const next = reconcileCarrierCloudStatus(
            t.cloudStatus,
            authorizeCarrierTemplateCloudWrite(ctx, t.accountOwnerId).allowed,
          );
          if (next === t.cloudStatus) return t;
          changed++;
          return { ...t, cloudStatus: next };
        });
        const packets = get().packets.map((p) => {
          const next = reconcileCarrierCloudStatus(
            p.cloudStatus,
            authorizeCarrierPacketCloudWrite(ctx, p.accountOwnerId).allowed,
          );
          if (next === p.cloudStatus) return p;
          changed++;
          return { ...p, cloudStatus: next };
        });
        if (changed > 0) set({ templates, packets });
        return changed;
      },

      clear: () => set({ templates: [], packets: [], items: [], readyReturnProofs: [] }),
    }),
    {
      name: 'rigreceipts.carrierPackets',
      version: CARRIER_PACKETS_PERSIST_VERSION,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ hydrated: _hydrated, ...rest }) => rest,
      migrate: (persisted) => normalizeCarrierPacketsState(persisted),
      merge: (persisted, current) => ({
        ...current,
        ...normalizeCarrierPacketsState(persisted),
      }),
      onRehydrateStorage: () => () => {
        useCarrierPacketsStore.setState({ hydrated: true });
      },
    },
  ),
);

export const selectVisiblePackets = (
  packets: CarrierPacket[],
  sessionUserId: string | null,
): CarrierPacket[] => visiblePacketsForSession(packets, sessionUserId);

export const selectDraftReadyPackets = (packets: CarrierPacket[], sessionUserId: string | null) =>
  selectVisiblePackets(packets, sessionUserId).filter(
    (p) => p.status === 'DRAFT' || p.status === 'READY',
  );

export const selectHistoryPackets = (packets: CarrierPacket[], sessionUserId: string | null) =>
  selectVisiblePackets(packets, sessionUserId).filter(
    (p) => p.status === 'SHARED' || p.status === 'SUPERSEDED',
  );

export const selectItemsForPacket = (items: CarrierPacketItem[], packetId: string) =>
  itemsForPacket(items, packetId);
