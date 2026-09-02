import {
  CloudSyncContext,
  currentVersion,
  fromRemoteDocumentRow,
  fromRemoteVersionRow,
  mergeRecoveredDocument,
  mergeRecoveredVersion,
  newOpaqueId,
  OperationalDocument,
  sha256Hex,
  toRemoteDocumentRow,
  toRemoteVersionRow,
} from '@/domain';
import { selectVisibleDocuments, useRoadWalletStore } from '@/store/roadWallet';

import { MemoryDocumentFileStore } from '../documentFiles';
import { configureRoadWalletFileStore, createOperationalDocumentFromFile } from '../roadWallet';
import {
  recoverRoadWalletFromCloud,
  RecoveryDeps,
  restoreDocumentVersionToDevice,
  RestoreError,
  RoadWalletRemote,
} from '../roadWalletRecovery';

// ---------------------------------------------------------------------------
// Fake private cloud: rows keyed by owner, objects keyed by bucket/path.
// ---------------------------------------------------------------------------

class FakeRemote implements RoadWalletRemote {
  documents: Record<string, unknown>[] = [];
  versions: Record<string, unknown>[] = [];
  objects = new Map<string, Uint8Array>();
  onFetch: (() => void) | null = null;
  onDownload: (() => void) | null = null;
  failDownload = false;
  downloads: string[] = [];

  async fetchDocuments(userId: string) {
    this.onFetch?.();
    return this.documents.filter((d) => d.owner_id === userId);
  }
  async fetchVersions(userId: string) {
    return this.versions.filter((v) => v.owner_id === userId);
  }
  async downloadBytes(bucket: 'documents', path: string) {
    this.onDownload?.();
    this.downloads.push(`${bucket}/${path}`);
    if (this.failDownload) throw new Error('network');
    const bytes = this.objects.get(`${bucket}/${path}`);
    if (!bytes) throw new Error('not found');
    return new Uint8Array(bytes);
  }
}

type Tier = CloudSyncContext['tier'];

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 1, 2, 3, 4]);
const JPEG2 = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 0x10, 0x45, 0x78, 0x69, 0x66, 9, 9, 9]);
const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n');

let seed = 0;
const nextId = () => {
  seed++;
  const s = seed;
  return newOpaqueId(
    () => new Uint8Array(Array.from({ length: 16 }, (_, i) => (i * 43 + s * 17) & 0xff)),
  );
};

let fileStore: MemoryDocumentFileStore;
let remote: FakeRemote;
const session = { userId: 'user-a' as string | null, tier: 'driver_pro' as Tier, configured: true };

const deps = (): RecoveryDeps => ({
  fileStore,
  remote,
  ctx: () => ({
    userId: session.userId,
    tier: session.tier,
    supabaseConfigured: session.configured,
  }),
  now: () => 7_000,
});

/** Seeds the fake cloud with a fully backed-up document + version 1 for `owner`. */
const seedCloud = (
  owner: string,
  opts: {
    kind?: OperationalDocument['documentKind'];
    pinned?: boolean;
    bytes?: Uint8Array;
    lifecycle?: 'ACTIVE' | 'ARCHIVED';
    updatedAt?: number;
  } = {},
) => {
  const bytes = opts.bytes ?? JPEG;
  const docId = nextId();
  const verId = nextId();
  const kind = opts.kind ?? 'VEHICLE_REGISTRATION';
  const sensitivity =
    kind === 'W9' ? 'FINANCIAL_SENSITIVE' : kind === 'CDL' ? 'PERSONAL_SENSITIVE' : 'STANDARD';
  const doc: OperationalDocument = {
    id: docId,
    accountOwnerId: owner,
    documentKind: kind,
    subjectKind: kind === 'W9' ? 'CARRIER' : kind === 'CDL' ? 'DRIVER' : 'TRUCK',
    truckId: null,
    trailerNumber: null,
    title: `Doc ${docId.slice(0, 4)}`,
    issuer: null,
    jurisdiction: null,
    issuedAt: null,
    effectiveAt: null,
    expiresAt: '2027-06-30',
    maskedReference: '****1234',
    sensitivity,
    lifecycle: opts.lifecycle ?? 'ACTIVE',
    offlinePinned: opts.pinned ?? sensitivity !== 'FINANCIAL_SENSITIVE',
    cloudStatus: 'synced',
    createdAt: 1_000,
    updatedAt: opts.updatedAt ?? 1_000,
  };
  const ext = bytes === PDF ? 'pdf' : 'jpg';
  const version = {
    id: verId,
    operationalDocumentId: docId,
    accountOwnerId: owner,
    versionNumber: 1,
    supersedesVersionId: null,
    fileKind: bytes === PDF ? ('PDF' as const) : ('IMAGE' as const),
    mimeType: bytes === PDF ? 'application/pdf' : 'image/jpeg',
    extension: ext,
    byteSize: bytes.length,
    sha256: sha256Hex(bytes),
    relativePath: `road-wallet/${docId}/${verId}.${ext}`,
    fileCache: {
      state: 'READY' as const,
      relativePath: '',
      mimeType: '',
      byteSize: 0,
      sha256: '',
      error: null,
      verifiedAt: null,
    },
    cloudStatus: 'synced' as const,
    remoteStorageBucket: 'documents' as const,
    remoteStoragePath: `${owner}/road-wallet/${docId}/${verId}.${ext}`,
    createdAt: 1_000,
  };
  remote.documents.push(toRemoteDocumentRow(doc, owner) as unknown as Record<string, unknown>);
  remote.versions.push(toRemoteVersionRow(version, owner) as unknown as Record<string, unknown>);
  remote.objects.set(`documents/${version.remoteStoragePath}`, bytes);
  return { doc, version };
};

