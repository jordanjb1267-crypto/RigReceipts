import { CloudSyncContext, emptyRecoveryResult, newOpaqueId, sha256Hex } from '@/domain';
import * as supabaseMock from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { useRoadWalletStore } from '@/store/roadWallet';
import { useSubscriptionStore } from '@/store/subscription';

import { CloudSyncDeniedError } from '../cloudSyncAuth';
import { MemoryDocumentFileStore } from '../documentFiles';

import {
  __resetDocumentSyncForTests,
  initDocumentSync,
  runRoadWalletCloudCycle,
  syncDocumentVersion,
  syncOperationalDocument,
  syncPendingRoadWallet,
  VersionIntegrityError,
} from '../documentSync';
import {
  configureRoadWalletFileStore,
  createOperationalDocumentFromFile,
  RoadWalletDeps,
} from '../roadWallet';

// ---------------------------------------------------------------------------
// Stateful fake Supabase: real unique-id semantics for document_versions so
// idempotent retries and conflicting duplicates can be exercised.
// ---------------------------------------------------------------------------

interface RemoteState {
  configured: boolean;
  uploads: {
    bucket: string;
    path: string;
    bytes: Uint8Array;
    contentType?: string;
    upsert?: boolean;
  }[];
  upserts: { table: string; row: Record<string, unknown>; onConflict?: string }[];
  inserts: { table: string; row: Record<string, unknown> }[];
  tables: Record<string, Map<string, Record<string, unknown>>>;
  failUploadOnce: boolean;
  failInsertOnce: boolean;
  failUpsertOnce: boolean;
  onUpload: null | (() => void);
  reset(): void;
}

jest.mock('@/lib/supabase', () => {
  const state: RemoteState = {
    configured: true,
    uploads: [],
    upserts: [],
    inserts: [],
    tables: { operational_documents: new Map(), document_versions: new Map() },
    failUploadOnce: false,
    failInsertOnce: false,
    failUpsertOnce: false,
    onUpload: null,
    reset() {
      this.configured = true;
      this.uploads = [];
      this.upserts = [];
      this.inserts = [];
      this.tables = { operational_documents: new Map(), document_versions: new Map() };
      this.failUploadOnce = false;
      this.failInsertOnce = false;
      this.failUpsertOnce = false;
      this.onUpload = null;
    },
  };
  const thenable = (value: unknown) => ({
    then: (resolve: (v: unknown) => void) => resolve(value),
  });
  return {
    __state: state,
    isSupabaseConfigured: () => state.configured,
    getSupabaseClient: () => ({
      storage: {
        from: (bucket: string) => ({
          upload: async (
            path: string,
            bytes: Uint8Array,
            opts?: { contentType?: string; upsert?: boolean },
          ) => {
            state.onUpload?.();
            if (state.failUploadOnce) {
              state.failUploadOnce = false;
              return { error: new Error('upload failed') };
            }
            state.uploads.push({ bucket, path, bytes, ...opts });
            return { error: null };
          },
          download: async (path: string) => {
            const hit = state.uploads.find((u) => u.bucket === bucket && u.path === path);
            if (!hit) return { data: null, error: new Error('not found') };
            const bytes = hit.bytes;
            return {
              data: {
                arrayBuffer: async () =>
                  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
              },
              error: null,
            };
          },
        }),
      },
      from: (table: string) => ({
        upsert: (row: Record<string, unknown>, opts?: { onConflict?: string }) => {
          if (state.failUpsertOnce) {
            state.failUpsertOnce = false;
            return thenable({ error: new Error('upsert failed') });
          }
          state.upserts.push({ table, row, onConflict: opts?.onConflict });
          state.tables[table].set(row.id as string, row);
          return thenable({ error: null });
        },
        insert: (row: Record<string, unknown>) => {
          if (state.failInsertOnce) {
            state.failInsertOnce = false;
            return thenable({ error: { code: 'XX000', message: 'insert failed' } });
          }
          state.inserts.push({ table, row });
          if (state.tables[table].has(row.id as string)) {
            return thenable({ error: { code: '23505', message: 'duplicate key' } });
          }
          state.tables[table].set(row.id as string, row);
          return thenable({ error: null });
        },
        select: () => {
          const filters: [string, unknown][] = [];
          const matching = () =>
            [...state.tables[table].values()].filter((r) => filters.every(([c, v]) => r[c] === v));
          const q = {
            eq: (col: string, val: unknown) => {
              filters.push([col, val]);
              return q;
            },
            maybeSingle: async () => ({ data: matching()[0] ?? null, error: null }),
            // Awaiting the query itself (recovery reads) yields every matching row.
            then: (resolve: (v: { data: Record<string, unknown>[]; error: null }) => void) =>
              resolve({ data: matching(), error: null }),
          };
          return q;
        },
      }),
    }),
  };
});

