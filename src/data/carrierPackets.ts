import {
  assertPacketDraft,
  canMutateCarrierPackets,
  canMutateCarrierTemplates,
  canTransitionPacket,
  CarrierPacket,
  CarrierPacketItem,
  CarrierPacketReview,
  CarrierPacketTemplate,
  CarrierPacketTemplateDefinition,
  carrierStatusAfterMutation,
  CloudSyncContext,
  currentVersion,
  freezePacketItem,
  isVisibleInSession,
  itemsForPacket,
  matchingDocumentsForKind,
  profileSnapshotEqualsCurrent,
  reviewCarrierPacket,
  snapshotCarrierProfile,
  STANDARD_BROKER_PACKET,
  STANDARD_BROKER_PACKET_CODE,
  validateCarrierPacketTemplate,
  validateTemplateDefinition,
} from '@/domain';
import { selectVisibleCarrierProfile, useCarrierProfileStore } from '@/store/carrierProfile';
import { useCarrierPacketsStore } from '@/store/carrierPackets';
import { useRoadWalletStore } from '@/store/roadWallet';

import { currentCarrierProfile } from './carrierProfile';
import { currentCloudSyncContext } from './cloudSyncAuth';
import { newSecureOpaqueId } from './documentFiles';
import { ShareDeniedError, shareOperationalDocumentVersion } from './roadWallet';
import { restoreDocumentVersionToDevice } from './roadWalletRecovery';

export class CarrierPacketDeniedError extends Error {
  readonly reason:
    | 'NOT_ENTITLED'
    | 'NOT_FOUND'
    | 'NOT_VISIBLE'
    | 'NOT_DRAFT'
    | 'NOT_READY'
    | 'IMMUTABLE'
    | 'BLOCKED'
    | 'STALE_VERSION'
    | 'CONFIRMATION_REQUIRED'
    | 'INVALID_TRANSITION'
    | 'TEMPLATE_ARCHIVED';
  constructor(reason: CarrierPacketDeniedError['reason'], detail?: string) {
    super(`carrier packet denied: ${reason}${detail ? ` (${detail})` : ''}`);
    this.name = 'CarrierPacketDeniedError';
    this.reason = reason;
  }
}

export interface CarrierPacketDeps {
  ctx: () => CloudSyncContext;
  now: () => number;
  newId: () => string;
}

export const defaultCarrierPacketDeps = (): CarrierPacketDeps => ({
  ctx: currentCloudSyncContext,
  now: Date.now,
  newId: newSecureOpaqueId,
});

const assertBuilder = (ctx: CloudSyncContext): void => {
  if (!canMutateCarrierPackets(ctx.tier)) throw new CarrierPacketDeniedError('NOT_ENTITLED');
};

const ownedPacket = (id: string, ctx: CloudSyncContext): CarrierPacket => {
  const packet = useCarrierPacketsStore.getState().packets.find((p) => p.id === id);
  if (!packet) throw new CarrierPacketDeniedError('NOT_FOUND');
  if (packet.accountOwnerId !== ctx.userId) throw new CarrierPacketDeniedError('NOT_VISIBLE');
  return packet;
};

const cloudAfter = (ctx: CloudSyncContext, entitled: boolean) =>
  carrierStatusAfterMutation(ctx, entitled, ctx.userId);

export function createCustomCarrierTemplate(
  input: { name: string; definition: Omit<CarrierPacketTemplateDefinition, 'name'> },
  deps: CarrierPacketDeps = defaultCarrierPacketDeps(),
): CarrierPacketTemplate {
  const ctx = deps.ctx();
  if (!canMutateCarrierTemplates(ctx.tier)) throw new CarrierPacketDeniedError('NOT_ENTITLED');
  const now = deps.now();
  const definition: CarrierPacketTemplateDefinition = {
    ...input.definition,
    schemaVersion: 1,
    name: input.name.trim(),
  };
  validateTemplateDefinition(definition);
  const template: CarrierPacketTemplate = {
    id: deps.newId(),
    accountOwnerId: ctx.userId,
    name: definition.name,
    lifecycle: 'ACTIVE',
    definition,
    cloudStatus: cloudAfter(ctx, true),
    createdAt: now,
    updatedAt: now,
  };
  validateCarrierPacketTemplate(template);
  useCarrierPacketsStore.getState().upsertTemplate(template);
  return template;
}