const local = () => useRoadWalletStore.getState();

beforeEach(() => {
  useRoadWalletStore.getState().clear();
  fileStore = new MemoryDocumentFileStore();
  fileStore.addSource('file:///tmp/picker/cab-card.jpg', JPEG, 'image/jpeg');
  configureRoadWalletFileStore(fileStore);
  remote = new FakeRemote();
  session.userId = 'user-a';
  session.tier = 'driver_pro';
  session.configured = true;
  seed = 0;
});

afterAll(() => configureRoadWalletFileStore(null));

// ---------------------------------------------------------------------------

describe('recovery rights (R1)', () => {
  it('a signed-in former subscriber (now Free) recovers previously backed-up data', async () => {
    const { doc, version } = seedCloud('user-a');
    session.tier = 'free';
    const result = await recoverRoadWalletFromCloud(deps());
    expect(result).toMatchObject({
      outcome: 'completed',
      documentsRecovered: 1,
      versionsRecovered: 1,
      filesRestored: 1,
    });
    expect(local().documents.map((d) => d.id)).toEqual([doc.id]);
    const v = local().versions.find((x) => x.id === version.id)!;
    expect(v.cloudStatus).toBe('synced');
    expect(v.fileCache.state).toBe('READY');
    expect(await fileStore.exists(v.relativePath)).toBe(true);
  });

  it('recovery grants no new cloud writes: a Free user’s new local document stays local_only', async () => {
    seedCloud('user-a');
    session.tier = 'free';
    await recoverRoadWalletFromCloud(deps());
    const created = await createOperationalDocumentFromFile(
      { uri: 'file:///tmp/picker/cab-card.jpg', mimeType: 'image/jpeg' },
      { documentKind: 'INSURANCE', title: 'New' },
      { fileStore, ctx: deps().ctx, now: () => 8_000, newId: nextId },
    );
    expect(created.document.cloudStatus).toBe('local_only');
    expect(created.version.cloudStatus).toBe('local_only');
  });

  it('signed-out and unconfigured sessions recover nothing; no cross-account recovery', async () => {
    seedCloud('user-a');
    seedCloud('user-b');
    session.userId = null;
    expect((await recoverRoadWalletFromCloud(deps())).outcome).toBe('signed_out');
    expect(local().documents).toHaveLength(0);

    session.userId = 'user-a';
    session.configured = false;
    expect((await recoverRoadWalletFromCloud(deps())).outcome).toBe('not_configured');

    session.configured = true;
    await recoverRoadWalletFromCloud(deps());
    expect(local().documents.every((d) => d.accountOwnerId === 'user-a')).toBe(true);
    expect(selectVisibleDocuments(local(), 'user-b')).toEqual([]);
  });

  it('defensively rejects a returned row that does not belong to the session user', async () => {
    seedCloud('user-a');
    // Simulate RLS misconfiguration: the remote hands back another owner's row.
    const foreign = seedCloud('user-b');
    remote.fetchDocuments = async () => remote.documents;
    remote.fetchVersions = async () => remote.versions;
    const result = await recoverRoadWalletFromCloud(deps());
    expect(result.documentsRecovered).toBe(1);
    expect(result.integrityConflicts).toBeGreaterThanOrEqual(1);
    expect(local().documents.find((d) => d.id === foreign.doc.id)).toBeUndefined();
  });
});

