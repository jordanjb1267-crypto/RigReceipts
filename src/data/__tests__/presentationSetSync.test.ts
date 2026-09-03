import {
  newOpaqueId,
  PresentationSet,
  PresentationSetItem,
  toRemotePresentationSetItemRow,
  toRemotePresentationSetRow,
} from '@/domain';
import { useAuthStore } from '@/store/auth';
import { usePresentationSetsStore } from '@/store/presentationSets';
import { useSubscriptionStore } from '@/store/subscription';

import {
  PresentationSetRemote,
  recoverPresentationSetsFromCloud,
  syncPendingPresentationSets,
} from '../presentationSetSync';

class FakeSetRemote implements PresentationSetRemote {
  sets: Record<string, unknown>[] = [];
  items: Record<string, unknown>[] = [];
  upserts: { table: string; row: Record<string, unknown> }[] = [];
  failFetch = false;
  failIncludedFalseOnce = false;

  async fetchSets(userId: string) {
    if (this.failFetch) throw new Error('network');
    return this.sets.filter((s) => s.owner_id === userId);
  }
  async fetchItems(userId: string) {
    if (this.failFetch) throw new Error('network');
    return this.items.filter((s) => s.owner_id === userId);
  }
  async upsertSet(row: Record<string, unknown>) {
    this.upserts.push({ table: 'presentation_sets', row });
    this.sets = this.sets.filter((s) => s.id !== row.id);
    this.sets.push(row);
  }
  async upsertItem(row: Record<string, unknown>) {
    const clash = this.items.find(
      (i) =>
        i.presentation_set_id === row.presentation_set_id &&
        i.operational_document_id === row.operational_document_id &&
        i.id !== row.id,
    );
    if (clash) throw new Error('unique(set,document) violated');
    if (this.failIncludedFalseOnce && row.included === false) {
      this.failIncludedFalseOnce = false;
      throw new Error('tombstone upsert failed');
    }
    this.upserts.push({ table: 'presentation_set_items', row });
    this.items = this.items.filter((s) => s.id !== row.id);
    this.items.push(row);
  }
}

const id = (seed: number) =>
  newOpaqueId(() => new Uint8Array(Array.from({ length: 16 }, (_, i) => (i * 31 + seed) & 0xff)));

let remote: FakeSetRemote;
const session = { userId: 'user-a' as string | null, tier: 'driver_pro' as const };

const deps = () => ({
  remote,
  ctx: () => ({
    userId: session.userId,
    tier: useSubscriptionStore.getState().tier,
    supabaseConfigured: true,
  }),
});

beforeEach(() => {
  usePresentationSetsStore.getState().clear();
  remote = new FakeSetRemote();
  session.userId = 'user-a';
  useAuthStore.setState({ userId: 'user-a', status: 'signed_in', session: null });
  useSubscriptionStore.getState().setTier('driver_pro');
});

describe('presentation set recovery (tier-independent)', () => {
  it('Free recovers already-backed-up sets but cannot write new ones', async () => {
    const set: PresentationSet = {
      id: id(1),
      accountOwnerId: 'user-a',
      setKind: 'CUSTOM',
      name: 'Recovered',
      lifecycle: 'ACTIVE',
      cloudStatus: 'synced',
      createdAt: 1,
      updatedAt: 1,
    };
    remote.sets.push(toRemotePresentationSetRow(set, 'user-a') as unknown as Record<string, unknown>);
    useSubscriptionStore.getState().setTier('free');
    const result = await recoverPresentationSetsFromCloud(deps());
    expect(result.outcome).toBe('completed');
    expect(result.setsRecovered).toBe(1);
    expect(usePresentationSetsStore.getState().sets[0]?.name).toBe('Recovered');

    const writes = await syncPendingPresentationSets(deps());
    expect(writes.setsSynced).toBe(0);
    expect(remote.upserts).toHaveLength(0);
  });

  it('fetch failure does not overwrite local sets', async () => {
    usePresentationSetsStore.getState().addSet({
      id: id(2),
      accountOwnerId: 'user-a',
      setKind: 'CUSTOM',
      name: 'Local',
      lifecycle: 'ACTIVE',
      cloudStatus: 'pending_sync',
      createdAt: 1,
      updatedAt: 1,
    });
    remote.failFetch = true;
    const result = await recoverPresentationSetsFromCloud(deps());
    expect(result.outcome).toBe('fetch_failed');
    expect(usePresentationSetsStore.getState().sets[0]?.name).toBe('Local');
  });

  it('keeps local pending edits instead of replacing with remote', async () => {
    const setId = id(3);
    usePresentationSetsStore.getState().addSet({
      id: setId,
      accountOwnerId: 'user-a',
      setKind: 'CUSTOM',
      name: 'Local edit',
      lifecycle: 'ACTIVE',
      cloudStatus: 'pending_sync',
      createdAt: 1,
      updatedAt: 1,
    });
    remote.sets.push(
      toRemotePresentationSetRow(
        {
          id: setId,
          accountOwnerId: 'user-a',
          setKind: 'CUSTOM',
          name: 'Remote',
          lifecycle: 'ACTIVE',
          cloudStatus: 'synced',
          createdAt: 1,
          updatedAt: 99,
        },
        'user-a',
      ) as unknown as Record<string, unknown>,
    );
    const result = await recoverPresentationSetsFromCloud(deps());
    expect(result.skippedLocalChanges).toBe(1);
    expect(usePresentationSetsStore.getState().sets[0]?.name).toBe('Local edit');
  });
});