const remote = (supabaseMock as unknown as { __state: RemoteState }).__state;

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 1, 2, 3, 4]);
const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n');

let fileStore: MemoryDocumentFileStore;
let seed = 0;
const nextId = () => {
  seed++;
  const s = seed;
  return newOpaqueId(
    () => new Uint8Array(Array.from({ length: 16 }, (_, i) => (i * 41 + s * 13) & 0xff)),
  );
};

const signIn = (userId: string | null) =>
  useAuthStore.setState({ userId, status: userId ? 'signed_in' : 'signed_out', session: null });
const setTier = (tier: 'free' | 'driver_pro' | 'owner_operator' | 'fleet_lite' | 'lifetime') =>
  useSubscriptionStore.getState().setTier(tier);

const liveDeps = (): RoadWalletDeps => ({
  fileStore,
  ctx: (): CloudSyncContext => ({
    userId: useAuthStore.getState().userId,
    tier: useSubscriptionStore.getState().tier,
    supabaseConfigured: remote.configured,
  }),
  now: () => 5_000,
  newId: nextId,
});

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

const create = (uri = 'file:///tmp/picker/cab-card.jpg', mime = 'image/jpeg') =>
  createOperationalDocumentFromFile(
    { uri, mimeType: mime, name: 'ORIGINAL-FILENAME.jpg' },
    { documentKind: 'VEHICLE_REGISTRATION', title: 'Cab card', maskedReference: '****7788' },
    liveDeps(),
  );

const doc = (id: string) => useRoadWalletStore.getState().documents.find((d) => d.id === id)!;
const ver = (id: string) => useRoadWalletStore.getState().versions.find((v) => v.id === id)!;

beforeEach(() => {
  remote.reset();
  __resetDocumentSyncForTests();
  useRoadWalletStore.getState().clear();
  fileStore = new MemoryDocumentFileStore();
  fileStore.addSource('file:///tmp/picker/cab-card.jpg', JPEG, 'image/jpeg');
  fileStore.addSource('file:///tmp/picker/coi.pdf', PDF, 'application/pdf');
  configureRoadWalletFileStore(fileStore);
  signIn(null);
  setTier('free');
  seed = 0;
});

afterAll(() => configureRoadWalletFileStore(null));

const sync = () => syncPendingRoadWallet({ fileStore });