describe('remote mapping (R2)', () => {
  it('maps a valid document row and rejects malformed ones', () => {
    const { doc } = seedCloud('user-a');
    const row = remote.documents[0];
    const mapped = fromRemoteDocumentRow(row, 'user-a')!;
    expect(mapped).toMatchObject({
      id: doc.id,
      accountOwnerId: 'user-a',
      cloudStatus: 'synced',
      title: doc.title,
    });
    expect(Object.keys(mapped)).not.toContain('relativePath');
    expect(fromRemoteDocumentRow(row, 'user-b')).toBeNull();
    expect(fromRemoteDocumentRow({ ...row, id: 'not opaque' }, 'user-a')).toBeNull();
    expect(fromRemoteDocumentRow({ ...row, document_kind: 'PASSPORT' }, 'user-a')).toBeNull();
    expect(
      fromRemoteDocumentRow({ ...row, document_kind: 'W9', sensitivity: 'STANDARD' }, 'user-a'),
    ).toBeNull();
    expect(fromRemoteDocumentRow({ ...row, expires_at: '06/30/2027' }, 'user-a')).toBeNull();
    expect(fromRemoteDocumentRow({ ...row, masked_reference: 'D1234567' }, 'user-a')).toBeNull();
    expect(fromRemoteDocumentRow({ ...row, lifecycle: 'DELETED' }, 'user-a')).toBeNull();
    expect(fromRemoteDocumentRow({ ...row, updated_at: 'yesterday' }, 'user-a')).toBeNull();
    expect(fromRemoteDocumentRow(null, 'user-a')).toBeNull();
  });

  it('maps a valid version row, reconstructs the local path, starts NOT_CACHED, and rejects malformed rows', () => {
    const { doc, version } = seedCloud('user-a');
    const parent = fromRemoteDocumentRow(remote.documents[0], 'user-a')!;
    const row = remote.versions[0];
    const mapped = fromRemoteVersionRow(row, 'user-a', parent)!;
    expect(mapped).toMatchObject({
      id: version.id,
      operationalDocumentId: doc.id,
      accountOwnerId: 'user-a',
      versionNumber: 1,
      relativePath: `road-wallet/${doc.id}/${version.id}.jpg`,
      remoteStorageBucket: 'documents',
      remoteStoragePath: `user-a/road-wallet/${doc.id}/${version.id}.jpg`,
      cloudStatus: 'synced',
    });
    expect(mapped.fileCache).toMatchObject({
      state: 'NOT_CACHED',
      sha256: version.sha256,
      byteSize: JPEG.length,
    });

    expect(fromRemoteVersionRow(row, 'user-b', parent)).toBeNull();
    expect(
      fromRemoteVersionRow({ ...row, storage_bucket: 'receipts' }, 'user-a', parent),
    ).toBeNull();
    expect(
      fromRemoteVersionRow(
        { ...row, storage_path: `user-a/road-wallet/${doc.id}/other.jpg` },
        'user-a',
        parent,
      ),
    ).toBeNull();
    expect(
      fromRemoteVersionRow(
        { ...row, storage_path: `user-b/road-wallet/${doc.id}/${version.id}.jpg` },
        'user-a',
        parent,
      ),
    ).toBeNull();
    expect(fromRemoteVersionRow({ ...row, sha256: 'ABC' }, 'user-a', parent)).toBeNull();
    expect(fromRemoteVersionRow({ ...row, byte_size: 0 }, 'user-a', parent)).toBeNull();
    expect(fromRemoteVersionRow({ ...row, file_kind: 'VIDEO' }, 'user-a', parent)).toBeNull();
    expect(fromRemoteVersionRow({ ...row, extension: 'JPG' }, 'user-a', parent)).toBeNull();
    expect(fromRemoteVersionRow({ ...row, version_number: 0 }, 'user-a', parent)).toBeNull();
    expect(
      fromRemoteVersionRow({ ...row, operational_document_id: nextId() }, 'user-a', parent),
    ).toBeNull();
    // A server-supplied "local path" field is simply ignored.
    expect(
      fromRemoteVersionRow({ ...row, relative_path: '/etc/passwd' }, 'user-a', parent)
        ?.relativePath,
    ).toBe(`road-wallet/${doc.id}/${version.id}.jpg`);
  });

  it('H0B: byte_size and version_number must be safe positive integers (no Number coercion)', () => {
    const parent = fromRemoteDocumentRow(remote.documents[0], 'user-a')!;
    const row = remote.versions[0];
    expect(fromRemoteVersionRow({ ...row, version_number: '1' }, 'user-a', parent)).toBeNull();
    expect(fromRemoteVersionRow({ ...row, version_number: true }, 'user-a', parent)).toBeNull();
    expect(fromRemoteVersionRow({ ...row, version_number: 1.5 }, 'user-a', parent)).toBeNull();
    expect(fromRemoteVersionRow({ ...row, byte_size: String(JPEG.length) }, 'user-a', parent)).toBeNull();
    expect(fromRemoteVersionRow({ ...row, byte_size: JPEG.length + 0.5 }, 'user-a', parent)).toBeNull();
    expect(fromRemoteVersionRow({ ...row, byte_size: true }, 'user-a', parent)).toBeNull();
  });

  it('H0B: offline_pinned must be a real boolean; optional scalars reject objects/numbers', () => {
    const row = remote.documents[0];
    expect(fromRemoteDocumentRow({ ...row, offline_pinned: 1 }, 'user-a')).toBeNull();
    expect(fromRemoteDocumentRow({ ...row, offline_pinned: 'true' }, 'user-a')).toBeNull();
    expect(fromRemoteDocumentRow({ ...row, issuer: 123 }, 'user-a')).toBeNull();
    expect(fromRemoteDocumentRow({ ...row, jurisdiction: { code: 'TX' } }, 'user-a')).toBeNull();
    expect(fromRemoteDocumentRow({ ...row, trailer_number: 88 }, 'user-a')).toBeNull();
    expect(fromRemoteDocumentRow({ ...row, issuer: null }, 'user-a')).not.toBeNull();
    expect(fromRemoteDocumentRow({ ...row, offline_pinned: false }, 'user-a')?.offlinePinned).toBe(
      false,
    );
  });
});

