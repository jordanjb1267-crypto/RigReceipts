import { CloudSyncContext, newOpaqueId, PresentationSet, PresentationSetItem } from '@/domain';
import {
  normalizePresentationSetsState,
  PRESENTATION_SETS_PERSIST_VERSION,
  selectActiveVisiblePresentationSets,
  usePresentationSetsStore,
} from '@/store/presentationSets';

const id = (seed: number) =>
  newOpaqueId(() => new Uint8Array(Array.from({ length: 16 }, (_, i) => (i * 19 + seed) & 0xff)));

const SET = id(1);
const ITEM = id(2);
const DOC = id(3);

const ctx = (over: Partial<CloudSyncContext> = {}): CloudSyncContext => ({
  userId: 'user-a',
  tier: 'driver_pro',
  supabaseConfigured: true,
  ...over,
});

const set = (over: Partial<PresentationSet> = {}): PresentationSet => ({
  id: SET,
  accountOwnerId: 'user-a',
  setKind: 'CUSTOM',
  name: 'Mine',
  lifecycle: 'ACTIVE',
  cloudStatus: 'local_only',
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

const item = (over: Partial<PresentationSetItem> = {}): PresentationSetItem => ({
  id: ITEM,
  presentationSetId: SET,
  accountOwnerId: 'user-a',
  operationalDocumentId: DOC,
  position: 0,
  included: true,
  ...over,
});

beforeEach(() => {
  usePresentationSetsStore.getState().clear();
});

describe('account scope + persist', () => {
  it('selectors hide another account’s sets and persist key/version are stable', () => {
    usePresentationSetsStore.getState().addSet(set());
    usePresentationSetsStore.getState().addSet(set({ id: id(9), accountOwnerId: 'user-b', name: 'B' }));
    const s = usePresentationSetsStore.getState();
    expect(selectActiveVisiblePresentationSets(s, 'user-a').map((x) => x.id)).toEqual([SET]);
    expect(selectActiveVisiblePresentationSets(s, 'user-b')).toHaveLength(1);
    expect(PRESENTATION_SETS_PERSIST_VERSION).toBe(1);
  });

  it('normalization drops malformed rows and never keeps a synced claim without an owner', () => {
    const normalized = normalizePresentationSetsState({
      sets: [
        set(),
        { ...set({ id: id(4) }), setKind: 'SYSTEM_ROADSIDE' },
        { ...set({ id: id(5) }), cloudStatus: 'synced', accountOwnerId: null },
        { id: 'nope' },
      ],
      items: [item(), { ...item({ id: id(6) }), presentationSetId: id(99) }],
    });
    expect(normalized.sets).toHaveLength(2);
    expect(normalized.sets.find((s) => s.accountOwnerId === null)?.cloudStatus).toBe('local_only');
    expect(normalized.items).toHaveLength(1);
  });
});

describe('mutations', () => {
  it('applyPresentationSetSelection rejects duplicate document relations and marks pending when entitled', () => {
    usePresentationSetsStore.getState().addSet(set());
    usePresentationSetsStore.getState().applyPresentationSetSelection(SET, [item()], ctx());
    expect(usePresentationSetsStore.getState().sets[0]?.cloudStatus).toBe('pending_sync');
    expect(() =>
      usePresentationSetsStore
        .getState()
        .applyPresentationSetSelection(SET, [item(), item({ id: id(8) })], ctx()),
    ).toThrow(/duplicate document/);
  });

  it('H1A hydration keeps at most one membership row per set/document and drops unsafe positions', () => {
    const dupA = item({ included: true, position: 0 });
    const dupB = item({ id: id(11), included: false, position: 1 });
    const unsafe = item({ id: id(12), operationalDocumentId: id(20), position: 1.5 });
    const huge = item({
      id: id(13),
      operationalDocumentId: id(21),
      position: Number.MAX_SAFE_INTEGER + 1,
    });
    const normalized = normalizePresentationSetsState({
      sets: [set()],
      items: [dupA, dupB, unsafe, huge],
    });
    expect(normalized.items).toHaveLength(1);
    expect(normalized.items[0]?.id).toBe(dupA.id);
    expect(normalized.items[0]?.included).toBe(true);

    const twoLive = normalizePresentationSetsState({
      sets: [set()],
      items: [
        item({ included: true, position: 0 }),
        item({ id: id(14), included: true, position: 1 }),
      ],
    });
    expect(twoLive.items).toHaveLength(0);
  });

  it('recovery import requires synced and replaceSynced refuses unsynced local', () => {
    expect(() => usePresentationSetsStore.getState().importRecoveredSet(set())).toThrow(/synced/);
    usePresentationSetsStore.getState().addSet(set({ cloudStatus: 'pending_sync' }));
    expect(() =>
      usePresentationSetsStore.getState().replaceSyncedSetMetadata(set({ cloudStatus: 'synced', name: 'X' })),
    ).toThrow(/unsynced/);
  });
});