export function updateCustomCarrierTemplate(
  id: string,
  input: { name?: string; definition?: CarrierPacketTemplateDefinition },
  deps: CarrierPacketDeps = defaultCarrierPacketDeps(),
): CarrierPacketTemplate {
  const ctx = deps.ctx();
  if (!canMutateCarrierTemplates(ctx.tier)) throw new CarrierPacketDeniedError('NOT_ENTITLED');
  const existing = useCarrierPacketsStore.getState().templates.find((t) => t.id === id);
  if (!existing) throw new CarrierPacketDeniedError('NOT_FOUND');
  if (existing.accountOwnerId !== ctx.userId) throw new CarrierPacketDeniedError('NOT_VISIBLE');
  const next: CarrierPacketTemplate = {
    ...existing,
    name: input.name?.trim() ?? existing.name,
    definition: input.definition
      ? { ...input.definition, name: input.name?.trim() ?? input.definition.name }
      : existing.definition,
    cloudStatus: cloudAfter(ctx, true),
    updatedAt: deps.now(),
  };
  validateCarrierPacketTemplate(next);
  useCarrierPacketsStore.getState().upsertTemplate(next);
  return next;
}

export function archiveCustomCarrierTemplate(
  id: string,
  deps: CarrierPacketDeps = defaultCarrierPacketDeps(),
): CarrierPacketTemplate {
  const ctx = deps.ctx();
  if (!canMutateCarrierTemplates(ctx.tier)) throw new CarrierPacketDeniedError('NOT_ENTITLED');
  const existing = useCarrierPacketsStore.getState().templates.find((t) => t.id === id);
  if (!existing) throw new CarrierPacketDeniedError('NOT_FOUND');
  if (existing.accountOwnerId !== ctx.userId) throw new CarrierPacketDeniedError('NOT_VISIBLE');
  useCarrierPacketsStore
    .getState()
    .archiveTemplate(id, deps.now(), cloudAfter(ctx, true));
  return useCarrierPacketsStore.getState().templates.find((t) => t.id === id)!;
}

const resolveTemplate = (
  source: { kind: 'BUILTIN' } | { kind: 'CUSTOM'; id: string },
  ctx: CloudSyncContext,
): {
  snapshot: CarrierPacketTemplateDefinition;
  templateSourceKind: CarrierPacket['templateSourceKind'];
  templateSourceId: string | null;
  templateCode: string | null;
} => {
  if (source.kind === 'BUILTIN') {
    return {
      snapshot: JSON.parse(JSON.stringify(STANDARD_BROKER_PACKET)) as CarrierPacketTemplateDefinition,
      templateSourceKind: 'BUILTIN',
      templateSourceId: null,
      templateCode: STANDARD_BROKER_PACKET_CODE,
    };
  }
  const template = useCarrierPacketsStore.getState().templates.find((t) => t.id === source.id);
  if (!template) throw new CarrierPacketDeniedError('NOT_FOUND');
  if (template.accountOwnerId !== ctx.userId) throw new CarrierPacketDeniedError('NOT_VISIBLE');
  if (template.lifecycle !== 'ACTIVE') throw new CarrierPacketDeniedError('TEMPLATE_ARCHIVED');
  if (!canMutateCarrierTemplates(ctx.tier)) throw new CarrierPacketDeniedError('NOT_ENTITLED');
  return {
    snapshot: JSON.parse(JSON.stringify(template.definition)) as CarrierPacketTemplateDefinition,
    templateSourceKind: 'CUSTOM',
    templateSourceId: template.id,
    templateCode: null,
  };
};