describe('safe merge (R3)', () => {
  it('imports absent documents, preserves unsynced local metadata, and replaces synced local metadata only when remote is newer', () => {
    const { doc } = seedCloud('user-a');
    const remoteDoc = fromRemoteDocumentRow(remote.documents[0], 'user-a')!;
    expect(mergeRecoveredDocument(undefined, remoteDoc).action).toBe('import');

    const pendingLocal = {
      ...doc,
      title: 'Edited offline',
      cloudStatus: 'pending_sync' as const,
      updatedAt: 500,
    };
    const kept = mergeRecoveredDocument(pendingLocal, { ...remoteDoc, updatedAt: 9_999 });
    expect(kept.action).toBe('keep_local');
    expect(kept.document.title).toBe('Edited offline');

    const syncedOld = {
      ...doc,
      title: 'Old synced',
      cloudStatus: 'synced' as const,
      updatedAt: 500,
    };
    const replaced = mergeRecoveredDocument(syncedOld, {
      ...remoteDoc,
      title: 'Newer remote',
      updatedAt: 9_999,
    });
    expect(replaced.action).toBe('replace_metadata');
    expect(replaced.document).toMatchObject({
      title: 'Newer remote',
      id: doc.id,
      accountOwnerId: 'user-a',
      createdAt: doc.createdAt,
    });

    const syncedNew = {
      ...doc,
      title: 'Local newer',
      cloudStatus: 'synced' as const,
      updatedAt: 99_999,
    };
    expect(mergeRecoveredDocument(syncedNew, { ...remoteDoc, updatedAt: 9_999 }).action).toBe(
      'keep_synced_local',
    );
  });

  it('end-to-end: a local pending edit survives recovery; an older synced copy is refreshed', async () => {
    const { doc } = seedCloud('user-a', { updatedAt: 5_000 });
    const remoteDoc = fromRemoteDocumentRow(remote.documents[0], 'user-a')!;
    // Local has the same document with an unsynced edit.
    local().importRecoveredDocument({ ...remoteDoc, title: 'Synced before edit' });
    local().updateDocumentMetadata(
      doc.id,
      { title: 'Edited offline' },
      { userId: 'user-a', tier: 'free', supabaseConfigured: true },
      6_000,
    );
    expect(local().documents[0].cloudStatus).toBe('local_only');

    const r1 = await recoverRoadWalletFromCloud(deps());
    expect(r1.skippedLocalChanges).toBe(1);
    expect(local().documents[0].title).toBe('Edited offline');

    // Now the local copy is synced but stale; remote is newer → replaced.
    local().setDocumentCloudStatus(doc.id, 'synced');
    remote.documents[0] = {
      ...remote.documents[0],
      title: 'Renewed on other device',
      updated_at: new Date(9_000).toISOString(),
    };
    const r2 = await recoverRoadWalletFromCloud(deps());
    expect(r2.documentsRecovered).toBe(1);
    expect(local().documents[0].title).toBe('Renewed on other device');
    expect(local().documents[0].id).toBe(doc.id);
  });

  it('identical version ids reconcile cloud state; mismatched immutable evidence is an integrity conflict', async () => {
    const created = await createOperationalDocumentFromFile(
      { uri: 'file:///tmp/picker/cab-card.jpg', mimeType: 'image/jpeg' },
      { documentKind: 'VEHICLE_REGISTRATION', title: 'Local' },
      { fileStore, ctx: deps().ctx, now: () => 1_000, newId: nextId },
    );
    local().setDocumentCloudStatus(created.document.id, 'synced');
    remote.documents.push(
      toRemoteDocumentRow(local().documents[0], 'user-a') as unknown as Record<string, unknown>,
    );
    const row = toRemoteVersionRow(created.version, 'user-a') as unknown as Record<string, unknown>;
    remote.versions.push(row);

    const identical = fromRemoteVersionRow(row, 'user-a', local().documents[0])!;
    expect(mergeRecoveredVersion(created.version, identical).action).toBe('reconcile');
    expect(
      mergeRecoveredVersion(created.version, { ...identical, sha256: 'f'.repeat(64) }).action,
    ).toBe('conflict');

    const r1 = await recoverRoadWalletFromCloud(deps());
    expect(r1.integrityConflicts).toBe(0);
    const v = local().versions.find((x) => x.id === created.version.id)!;
    expect(v).toMatchObject({
      cloudStatus: 'synced',
      remoteStorageBucket: 'documents',
      remoteStoragePath: `user-a/road-wallet/${created.document.id}/${created.version.id}.jpg`,
    });
    expect(v.sha256).toBe(created.version.sha256);

    // Remote row now claims different evidence for the same id → conflict, nothing rewritten.
    remote.versions[0] = { ...row, sha256: 'f'.repeat(64), byte_size: 999 };
    local().setVersionCloudState(v.id, {
      cloudStatus: 'local_only',
      remoteStorageBucket: null,
      remoteStoragePath: null,
    });
    const r2 = await recoverRoadWalletFromCloud(deps());
    expect(r2.integrityConflicts).toBe(1);
    expect(local().versions.find((x) => x.id === v.id)!.sha256).toBe(created.version.sha256);
    expect(remote.versions[0].sha256).toBe('f'.repeat(64)); // remote untouched
  });
});

