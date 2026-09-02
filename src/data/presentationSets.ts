import {
  canMutateCustomPresentationSets,
  canUseFeature,
  CloudSyncContext,
  currentVersion,
  evaluatePreflightItem,
  includedItemsForSet,
  isFinancialBlockedFromQuickPresent,
  isQuickPresentEligibleDocument,
  isVisibleInSession,
  PresentationSession,
  PresentationSet,
  PresentationSetItem,
  PreflightItem,
  PreflightResult,
  sessionItemFromReady,
  sessionNeedsPersonalAck,
  summarizePreflight,
  SYSTEM_PRESENTATION_SET_KIND,
  SystemPresentationSetCode,
  systemSetLabel,
  validatePresentationSetName,
} from '@/domain';
import { usePresentationSetsStore } from '@/store/presentationSets';
import { useRoadWalletStore } from '@/store/roadWallet';
import { useSubscriptionStore } from '@/store/subscription';

import { currentCloudSyncContext } from './cloudSyncAuth';
import { DocumentFileStore, newSecureOpaqueId, reverifyDocumentFile } from './documentFiles';
import { roadWalletFileStore } from './roadWallet';

/**
 * Quick Present orchestration (Pass 2). UI never writes the store directly
 * for custom-set mutations: every create/update/archive/item change re-checks
 * `savedPresentationSets` at the effect boundary. Free cannot mutate. A
 * downgrade does not delete recovered or local sets.
 */

export class PresentationSetDeniedError extends Error {
  readonly reason:
    | 'NOT_ENTITLED'
    | 'NOT_FOUND'
    | 'NOT_VISIBLE'
    | 'NOT_CUSTOM'
    | 'FINANCIAL_BLOCKED'
    | 'SESSION_DENIED'
    | 'PERSONAL_ACK_REQUIRED'
    | 'NO_READY_IMAGES';
  constructor(
    reason: PresentationSetDeniedError['reason'],
    detail?: string,
  ) {
    super(`presentation set denied: ${reason}${detail ? ` (${detail})` : ''}`);
    this.name = 'PresentationSetDeniedError';
    this.reason = reason;
  }
}

export interface PresentationSetDeps {
  fileStore: DocumentFileStore;
  ctx: () => CloudSyncContext;
  now: () => number;
  newId: () => string;
}

export const defaultPresentationSetDeps = (): PresentationSetDeps => ({
  fileStore: roadWalletFileStore(),
  ctx: currentCloudSyncContext,
  now: Date.now,
  newId: newSecureOpaqueId,
});

const assertCanMutate = (ctx: CloudSyncContext): void => {
  if (!canMutateCustomPresentationSets(ctx.tier)) {
    throw new PresentationSetDeniedError('NOT_ENTITLED');
  }
};

const assertCustomOwned = (
  set: PresentationSet | undefined,
  ctx: CloudSyncContext,
): PresentationSet => {
  if (!set) throw new PresentationSetDeniedError('NOT_FOUND');
  if (set.setKind !== 'CUSTOM') throw new PresentationSetDeniedError('NOT_CUSTOM');
  if (set.accountOwnerId !== ctx.userId) throw new PresentationSetDeniedError('NOT_VISIBLE');
  return set;
};

export function createCustomPresentationSet(
  input: { name: string; documentIds?: string[] },
  deps: PresentationSetDeps = defaultPresentationSetDeps(),
): PresentationSet {
  const ctx = deps.ctx();
  assertCanMutate(ctx);
  const name = validatePresentationSetName(input.name);
  const now = deps.now();
  const set: PresentationSet = {
    id: deps.newId(),
    accountOwnerId: ctx.userId,
    setKind: 'CUSTOM',
    name,
    lifecycle: 'ACTIVE',
    cloudStatus: canMutateCustomPresentationSets(ctx.tier)
      ? ctx.userId && ctx.supabaseConfigured && canUseFeature(ctx.tier, 'cloudDocumentBackup')
        ? 'pending_sync'
        : 'local_only'
      : 'local_only',
    createdAt: now,
    updatedAt: now,
  };
  usePresentationSetsStore.getState().addSet(set);
  if (input.documentIds && input.documentIds.length > 0) {
    setPresentationSetItems(set.id, input.documentIds, deps);
  }
  return usePresentationSetsStore.getState().sets.find((s) => s.id === set.id) ?? set;
}