describe('eligibility', () => {
  it('signed out -> local_only, no remote effect', async () => {
    const { document } = await create();
    expect(document.cloudStatus).toBe('local_only');
    expect(await sync()).toEqual({ documentsSynced: 0, versionsSynced: 0, integrityFailures: 0 });
    expect(remote.uploads).toHaveLength(0);
    expect(remote.upserts).toHaveLength(0);
  });

  it('signed-in Free -> local_only, no upload (cloudBackup is not substituted for cloudDocumentBackup)', async () => {
    signIn('user-a');
    const { document, version } = await create();
    expect(document.cloudStatus).toBe('local_only');
    await sync();
    expect(remote.uploads).toHaveLength(0);
    expect(remote.inserts).toHaveLength(0);
    expect(doc(document.id).cloudStatus).toBe('local_only');
    expect(ver(version.id).cloudStatus).toBe('local_only');
  });

  it('Driver Pro -> metadata upserted, bytes uploaded to documents/{uid}/road-wallet/..., version row inserted, then synced', async () => {
    signIn('user-a');
    setTier('driver_pro');
    const { document, version } = await create();
    expect(document.cloudStatus).toBe('pending_sync');

    expect(await sync()).toEqual({ documentsSynced: 1, versionsSynced: 1, integrityFailures: 0 });

    expect(remote.upserts).toEqual([
      expect.objectContaining({ table: 'operational_documents', onConflict: 'id' }),
    ]);
    const docRow = remote.upserts[0].row;
    expect(docRow).toMatchObject({
      id: document.id,
      owner_id: 'user-a',
      document_kind: 'VEHICLE_REGISTRATION',
      masked_reference: '****7788',
      lifecycle: 'ACTIVE',
    });
    expect(JSON.stringify(docRow)).not.toMatch(/road-wallet\/|file:\/\/|ORIGINAL-FILENAME/);

    expect(remote.uploads).toHaveLength(1);
    const up = remote.uploads[0];
    expect(up.bucket).toBe('documents');
    expect(up.path).toBe(`user-a/road-wallet/${document.id}/${version.id}.jpg`);
    expect(up.path.startsWith('user-a/')).toBe(true);
    expect(up.contentType).toBe('image/jpeg');
    expect(up.upsert).toBe(true);
    expect(sha256Hex(up.bytes)).toBe(version.sha256);

    expect(remote.inserts.map((i) => i.table)).toEqual(['document_versions']);
    const row = remote.inserts[0].row;
    expect(row).toMatchObject({
      id: version.id,
      owner_id: 'user-a',
      operational_document_id: document.id,
      version_number: 1,
      supersedes_version_id: null,
      storage_bucket: 'documents',
      storage_path: up.path,
      file_kind: 'IMAGE',
      mime_type: 'image/jpeg',
      extension: 'jpg',
      byte_size: JPEG.length,
      sha256: version.sha256,
    });
    expect(JSON.stringify(row)).not.toMatch(
      /ORIGINAL-FILENAME|road-wallet\/[^/]+\/[^/]+\.jpg"$|file:\/\//,
    );
    expect(Object.keys(row)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/filename|local|uri/i)]),
    );
    expect(remote.inserts.some((i) => i.table === 'expenses' || i.table === 'document_scans')).toBe(
      false,
    );

    expect(doc(document.id).cloudStatus).toBe('synced');
    expect(ver(version.id)).toMatchObject({
      cloudStatus: 'synced',
      remoteStorageBucket: 'documents',
      remoteStoragePath: up.path,
    });
    // Local durable copy is retained after upload (no auto-evict in Pass 1A).
    expect(await fileStore.exists(version.relativePath)).toBe(true);
  });

  it('upgrade Free -> Driver Pro promotes the same owner’s local_only content and syncs it', async () => {
    signIn('user-a');
    const { document, version } = await create();
    await sync();
    expect(remote.uploads).toHaveLength(0);

    setTier('driver_pro');
    expect(await sync()).toMatchObject({ documentsSynced: 1, versionsSynced: 1 });
    expect(doc(document.id).cloudStatus).toBe('synced');
    expect(ver(version.id).cloudStatus).toBe('synced');
  });

  it('downgrade / sign-out before the effect stops remote work and retains local data', async () => {
    signIn('user-a');
    setTier('driver_pro');
    const { document, version } = await create();
    setTier('free');
    await sync();
    expect(remote.uploads).toHaveLength(0);
    expect(doc(document.id).cloudStatus).toBe('local_only');
    expect(ver(version.id).cloudStatus).toBe('local_only');
    expect(useRoadWalletStore.getState().documents).toHaveLength(1);
    expect(await fileStore.exists(version.relativePath)).toBe(true);

    setTier('driver_pro');
    signIn(null);
    await sync();
    expect(remote.uploads).toHaveLength(0);
    expect(useRoadWalletStore.getState().versions).toHaveLength(1);
  });

  it("User A's content never syncs under User B; unowned content never syncs", async () => {
    signIn('user-a');
    setTier('driver_pro');
    const a = await create();
    signIn(null);
    const anon = await create();
    signIn('user-b');
    setTier('lifetime');

    await sync();
    expect(remote.uploads).toHaveLength(0);
    expect(remote.upserts).toHaveLength(0);
    expect(doc(a.document.id)).toMatchObject({
      accountOwnerId: 'user-a',
      cloudStatus: 'local_only',
    });
    expect(doc(anon.document.id)).toMatchObject({
      accountOwnerId: null,
      cloudStatus: 'local_only',
    });

    signIn('user-a');
    setTier('driver_pro');
    await sync();
    expect(remote.uploads.map((u) => u.path)).toEqual([
      `user-a/road-wallet/${a.document.id}/${a.version.id}.jpg`,
    ]);
    expect(doc(anon.document.id).cloudStatus).toBe('local_only');
  });
});