describe('remote chain validation (R4)', () => {
  const chainRows = (
    docId: string,
    owner: string,
    numbers: number[],
    supersedes: (i: number, ids: string[]) => string | null,
  ) => {
    const ids = numbers.map(() => nextId());
    return numbers.map((n, i) => ({
      id: ids[i],
      owner_id: owner,
      operational_document_id: docId,
      version_number: n,
      supersedes_version_id: supersedes(i, ids),
      storage_bucket: 'documents',
      storage_path: `${owner}/road-wallet/${docId}/${ids[i]}.jpg`,
      file_kind: 'IMAGE',
      mime_type: 'image/jpeg',
      extension: 'jpg',
      byte_size: JPEG.length,
      sha256: sha256Hex(JPEG),
      created_at: new Date(1_000 + i).toISOString(),
    }));
  };

  it('imports a valid 1→2→3 chain and only the valid prefix of 1→2→4', async () => {
    const a = seedCloud('user-a', { pinned: false });
    remote.versions = remote.versions.filter((v) => v.operational_document_id !== a.doc.id);
    remote.versions.push(
      ...chainRows(a.doc.id, 'user-a', [1, 2, 3], (i, ids) => (i === 0 ? null : ids[i - 1])),
    );

    const b = seedCloud('user-a', { pinned: false });
    remote.versions = remote.versions.filter((v) => v.operational_document_id !== b.doc.id);
    remote.versions.push(
      ...chainRows(b.doc.id, 'user-a', [1, 2, 4], (i, ids) => (i === 0 ? null : ids[i - 1])),
    );

    const result = await recoverRoadWalletFromCloud(deps());
    expect(result.versionsRecovered).toBe(5);
    expect(result.integrityConflicts).toBe(1);
    expect(
      local()
        .versions.filter((v) => v.operationalDocumentId === a.doc.id)
        .map((v) => v.versionNumber)
        .sort(),
    ).toEqual([1, 2, 3]);
    expect(
      local()
        .versions.filter((v) => v.operationalDocumentId === b.doc.id)
        .map((v) => v.versionNumber)
        .sort(),
    ).toEqual([1, 2]);
    expect(currentVersion(local().versions, b.doc.id)?.versionNumber).toBe(2);
    // The malformed remote row was quarantined locally, not deleted remotely.
    expect(remote.versions.filter((v) => v.operational_document_id === b.doc.id)).toHaveLength(3);
  });
});

