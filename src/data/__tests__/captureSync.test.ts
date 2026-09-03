import { SCAN_TYPES, scanTypeToExpenseCategory } from '@/domain';
import * as supabaseMock from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { Capture, NewCapture, useCapturesStore } from '@/store/captures';
import { useSubscriptionStore } from '@/store/subscription';

import {
  __resetCaptureSyncForTests,
  contentTypeForPath,
  createCapture,
  initCaptureSync,
  normalizedExpenseDate,
  storageBucketForCapture,
  storagePathFor,
  syncCapture,
  syncPendingCaptures,
} from '../captureSync';
import { CloudSyncDeniedError } from '../cloudSyncAuth';

// ---------------------------------------------------------------------------
// Fake Supabase: records every remote effect so tests can assert "no upload".
// ---------------------------------------------------------------------------

interface UploadCall {
  bucket: string;
  path: string;
}
interface InsertCall {
  table: string;
  row: Record<string, unknown>;
}

interface RemoteState {
  configured: boolean;
  failUpload: boolean;
  uploads: UploadCall[];
  inserts: InsertCall[];
  onUpload: null | (() => void);
  onInsert: null | ((table: string) => void);
  reset(): void;
}

// The factory is hoisted above every import (the auth store reads
// `isSupabaseConfigured()` while it is being imported), so the fake's state
// lives inside the factory and is re-exported for the tests to drive.
jest.mock('@/lib/supabase', () => {
  const state: RemoteState = {
    configured: true,
    failUpload: false,
    uploads: [],
    inserts: [],
    onUpload: null,
    onInsert: null,
    reset() {
      this.configured = true;
      this.failUpload = false;
      this.uploads = [];
      this.inserts = [];
      this.onUpload = null;
      this.onInsert = null;
    },
  };
  return {
    __state: state,
    isSupabaseConfigured: () => state.configured,
    getSupabaseClient: () => ({
      storage: {
        from: (bucket: string) => ({
          upload: async (path: string) => {
            state.onUpload?.();
            if (state.failUpload) return { error: new Error('upload failed') };
            state.uploads.push({ bucket, path });
            return { error: null };
          },
        }),
      },
      from: (table: string) => ({
        insert: (row: Record<string, unknown>) => {
          state.inserts.push({ table, row });
          state.onInsert?.(table);
          const result = { data: { id: `remote_${state.inserts.length}` }, error: null };
          return {
            select: () => ({ single: async () => result }),
            then: (resolve: (v: { error: null }) => void) => resolve({ error: null }),
          };
        },
      }),
    }),
  };
});

const mockRemote = (supabaseMock as unknown as { __state: RemoteState }).__state;

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

const draft: NewCapture = {
  scanType: 'fuel',
  imageUri: 'file:///tmp/fuel.jpg',
  engine: 'stub',
  rawText: 'PILOT 120.00',
  vendor: 'Pilot',
  totalUsd: 120,
  date: '2026-09-01',
  gallons: 30,
};

const signIn = (userId: string | null) =>
  useAuthStore.setState({ userId, status: userId ? 'signed_in' : 'signed_out', session: null });

const setTier = (tier: 'free' | 'driver_pro' | 'owner_operator' | 'fleet_lite' | 'lifetime') =>
  useSubscriptionStore.getState().setTier(tier);

const seed = (over: Partial<Capture>): Capture => {
  const capture: Capture = {
    ...draft,
    id: over.id ?? `cap_${Math.random().toString(36).slice(2, 8)}`,
    status: 'local_only',
    accountOwnerId: null,
    loadId: null,
    createdAt: 1_700_000_000_000,
    ...over,
  };
  useCapturesStore.setState((s) => ({ captures: [capture, ...s.captures] }));
  return capture;
};

const find = (id: string) => useCapturesStore.getState().captures.find((c) => c.id === id);

beforeEach(() => {
  mockRemote.reset();
  __resetCaptureSyncForTests();
  useCapturesStore.getState().clear();
  signIn(null);
  setTier('free');
  (globalThis as { fetch: unknown }).fetch = jest.fn(async () => ({
    arrayBuffer: async () => new ArrayBuffer(8),
  }));
});

// ---------------------------------------------------------------------------
// Pure helpers (pre-existing behaviour)
// ---------------------------------------------------------------------------