describe('per-effect authorization', () => {
  it('re-checks immediately before the version upload: a downgrade mid-flight aborts with no row and keeps local data', async () => {
    signIn('user-a');
    setTier('driver_pro');
    const { document, version } = await create();
    // Lapse the subscription right as the document metadata write completes:
    // the version's own boundary check must deny before any upload.
    let armed = true;
    const origUpsert = remote.tables.operational_documents.set.bind(
      remote.tables.operational_documents,
    );
    remote.tables.operational_documents.set = (k, v) => {
      const r = origUpsert(k, v);
      if (armed) {
        armed = false;
        setTier('free');
      }
      return r;
    };

    await sync();
    expect(remote.uploads).toHaveLength(0);
    expect(remote.inserts).toHaveLength(0);
    expect(doc(document.id).cloudStatus).toBe('synced');
    expect(ver(version.id).cloudStatus).toBe('local_only');
    expect(await fileStore.exists(version.relativePath)).toBe(true);
  });

  it('syncDocumentVersion denies directly when not authorized', async () => {
    signIn('user-a');
    setTier('driver_pro');
    const { version } = await create();
    setTier('free');
    await expect(syncDocumentVersion(version, { fileStore })).rejects.toBeInstanceOf(
      CloudSyncDeniedError,
    );
    expect(remote.uploads).toHaveLength(0);
  });

  it('syncOperationalDocument denies for another owner', async () => {
    signIn('user-a');
    setTier('driver_pro');
    const { document } = await create();
    signIn('user-b');
    await expect(syncOperationalDocument(document)).rejects.toBeInstanceOf(CloudSyncDeniedError);
    expect(remote.upserts).toHaveLength(0);
  });
});

describe('version integrity', () => {
  it('re-verifies the physical file against the immutable SHA-256/kind; a changed file is never uploaded or inserted', async () => {
    signIn('user-a');
    setTier('driver_pro');
    const { version } = await create();
    fileStore.overwrite(version.relativePath, new Uint8Array([0xff, 0xd8, 0xff, 0x00, 1]));

    const result = await sync();
    expect(result.integrityFailures).toBe(1);
    expect(result.versionsSynced).toBe(0);
    expect(remote.uploads).toHaveLength(0);
    expect(remote.inserts).toHaveLength(0);
    const v = ver(version.id);
    expect(v.cloudStatus).toBe('pending_sync');
    expect(v.fileCache.state).toBe('ERROR');
    expect(v.fileCache.error).toBe('HASH_MISMATCH');
    // Immutable evidence is preserved, not recalculated.
    expect(v.sha256).toBe(version.sha256);
    expect(v.byteSize).toBe(version.byteSize);
  });

  it('a missing local file blocks upload and records MISSING without deleting the record', async () => {
    signIn('user-a');
    setTier('driver_pro');
    const { version } = await create();
    await fileStore.remove(version.relativePath);
    await expect(syncDocumentVersion(version, { fileStore })).rejects.toBeInstanceOf(
      VersionIntegrityError,
    );
    expect(remote.uploads).toHaveLength(0);
    expect(ver(version.id).fileCache.error).toBe('MISSING');
    expect(useRoadWalletStore.getState().versions).toHaveLength(1);
  });
});