describe('restoreDocumentVersionToDevice (R5)', () => {
  const recoverMetadataOnly = async () => {
    const { doc, version } = seedCloud('user-a', { pinned: false });
    await recoverRoadWalletFromCloud(deps());
    expect(local().versions.find((v) => v.id === version.id)?.fileCache.state).toBe('NOT_CACHED');
    expect(await fileStore.exists(version.relativePath)).toBe(false);
    return { doc, version };
  };

  it('exact bytes → written to the canonical path → reverified → READY', async () => {
    const { doc, version } = await recoverMetadataOnly();
    const restored = await restoreDocumentVersionToDevice(doc.id, undefined, deps());
    expect(restored.fileCache.state).toBe('READY');
    expect(restored.fileCache.verifiedAt).toBe(7_000);
    expect(await fileStore.exists(`road-wallet/${doc.id}/${version.id}.jpg`)).toBe(true);
    expect(await fileStore.sha256(version.relativePath)).toBe(version.sha256);
    expect(remote.downloads).toEqual([`documents/user-a/road-wallet/${doc.id}/${version.id}.jpg`]);
  });

  it('wrong hash, wrong kind and wrong size are rejected; no file is kept and the version hash is untouched', async () => {
    const { doc, version } = await recoverMetadataOnly();
    const key = `documents/${version.remoteStoragePath}`;

    remote.objects.set(key, JPEG2); // same kind/size-ish, different hash
    await expect(restoreDocumentVersionToDevice(doc.id, undefined, deps())).rejects.toMatchObject({
      reason: 'BYTES_MISMATCH',
    });
    remote.objects.set(key, PDF); // wrong kind
    await expect(restoreDocumentVersionToDevice(doc.id, undefined, deps())).rejects.toMatchObject({
      reason: 'BYTES_MISMATCH',
    });
    remote.objects.set(key, new Uint8Array([...JPEG, 0])); // wrong size (and hash)
    await expect(restoreDocumentVersionToDevice(doc.id, undefined, deps())).rejects.toMatchObject({
      reason: 'BYTES_MISMATCH',
    });

    expect(await fileStore.exists(version.relativePath)).toBe(false);
    const v = local().versions.find((x) => x.id === version.id)!;
    expect(v.sha256).toBe(version.sha256);
    expect(v.fileCache.state).not.toBe('READY');
  });

  it('rejects a non-canonical remote path, a version that was never backed up, and download failures', async () => {
    const { doc, version } = await recoverMetadataOnly();
    local().setVersionCloudState(version.id, {
      remoteStoragePath: `user-a/road-wallet/${doc.id}/elsewhere.jpg`,
      cloudStatus: 'synced',
    });
    await expect(restoreDocumentVersionToDevice(doc.id, undefined, deps())).rejects.toMatchObject({
      reason: 'REMOTE_PATH_INVALID',
    });

    local().setVersionCloudState(version.id, {
      cloudStatus: 'local_only',
      remoteStorageBucket: null,
      remoteStoragePath: null,
    });
    await expect(restoreDocumentVersionToDevice(doc.id, undefined, deps())).rejects.toMatchObject({
      reason: 'NOT_BACKED_UP',
    });

    local().setVersionCloudState(version.id, {
      cloudStatus: 'synced',
      remoteStorageBucket: 'documents',
      remoteStoragePath: version.remoteStoragePath,
    });
    remote.failDownload = true;
    await expect(restoreDocumentVersionToDevice(doc.id, undefined, deps())).rejects.toMatchObject({
      reason: 'DOWNLOAD_FAILED',
    });
    expect(await fileStore.exists(version.relativePath)).toBe(false);
  });

  it('a partial/untrusted write is cleaned up and never READY; final physical reverify is required', async () => {
    const { doc, version } = await recoverMetadataOnly();
    fileStore.unwritable.add(version.relativePath);
    await expect(restoreDocumentVersionToDevice(doc.id, undefined, deps())).rejects.toMatchObject({
      reason: 'WRITE_FAILED',
    });
    fileStore.unwritable.delete(version.relativePath);

    // Write succeeds but the durable re-read fails (simulated unreadable file).
    fileStore.unreadable.add(version.relativePath);
    await expect(restoreDocumentVersionToDevice(doc.id, undefined, deps())).rejects.toMatchObject({
      reason: 'VERIFY_FAILED',
    });
    expect(await fileStore.exists(version.relativePath)).toBe(false);
    expect(local().versions.find((x) => x.id === version.id)!.fileCache.state).toBe('ERROR');
  });

  it('is denied signed out, for another account, and for unknown documents — regardless of tier', async () => {
    const { doc } = await recoverMetadataOnly();
    session.tier = 'free';
    await expect(restoreDocumentVersionToDevice(doc.id, undefined, deps())).resolves.toMatchObject({
      fileCache: { state: 'READY' },
    });
    await fileStore.remove(`road-wallet/${doc.id}/${local().versions[0].id}.jpg`);

    session.userId = 'user-b';
    await expect(restoreDocumentVersionToDevice(doc.id, undefined, deps())).rejects.toMatchObject({
      reason: 'NOT_VISIBLE',
    });
    session.userId = null;
    await expect(restoreDocumentVersionToDevice(doc.id, undefined, deps())).rejects.toMatchObject({
      reason: 'SIGNED_OUT',
    });
    session.userId = 'user-a';
    await expect(restoreDocumentVersionToDevice('nope', undefined, deps())).rejects.toMatchObject({
      reason: 'NOT_FOUND',
    });
  });
});