export function updateCustomPresentationSet(
  id: string,
  patch: { name?: string },
  deps: PresentationSetDeps = defaultPresentationSetDeps(),
): PresentationSet {
  const ctx = deps.ctx();
  assertCanMutate(ctx);
  const existing = assertCustomOwned(
    usePresentationSetsStore.getState().sets.find((s) => s.id === id),
    ctx,
  );
  const name = patch.name !== undefined ? validatePresentationSetName(patch.name) : existing.name;
  usePresentationSetsStore.getState().updateSet(id, { name }, ctx, deps.now());
  return usePresentationSetsStore.getState().sets.find((s) => s.id === id)!;
}

export function archiveCustomPresentationSet(
  id: string,
  deps: PresentationSetDeps = defaultPresentationSetDeps(),
): PresentationSet {
  const ctx = deps.ctx();
  assertCanMutate(ctx);
  assertCustomOwned(
    usePresentationSetsStore.getState().sets.find((s) => s.id === id),
    ctx,
  );
  usePresentationSetsStore.getState().archiveSet(id, ctx, deps.now());
  return usePresentationSetsStore.getState().sets.find((s) => s.id === id)!;
}

/**
 * Replaces the item list. Only ACTIVE, session-visible, non-FINANCIAL logical
 * ids are stored. Title/path/hash/bytes are never persisted on the set.
 * Documents that later become archived, financial or missing stay on the set
 * and are reported at preflight — this function does not rewrite them later.
 */
export function setPresentationSetItems(
  setId: string,
  documentIds: string[],
  deps: PresentationSetDeps = defaultPresentationSetDeps(),
): PresentationSetItem[] {
  const ctx = deps.ctx();
  assertCanMutate(ctx);
  const set = assertCustomOwned(
    usePresentationSetsStore.getState().sets.find((s) => s.id === setId),
    ctx,
  );
  const wallet = useRoadWalletStore.getState();
  const next: PresentationSetItem[] = [];
  const seen = new Set<string>();
  for (const docId of documentIds) {
    if (seen.has(docId)) continue;
    const doc = wallet.documents.find((d) => d.id === docId);
    if (!doc || !isQuickPresentEligibleDocument(doc, ctx.userId)) {
      if (doc && isFinancialBlockedFromQuickPresent(doc)) {
        throw new PresentationSetDeniedError('FINANCIAL_BLOCKED');
      }
      continue;
    }
    seen.add(docId);
    next.push({
      id: deps.newId(),
      presentationSetId: set.id,
      accountOwnerId: set.accountOwnerId,
      operationalDocumentId: doc.id,
      position: next.length,
      included: true,
    });
  }
  usePresentationSetsStore.getState().replaceItems(set.id, next, ctx, deps.now());
  return usePresentationSetsStore.getState().items.filter((i) => i.presentationSetId === set.id);
}

// ---------------------------------------------------------------------------
// Preflight + session
// ---------------------------------------------------------------------------

export async function runPresentationPreflight(
  documentIds: string[],
  deps: PresentationSetDeps = defaultPresentationSetDeps(),
): Promise<PreflightResult> {
  const ctx = deps.ctx();
  const wallet = useRoadWalletStore.getState();
  const evaluated: PreflightItem[] = [];
  for (const id of documentIds) {
    const doc = wallet.documents.find((d) => d.id === id);
    const version = doc ? currentVersion(wallet.versions, doc.id) : null;
    if (
      doc &&
      version &&
      isVisibleInSession(doc, ctx.userId) &&
      !isFinancialBlockedFromQuickPresent(doc) &&
      doc.lifecycle === 'ACTIVE'
    ) {
      const fresh = await reverifyDocumentFile(
        deps.fileStore,
        {
          ...version.fileCache,
          relativePath: version.relativePath,
          sha256: version.sha256,
        },
        version.fileKind,
        deps.now,
      );
      useRoadWalletStore.getState().setVersionFileCache(version.id, fresh);
    }
    const live = useRoadWalletStore.getState();
    evaluated.push(evaluatePreflightItem(id, ctx.userId, live.documents, live.versions));
  }
  return summarizePreflight(evaluated);
}

export interface BuildSessionInput {
  setId: string;
  setKind: PresentationSet['setKind'];
  setName: string;
  documentIds: string[];
  personalAcknowledged: boolean;
}