describe('partial failure and idempotency', () => {
  it('upload success + version insert failure does not mark synced; retry re-verifies and completes', async () => {
    signIn('user-a');
    setTier('driver_pro');
    const { document, version } = await create();
    remote.failInsertOnce = true;

    await sync();
    expect(remote.uploads).toHaveLength(1);
    expect(doc(document.id).cloudStatus).toBe('synced');
    expect(ver(version.id).cloudStatus).toBe('pending_sync');
    expect(ver(version.id).remoteStoragePath).toBeNull();

    // Retry: same deterministic path, same verified bytes (upsert), row inserted.
    await sync();
    expect(remote.uploads).toHaveLength(2);
    expect(remote.uploads[1].path).toBe(remote.uploads[0].path);
    expect(sha256Hex(remote.uploads[1].bytes)).toBe(version.sha256);
    expect(remote.tables.document_versions.size).toBe(1);
    expect(ver(version.id).cloudStatus).toBe('synced');
  });

  it('upload failure leaves the version pending with no row and no status change', async () => {
    signIn('user-a');
    setTier('driver_pro');
    const { version } = await create();
    remote.failUploadOnce = true;
    await sync();
    expect(remote.inserts).toHaveLength(0);
    expect(ver(version.id).cloudStatus).toBe('pending_sync');
    await sync();
    expect(ver(version.id).cloudStatus).toBe('synced');
  });

  it('metadata upsert failure skips the version (FK order) and leaves both pending', async () => {
    signIn('user-a');
    setTier('driver_pro');
    const { document, version } = await create();
    remote.failUpsertOnce = true;
    await sync();
    expect(remote.uploads).toHaveLength(0);
    expect(doc(document.id).cloudStatus).toBe('pending_sync');
    expect(ver(version.id).cloudStatus).toBe('pending_sync');
  });

  it('a crash after insert but before marking synced is an idempotent retry when the remote row matches', async () => {
    signIn('user-a');
    setTier('driver_pro');
    const { version } = await create();
    await sync();
    expect(ver(version.id).cloudStatus).toBe('synced');

    // Simulate the crash: local status lost, remote row present and identical.
    useRoadWalletStore.getState().setVersionCloudState(version.id, {
      cloudStatus: 'pending_sync',
      remoteStorageBucket: null,
      remoteStoragePath: null,
    });
    const result = await sync();
    expect(result.versionsSynced).toBe(1);
    expect(result.integrityFailures).toBe(0);
    expect(remote.inserts).toHaveLength(2); // second insert hit 23505 and was reconciled
    expect(remote.tables.document_versions.size).toBe(1);
    expect(ver(version.id).cloudStatus).toBe('synced');
  });

  it('a remote row with the same id but different immutable evidence is an integrity failure, never overwritten', async () => {
    signIn('user-a');
    setTier('driver_pro');
    const { document, version } = await create();
    remote.tables.document_versions.set(version.id, {
      id: version.id,
      owner_id: 'user-a',
      operational_document_id: document.id,
      version_number: 1,
      supersedes_version_id: null,
      storage_bucket: 'documents',
      storage_path: `user-a/road-wallet/${document.id}/${version.id}.jpg`,
      file_kind: 'IMAGE',
      mime_type: 'image/jpeg',
      extension: 'jpg',
      byte_size: 999,
      sha256: 'f'.repeat(64),
      created_at: 'x',
    });

    const result = await sync();
    expect(result.integrityFailures).toBe(1);
    expect(ver(version.id).cloudStatus).toBe('pending_sync');
    expect(remote.tables.document_versions.get(version.id)?.sha256).toBe('f'.repeat(64)); // untouched
  });
});

describe('metadata edits after sync', () => {
  it('editing a synced document makes it pending again (or local_only when not entitled) and re-syncs', async () => {
    signIn('user-a');
    setTier('driver_pro');
    const { document, version } = await create();
    await sync();
    expect(doc(document.id).cloudStatus).toBe('synced');

    useRoadWalletStore
      .getState()
      .updateDocumentMetadata(document.id, { title: 'Cab card (renewed)' }, liveDeps().ctx());
    expect(doc(document.id).cloudStatus).toBe('pending_sync');
    await sync();
    expect(remote.upserts).toHaveLength(2);
    expect(remote.upserts[1].row.title).toBe('Cab card (renewed)');
    expect(remote.uploads).toHaveLength(1); // the synced version was not re-uploaded
    expect(ver(version.id).cloudStatus).toBe('synced');

    setTier('free');
    useRoadWalletStore
      .getState()
      .updateDocumentMetadata(document.id, { issuer: 'TxDMV' }, liveDeps().ctx());
    expect(doc(document.id).cloudStatus).toBe('local_only');
  });

  it('a synced immutable version is never rewritten by auth/tier changes', async () => {
    signIn('user-a');
    setTier('driver_pro');
    const { version } = await create();
    await sync();
    const synced = ver(version.id);
    setTier('free');
    await sync();
    signIn('user-b');
    await sync();
    signIn(null);
    await sync();
    expect(ver(version.id)).toEqual(synced);
  });
});