describe('auto-recovery policy (R7)', () => {
  it('auto-restores pinned ACTIVE current versions only; unpinned (financial), archived and historical versions are metadata-only', async () => {
    const pinned = seedCloud('user-a', { pinned: true });
    const financial = seedCloud('user-a', { kind: 'W9', bytes: PDF }); // offlinePinned false
    const archived = seedCloud('user-a', { pinned: true, lifecycle: 'ARCHIVED' });
    // Historical version for `pinned`: add version 2 remotely with different bytes.
    const v2Id = nextId();
    remote.versions.push({
      id: v2Id,
      owner_id: 'user-a',
      operational_document_id: pinned.doc.id,
      version_number: 2,
      supersedes_version_id: pinned.version.id,
      storage_bucket: 'documents',
      storage_path: `user-a/road-wallet/${pinned.doc.id}/${v2Id}.jpg`,
      file_kind: 'IMAGE',
      mime_type: 'image/jpeg',
      extension: 'jpg',
      byte_size: JPEG2.length,
      sha256: sha256Hex(JPEG2),
      created_at: new Date(2_000).toISOString(),
    });
    remote.objects.set(`documents/user-a/road-wallet/${pinned.doc.id}/${v2Id}.jpg`, JPEG2);

    const result = await recoverRoadWalletFromCloud(deps());
    expect(result.documentsRecovered).toBe(3);
    expect(result.versionsRecovered).toBe(4);
    expect(result.filesRestored).toBe(1);
    expect(remote.downloads).toEqual([`documents/user-a/road-wallet/${pinned.doc.id}/${v2Id}.jpg`]); // current only
    expect(local().versions.find((v) => v.id === v2Id)?.fileCache.state).toBe('READY');
    expect(local().versions.find((v) => v.id === pinned.version.id)?.fileCache.state).toBe(
      'NOT_CACHED',
    );
    expect(local().versions.find((v) => v.id === financial.version.id)?.fileCache.state).toBe(
      'NOT_CACHED',
    );
    expect(local().versions.find((v) => v.id === archived.version.id)?.fileCache.state).toBe(
      'NOT_CACHED',
    );

    // Historical version restores on explicit request.
    await restoreDocumentVersionToDevice(pinned.doc.id, pinned.version.id, deps());
    expect(local().versions.find((v) => v.id === pinned.version.id)?.fileCache.state).toBe('READY');
    // Financial restores on explicit request too (owner right, tier-independent).
    session.tier = 'free';
    await restoreDocumentVersionToDevice(financial.doc.id, undefined, deps());
    expect(local().versions.find((v) => v.id === financial.version.id)?.fileCache.state).toBe(
      'READY',
    );
  });

  it('does not re-download a file that is present and verifies READY', async () => {
    const { version } = seedCloud('user-a', { pinned: true });
    await fileStore.writeBytes(version.relativePath, JPEG);
    const result = await recoverRoadWalletFromCloud(deps());
    expect(result.filesRestored).toBe(0);
    expect(remote.downloads).toEqual([]);
    expect(local().versions[0].fileCache.state).toBe('READY');
  });

  it('counts download failures without deleting anything', async () => {
    const { version } = seedCloud('user-a', { pinned: true });
    remote.failDownload = true;
    const result = await recoverRoadWalletFromCloud(deps());
    expect(result).toMatchObject({
      documentsRecovered: 1,
      versionsRecovered: 1,
      filesRestored: 0,
      downloadFailures: 1,
    });
    expect(local().versions.find((v) => v.id === version.id)).toBeDefined();
    expect(remote.versions).toHaveLength(1);
  });
});

