import {
  Capture,
  CAPTURES_PERSIST_VERSION,
  migrateCapturesState,
  NewCapture,
  normalizeLegacyCapture,
  selectLocalOnlyCount,
  selectPendingSyncCount,
  useCapturesStore,
} from '@/store/captures';

const draft: NewCapture = {
  scanType: 'fuel',
  imageUri: 'file:///tmp/a.jpg',
  engine: 'stub',
  rawText: 'PILOT 120.00',
  vendor: 'Pilot',
  totalUsd: 120,
  date: '2026-09-01',
  gallons: 30,
};

beforeEach(() => {
  useCapturesStore.getState().clear();
});

describe('legacy normalization (persisted v0 -> v1)', () => {
  const legacyBase = {
    id: 'cap_legacy',
    scanType: 'fuel' as const,
    imageUri: 'file:///legacy.jpg',
    engine: 'mlkit' as const,
    rawText: 'text',
    vendor: 'Loves',
    totalUsd: 80,
    date: '2026-01-02',
    gallons: 20,
    createdAt: 1,
  };

  it('keeps synced legacy captures synced with their remoteScanId (never re-uploaded)', () => {
    const c = normalizeLegacyCapture({ ...legacyBase, status: 'synced', remoteScanId: 'r-1' });
    expect(c.status).toBe('synced');
    expect(c.remoteScanId).toBe('r-1');
    expect(c.accountOwnerId).toBeNull();
  });

  it('turns unowned pending legacy captures into local_only and preserves every field', () => {
    const c = normalizeLegacyCapture({ ...legacyBase, status: 'pending_sync' });
    expect(c.status).toBe('local_only');
    expect(c.accountOwnerId).toBeNull();
    expect(c).toMatchObject(legacyBase);
    expect(c.loadId).toBeNull();
  });

  it('treats unknown/missing status conservatively as local_only', () => {
    expect(normalizeLegacyCapture({ ...legacyBase }).status).toBe('local_only');
    expect(normalizeLegacyCapture({ ...legacyBase, status: 'weird' }).status).toBe('local_only');
  });

  it('preserves an existing owner binding when present', () => {
    const c = normalizeLegacyCapture({
      ...legacyBase,
      status: 'pending_sync',
      accountOwnerId: 'user-a',
    });
    expect(c.accountOwnerId).toBe('user-a');
    // Still local_only until the next reconcile proves this session may upload it.
    expect(c.status).toBe('local_only');
  });

  it('migrateCapturesState normalizes every row and drops nothing', () => {
    const persisted = {
      captures: [
        { ...legacyBase, id: 'a', status: 'pending_sync' },
        { ...legacyBase, id: 'b', status: 'synced', remoteScanId: 'r-b' },
      ],
    };
    const out = migrateCapturesState(persisted, 0);
    expect(out.captures.map((c) => c.id)).toEqual(['a', 'b']);
    expect(out.captures[0].status).toBe('local_only');
    expect(out.captures[1].status).toBe('synced');
    expect(out.captures[1].remoteScanId).toBe('r-b');
    expect(CAPTURES_PERSIST_VERSION).toBe(1);
  });

  it('migrateCapturesState tolerates empty or malformed persisted state', () => {
    expect(migrateCapturesState(undefined, 0)).toEqual({ captures: [] });
    expect(migrateCapturesState({ captures: 'nope' }, 0)).toEqual({ captures: [] });
  });
});

describe('addCapture with an explicit binding', () => {
  it('stores the owner binding and initial state it is given', () => {
    const id = useCapturesStore
      .getState()
      .addCapture(draft, { accountOwnerId: 'user-a', status: 'pending_sync' });
    const c = useCapturesStore.getState().captures.find((x) => x.id === id) as Capture;
    expect(c.accountOwnerId).toBe('user-a');
    expect(c.status).toBe('pending_sync');
    expect(c.loadId).toBeNull();
  });

  it('records local_only content without an owner when created signed out', () => {
    useCapturesStore.getState().addCapture(draft, { accountOwnerId: null, status: 'local_only' });
    const s = useCapturesStore.getState();
    expect(selectLocalOnlyCount(s)).toBe(1);
    expect(selectPendingSyncCount(s)).toBe(0);
  });
});

describe('reconcileSyncStates', () => {
  it('moves owned content between local_only and pending_sync without deleting anything', () => {
    const store = useCapturesStore.getState();
    store.addCapture(draft, { accountOwnerId: 'user-a', status: 'local_only' });
    store.addCapture(draft, { accountOwnerId: null, status: 'local_only' });
    const syncedId = store.addCapture(draft, { accountOwnerId: 'user-a', status: 'pending_sync' });
    store.markSynced(syncedId, 'remote-1');

    const entitled = { userId: 'user-a', tier: 'driver_pro' as const, supabaseConfigured: true };
    expect(useCapturesStore.getState().reconcileSyncStates(entitled)).toBe(1);
    let s = useCapturesStore.getState();
    expect(s.captures).toHaveLength(3);
    expect(selectPendingSyncCount(s)).toBe(1);
    expect(selectLocalOnlyCount(s)).toBe(1);
    expect(s.captures.find((c) => c.id === syncedId)?.status).toBe('synced');

    const downgraded = { ...entitled, tier: 'free' as const };
    expect(useCapturesStore.getState().reconcileSyncStates(downgraded)).toBe(1);
    s = useCapturesStore.getState();
    expect(s.captures).toHaveLength(3);
    expect(selectPendingSyncCount(s)).toBe(0);
    expect(selectLocalOnlyCount(s)).toBe(2);
    expect(s.captures.find((c) => c.id === syncedId)?.remoteScanId).toBe('remote-1');
  });

  it('is a no-op (returns 0) when nothing changes', () => {
    useCapturesStore.getState().addCapture(draft, { accountOwnerId: null, status: 'local_only' });
    expect(
      useCapturesStore
        .getState()
        .reconcileSyncStates({ userId: 'user-a', tier: 'lifetime', supabaseConfigured: true }),
    ).toBe(0);
  });
});