const suggestItems = (
  packet: CarrierPacket,
  deps: CarrierPacketDeps,
): CarrierPacketItem[] => {
  const wallet = useRoadWalletStore.getState();
  const items: CarrierPacketItem[] = [];
  for (const req of packet.templateSnapshot.documentRequirements) {
    const matches = matchingDocumentsForKind(req.documentKind, wallet.documents, packet.accountOwnerId);
    if (matches.length !== 1) continue;
    const doc = matches[0]!;
    const version = currentVersion(wallet.versions, doc.id);
    if (!version) continue;
    items.push(
      freezePacketItem({
        id: deps.newId(),
        packet,
        requirement: req,
        document: doc,
        version,
        now: deps.now(),
      }),
    );
  }
  return items;
};

export function createCarrierPacketDraft(
  input: {
    name?: string;
    source: { kind: 'BUILTIN' } | { kind: 'CUSTOM'; id: string };
    supersedesPacketId?: string | null;
  },
  deps: CarrierPacketDeps = defaultCarrierPacketDeps(),
): CarrierPacket {
  const ctx = deps.ctx();
  assertBuilder(ctx);
  const resolved = resolveTemplate(input.source, ctx);
  const profile = currentCarrierProfile({ ctx: deps.ctx, now: deps.now, newId: deps.newId });
  const now = deps.now();
  const packet: CarrierPacket = {
    id: deps.newId(),
    accountOwnerId: ctx.userId,
    status: 'DRAFT',
    name: (input.name ?? resolved.snapshot.name).trim(),
    templateSourceKind: resolved.templateSourceKind,
    templateSourceId: resolved.templateSourceId,
    templateCode: resolved.templateCode,
    templateSnapshot: resolved.snapshot,
    carrierProfileId: profile?.id ?? null,
    profileSnapshot: profile ? snapshotCarrierProfile(profile, now) : null,
    recipientLabel: null,
    shareMethod: null,
    readyAt: null,
    sharedAt: null,
    supersedesPacketId: input.supersedesPacketId ?? null,
    cloudStatus: cloudAfter(ctx, true),
    createdAt: now,
    updatedAt: now,
  };
  const items = suggestItems(packet, deps);
  useCarrierPacketsStore.getState().addPacket(packet, items);
  return packet;
}

export function setCarrierPacketItemDocument(
  packetId: string,
  requirementKey: string,
  documentId: string,
  deps: CarrierPacketDeps = defaultCarrierPacketDeps(),
): CarrierPacketItem {
  const ctx = deps.ctx();
  assertBuilder(ctx);
  const packet = ownedPacket(packetId, ctx);
  assertPacketDraft(packet);
  const req = packet.templateSnapshot.documentRequirements.find((r) => r.key === requirementKey);
  if (!req) throw new CarrierPacketDeniedError('NOT_FOUND', 'requirement');
  const wallet = useRoadWalletStore.getState();
  const doc = wallet.documents.find((d) => d.id === documentId);
  if (!doc || !isVisibleInSession(doc, ctx.userId) || doc.lifecycle !== 'ACTIVE') {
    throw new CarrierPacketDeniedError('NOT_VISIBLE');
  }
  if (doc.documentKind !== req.documentKind) throw new CarrierPacketDeniedError('NOT_FOUND', 'kind');
  const version = currentVersion(wallet.versions, doc.id);
  if (!version) throw new CarrierPacketDeniedError('NOT_FOUND', 'version');
  const nextItem = freezePacketItem({
    id: deps.newId(),
    packet,
    requirement: req,
    document: doc,
    version,
    now: deps.now(),
  });
  const items = itemsForPacket(useCarrierPacketsStore.getState().items, packet.id).filter(
    (i) => i.requirementKey !== requirementKey,
  );
  items.push(nextItem);
  useCarrierPacketsStore.getState().updateDraftPacket(
    packet.id,
    { updatedAt: deps.now(), cloudStatus: cloudAfter(ctx, true) },
    items.sort((a, b) => a.position - b.position),
  );
  return nextItem;
}