describe('runRoadWalletCloudCycle (Pass 1B.1 R9)', () => {
  it('recovers the owner’s cloud metadata + file before any write, on a fresh device', async () => {
    // Device 1: Driver Pro creates and backs up a document.
    signIn('user-a');
    setTier('driver_pro');
    const { document, version } = await create();
    await sync();
    expect(remote.tables.document_versions.size).toBe(1);

    // Device 2: empty local store, same account, now Free after a downgrade.
    useRoadWalletStore.getState().clear();
    fileStore = new MemoryDocumentFileStore();
    configureRoadWalletFileStore(fileStore);
    setTier('free');
    await runRoadWalletCloudCycle();

    const s = useRoadWalletStore.getState();
    expect(s.documents.map((d) => d.id)).toEqual([document.id]);
    const v = s.versions.find((x) => x.id === version.id)!;
    expect(v).toMatchObject({
      cloudStatus: 'synced',
      remoteStoragePath: `user-a/road-wallet/${document.id}/${version.id}.jpg`,
    });
    expect(v.fileCache.state).toBe('READY'); // pinned current version auto-restored + verified
    expect(await fileStore.sha256(version.relativePath)).toBe(version.sha256);
    // No new writes happened for the Free tier.
    expect(remote.uploads).toHaveLength(1);
    expect(remote.upserts).toHaveLength(1);
  });

  it('a stale local synced copy never overwrites newer remote metadata (recovery precedes upload)', async () => {
    signIn('user-a');
    setTier('driver_pro');
    const { document } = await create();
    await sync();
    // Another device renamed the document later.
    const row = remote.tables.operational_documents.get(document.id)!;
    remote.tables.operational_documents.set(document.id, {
      ...row,
      title: 'Renamed elsewhere',
      updated_at: new Date(Date.now() + 60_000).toISOString(),
    });

    await runRoadWalletCloudCycle();
    expect(doc(document.id).title).toBe('Renamed elsewhere');
    expect(remote.tables.operational_documents.get(document.id)?.title).toBe('Renamed elsewhere');
  });

  it('coalesces concurrent cycles', async () => {
    signIn('user-a');
    setTier('driver_pro');
    await create();
    const [p1, p2] = [runRoadWalletCloudCycle(), runRoadWalletCloudCycle()];
    expect(p1).toBe(p2);
    await Promise.all([p1, p2]);
    await flush();
    expect(remote.uploads).toHaveLength(1);
  });
});