describe('scanTypeToExpenseCategory', () => {
  it('maps expense-bearing scan types to real category slugs', () => {
    expect(scanTypeToExpenseCategory('fuel')).toBe('fuel');
    expect(scanTypeToExpenseCategory('repair_invoice')).toBe('repairs');
    expect(scanTypeToExpenseCategory('hotel')).toBe('lodging');
    expect(scanTypeToExpenseCategory('scale_ticket')).toBe('scales');
    expect(scanTypeToExpenseCategory('permit')).toBe('permits_registration');
    expect(scanTypeToExpenseCategory('receipt')).toBe('misc');
  });

  it('maps document-only scans to null (no expense created)', () => {
    expect(scanTypeToExpenseCategory('bol')).toBeNull();
    expect(scanTypeToExpenseCategory('pod')).toBeNull();
    expect(scanTypeToExpenseCategory('inspection')).toBeNull();
  });

  it('covers every canonical scan type', () => {
    for (const t of SCAN_TYPES) {
      // Either a mapped category or an explicit null — never undefined.
      expect(scanTypeToExpenseCategory(t.slug)).not.toBeUndefined();
    }
  });
});

describe('storagePathFor', () => {
  it('nests the object under the user folder and keeps the extension', () => {
    expect(storagePathFor('user-1', 'cap_9', 'file:///tmp/photo.png')).toBe('user-1/cap_9.png');
    expect(storagePathFor('user-1', 'cap_9', 'file:///tmp/IMG_0001.JPG')).toBe('user-1/cap_9.jpg');
  });

  it('handles query strings and missing extensions', () => {
    expect(storagePathFor('u', 'c', 'https://x/y.jpeg?token=abc')).toBe('u/c.jpeg');
    expect(storagePathFor('u', 'c', 'content://media/1234')).toBe('u/c.jpg');
    expect(storagePathFor('u', 'c', null)).toBe('u/c.jpg');
  });
});

describe('contentTypeForPath', () => {
  it('derives a MIME type from the extension, defaulting to JPEG', () => {
    expect(contentTypeForPath('u/c.png')).toBe('image/png');
    expect(contentTypeForPath('u/c.jpeg')).toBe('image/jpeg');
    expect(contentTypeForPath('u/c.heic')).toBe('image/heic');
    expect(contentTypeForPath('u/c.bin')).toBe('image/jpeg');
  });
});