export function refreshCarrierPacketItem(
  packetId: string,
  requirementKey: string,
  deps: CarrierPacketDeps = defaultCarrierPacketDeps(),
): CarrierPacketItem {
  const item = itemsForPacket(useCarrierPacketsStore.getState().items, packetId).find(
    (i) => i.requirementKey === requirementKey,
  );
  if (!item) throw new CarrierPacketDeniedError('NOT_FOUND');
  return setCarrierPacketItemDocument(packetId, requirementKey, item.operationalDocumentId, deps);
}

export function updateCarrierPacketRecipient(
  packetId: string,
  recipientLabel: string | null,
  deps: CarrierPacketDeps = defaultCarrierPacketDeps(),
): CarrierPacket {
  const ctx = deps.ctx();
  assertBuilder(ctx);
  const packet = ownedPacket(packetId, ctx);
  assertPacketDraft(packet);
  useCarrierPacketsStore.getState().updateDraftPacket(packet.id, {
    recipientLabel,
    updatedAt: deps.now(),
    cloudStatus: cloudAfter(ctx, true),
  });
  return useCarrierPacketsStore.getState().packets.find((p) => p.id === packet.id)!;
}

export function refreshCarrierPacketProfile(
  packetId: string,
  deps: CarrierPacketDeps = defaultCarrierPacketDeps(),
): CarrierPacket {
  const ctx = deps.ctx();
  assertBuilder(ctx);
  const packet = ownedPacket(packetId, ctx);
  assertPacketDraft(packet);
  const profile = currentCarrierProfile({ ctx: deps.ctx, now: deps.now, newId: deps.newId });
  useCarrierPacketsStore.getState().updateDraftPacket(packet.id, {
    carrierProfileId: profile?.id ?? null,
    profileSnapshot: profile ? snapshotCarrierProfile(profile, deps.now()) : null,
    updatedAt: deps.now(),
    cloudStatus: cloudAfter(ctx, true),
  });
  return useCarrierPacketsStore.getState().packets.find((p) => p.id === packet.id)!;
}

export function liveReviewCarrierPacket(
  packetId: string,
  deps: CarrierPacketDeps = defaultCarrierPacketDeps(),
): CarrierPacketReview {
  const ctx = deps.ctx();
  const packet = ownedPacket(packetId, ctx);
  const items = itemsForPacket(useCarrierPacketsStore.getState().items, packet.id);
  const profile = selectVisibleCarrierProfile(
    useCarrierProfileStore.getState().profiles,
    ctx.userId,
  );
  const wallet = useRoadWalletStore.getState();
  return reviewCarrierPacket({
    packet,
    items,
    profile,
    documents: wallet.documents,
    versions: wallet.versions,
    now: new Date(deps.now()),
  });
}

export function markCarrierPacketReady(
  packetId: string,
  deps: CarrierPacketDeps = defaultCarrierPacketDeps(),
): CarrierPacket {
  const ctx = deps.ctx();
  assertBuilder(ctx);
  const packet = ownedPacket(packetId, ctx);
  if (!canTransitionPacket(packet.status, 'READY')) {
    throw new CarrierPacketDeniedError('INVALID_TRANSITION');
  }
  const profile = currentCarrierProfile({ ctx: deps.ctx, now: deps.now, newId: deps.newId });
  if (packet.status === 'DRAFT') {
    useCarrierPacketsStore.getState().updateDraftPacket(packet.id, {
      carrierProfileId: profile?.id ?? packet.carrierProfileId,
      profileSnapshot: profile ? snapshotCarrierProfile(profile, deps.now()) : packet.profileSnapshot,
      updatedAt: deps.now(),
      cloudStatus: cloudAfter(ctx, true),
    });
  }
  const live = useCarrierPacketsStore.getState().packets.find((p) => p.id === packet.id)!;
  const review = liveReviewCarrierPacket(live.id, deps);
  if (!review.readyEligible) throw new CarrierPacketDeniedError('BLOCKED');
  const now = deps.now();
  useCarrierPacketsStore.getState().transitionPacket(live.id, 'READY', {
    readyAt: now,
    updatedAt: now,
    cloudStatus: cloudAfter(ctx, true),
    profileSnapshot: live.profileSnapshot,
  });
  return useCarrierPacketsStore.getState().packets.find((p) => p.id === live.id)!;
}