describe('Pass 2 H0 — writeSafe read-before-write', () => {
  const recoverOk = async () => emptyRecoveryResult('completed');
  const recoverFail = async () => emptyRecoveryResult('fetch_failed');
  const recoverCancel = async () => emptyRecoveryResult('cancelled');
  const recoverConflict = async () => ({
    ...emptyRecoveryResult('completed'),
    integrityConflicts: 1,
    writeSafe: false,
  });
  const recoverDownloads = async () => ({
    ...emptyRecoveryResult('completed'),
    downloadFailures: 2,
    writeSafe: true,
  });

  it('success → writes run', async () => {
    signIn('user-a');
    setTier('driver_pro');
    let writes = 0;
    const result = await runRoadWalletCloudCycle({
      recoverRoadWallet: recoverOk,
      syncPendingRoadWallet: async () => {
        writes++;
        return { documentsSynced: 0, versionsSynced: 0, integrityFailures: 0 };
      },
      recoverPresentationSets: async () => ({
        setsRecovered: 0,
        itemsRecovered: 0,
        integrityConflicts: 0,
        skippedLocalChanges: 0,
        outcome: 'completed',
      }),
      syncPendingPresentationSets: async () => ({ setsSynced: 0, itemsSynced: 0 }),
    });
    expect(result.writeSafe).toBe(true);
    expect(writes).toBe(1);
  });

  it('fetch_failed / cancelled / integrity conflict → no writes', async () => {
    signIn('user-a');
    setTier('driver_pro');
    let writes = 0;
    const sync = async () => {
      writes++;
      return { documentsSynced: 0, versionsSynced: 0, integrityFailures: 0 };
    };
    const sets = {
      recoverPresentationSets: async () => ({
        setsRecovered: 0,
        itemsRecovered: 0,
        integrityConflicts: 0,
        skippedLocalChanges: 0,
        outcome: 'completed' as const,
      }),
      syncPendingPresentationSets: async () => {
        writes++;
        return { setsSynced: 0, itemsSynced: 0 };
      },
    };
    expect((await runRoadWalletCloudCycle({ recoverRoadWallet: recoverFail, syncPendingRoadWallet: sync, ...sets })).writeSafe).toBe(
      false,
    );
    expect((await runRoadWalletCloudCycle({ recoverRoadWallet: recoverCancel, syncPendingRoadWallet: sync, ...sets })).writeSafe).toBe(
      false,
    );
    expect(
      (await runRoadWalletCloudCycle({ recoverRoadWallet: recoverConflict, syncPendingRoadWallet: sync, ...sets })).writeSafe,
    ).toBe(false);
    expect(writes).toBe(0);
  });

  it('downloadFailures after sound metadata recovery stay write-safe', async () => {
    signIn('user-a');
    setTier('driver_pro');
    let writes = 0;
    const result = await runRoadWalletCloudCycle({
      recoverRoadWallet: recoverDownloads,
      syncPendingRoadWallet: async () => {
        writes++;
        return { documentsSynced: 0, versionsSynced: 0, integrityFailures: 0 };
      },
      recoverPresentationSets: async () => ({
        setsRecovered: 0,
        itemsRecovered: 0,
        integrityConflicts: 0,
        skippedLocalChanges: 0,
        outcome: 'completed',
      }),
      syncPendingPresentationSets: async () => ({ setsSynced: 0, itemsSynced: 0 }),
    });
    expect(result.writeSafe).toBe(true);
    expect(writes).toBe(1);
  });

  it('later clean recovery allows writes after a failed pass', async () => {
    signIn('user-a');
    setTier('driver_pro');
    let writes = 0;
    const sync = async () => {
      writes++;
      return { documentsSynced: 0, versionsSynced: 0, integrityFailures: 0 };
    };
    const sets = {
      recoverPresentationSets: async () => ({
        setsRecovered: 0,
        itemsRecovered: 0,
        integrityConflicts: 0,
        skippedLocalChanges: 0,
        outcome: 'completed' as const,
      }),
      syncPendingPresentationSets: async () => ({ setsSynced: 0, itemsSynced: 0 }),
    };
    await runRoadWalletCloudCycle({ recoverRoadWallet: recoverFail, syncPendingRoadWallet: sync, ...sets });
    expect(writes).toBe(0);
    await runRoadWalletCloudCycle({ recoverRoadWallet: recoverOk, syncPendingRoadWallet: sync, ...sets });
    expect(writes).toBe(1);
  });

  it('Free recovery does not grant writes', async () => {
    signIn('user-a');
    setTier('free');
    const { document } = await create();
    expect(document.cloudStatus).toBe('local_only');
    const result = await runRoadWalletCloudCycle({
      recoverRoadWallet: recoverOk,
      recoverPresentationSets: async () => ({
        setsRecovered: 0,
        itemsRecovered: 0,
        integrityConflicts: 0,
        skippedLocalChanges: 0,
        outcome: 'completed',
      }),
    });
    expect(result.writeSafe).toBe(true);
    expect(remote.uploads).toHaveLength(0);
    expect(remote.upserts).toHaveLength(0);
    expect(doc(document.id).cloudStatus).toBe('local_only');
  });
});

describe('initDocumentSync', () => {
  it('reacts to tier and sign-in changes and never touches unrelated content', async () => {
    signIn('user-a');
    const { document, version } = await create();
    initDocumentSync();
    await flush();
    expect(remote.uploads).toHaveLength(0);

    setTier('driver_pro');
    await flush();
    expect(doc(document.id).cloudStatus).toBe('synced');
    expect(ver(version.id).cloudStatus).toBe('synced');
    expect(remote.uploads).toHaveLength(1);
  });
});
