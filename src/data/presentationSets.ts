import {
  applySelectionToMembership,
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
    | 'NO_READY_IMAGES'
    | 'PREFLIGHT_SESSION_CHANGED'
    | 'SESSION_CHANGED'
    | 'SET_ARCHIVED'
    | 'ARCHIVED'
    | 'APP_BACKGROUNDED';
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
  /** Pass 2.1 H6 — injectable AppState. Defaults to active in tests. */
  appActivity?: () => 'active' | 'inactive' | 'background' | 'unknown';
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
 * Reconciles membership for one custom set (Pass 2.1 H1). Existing
 * (set, document) rows keep their item id. Newly selected documents mint one
 * id. Removed documents stay as included=false tombstones. Re-add restores
 * the same id. Title/path/hash/bytes are never persisted.
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
  const selected: string[] = [];
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
    selected.push(doc.id);
  }
  const existing = usePresentationSetsStore
    .getState()
    .items.filter((i) => i.presentationSetId === set.id);
  const next = applySelectionToMembership(existing, selected, set, deps.newId);
  usePresentationSetsStore.getState().applyPresentationSetSelection(set.id, next, ctx, deps.now());
  return usePresentationSetsStore.getState().items.filter((i) => i.presentationSetId === set.id);
}

// ---------------------------------------------------------------------------
// Preflight + session
// ---------------------------------------------------------------------------

const sessionKey = (ctx: CloudSyncContext): string | null => ctx.userId;