describe('presentation set writes', () => {
  it('Driver Pro upserts set metadata + items when authorized', async () => {
    const created: PresentationSet = {
      id: id(4),
      accountOwnerId: 'user-a',
      setKind: 'CUSTOM',
      name: 'Pack',
      lifecycle: 'ACTIVE',
      cloudStatus: 'pending_sync',
      createdAt: 1,
      updatedAt: 1,
    };
    usePresentationSetsStore.getState().addSet(created);
    const writes = await syncPendingPresentationSets(deps());
    expect(writes.setsSynced).toBe(1);
    expect(remote.upserts.some((u) => u.table === 'presentation_sets')).toBe(true);
    expect(usePresentationSetsStore.getState().sets.find((s) => s.id === created.id)?.cloudStatus).toBe(
      'synced',
    );
  });

  it('H1B writes included=false tombstones, retries after a crash, and never violates unique(set,document)', async () => {
    const setId = id(4);
    const docA = id(40);
    const docB = id(41);
    const itemA: PresentationSetItem = {
      id: id(42),
      presentationSetId: setId,
      accountOwnerId: 'user-a',
      operationalDocumentId: docA,
      position: 0,
      included: true,
    };
    const itemB: PresentationSetItem = {
      id: id(43),
      presentationSetId: setId,
      accountOwnerId: 'user-a',
      operationalDocumentId: docB,
      position: 1,
      included: true,
    };
    const created: PresentationSet = {
      id: setId,
      accountOwnerId: 'user-a',
      setKind: 'CUSTOM',
      name: 'Pack',
      lifecycle: 'ACTIVE',
      cloudStatus: 'pending_sync',
      createdAt: 1,
      updatedAt: 1,
    };
    usePresentationSetsStore.getState().addSet(created);
    usePresentationSetsStore.getState().applyPresentationSetSelection(
      setId,
      [itemA, itemB],
      {
        userId: 'user-a',
        tier: 'driver_pro',
        supabaseConfigured: true,
      },
    );
    await syncPendingPresentationSets(deps());
    expect(remote.items).toHaveLength(2);
    expect(remote.items.every((i) => i.included === true)).toBe(true);

    usePresentationSetsStore.getState().applyPresentationSetSelection(
      setId,
      [itemA, { ...itemB, included: false }],
      {
        userId: 'user-a',
        tier: 'driver_pro',
        supabaseConfigured: true,
      },
    );
    remote.failIncludedFalseOnce = true;
    const crashed = await syncPendingPresentationSets(deps());
    expect(crashed.setsSynced).toBe(0);
    expect(usePresentationSetsStore.getState().sets.find((s) => s.id === setId)?.cloudStatus).toBe(
      'pending_sync',
    );
    expect(remote.items.find((i) => i.id === itemB.id)?.included).not.toBe(false);

    const retried = await syncPendingPresentationSets(deps());
    expect(retried.setsSynced).toBe(1);
    expect(remote.items.find((i) => i.id === itemB.id)).toMatchObject({
      id: itemB.id,
      included: false,
      operational_document_id: docB,
    });
    expect(usePresentationSetsStore.getState().sets.find((s) => s.id === setId)?.cloudStatus).toBe(
      'synced',
    );

    usePresentationSetsStore.getState().clear();
    const recovered = await recoverPresentationSetsFromCloud(deps());
    expect(recovered.outcome).toBe('completed');
    const localB = usePresentationSetsStore
      .getState()
      .items.find((i) => i.operationalDocumentId === docB);
    expect(localB).toMatchObject({ id: itemB.id, included: false });
  });

  it('recovery of duplicate set/document rows is an integrity conflict, not a write', async () => {
    const setId = id(50);
    const docId = id(51);
    const parent: PresentationSet = {
      id: setId,
      accountOwnerId: 'user-a',
      setKind: 'CUSTOM',
      name: 'Dupes',
      lifecycle: 'ACTIVE',
      cloudStatus: 'synced',
      createdAt: 1,
      updatedAt: 1,
    };
    remote.sets.push(toRemotePresentationSetRow(parent, 'user-a') as unknown as Record<string, unknown>);
    const item = (seed: number): PresentationSetItem => ({
      id: id(seed),
      presentationSetId: setId,
      accountOwnerId: 'user-a',
      operationalDocumentId: docId,
      position: 0,
      included: true,
    });
    remote.items.push(
      toRemotePresentationSetItemRow(item(52), 'user-a') as unknown as Record<string, unknown>,
      toRemotePresentationSetItemRow(item(53), 'user-a') as unknown as Record<string, unknown>,
    );
    const result = await recoverPresentationSetsFromCloud(deps());
    expect(result.integrityConflicts).toBeGreaterThan(0);
    expect(usePresentationSetsStore.getState().items).toHaveLength(0);
  });
});