describe('normalizedExpenseDate', () => {
  it('passes through valid ISO dates and rejects everything else', () => {
    expect(normalizedExpenseDate('2026-07-18')).toBe('2026-07-18');
    expect(normalizedExpenseDate('  2026-07-18 ')).toBe('2026-07-18');
    expect(normalizedExpenseDate('07/18/2026')).toBeUndefined();
    expect(normalizedExpenseDate('')).toBeUndefined();
    expect(normalizedExpenseDate(null)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// C2 — storage classification on the capture path
// ---------------------------------------------------------------------------

describe('C2 storage classification', () => {
  it('resolves the bucket from the explicit scan-type class', () => {
    expect(storageBucketForCapture({ scanType: 'fuel' })).toBe('receipts');
    expect(storageBucketForCapture({ scanType: 'other' })).toBe('receipts');
    expect(storageBucketForCapture({ scanType: 'bol' })).toBe('documents');
    expect(storageBucketForCapture({ scanType: 'permit' })).toBe('documents');
  });

  it('uploads a permit to documents, records that bucket, and still books the expense', async () => {
    signIn('user-a');
    setTier('driver_pro');
    const c = seed({
      id: 'permit-1',
      scanType: 'permit',
      status: 'pending_sync',
      accountOwnerId: 'user-a',
      totalUsd: 45,
    });

    const scanId = await syncCapture(c);

    expect(mockRemote.uploads).toEqual([{ bucket: 'documents', path: 'user-a/permit-1.jpg' }]);
    const scanRow = mockRemote.inserts.find((i) => i.table === 'document_scans')?.row;
    expect(scanRow).toMatchObject({
      owner_id: 'user-a',
      scan_type: 'permit',
      storage_bucket: 'documents',
      storage_path: 'user-a/permit-1.jpg',
    });
    const expenseRow = mockRemote.inserts.find((i) => i.table === 'expenses')?.row;
    expect(expenseRow).toMatchObject({
      owner_id: 'user-a',
      amount_usd: 45,
      category_slug: 'permits_registration',
      scan_id: scanId,
    });
  });

  it('uploads a BOL to documents and creates no expense row', async () => {
    signIn('user-a');
    setTier('driver_pro');
    const c = seed({
      id: 'bol-1',
      scanType: 'bol',
      status: 'pending_sync',
      accountOwnerId: 'user-a',
    });

    await syncCapture(c);

    expect(mockRemote.uploads[0].bucket).toBe('documents');
    expect(mockRemote.inserts.map((i) => i.table)).toEqual(['document_scans']);
  });

  it('uploads a fuel receipt to receipts and books the expense', async () => {
    signIn('user-a');
    setTier('driver_pro');
    const c = seed({ id: 'fuel-1', status: 'pending_sync', accountOwnerId: 'user-a' });

    await syncCapture(c);

    expect(mockRemote.uploads[0].bucket).toBe('receipts');
    expect(mockRemote.inserts.find((i) => i.table === 'document_scans')?.row.storage_bucket).toBe(
      'receipts',
    );
    expect(mockRemote.inserts.find((i) => i.table === 'expenses')?.row.category_slug).toBe('fuel');
  });
});

// ---------------------------------------------------------------------------
// C1 — authorization boundary + local-only semantics
// ---------------------------------------------------------------------------

describe('C1 createCapture (Scan save path)', () => {
  it('signed out -> local_only, unowned, no remote effect', async () => {
    const id = createCapture(draft);
    await flush();
    expect(find(id)).toMatchObject({ status: 'local_only', accountOwnerId: null });
    expect(mockRemote.uploads).toHaveLength(0);
    expect(mockRemote.inserts).toHaveLength(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('signed-in Free -> local_only, bound to the user, no upload', async () => {
    signIn('user-a');
    const id = createCapture(draft);
    await flush();
    expect(find(id)).toMatchObject({ status: 'local_only', accountOwnerId: 'user-a' });
    expect(mockRemote.uploads).toHaveLength(0);
    expect(mockRemote.inserts).toHaveLength(0);
  });

  it('signed-in Driver Pro -> pending_sync, then synced with the remote id', async () => {
    signIn('user-a');
    setTier('driver_pro');
    const id = createCapture(draft);
    expect(find(id)?.status).toBe('pending_sync');
    await flush();
    expect(find(id)).toMatchObject({
      status: 'synced',
      accountOwnerId: 'user-a',
      remoteScanId: 'remote_1',
    });
    expect(mockRemote.uploads).toEqual([{ bucket: 'receipts', path: `user-a/${id}.jpg` }]);
  });

  it('a failed upload preserves the capture as retryable pending_sync with all data intact', async () => {
    signIn('user-a');
    setTier('driver_pro');
    mockRemote.failUpload = true;
    const id = createCapture(draft);
    await flush();
    const c = find(id);
    expect(c).toMatchObject({ ...draft, status: 'pending_sync', accountOwnerId: 'user-a' });
    expect(c?.remoteScanId).toBeUndefined();
    expect(mockRemote.inserts).toHaveLength(0);
  });
});

describe('C1 syncPendingCaptures (backfill)', () => {
  it('signed out -> no remote effect, owned pending content returns to local_only', async () => {
    seed({ id: 'a1', status: 'pending_sync', accountOwnerId: 'user-a' });
    expect(await syncPendingCaptures()).toBe(0);
    expect(find('a1')?.status).toBe('local_only');
    expect(mockRemote.uploads).toHaveLength(0);
  });

  it('Free -> Driver Pro transition promotes matching local_only content and syncs it', async () => {
    signIn('user-a');
    seed({ id: 'a1', status: 'local_only', accountOwnerId: 'user-a' });

    expect(await syncPendingCaptures()).toBe(0);
    expect(find('a1')?.status).toBe('local_only');
    expect(mockRemote.uploads).toHaveLength(0);

    setTier('driver_pro');
    expect(await syncPendingCaptures()).toBe(1);
    expect(find('a1')).toMatchObject({ status: 'synced', remoteScanId: 'remote_1' });
    expect(mockRemote.uploads).toEqual([{ bucket: 'receipts', path: 'user-a/a1.jpg' }]);
  });

  it('Driver Pro -> Free before upload returns content to local_only and uploads nothing', async () => {
    signIn('user-a');
    setTier('driver_pro');
    const c = seed({ id: 'a1', status: 'pending_sync', accountOwnerId: 'user-a' });
    setTier('free');

    expect(await syncPendingCaptures()).toBe(0);
    expect(find('a1')).toMatchObject({ ...c, status: 'local_only' });
    expect(mockRemote.uploads).toHaveLength(0);
    expect(mockRemote.inserts).toHaveLength(0);
  });

  it("User A's capture never uploads under User B (and is preserved for User A)", async () => {
    signIn('user-b');
    setTier('driver_pro');
    seed({ id: 'a1', status: 'pending_sync', accountOwnerId: 'user-a' });

    expect(await syncPendingCaptures()).toBe(0);
    expect(find('a1')).toMatchObject({ status: 'local_only', accountOwnerId: 'user-a' });
    expect(mockRemote.uploads).toHaveLength(0);

    signIn('user-a');
    expect(await syncPendingCaptures()).toBe(1);
    expect(mockRemote.uploads).toEqual([{ bucket: 'receipts', path: 'user-a/a1.jpg' }]);
    expect(mockRemote.inserts.find((i) => i.table === 'document_scans')?.row.owner_id).toBe(
      'user-a',
    );
  });

  it('legacy unowned captures stay local_only for any signed-in, entitled user', async () => {
    signIn('user-a');
    setTier('lifetime');
    seed({ id: 'legacy', status: 'local_only', accountOwnerId: null });

    expect(await syncPendingCaptures()).toBe(0);
    expect(find('legacy')).toMatchObject({ status: 'local_only', accountOwnerId: null });
    expect(mockRemote.uploads).toHaveLength(0);
  });

  it('existing synced captures remain synced and are never re-uploaded', async () => {
    signIn('user-a');
    setTier('driver_pro');
    seed({ id: 'done', status: 'synced', accountOwnerId: null, remoteScanId: 'r-old' });
    seed({ id: 'done2', status: 'synced', accountOwnerId: 'user-a', remoteScanId: 'r-old2' });

    expect(await syncPendingCaptures()).toBe(0);
    expect(find('done')).toMatchObject({ status: 'synced', remoteScanId: 'r-old' });
    expect(find('done2')).toMatchObject({ status: 'synced', remoteScanId: 'r-old2' });
    expect(mockRemote.uploads).toHaveLength(0);
  });

  it('re-checks authorization per item: a downgrade between items stops later uploads', async () => {
    signIn('user-a');
    setTier('driver_pro');
    seed({ id: 'second', status: 'pending_sync', accountOwnerId: 'user-a' });
    seed({ id: 'first', status: 'pending_sync', accountOwnerId: 'user-a' });
    // The subscription lapses right as the first capture finishes (its expense row lands).
    mockRemote.onInsert = (table) => {
      if (table === 'expenses') setTier('free');
    };

    expect(await syncPendingCaptures()).toBe(1);
    expect(mockRemote.uploads.map((u) => u.path)).toEqual(['user-a/first.jpg']);
    expect(find('first')).toMatchObject({ status: 'synced', remoteScanId: 'remote_1' });
    expect(find('second')).toMatchObject({ status: 'local_only', accountOwnerId: 'user-a' });
  });

  it('re-checks authorization mid-item: a denial after upload writes no rows and keeps the capture', async () => {
    signIn('user-a');
    setTier('driver_pro');
    const c = seed({ id: 'a1', status: 'pending_sync', accountOwnerId: 'user-a' });
    // The subscription lapses while the object upload is in flight.
    mockRemote.onUpload = () => setTier('free');

    expect(await syncPendingCaptures()).toBe(0);
    expect(mockRemote.uploads).toHaveLength(1);
    expect(mockRemote.inserts).toHaveLength(0);
    expect(find('a1')).toMatchObject({ ...c, status: 'local_only' });
  });

  it('a denial raised at the effect boundary relabels instead of deleting', async () => {
    signIn('user-a');
    setTier('free');
    const c = seed({ id: 'a1', status: 'pending_sync', accountOwnerId: 'user-a' });
    await expect(syncCapture(c)).rejects.toBeInstanceOf(CloudSyncDeniedError);
    expect(find('a1')).toBeDefined();
    expect(mockRemote.uploads).toHaveLength(0);
  });

  it('never runs two backfills concurrently and never double-uploads', async () => {
    signIn('user-a');
    setTier('driver_pro');
    seed({ id: 'x1', status: 'pending_sync', accountOwnerId: 'user-a' });
    seed({ id: 'x2', status: 'pending_sync', accountOwnerId: 'user-a' });

    const [a, b] = await Promise.all([syncPendingCaptures(), syncPendingCaptures()]);
    await flush();
    expect(a + b).toBe(2);
    expect(mockRemote.uploads).toHaveLength(2);
    expect(useCapturesStore.getState().captures.every((c) => c.status === 'synced')).toBe(true);
  });

  it('device-only mode (Supabase unconfigured) makes no remote calls and keeps data', async () => {
    mockRemote.configured = false;
    signIn('user-a');
    setTier('driver_pro');
    seed({ id: 'a1', status: 'pending_sync', accountOwnerId: 'user-a' });

    expect(await syncPendingCaptures()).toBe(0);
    expect(find('a1')).toMatchObject({ status: 'local_only', accountOwnerId: 'user-a' });
    expect(mockRemote.uploads).toHaveLength(0);
  });
});

describe('C1 initCaptureSync', () => {
  it('reacts to tier changes and sign-in, syncing eligible content automatically', async () => {
    signIn('user-a');
    seed({ id: 'a1', status: 'local_only', accountOwnerId: 'user-a' });
    initCaptureSync();
    await flush();
    expect(mockRemote.uploads).toHaveLength(0);

    setTier('driver_pro');
    await flush();
    expect(find('a1')?.status).toBe('synced');
    expect(mockRemote.uploads).toEqual([{ bucket: 'receipts', path: 'user-a/a1.jpg' }]);

    // Sign-out returns any still-pending content to local_only without touching synced rows.
    seed({ id: 'a2', status: 'pending_sync', accountOwnerId: 'user-a' });
    mockRemote.failUpload = true;
    signIn(null);
    await flush();
    expect(find('a2')?.status).toBe('local_only');
    expect(find('a1')?.status).toBe('synced');
  });
});
