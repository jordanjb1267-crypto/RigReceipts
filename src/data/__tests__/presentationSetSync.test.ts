import { newOpaqueId, PresentationSet, toRemotePresentationSetRow } from '@/domain';
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
});