/**
 * Live re-check immediately before a swipe session. Cached READY is never
 * trusted: every selected IMAGE is re-verified again here. FINANCIAL is
 * refused. PERSONAL_SENSITIVE requires `personalAcknowledged`.
 */
export async function buildQuickPresentSession(
  input: BuildSessionInput,
  deps: PresentationSetDeps = defaultPresentationSetDeps(),
): Promise<PresentationSession> {
  const ctx = deps.ctx();
  if (!canUseFeature(ctx.tier, 'quickPresent')) {
    throw new PresentationSetDeniedError('SESSION_DENIED', 'quickPresent');
  }
  if (input.setKind === 'CUSTOM') {
    if (!canUseFeature(ctx.tier, 'savedPresentationSets')) {
      throw new PresentationSetDeniedError('NOT_ENTITLED');
    }
    const set = usePresentationSetsStore.getState().sets.find((s) => s.id === input.setId);
    if (!set || set.accountOwnerId !== ctx.userId) {
      throw new PresentationSetDeniedError('NOT_VISIBLE');
    }
  }

  const preflight = await runPresentationPreflight(input.documentIds, deps);
  const ready = preflight.items.filter((i) => i.state === 'READY');
  if (ready.length === 0) throw new PresentationSetDeniedError('NO_READY_IMAGES');
  if (sessionNeedsPersonalAck(ready) && !input.personalAcknowledged) {
    throw new PresentationSetDeniedError('PERSONAL_ACK_REQUIRED');
  }

  const wallet = useRoadWalletStore.getState();
  const items = [];
  for (const row of ready) {
    const doc = wallet.documents.find((d) => d.id === row.logicalDocumentId);
    const version = row.exactVersionId
      ? wallet.versions.find((v) => v.id === row.exactVersionId)
      : null;
    if (!doc || !version) continue;
    if (!isVisibleInSession(doc, ctx.userId) || doc.lifecycle !== 'ACTIVE') continue;
    if (isFinancialBlockedFromQuickPresent(doc)) continue;
    if (version.fileKind !== 'IMAGE' || version.fileCache.state !== 'READY') continue;
    if (version.accountOwnerId !== doc.accountOwnerId) continue;
    // Live re-verify once more immediately before minting the session URI.
    const again = await reverifyDocumentFile(
      deps.fileStore,
      {
        ...version.fileCache,
        relativePath: version.relativePath,
        sha256: version.sha256,
      },
      version.fileKind,
      deps.now,
    );
    useRoadWalletStore.getState().setVersionFileCache(version.id, again);
    if (again.state !== 'READY') continue;
    items.push(
      sessionItemFromReady(
        doc,
        version,
        deps.fileStore.uriFor(version.relativePath),
        new Date(deps.now()),
      ),
    );
  }
  if (items.length === 0) throw new PresentationSetDeniedError('NO_READY_IMAGES');

  const session: PresentationSession = {
    id: deps.newId(),
    setId: input.setId,
    setKind: input.setKind,
    setName: input.setName,
    items,
    personalAcknowledged: input.personalAcknowledged,
    builtAt: deps.now(),
  };
  holdPresentationSession(session);
  return session;
}

/** System-set identity used only in memory / routes — never persisted. */
export function systemSetIdentity(code: SystemPresentationSetCode): {
  id: string;
  setKind: PresentationSet['setKind'];
  name: string;
} {
  return {
    id: `system:${code.toLowerCase()}`,
    setKind: SYSTEM_PRESENTATION_SET_KIND[code],
    name: systemSetLabel(code),
  };
}

export function selectedIdsForCustomSet(setId: string): string[] {
  const items = includedItemsForSet(usePresentationSetsStore.getState().items, setId);
  return items.map((i) => i.operationalDocumentId);
}

// ---------------------------------------------------------------------------
// Ephemeral session (never persisted)
// ---------------------------------------------------------------------------

let heldSession: PresentationSession | null = null;

export function holdPresentationSession(session: PresentationSession | null): void {
  heldSession = session;
}

export function activePresentationSession(): PresentationSession | null {
  return heldSession;
}

export function destroyPresentationSession(): void {
  heldSession = null;
}

export function __resetPresentationSessionForTests(): void {
  heldSession = null;
}

export function currentTierHasSavedSets(): boolean {
  return canUseFeature(useSubscriptionStore.getState().tier, 'savedPresentationSets');
}