export function returnCarrierPacketToDraft(
  packetId: string,
  deps: CarrierPacketDeps = defaultCarrierPacketDeps(),
): CarrierPacket {
  const ctx = deps.ctx();
  assertBuilder(ctx);
  const packet = ownedPacket(packetId, ctx);
  if (!canTransitionPacket(packet.status, 'DRAFT')) {
    throw new CarrierPacketDeniedError('INVALID_TRANSITION');
  }
  useCarrierPacketsStore.getState().transitionPacket(packet.id, 'DRAFT', {
    readyAt: null,
    updatedAt: deps.now(),
    cloudStatus: cloudAfter(ctx, true),
  });
  return useCarrierPacketsStore.getState().packets.find((p) => p.id === packet.id)!;
}

export async function shareCarrierPacketItem(
  input: {
    packetId: string;
    itemId: string;
    sensitiveConfirmation: 'NONE' | 'PERSONAL_ACKNOWLEDGED' | 'FINANCIAL_ACKNOWLEDGED';
  },
  deps: CarrierPacketDeps = defaultCarrierPacketDeps(),
): Promise<{ versionId: string; mimeType: string }> {
  const ctx = deps.ctx();
  assertBuilder(ctx);
  const packet = ownedPacket(input.packetId, ctx);
  if (packet.status !== 'READY') throw new CarrierPacketDeniedError('NOT_READY');
  const item = itemsForPacket(useCarrierPacketsStore.getState().items, packet.id).find(
    (i) => i.id === input.itemId,
  );
  if (!item) throw new CarrierPacketDeniedError('NOT_FOUND');
  const review = liveReviewCarrierPacket(packet.id, deps);
  const stale = review.blockers.find(
    (f) => f.requirementKey === item.requirementKey && f.code === 'STALE_VERSION',
  );
  if (stale) throw new CarrierPacketDeniedError('STALE_VERSION');
  if (
    review.blockers.some((f) => !f.requirementKey || f.requirementKey === item.requirementKey)
  ) {
    throw new CarrierPacketDeniedError('BLOCKED');
  }
  return shareOperationalDocumentVersion({
    documentId: item.operationalDocumentId,
    versionId: item.documentVersionId,
    sensitiveConfirmation: input.sensitiveConfirmation,
  });
}

export async function restoreCarrierPacketItem(
  packetId: string,
  itemId: string,
  deps: CarrierPacketDeps = defaultCarrierPacketDeps(),
) {
  const ctx = deps.ctx();
  const packet = ownedPacket(packetId, ctx);
  const item = itemsForPacket(useCarrierPacketsStore.getState().items, packet.id).find(
    (i) => i.id === itemId,
  );
  if (!item) throw new CarrierPacketDeniedError('NOT_FOUND');
  return restoreDocumentVersionToDevice(item.operationalDocumentId, item.documentVersionId);
}