describe('account switch during recovery (R14)', () => {
  it('a switch during fetch discards the stale result: nothing of A is merged into B’s session', async () => {
    seedCloud('user-a');
    remote.onFetch = () => {
      session.userId = 'user-b';
    };
    const result = await recoverRoadWalletFromCloud(deps());
    expect(result.outcome).toBe('cancelled');
    expect(local().documents).toHaveLength(0);
    expect(selectVisibleDocuments(local(), 'user-b')).toEqual([]);
  });

  it('a switch during download cancels the file restore and surfaces nothing to B', async () => {
    seedCloud('user-a', { pinned: true });
    remote.onDownload = () => {
      session.userId = 'user-b';
    };
    const result = await recoverRoadWalletFromCloud(deps());
    expect(result.outcome).toBe('cancelled');
    expect(result.filesRestored).toBe(0);
    // A's metadata was safely recovered and remains account-bound to A …
    expect(local().documents.every((d) => d.accountOwnerId === 'user-a')).toBe(true);
    // … but B sees none of it and no file was written for B's pass.
    expect(selectVisibleDocuments(local(), 'user-b')).toEqual([]);
    expect(local().versions.every((v) => v.fileCache.state !== 'READY')).toBe(true);
  });
});

describe('no-touch guarantees (R15)', () => {
  it('recovery never deletes remote rows/objects or local verified files, and never mints versions to hide conflicts', async () => {
    const created = await createOperationalDocumentFromFile(
      { uri: 'file:///tmp/picker/cab-card.jpg', mimeType: 'image/jpeg' },
      { documentKind: 'VEHICLE_REGISTRATION', title: 'Local' },
      { fileStore, ctx: deps().ctx, now: () => 1_000, newId: nextId },
    );
    local().setDocumentCloudStatus(created.document.id, 'synced');
    remote.documents.push(
      toRemoteDocumentRow(local().documents[0], 'user-a') as unknown as Record<string, unknown>,
    );
    remote.versions.push({
      ...(toRemoteVersionRow(created.version, 'user-a') as unknown as Record<string, unknown>),
      sha256: 'e'.repeat(64),
    });
    const before = {
      docs: remote.documents.length,
      versions: remote.versions.length,
      objects: remote.objects.size,
    };

    const result = await recoverRoadWalletFromCloud(deps());
    expect(result.integrityConflicts).toBe(1);
    expect(local().versions).toHaveLength(1);
    expect(local().versions[0].sha256).toBe(created.version.sha256);
    expect(await fileStore.exists(created.version.relativePath)).toBe(true);
    expect({
      docs: remote.documents.length,
      versions: remote.versions.length,
      objects: remote.objects.size,
    }).toEqual(before);
    expect(result.outcome).toBe('completed');
  });
});

describe('RestoreError', () => {
  it('carries a bounded reason and no sensitive detail', () => {
    const e = new RestoreError('BYTES_MISMATCH', 'HASH_MISMATCH');
    expect(e.reason).toBe('BYTES_MISMATCH');
    expect(e.message).not.toMatch(/road-wallet\//);
  });
});
