import { CloudSyncContext, DocumentVersion, newOpaqueId, OperationalDocument } from '@/domain';
import {
  normalizeRoadWalletState,
  ROAD_WALLET_CLOUD_CAPABILITY,
  ROAD_WALLET_PERSIST_VERSION,
  selectActiveVisibleDocuments,
  selectCurrentVersion,
  selectDocumentById,
  selectVersionsForDocument,
  selectVisibleDocuments,
  useRoadWalletStore,
} from '@/store/roadWallet';

const fixedId = (seed: number) =>
  newOpaqueId(() => new Uint8Array(Array.from({ length: 16 }, (_, i) => (i * 29 + seed) & 0xff)));

const DOC_A = fixedId(1);
const DOC_B = fixedId(2);
const DOC_ANON = fixedId(3);
const V1 = fixedId(4);
const V2 = fixedId(5);
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

const ctx = (over: Partial<CloudSyncContext> = {}): CloudSyncContext => ({
  userId: 'user-a',
  tier: 'driver_pro',
  supabaseConfigured: true,
  ...over,
});

const doc = (over: Partial<OperationalDocument> = {}): OperationalDocument => ({
  id: DOC_A,
  accountOwnerId: 'user-a',
  documentKind: 'VEHICLE_REGISTRATION',
  subjectKind: 'TRUCK',
  truckId: null,
  trailerNumber: null,
  title: 'Cab card',
  issuer: null,
  jurisdiction: 'TX',
  issuedAt: null,
  effectiveAt: null,
  expiresAt: '2027-01-31',
  maskedReference: null,
  sensitivity: 'STANDARD',
  lifecycle: 'ACTIVE',
  offlinePinned: true,
  cloudStatus: 'local_only',
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

const version = (over: Partial<DocumentVersion> = {}): DocumentVersion => ({
  id: V1,
  operationalDocumentId: DOC_A,
  accountOwnerId: 'user-a',
  versionNumber: 1,
  supersedesVersionId: null,
  fileKind: 'IMAGE',
  mimeType: 'image/jpeg',
  extension: 'jpg',
  byteSize: 10,
  sha256: SHA_A,
  relativePath: `road-wallet/${DOC_A}/${V1}.jpg`,
  fileCache: {
    state: 'READY',
    relativePath: `road-wallet/${DOC_A}/${V1}.jpg`,
    mimeType: 'image/jpeg',
    byteSize: 10,
    sha256: SHA_A,
    error: null,
    verifiedAt: 1,
  },
  cloudStatus: 'local_only',
  remoteStorageBucket: null,
  remoteStoragePath: null,
  createdAt: 1,
  ...over,
});

beforeEach(() => {
  useRoadWalletStore.getState().clear();
});

describe('persistence normalization', () => {
  it('is versioned and never crashes on malformed persisted data', () => {
    expect(ROAD_WALLET_PERSIST_VERSION).toBe(1);
    expect(normalizeRoadWalletState(undefined)).toEqual({ documents: [], versions: [] });
    expect(normalizeRoadWalletState('garbage')).toEqual({ documents: [], versions: [] });
    expect(normalizeRoadWalletState({ documents: 'x', versions: 42 })).toEqual({
      documents: [],
      versions: [],
    });
    expect(
      normalizeRoadWalletState({
        documents: [null, 7, { id: 'bad id' }, { id: DOC_A, documentKind: 'PASSPORT' }],
        versions: [{ id: V1 }],
      }),
    ).toEqual({ documents: [], versions: [] });
  });

  it('keeps sound records, drops versions whose document is gone, and distrusts unknown cloud states', () => {
    const out = normalizeRoadWalletState({
      documents: [
        doc({ cloudStatus: 'weird' as unknown as 'synced' }),
        doc({ id: DOC_B, cloudStatus: 'synced' }),
      ],
      versions: [
        version(),
        version({ id: V2, operationalDocumentId: fixedId(40), versionNumber: 1 }),
      ],
    });
    expect(out.documents.map((d) => [d.id, d.cloudStatus])).toEqual([
      [DOC_A, 'local_only'],
      [DOC_B, 'synced'],
    ]);
    expect(out.versions.map((v) => v.id)).toEqual([V1]);
  });

  it('H2: a persisted READY claim is never authoritative — every version rehydrates NOT_CACHED with canonical evidence', () => {
    const out = normalizeRoadWalletState({
      documents: [doc()],
      versions: [
        version({
          fileCache: {
            state: 'READY',
            relativePath: 'road-wallet/attacker/path.jpg',
            mimeType: 'text/plain',
            byteSize: 1,
            sha256: SHA_B,
            error: null,
            verifiedAt: 123,
          },
        }),
      ],
    });
    const cache = out.versions[0].fileCache;
    expect(cache.state).toBe('NOT_CACHED');
    expect(cache.verifiedAt).toBeNull();
    expect(cache.error).toBeNull();
    // Expectations come from the immutable version, not from arbitrary persisted cache text.
    expect(cache.relativePath).toBe(`road-wallet/${DOC_A}/${V1}.jpg`);
    expect(cache.sha256).toBe(SHA_A);
    expect(cache.byteSize).toBe(10);
    expect(cache.mimeType).toBe('image/jpeg');
  });

  it('H5: a known-sensitive kind persisted with a downgraded class is repaired, not kept downgraded', () => {
    const out = normalizeRoadWalletState({
      documents: [
        doc({ id: DOC_A, documentKind: 'W9', subjectKind: 'CARRIER', sensitivity: 'STANDARD' }),
        doc({
          id: DOC_B,
          documentKind: 'CDL',
          subjectKind: 'DRIVER',
          sensitivity: 'FINANCIAL_SENSITIVE',
        }),
        doc({
          id: DOC_ANON,
          documentKind: 'CUSTOM',
          subjectKind: 'GENERAL',
          sensitivity: 'STANDARD',
        }),
      ],
      versions: [],
    });
    expect(out.documents.map((d) => [d.documentKind, d.sensitivity])).toEqual([
      ['W9', 'FINANCIAL_SENSITIVE'],
      ['CDL', 'PERSONAL_SENSITIVE'],
      ['CUSTOM', 'STANDARD'],
    ]);
  });

  it('unowned documents never carry a synced claim', () => {
    const out = normalizeRoadWalletState({
      documents: [doc({ accountOwnerId: null, cloudStatus: 'synced' })],
      versions: [],
    });
    expect(out.documents[0].cloudStatus).toBe('local_only');
  });
});

describe('H3 — persisted version normalization rejects corruption deterministically', () => {
  const persisted = (versions: unknown[], documents: unknown[] = [doc()]) =>
    normalizeRoadWalletState({ documents, versions });
  const V3 = fixedId(6);
  const V4 = fixedId(7);
  const at = (id: string, docId = DOC_A, ext = 'jpg') => `road-wallet/${docId}/${id}.${ext}`;
  const v2 = () =>
    version({
      id: V2,
      versionNumber: 2,
      supersedesVersionId: V1,
      sha256: SHA_B,
      relativePath: at(V2),
    });

  it('keeps a consistent chain intact', () => {
    const out = persisted([v2(), version()]);
    expect(out.versions.map((v) => v.versionNumber)).toEqual([1, 2]);
    expect(out.versions.every((v) => v.fileCache.state === 'NOT_CACHED')).toBe(true);
  });

  it('drops a version whose owner differs from its parent document', () => {
    expect(persisted([version({ accountOwnerId: 'user-b' })]).versions).toEqual([]);
    expect(persisted([version({ accountOwnerId: null })]).versions).toEqual([]);
    const anonDoc = doc({ accountOwnerId: null });
    expect(persisted([version({ accountOwnerId: 'user-a' })], [anonDoc]).versions).toEqual([]);
    expect(persisted([version({ accountOwnerId: null })], [anonDoc]).versions).toHaveLength(1);
  });

  it('drops a version whose relativePath is not the canonical local path', () => {
    expect(persisted([version({ relativePath: 'road-wallet/x/y.jpg' })]).versions).toEqual([]);
    expect(persisted([version({ relativePath: at(V1, DOC_A, 'pdf') })]).versions).toEqual([]);
    expect(persisted([version({ relativePath: `/etc/${DOC_A}/${V1}.jpg` })]).versions).toEqual([]);
  });

  it('drops malformed evidence: bad hash, zero size, bad version number, bad extension, bad kind, bad id', () => {
    expect(persisted([version({ sha256: 'ABC' })]).versions).toEqual([]);
    expect(persisted([version({ sha256: SHA_A.toUpperCase() })]).versions).toEqual([]);
    expect(persisted([version({ byteSize: 0 })]).versions).toEqual([]);
    expect(persisted([version({ versionNumber: 0 })]).versions).toEqual([]);
    expect(persisted([version({ versionNumber: 1.5 })]).versions).toEqual([]);
    expect(persisted([version({ extension: 'JPG' })]).versions).toEqual([]);
    expect(persisted([version({ fileKind: 'VIDEO' as unknown as 'IMAGE' })]).versions).toEqual([]);
    expect(persisted([version({ id: 'John Smith' })]).versions).toEqual([]);
  });

  it('drops every entry sharing a duplicated version id', () => {
    expect(persisted([version(), version({ sha256: SHA_B })]).versions).toEqual([]);
  });

  it('drops every entry sharing a duplicated version number', () => {
    const dup = version({
      id: V3,
      versionNumber: 2,
      supersedesVersionId: V1,
      relativePath: at(V3),
    });
    const out = persisted([version(), v2(), dup]);
    expect(out.versions.map((v) => v.id)).toEqual([V1]);
  });

  it('rejects cross-document supersession', () => {
    const other = doc({ id: DOC_B });
    const foreignV1 = version({
      id: V3,
      operationalDocumentId: DOC_B,
      relativePath: at(V3, DOC_B),
    });
    const bad = version({
      id: V2,
      versionNumber: 2,
      supersedesVersionId: V3,
      relativePath: at(V2),
    });
    const out = persisted([version(), bad, foreignV1], [doc(), other]);
    expect(out.versions.map((v) => v.id).sort()).toEqual([V1, V3].sort());
  });

  it('rejects forward supersession and self-supersession', () => {
    const v3 = version({ id: V3, versionNumber: 3, supersedesVersionId: V2, relativePath: at(V3) });
    const forward = version({
      id: V2,
      versionNumber: 2,
      supersedesVersionId: V3,
      relativePath: at(V2),
    });
    expect(persisted([version(), forward, v3]).versions.map((v) => v.versionNumber)).toEqual([1]);
    expect(persisted([version({ supersedesVersionId: V1 })]).versions).toEqual([]);
  });

  it('a fake high-version-number entry never becomes the current version', () => {
    const fake = version({
      id: V4,
      versionNumber: 999,
      supersedesVersionId: V3,
      relativePath: at(V4),
    });
    const out = persisted([version(), v2(), fake]);
    expect(out.versions.map((v) => v.versionNumber)).toEqual([1, 2]);
    expect(selectCurrentVersion(out, DOC_A)?.id).toBe(V2);
  });

  it('downgrades a synced claim whose remote identity is not the canonical owned path', () => {
    const canonical = `user-a/road-wallet/${DOC_A}/${V1}.jpg`;
    const good = version({
      cloudStatus: 'synced',
      remoteStorageBucket: 'documents',
      remoteStoragePath: canonical,
    });
    expect(persisted([good]).versions[0]).toMatchObject({
      cloudStatus: 'synced',
      remoteStorageBucket: 'documents',
      remoteStoragePath: canonical,
    });

    const bads = [
      version({
        cloudStatus: 'synced',
        remoteStorageBucket: 'documents',
        remoteStoragePath: `user-b/road-wallet/${DOC_A}/${V1}.jpg`,
      }),
      version({
        cloudStatus: 'synced',
        remoteStorageBucket: 'receipts' as unknown as 'documents',
        remoteStoragePath: canonical,
      }),
      version({ cloudStatus: 'synced', remoteStorageBucket: 'documents', remoteStoragePath: null }),
      version({ cloudStatus: 'synced', remoteStorageBucket: null, remoteStoragePath: null }),
    ];
    for (const bad of bads) {
      const out = persisted([bad]).versions[0];
      expect(out.cloudStatus).toBe('local_only');
      expect(out.remoteStorageBucket).toBeNull();
      expect(out.remoteStoragePath).toBeNull();
    }
  });

  it('never invents a remote path for an unowned document', () => {
    const anonDoc = doc({ accountOwnerId: null });
    const claimed = version({
      accountOwnerId: null,
      cloudStatus: 'synced',
      remoteStorageBucket: 'documents',
      remoteStoragePath: `null/road-wallet/${DOC_A}/${V1}.jpg`,
    });
    expect(persisted([claimed], [anonDoc]).versions[0]).toMatchObject({
      cloudStatus: 'local_only',
      remoteStorageBucket: null,
      remoteStoragePath: null,
    });
  });

  it('hydration never crashes on malformed entries', () => {
    const junk = [
      null,
      1,
      'x',
      {},
      { id: V1 },
      { id: V1, operationalDocumentId: DOC_A, versionNumber: 'one' },
      version({ fileCache: null as unknown as DocumentVersion['fileCache'] }),
    ];
    expect(() => persisted(junk)).not.toThrow();
    expect(() =>
      normalizeRoadWalletState({
        documents: [doc()],
        versions: [{ operationalDocumentId: DOC_A, id: 12 }],
      }),
    ).not.toThrow();
  });
});

describe('H6 — version deletion API', () => {
  it('exposes no ordinary version-delete action', () => {
    const s = useRoadWalletStore.getState() as unknown as Record<string, unknown>;
    expect(s.removeVersion).toBeUndefined();
    expect(s.deleteVersion).toBeUndefined();
    expect(Object.keys(s).filter((k) => /remove|delete/i.test(k))).toEqual([]);
    expect(typeof s.clear).toBe('function');
  });

  it('previous versions remain discoverable after replacement', () => {
    useRoadWalletStore.getState().addDocument(doc());
    useRoadWalletStore.getState().addVersion(version());
    useRoadWalletStore.getState().addVersion(
      version({
        id: V2,
        versionNumber: 2,
        supersedesVersionId: V1,
        sha256: SHA_B,
        relativePath: `road-wallet/${DOC_A}/${V2}.jpg`,
      }),
    );
    const s = useRoadWalletStore.getState();
    expect(selectVersionsForDocument(s, DOC_A).map((v) => v.id)).toEqual([V1, V2]);
    expect(selectCurrentVersion(s, DOC_A)?.id).toBe(V2);
  });
});

describe('H5 — metadata patches cannot downgrade a known-sensitive kind', () => {
  it('rejects a sensitivity downgrade and a kind change that would invalidate the class', () => {
    useRoadWalletStore
      .getState()
      .addDocument(
        doc({ documentKind: 'CDL', subjectKind: 'DRIVER', sensitivity: 'PERSONAL_SENSITIVE' }),
      );
    expect(() =>
      useRoadWalletStore
        .getState()
        .updateDocumentMetadata(DOC_A, { sensitivity: 'STANDARD' }, ctx()),
    ).toThrow(/must be PERSONAL_SENSITIVE/);
    expect(() =>
      useRoadWalletStore.getState().updateDocumentMetadata(DOC_A, { documentKind: 'W9' }, ctx()),
    ).toThrow(/must be FINANCIAL_SENSITIVE/);
    expect(() =>
      useRoadWalletStore
        .getState()
        .addDocument(doc({ id: DOC_B, documentKind: 'W9', sensitivity: 'STANDARD' })),
    ).toThrow(/must be FINANCIAL_SENSITIVE/);
    const d = useRoadWalletStore.getState().documents[0];
    expect(d.sensitivity).toBe('PERSONAL_SENSITIVE');
    expect(d.documentKind).toBe('CDL');
  });

  it('still allows raising a configurable kind and any class on CUSTOM', () => {
    useRoadWalletStore.getState().addDocument(doc());
    useRoadWalletStore
      .getState()
      .updateDocumentMetadata(DOC_A, { sensitivity: 'PERSONAL_SENSITIVE' }, ctx());
    expect(useRoadWalletStore.getState().documents[0].sensitivity).toBe('PERSONAL_SENSITIVE');
    useRoadWalletStore.getState().addDocument(
      doc({
        id: DOC_B,
        documentKind: 'CUSTOM',
        subjectKind: 'GENERAL',
        sensitivity: 'FINANCIAL_SENSITIVE',
      }),
    );
    expect(useRoadWalletStore.getState().documents.find((d) => d.id === DOC_B)?.sensitivity).toBe(
      'FINANCIAL_SENSITIVE',
    );
  });
});

describe('documents', () => {
  it('adds a validated document and rejects duplicates / raw references', () => {
    useRoadWalletStore.getState().addDocument(doc());
    expect(useRoadWalletStore.getState().documents).toHaveLength(1);
    expect(() => useRoadWalletStore.getState().addDocument(doc())).toThrow(/duplicate/);
    expect(() =>
      useRoadWalletStore.getState().addDocument(doc({ id: DOC_B, maskedReference: 'D1234567' })),
    ).toThrow(/masked/);
    expect(useRoadWalletStore.getState().documents).toHaveLength(1);
  });

  it('updates editable metadata, bumps updatedAt and re-derives cloud status (synced is not terminal)', () => {
    useRoadWalletStore.getState().addDocument(doc({ cloudStatus: 'synced' }));
    useRoadWalletStore
      .getState()
      .updateDocumentMetadata(
        DOC_A,
        { title: 'Cab card 2027', expiresAt: '2027-12-31' },
        ctx(),
        500,
      );
    let d = useRoadWalletStore.getState().documents[0];
    expect(d).toMatchObject({ title: 'Cab card 2027', expiresAt: '2027-12-31', updatedAt: 500 });
    expect(d.cloudStatus).toBe('pending_sync');

    useRoadWalletStore
      .getState()
      .updateDocumentMetadata(DOC_A, { issuer: 'TxDMV' }, ctx({ tier: 'free' }), 600);
    d = useRoadWalletStore.getState().documents[0];
    expect(d.cloudStatus).toBe('local_only');
    expect(d.issuer).toBe('TxDMV');
  });

  it('never lets a patch change identity, ownership or lifecycle', () => {
    useRoadWalletStore.getState().addDocument(doc());
    useRoadWalletStore
      .getState()
      .updateDocumentMetadata(
        DOC_A,
        { id: DOC_B, accountOwnerId: 'user-b', lifecycle: 'ARCHIVED' } as unknown as Record<
          string,
          unknown
        >,
        ctx(),
      );
    const d = useRoadWalletStore.getState().documents[0];
    expect(d.id).toBe(DOC_A);
    expect(d.accountOwnerId).toBe('user-a');
    expect(d.lifecycle).toBe('ACTIVE');
  });

  it('archives a document without deleting it', () => {
    useRoadWalletStore.getState().addDocument(doc({ cloudStatus: 'synced' }));
    useRoadWalletStore.getState().archiveDocument(DOC_A, ctx(), 700);
    const d = useRoadWalletStore.getState().documents[0];
    expect(d.lifecycle).toBe('ARCHIVED');
    expect(d.cloudStatus).toBe('pending_sync');
    expect(selectActiveVisibleDocuments(useRoadWalletStore.getState(), 'user-a')).toEqual([]);
    expect(selectVisibleDocuments(useRoadWalletStore.getState(), 'user-a')).toHaveLength(1);
  });
});

describe('versions', () => {
  beforeEach(() => {
    useRoadWalletStore.getState().addDocument(doc());
  });

  it('adds version 1 and a replacement N+1 that supersedes it, leaving v1 untouched', () => {
    useRoadWalletStore.getState().addVersion(version());
    const v2 = version({
      id: V2,
      versionNumber: 2,
      supersedesVersionId: V1,
      sha256: SHA_B,
      byteSize: 20,
    });
    useRoadWalletStore.getState().addVersion(v2);

    const s = useRoadWalletStore.getState();
    expect(selectVersionsForDocument(s, DOC_A).map((v) => v.versionNumber)).toEqual([1, 2]);
    expect(selectCurrentVersion(s, DOC_A)?.id).toBe(V2);
    const v1 = s.versions.find((v) => v.id === V1)!;
    expect(v1).toEqual(version());
  });

  it('rejects duplicate version numbers, cross-document supersession and unknown documents', () => {
    useRoadWalletStore.getState().addVersion(version());
    expect(() =>
      useRoadWalletStore.getState().addVersion(version({ id: V2, versionNumber: 1 })),
    ).toThrow(/duplicate versionNumber/);
    useRoadWalletStore.getState().addDocument(doc({ id: DOC_B }));
    expect(() =>
      useRoadWalletStore.getState().addVersion(
        version({
          id: V2,
          operationalDocumentId: DOC_B,
          versionNumber: 1,
          supersedesVersionId: V1,
        }),
      ),
    ).toThrow(/same document/);
    expect(() =>
      useRoadWalletStore
        .getState()
        .addVersion(version({ id: V2, operationalDocumentId: fixedId(50) })),
    ).toThrow(/not found/);
    expect(useRoadWalletStore.getState().versions).toHaveLength(1);
  });

  it('exposes only cache/cloud mutations and guards the immutable core', () => {
    useRoadWalletStore.getState().addVersion(version());
    const s = useRoadWalletStore.getState();
    expect((s as unknown as Record<string, unknown>).updateVersion).toBeUndefined();

    s.setVersionCloudState(V1, {
      cloudStatus: 'synced',
      remoteStorageBucket: 'documents',
      remoteStoragePath: `user-a/road-wallet/${DOC_A}/${V1}.jpg`,
    });
    s.setVersionFileCache(V1, { ...version().fileCache, state: 'ERROR', error: 'MISSING' });
    const v = useRoadWalletStore.getState().versions[0];
    expect(v.cloudStatus).toBe('synced');
    expect(v.remoteStorageBucket).toBe('documents');
    expect(v.fileCache.state).toBe('ERROR');
    expect(v.sha256).toBe(SHA_A);
    expect(v.byteSize).toBe(10);
    expect(v.versionNumber).toBe(1);
  });
});

describe('account scope', () => {
  beforeEach(() => {
    const s = useRoadWalletStore.getState();
    s.addDocument(doc({ id: DOC_A, accountOwnerId: 'user-a' }));
    s.addDocument(doc({ id: DOC_B, accountOwnerId: 'user-b' }));
    s.addDocument(doc({ id: DOC_ANON, accountOwnerId: null }));
  });

  it('User A sees only A; User B sees only B; signed out sees only unowned', () => {
    const s = useRoadWalletStore.getState();
    expect(selectVisibleDocuments(s, 'user-a').map((d) => d.id)).toEqual([DOC_A]);
    expect(selectVisibleDocuments(s, 'user-b').map((d) => d.id)).toEqual([DOC_B]);
    expect(selectVisibleDocuments(s, null).map((d) => d.id)).toEqual([DOC_ANON]);
    expect(selectDocumentById(s, DOC_A, 'user-b')).toBeNull();
    expect(selectDocumentById(s, DOC_A, 'user-a')?.id).toBe(DOC_A);
    expect(selectDocumentById(s, DOC_ANON, 'user-a')).toBeNull();
  });

  it('account switching and reconciliation never delete or rebind content', () => {
    const before = useRoadWalletStore.getState().documents.map((d) => [d.id, d.accountOwnerId]);
    useRoadWalletStore.getState().reconcileCloudStatuses(ctx({ userId: 'user-b' }));
    useRoadWalletStore.getState().reconcileCloudStatuses(ctx({ userId: null }));
    useRoadWalletStore.getState().reconcileCloudStatuses(ctx({ tier: 'free' }));
    const after = useRoadWalletStore.getState().documents.map((d) => [d.id, d.accountOwnerId]);
    expect(after).toEqual(before);
    expect(useRoadWalletStore.getState().documents).toHaveLength(3);
  });

  it('reconciles cloud status per owner under cloudDocumentBackup, never claiming unowned content', () => {
    expect(ROAD_WALLET_CLOUD_CAPABILITY).toBe('cloudDocumentBackup');
    useRoadWalletStore
      .getState()
      .reconcileCloudStatuses(ctx({ userId: 'user-a', tier: 'driver_pro' }));
    const byId = (id: string) => useRoadWalletStore.getState().documents.find((d) => d.id === id)!;
    expect(byId(DOC_A).cloudStatus).toBe('pending_sync');
    expect(byId(DOC_B).cloudStatus).toBe('local_only');
    expect(byId(DOC_ANON).cloudStatus).toBe('local_only');

    useRoadWalletStore.getState().reconcileCloudStatuses(ctx({ userId: 'user-a', tier: 'free' }));
    expect(byId(DOC_A).cloudStatus).toBe('local_only');

    useRoadWalletStore.getState().setDocumentCloudStatus(DOC_A, 'synced');
    useRoadWalletStore.getState().reconcileCloudStatuses(ctx({ userId: null }));
    expect(byId(DOC_A).cloudStatus).toBe('synced');
  });
});