export function markCarrierPacketShared(
  input: {
    packetId: string;
    confirmed: boolean;
    recipientLabel?: string | null;
    shareMethod?: CarrierPacket['shareMethod'];
  },
  deps: CarrierPacketDeps = defaultCarrierPacketDeps(),
): CarrierPacket {
  const ctx = deps.ctx();
  assertBuilder(ctx);
  if (!input.confirmed) throw new CarrierPacketDeniedError('CONFIRMATION_REQUIRED');
  const packet = ownedPacket(input.packetId, ctx);
  if (packet.status !== 'READY') throw new CarrierPacketDeniedError('NOT_READY');
  const profile = selectVisibleCarrierProfile(
    useCarrierProfileStore.getState().profiles,
    ctx.userId,
  );
  if (packet.profileSnapshot && profile && !profileSnapshotEqualsCurrent(packet.profileSnapshot, profile)) {
    throw new CarrierPacketDeniedError('BLOCKED', 'PROFILE_CHANGED');
  }
  const review = liveReviewCarrierPacket(packet.id, deps);
  if (!review.readyEligible) throw new CarrierPacketDeniedError('BLOCKED');
  const now = deps.now();
  useCarrierPacketsStore.getState().transitionPacket(packet.id, 'SHARED', {
    sharedAt: now,
    shareMethod: input.shareMethod ?? 'OTHER',
    recipientLabel: input.recipientLabel ?? packet.recipientLabel,
    updatedAt: now,
    cloudStatus: cloudAfter(ctx, true),
  });
  const shared = useCarrierPacketsStore.getState().packets.find((p) => p.id === packet.id)!;
  if (shared.supersedesPacketId) {
    const prior = useCarrierPacketsStore
      .getState()
      .packets.find((p) => p.id === shared.supersedesPacketId);
    if (prior && prior.status === 'SHARED' && prior.accountOwnerId === ctx.userId) {
      useCarrierPacketsStore.getState().transitionPacket(prior.id, 'SUPERSEDED', {
        updatedAt: now,
        cloudStatus: cloudAfter(ctx, true),
      });
    }
  }
  return shared;
}

export function createUpdatedCarrierPacket(
  sharedPacketId: string,
  deps: CarrierPacketDeps = defaultCarrierPacketDeps(),
): CarrierPacket {
  const ctx = deps.ctx();
  assertBuilder(ctx);
  const prior = ownedPacket(sharedPacketId, ctx);
  if (prior.status !== 'SHARED' && prior.status !== 'SUPERSEDED') {
    throw new CarrierPacketDeniedError('INVALID_TRANSITION');
  }
  const liveCustom =
    prior.templateSourceKind === 'CUSTOM' && prior.templateSourceId
      ? useCarrierPacketsStore
          .getState()
          .templates.find(
            (t) =>
              t.id === prior.templateSourceId &&
              t.accountOwnerId === ctx.userId &&
              t.lifecycle === 'ACTIVE',
          )
      : null;
  const source = liveCustom
    ? ({ kind: 'CUSTOM' as const, id: liveCustom.id })
    : prior.templateSourceKind === 'BUILTIN'
      ? ({ kind: 'BUILTIN' as const })
      : null;
  if (source) {
    return createCarrierPacketDraft(
      { name: prior.name, source, supersedesPacketId: prior.id },
      deps,
    );
  }
  const profile = currentCarrierProfile({ ctx: deps.ctx, now: deps.now, newId: deps.newId });
  const now = deps.now();
  const packet: CarrierPacket = {
    id: deps.newId(),
    accountOwnerId: ctx.userId,
    status: 'DRAFT',
    name: prior.name,
    templateSourceKind: prior.templateSourceKind,
    templateSourceId: prior.templateSourceId,
    templateCode: prior.templateCode,
    templateSnapshot: JSON.parse(
      JSON.stringify(prior.templateSnapshot),
    ) as CarrierPacketTemplateDefinition,
    carrierProfileId: profile?.id ?? null,
    profileSnapshot: profile ? snapshotCarrierProfile(profile, now) : null,
    recipientLabel: null,
    shareMethod: null,
    readyAt: null,
    sharedAt: null,
    supersedesPacketId: prior.id,
    cloudStatus: cloudAfter(ctx, true),
    createdAt: now,
    updatedAt: now,
  };
  const items = suggestItems(packet, deps);
  useCarrierPacketsStore.getState().addPacket(packet, items);
  return packet;
}

export function packetItems(packetId: string): CarrierPacketItem[] {
  return itemsForPacket(useCarrierPacketsStore.getState().items, packetId);
}

export { ShareDeniedError };