export async function runPresentationPreflight(
  documentIds: string[],
  deps: PresentationSetDeps = defaultPresentationSetDeps(),
): Promise<PreflightResult> {
  const starting = sessionKey(deps.ctx());
  const assertSameSession = () => {
    if (sessionKey(deps.ctx()) !== starting) {
      throw new PresentationSetDeniedError('PREFLIGHT_SESSION_CHANGED');
    }
  };

  const evaluated: PreflightItem[] = [];
  for (const id of documentIds) {
    assertSameSession();
    const wallet = useRoadWalletStore.getState();
    const ctx = deps.ctx();
    const doc = wallet.documents.find((d) => d.id === id);
    const version = doc ? currentVersion(wallet.versions, doc.id) : null;
    if (
      doc &&
      version &&
      isVisibleInSession(doc, ctx.userId) &&
      !isFinancialBlockedFromQuickPresent(doc) &&
      doc.lifecycle === 'ACTIVE'
    ) {
      assertSameSession();
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
      assertSameSession();
      useRoadWalletStore.getState().setVersionFileCache(version.id, fresh);
    }
    assertSameSession();
    const live = useRoadWalletStore.getState();
    evaluated.push(evaluatePreflightItem(id, deps.ctx().userId, live.documents, live.versions));
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

const activityOf = (deps: PresentationSetDeps): 'active' | 'inactive' | 'background' | 'unknown' =>
  deps.appActivity?.() ?? 'active';

/**
 * Live final authorization AFTER every await and immediately before minting
 * the ephemeral session (Pass 2.1 H5). Cached preflight rows are never the
 * privacy or version decision. The current DocumentVersion is re-resolved.
 */
export async function buildQuickPresentSession(
  input: BuildSessionInput,
  deps: PresentationSetDeps = defaultPresentationSetDeps(),
): Promise<PresentationSession> {
  if (activityOf(deps) !== 'active') {
    destroyPresentationSession();
    throw new PresentationSetDeniedError('APP_BACKGROUNDED');
  }
  const startingUserId = deps.ctx().userId;
  const assertSameSession = (): CloudSyncContext => {
    const live = deps.ctx();
    if (live.userId !== startingUserId) {
      throw new PresentationSetDeniedError('SESSION_CHANGED');
    }
    return live;
  };

  const start = assertSameSession();
  if (!canUseFeature(start.tier, 'quickPresent')) {
    throw new PresentationSetDeniedError('SESSION_DENIED', 'quickPresent');
  }

  // Physical re-verification (session-safe). Results are not trusted as the
  // final privacy/version decision — that happens after this loop.
  await runPresentationPreflight(input.documentIds, deps);

  const live = assertSameSession();
  if (!canUseFeature(live.tier, 'quickPresent')) {
    throw new PresentationSetDeniedError('SESSION_DENIED', 'quickPresent');
  }
  if (input.setKind === 'CUSTOM') {
    if (!canUseFeature(live.tier, 'savedPresentationSets')) {
      throw new PresentationSetDeniedError('NOT_ENTITLED');
    }
    const set = usePresentationSetsStore.getState().sets.find((s) => s.id === input.setId);
    if (!set) throw new PresentationSetDeniedError('NOT_FOUND');
    if (set.accountOwnerId !== live.userId) throw new PresentationSetDeniedError('NOT_VISIBLE');
    if (set.lifecycle !== 'ACTIVE') throw new PresentationSetDeniedError('SET_ARCHIVED');
  }

  const items: PresentationSession['items'] = [];
  let needsPersonalAck = false;
  for (const docId of input.documentIds) {
    const ctxNow = assertSameSession();
    const wallet = useRoadWalletStore.getState();
    const doc = wallet.documents.find((d) => d.id === docId);
    if (!doc || !isVisibleInSession(doc, ctxNow.userId)) {
      throw new PresentationSetDeniedError('NOT_VISIBLE');
    }
    if (doc.lifecycle !== 'ACTIVE') throw new PresentationSetDeniedError('ARCHIVED');
    if (isFinancialBlockedFromQuickPresent(doc)) {
      throw new PresentationSetDeniedError('FINANCIAL_BLOCKED');
    }

    // Resolve the LIVE current version (never a preflight snapshot) and
    // reverify it. If a replacement lands mid-await, resolve the new current
    // and verify that — never mint stale v1.
    let version = currentVersion(wallet.versions, doc.id);
    let verified: Awaited<ReturnType<typeof reverifyDocumentFile>> | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!version) break;
      if (version.accountOwnerId !== doc.accountOwnerId) {
        throw new PresentationSetDeniedError('NOT_VISIBLE');
      }
      if (version.fileKind !== 'IMAGE') {
        version = null;
        break;
      }
      assertSameSession();
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
      assertSameSession();
      useRoadWalletStore.getState().setVersionFileCache(version.id, again);
      const liveCurrent = currentVersion(useRoadWalletStore.getState().versions, doc.id);
      if (!liveCurrent) {
        version = null;
        break;
      }
      if (liveCurrent.id !== version.id) {
        version = liveCurrent;
        continue;
      }
      verified = again;
      break;
    }
    if (!version || !verified || verified.state !== 'READY' || version.fileKind !== 'IMAGE') {
      continue;
    }
    const liveDoc = useRoadWalletStore.getState().documents.find((d) => d.id === doc.id);
    if (!liveDoc || !isVisibleInSession(liveDoc, assertSameSession().userId)) {
      throw new PresentationSetDeniedError('NOT_VISIBLE');
    }
    if (liveDoc.lifecycle !== 'ACTIVE') throw new PresentationSetDeniedError('ARCHIVED');
    if (isFinancialBlockedFromQuickPresent(liveDoc)) {
      throw new PresentationSetDeniedError('FINANCIAL_BLOCKED');
    }
    if (liveDoc.sensitivity === 'PERSONAL_SENSITIVE') needsPersonalAck = true;
    items.push(
      sessionItemFromReady(
        liveDoc,
        version,
        deps.fileStore.uriFor(version.relativePath),
        new Date(deps.now()),
      ),
    );
  }
  if (items.length === 0) throw new PresentationSetDeniedError('NO_READY_IMAGES');

  // Final authorization boundary AFTER every await, immediately before mint.
  const finalCtx = assertSameSession();
  if (!canUseFeature(finalCtx.tier, 'quickPresent')) {
    throw new PresentationSetDeniedError('SESSION_DENIED', 'quickPresent');
  }
  if (input.setKind === 'CUSTOM') {
    if (!canUseFeature(finalCtx.tier, 'savedPresentationSets')) {
      throw new PresentationSetDeniedError('NOT_ENTITLED');
    }
    const set = usePresentationSetsStore.getState().sets.find((s) => s.id === input.setId);
    if (!set) throw new PresentationSetDeniedError('NOT_FOUND');
    if (set.accountOwnerId !== finalCtx.userId) throw new PresentationSetDeniedError('NOT_VISIBLE');
    if (set.lifecycle !== 'ACTIVE') throw new PresentationSetDeniedError('SET_ARCHIVED');
  }
  needsPersonalAck = false;
  for (const item of items) {
    const liveDoc = useRoadWalletStore.getState().documents.find((d) => d.id === item.logicalDocumentId);
    if (!liveDoc || !isVisibleInSession(liveDoc, finalCtx.userId)) {
      throw new PresentationSetDeniedError('NOT_VISIBLE');
    }
    if (liveDoc.lifecycle !== 'ACTIVE') throw new PresentationSetDeniedError('ARCHIVED');
    if (isFinancialBlockedFromQuickPresent(liveDoc)) {
      throw new PresentationSetDeniedError('FINANCIAL_BLOCKED');
    }
    if (liveDoc.sensitivity === 'PERSONAL_SENSITIVE') needsPersonalAck = true;
    const liveVersion = currentVersion(useRoadWalletStore.getState().versions, liveDoc.id);
    if (
      !liveVersion ||
      liveVersion.id !== item.exactVersionId ||
      liveVersion.fileKind !== 'IMAGE' ||
      liveVersion.accountOwnerId !== liveDoc.accountOwnerId
    ) {
      throw new PresentationSetDeniedError('SESSION_DENIED', 'current_version_changed');
    }
  }
  if (needsPersonalAck && !input.personalAcknowledged) {
    throw new PresentationSetDeniedError('PERSONAL_ACK_REQUIRED');
  }
  if (activityOf(deps) !== 'active') {
    destroyPresentationSession();
    throw new PresentationSetDeniedError('APP_BACKGROUNDED');
  }

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
