import { CloudSyncContext, newOpaqueId, sha256Hex } from '@/domain';
import {
  normalizeRoadWalletState,
  selectRoadWalletSummary,
  useRoadWalletStore,
} from '@/store/roadWallet';

import { MemoryDocumentFileStore, reverifyDocumentFile } from '../documentFiles';
import {
  __readinessInFlightKeys,
  createOperationalDocumentFromFile,
  readinessSessionKey,
  refreshDocumentReadiness,
  refreshRoadWalletReadinessForSession,
  replaceOperationalDocumentFile,
  RoadWalletDeps,
  shareOperationalDocumentVersion,
} from '../roadWallet';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 1, 2, 3, 4]);
const JPEG2 = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 0x10, 0x45, 0x78, 0x69, 0x66, 9, 9, 9]);
const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
const EMPTY = new Uint8Array([]);

let fileStore: MemoryDocumentFileStore;
let idCounter: number;
const ids: string[] = [];

const nextId = () => {
  idCounter++;
  const seed = idCounter;
  const id = newOpaqueId(
    () => new Uint8Array(Array.from({ length: 16 }, (_, i) => (i * 37 + seed * 11) & 0xff)),
  );
  ids.push(id);
  return id;
};

const deps = (ctx: Partial<CloudSyncContext> = {}): RoadWalletDeps => ({
  fileStore,
  ctx: () => ({ userId: 'user-a', tier: 'free', supabaseConfigured: true, ...ctx }),
  now: () => 1_000,
  newId: nextId,
});

beforeEach(() => {
  useRoadWalletStore.getState().clear();
  fileStore = new MemoryDocumentFileStore();
  fileStore.addSource('file:///tmp/picker/cab-card.jpg', JPEG, 'image/jpeg');
  fileStore.addSource('file:///tmp/picker/cab-card-2.jpg', JPEG2, 'image/jpeg');
  fileStore.addSource('file:///tmp/picker/coi.pdf', PDF, 'application/pdf');
  fileStore.addSource('file:///tmp/picker/empty.jpg', EMPTY, 'image/jpeg');
  fileStore.addSource('file:///tmp/picker/fake.jpg', PDF, 'image/jpeg');
  idCounter = 0;
  ids.length = 0;
});

describe('createOperationalDocumentFromFile', () => {
  it('creates a logical document + version 1 with verified immutable evidence and no filename', async () => {
    const { document, version } = await createOperationalDocumentFromFile(
      { uri: 'file:///tmp/picker/cab-card.jpg', mimeType: 'image/jpeg', name: 'Jane Doe CDL.jpg' },
      { documentKind: 'VEHICLE_REGISTRATION', title: 'Cab card', expiresAt: '2027-01-31' },
      deps(),
    );
    expect(ids).toHaveLength(2);
    expect(document.id).toBe(ids[0]);
    expect(version.id).toBe(ids[1]);
    expect(document).toMatchObject({
      accountOwnerId: 'user-a',
      documentKind: 'VEHICLE_REGISTRATION',
      subjectKind: 'TRUCK',
      sensitivity: 'STANDARD',
      offlinePinned: true,
      lifecycle: 'ACTIVE',
      cloudStatus: 'local_only', // Free tier
      createdAt: 1_000,
    });
    expect(version).toMatchObject({
      operationalDocumentId: document.id,
      accountOwnerId: 'user-a',
      versionNumber: 1,
      supersedesVersionId: null,
      fileKind: 'IMAGE',
      mimeType: 'image/jpeg',
      extension: 'jpg',
      byteSize: JPEG.length,
      sha256: sha256Hex(JPEG),
      relativePath: `road-wallet/${document.id}/${version.id}.jpg`,
      cloudStatus: 'local_only',
      remoteStorageBucket: null,
      remoteStoragePath: null,
    });
    expect(version.fileCache.state).toBe('READY');
    expect(JSON.stringify(version)).not.toContain('Jane');
    expect(JSON.stringify(document)).not.toContain('Jane');
    expect(Object.keys(document)).not.toContain('relativePath');

    const s = useRoadWalletStore.getState();
    expect(s.documents).toHaveLength(1);
    expect(s.versions).toHaveLength(1);
    expect(await fileStore.exists(version.relativePath)).toBe(true);
  });

  it('applies sensitivity + offlinePinned defaults per kind and lets the caller override', async () => {
    const w9 = await createOperationalDocumentFromFile(
      { uri: 'file:///tmp/picker/coi.pdf', mimeType: 'application/pdf' },
      { documentKind: 'W9', title: 'W-9' },
      deps(),
    );
    expect(w9.document.sensitivity).toBe('FINANCIAL_SENSITIVE');
    expect(w9.document.offlinePinned).toBe(false);
    expect(w9.version.fileKind).toBe('PDF');
    // offlinePinned=false must not remove the only durable copy.
    expect(await fileStore.exists(w9.version.relativePath)).toBe(true);

    const cdl = await createOperationalDocumentFromFile(
      { uri: 'file:///tmp/picker/cab-card.jpg', mimeType: 'image/jpeg' },
      { documentKind: 'CDL', title: 'CDL', offlinePinned: false, maskedReference: '****4567' },
      deps(),
    );
    expect(cdl.document.sensitivity).toBe('PERSONAL_SENSITIVE');
    expect(cdl.document.offlinePinned).toBe(false);
    expect(cdl.document.maskedReference).toBe('****4567');
  });

  it('binds to the signed-in user and marks pending_sync when entitled to cloudDocumentBackup', async () => {
    const { document, version } = await createOperationalDocumentFromFile(
      { uri: 'file:///tmp/picker/cab-card.jpg', mimeType: 'image/jpeg' },
      { documentKind: 'INSURANCE', title: 'Policy' },
      deps({ tier: 'driver_pro' }),
    );
    expect(document.cloudStatus).toBe('pending_sync');
    expect(version.cloudStatus).toBe('pending_sync');
    expect(document.accountOwnerId).toBe('user-a');

    const anon = await createOperationalDocumentFromFile(
      { uri: 'file:///tmp/picker/cab-card.jpg', mimeType: 'image/jpeg' },
      { documentKind: 'INSURANCE', title: 'Policy' },
      deps({ userId: null, tier: 'lifetime' }),
    );
    expect(anon.document.accountOwnerId).toBeNull();
    expect(anon.document.cloudStatus).toBe('local_only');
  });

  it('a failed import (empty file / content mismatch) creates no document, no version, no file', async () => {
    await expect(
      createOperationalDocumentFromFile(
        { uri: 'file:///tmp/picker/empty.jpg', mimeType: 'image/jpeg' },
        { documentKind: 'INSURANCE', title: 'Policy' },
        deps(),
      ),
    ).rejects.toThrow(/EMPTY/);
    await expect(
      createOperationalDocumentFromFile(
        { uri: 'file:///tmp/picker/fake.jpg', mimeType: 'image/jpeg' },
        { documentKind: 'INSURANCE', title: 'Policy' },
        deps(),
      ),
    ).rejects.toThrow(/CONTENT_MISMATCH/);
    const s = useRoadWalletStore.getState();
    expect(s.documents).toHaveLength(0);
    expect(s.versions).toHaveLength(0);
    for (const id of ids) expect(await fileStore.exists(`road-wallet/${id}`)).toBe(false);
  });

  it('a failed store commit after the copy removes the orphan file and creates no records', async () => {
    await expect(
      createOperationalDocumentFromFile(
        { uri: 'file:///tmp/picker/cab-card.jpg', mimeType: 'image/jpeg' },
        { documentKind: 'INSURANCE', title: 'Policy', maskedReference: 'RAW-POLICY-88812' },
        deps(),
      ),
    ).rejects.toThrow(/masked/);
    const s = useRoadWalletStore.getState();
    expect(s.documents).toHaveLength(0);
    expect(s.versions).toHaveLength(0);
    expect(await fileStore.exists(`road-wallet/${ids[0]}/${ids[1]}.jpg`)).toBe(false);
  });
});

describe('H4 — truck association in orchestration', () => {
  const src = { uri: 'file:///tmp/picker/cab-card.jpg', mimeType: 'image/jpeg' };

  it('accepts a same-owner truck and a null truck', async () => {
    const same = await createOperationalDocumentFromFile(
      src,
      {
        documentKind: 'VEHICLE_REGISTRATION',
        title: 'Cab card',
        truck: { id: 'truck-1', ownerId: 'user-a' },
      },
      deps(),
    );
    expect(same.document.truckId).toBe('truck-1');
    const none = await createOperationalDocumentFromFile(
      src,
      { documentKind: 'VEHICLE_REGISTRATION', title: 'Cab card', truck: null },
      deps(),
    );
    expect(none.document.truckId).toBeNull();
  });

  it('rejects another owner’s truck before any file is copied', async () => {
    await expect(
      createOperationalDocumentFromFile(
        src,
        {
          documentKind: 'VEHICLE_REGISTRATION',
          title: 'Cab card',
          truck: { id: 'truck-9', ownerId: 'user-b' },
        },
        deps(),
      ),
    ).rejects.toThrow(/same account/);
    expect(useRoadWalletStore.getState().documents).toHaveLength(0);
    expect(ids).toHaveLength(2); // ids were minted but no file was imported
    expect(await fileStore.exists(`road-wallet/${ids[0]}/${ids[1]}.jpg`)).toBe(false);
  });
});

describe('H5 — sensitivity is fixed for known kinds at creation', () => {
  const src = { uri: 'file:///tmp/picker/coi.pdf', mimeType: 'application/pdf' };

  it('ignores a caller-supplied downgrade for a known kind and keeps configurable kinds configurable', async () => {
    const w9 = await createOperationalDocumentFromFile(
      src,
      { documentKind: 'W9', title: 'W-9', sensitivity: 'STANDARD' },
      deps(),
    );
    expect(w9.document.sensitivity).toBe('FINANCIAL_SENSITIVE');
    const cdl = await createOperationalDocumentFromFile(
      { uri: 'file:///tmp/picker/cab-card.jpg', mimeType: 'image/jpeg' },
      { documentKind: 'CDL', title: 'CDL', sensitivity: 'FINANCIAL_SENSITIVE' },
      deps(),
    );
    expect(cdl.document.sensitivity).toBe('PERSONAL_SENSITIVE');
    const custom = await createOperationalDocumentFromFile(
      src,
      { documentKind: 'CUSTOM', title: 'Fuel card agreement', sensitivity: 'FINANCIAL_SENSITIVE' },
      deps(),
    );
    expect(custom.document.sensitivity).toBe('FINANCIAL_SENSITIVE');
  });
});

describe('H2 — rehydrated versions require fresh physical verification', () => {
  const rehydrate = () => {
    const snapshot = JSON.parse(JSON.stringify(useRoadWalletStore.getState()));
    return normalizeRoadWalletState(snapshot);
  };

  it('persisted READY + file present but not yet re-verified → NOT_CACHED; fresh reverify → READY', async () => {
    const { version } = await createOperationalDocumentFromFile(
      { uri: 'file:///tmp/picker/cab-card.jpg', mimeType: 'image/jpeg' },
      { documentKind: 'VEHICLE_REGISTRATION', title: 'Cab card' },
      deps(),
    );
    expect(version.fileCache.state).toBe('READY');

    const restored = rehydrate().versions[0];
    expect(restored.fileCache.state).toBe('NOT_CACHED');
    expect(restored.fileCache).toMatchObject({
      relativePath: version.relativePath,
      sha256: version.sha256,
      byteSize: version.byteSize,
      mimeType: 'image/jpeg',
    });

    const verified = await reverifyDocumentFile(fileStore, restored.fileCache, restored.fileKind);
    expect(verified.state).toBe('READY');
    expect(verified.sha256).toBe(version.sha256);
  });

  it('persisted READY + physical file missing → never READY', async () => {
    const { version } = await createOperationalDocumentFromFile(
      { uri: 'file:///tmp/picker/cab-card.jpg', mimeType: 'image/jpeg' },
      { documentKind: 'VEHICLE_REGISTRATION', title: 'Cab card' },
      deps(),
    );
    await fileStore.remove(version.relativePath);
    const restored = rehydrate().versions[0];
    expect(restored.fileCache.state).toBe('NOT_CACHED');
    const verified = await reverifyDocumentFile(fileStore, restored.fileCache, restored.fileKind);
    expect(verified.state).toBe('ERROR');
    expect(verified.error).toBe('MISSING');
    expect(verified.sha256).toBe(version.sha256); // evidence retained for retry/diagnosis
  });

  it('persisted READY + changed bytes → never READY (hash mismatch against immutable evidence)', async () => {
    const { version } = await createOperationalDocumentFromFile(
      { uri: 'file:///tmp/picker/cab-card.jpg', mimeType: 'image/jpeg' },
      { documentKind: 'VEHICLE_REGISTRATION', title: 'Cab card' },
      deps(),
    );
    fileStore.overwrite(version.relativePath, JPEG2);
    const restored = rehydrate().versions[0];
    const verified = await reverifyDocumentFile(fileStore, restored.fileCache, restored.fileKind);
    expect(verified.state).toBe('ERROR');
    expect(verified.error).toBe('HASH_MISMATCH');
    expect(restored.sha256).toBe(version.sha256);
  });
});

describe('refreshRoadWalletReadinessForSession (Pass 1B §3)', () => {
  const refreshDeps = () => ({ fileStore, now: () => 9_000 });

  const rehydrateStore = () => {
    const snapshot = JSON.parse(JSON.stringify(useRoadWalletStore.getState()));
    useRoadWalletStore.setState(normalizeRoadWalletState(snapshot));
  };

  it('rehydrated NOT_CACHED → refresh → READY; summary counts only current-runtime READY', async () => {
    await createOperationalDocumentFromFile(
      { uri: 'file:///tmp/picker/cab-card.jpg', mimeType: 'image/jpeg' },
      { documentKind: 'VEHICLE_REGISTRATION', title: 'Cab card' },
      deps(),
    );
    rehydrateStore();
    const before = selectRoadWalletSummary(useRoadWalletStore.getState(), 'user-a', new Date());
    expect(before).toMatchObject({ totalActive: 1, readyOffline: 0, needsFileCheck: 1 });

    const result = await refreshRoadWalletReadinessForSession('user-a', refreshDeps());
    expect(result).toEqual({ checked: 1, ready: 1, errored: 0 });
    const after = selectRoadWalletSummary(useRoadWalletStore.getState(), 'user-a', new Date());
    expect(after).toMatchObject({ readyOffline: 1, needsFileCheck: 0 });
    expect(useRoadWalletStore.getState().versions[0].fileCache).toMatchObject({
      state: 'READY',
      verifiedAt: 9_000,
    });
  });

  it('missing → ERROR/MISSING and tampered → ERROR/HASH_MISMATCH; immutable hash untouched, no new version', async () => {
    const a = await createOperationalDocumentFromFile(
      { uri: 'file:///tmp/picker/cab-card.jpg', mimeType: 'image/jpeg' },
      { documentKind: 'VEHICLE_REGISTRATION', title: 'A' },
      deps(),
    );
    const b = await createOperationalDocumentFromFile(
      { uri: 'file:///tmp/picker/cab-card-2.jpg', mimeType: 'image/jpeg' },
      { documentKind: 'INSURANCE', title: 'B' },
      deps(),
    );
    await fileStore.remove(a.version.relativePath);
    fileStore.overwrite(b.version.relativePath, JPEG);
    rehydrateStore();

    const result = await refreshRoadWalletReadinessForSession('user-a', refreshDeps());
    expect(result).toEqual({ checked: 2, ready: 0, errored: 2 });
    const va = useRoadWalletStore.getState().versions.find((v) => v.id === a.version.id)!;
    const vb = useRoadWalletStore.getState().versions.find((v) => v.id === b.version.id)!;
    expect(va.fileCache).toMatchObject({ state: 'ERROR', error: 'MISSING' });
    expect(vb.fileCache).toMatchObject({ state: 'ERROR', error: 'HASH_MISMATCH' });
    expect(vb.sha256).toBe(b.version.sha256);
    expect(useRoadWalletStore.getState().versions).toHaveLength(2);
  });

  it('skips archived and other-session documents; coalesces concurrent refreshes', async () => {
    const mine = await createOperationalDocumentFromFile(
      { uri: 'file:///tmp/picker/cab-card.jpg', mimeType: 'image/jpeg' },
      { documentKind: 'VEHICLE_REGISTRATION', title: 'Mine' },
      deps(),
    );
    const archived = await createOperationalDocumentFromFile(
      { uri: 'file:///tmp/picker/cab-card-2.jpg', mimeType: 'image/jpeg' },
      { documentKind: 'INSURANCE', title: 'Old' },
      deps(),
    );
    useRoadWalletStore.getState().archiveDocument(archived.document.id, deps().ctx());
    const other = await createOperationalDocumentFromFile(
      { uri: 'file:///tmp/picker/coi.pdf', mimeType: 'application/pdf' },
      { documentKind: 'CERTIFICATE_OF_INSURANCE', title: 'Other' },
      deps({ userId: 'user-b' }),
    );
    rehydrateStore();

    const [r1, r2] = await Promise.all([
      refreshRoadWalletReadinessForSession('user-a', refreshDeps()),
      refreshRoadWalletReadinessForSession('user-a', refreshDeps()),
    ]);
    expect(r1).toBe(r2); // same coalesced result object
    expect(r1).toEqual({ checked: 1, ready: 1, errored: 0 });
    const s = useRoadWalletStore.getState();
    expect(s.versions.find((v) => v.id === mine.version.id)?.fileCache.state).toBe('READY');
    expect(s.versions.find((v) => v.id === archived.version.id)?.fileCache.state).toBe(
      'NOT_CACHED',
    );
    expect(s.versions.find((v) => v.id === other.version.id)?.fileCache.state).toBe('NOT_CACHED');
    expect(selectRoadWalletSummary(s, 'user-a', new Date())).toMatchObject({
      totalActive: 1,
      readyOffline: 1,
      archived: 1,
    });
  });
});

describe('R11 — session-keyed readiness coalescing', () => {
  it('User A and User B refreshes never share an in-flight promise, only touch their own docs, and clean up', async () => {
    const a = await createOperationalDocumentFromFile(
      { uri: 'file:///tmp/picker/cab-card.jpg', mimeType: 'image/jpeg' },
      { documentKind: 'VEHICLE_REGISTRATION', title: 'A' },
      deps({ userId: 'user-a' }),
    );
    const b = await createOperationalDocumentFromFile(
      { uri: 'file:///tmp/picker/cab-card-2.jpg', mimeType: 'image/jpeg' },
      { documentKind: 'VEHICLE_REGISTRATION', title: 'B' },
      deps({ userId: 'user-b' }),
    );
    const anon = await createOperationalDocumentFromFile(
      { uri: 'file:///tmp/picker/coi.pdf', mimeType: 'application/pdf' },
      { documentKind: 'CERTIFICATE_OF_INSURANCE', title: 'Anon' },
      deps({ userId: null }),
    );
    useRoadWalletStore.setState(
      normalizeRoadWalletState(JSON.parse(JSON.stringify(useRoadWalletStore.getState()))),
    );

    const pa = refreshRoadWalletReadinessForSession('user-a', { fileStore, now: () => 1 });
    const pb = refreshRoadWalletReadinessForSession('user-b', { fileStore, now: () => 1 });
    const pDevice = refreshRoadWalletReadinessForSession(null, { fileStore, now: () => 1 });
    expect(pa).not.toBe(pb);
    expect(pa).not.toBe(pDevice);
    expect(refreshRoadWalletReadinessForSession('user-a', { fileStore, now: () => 1 })).toBe(pa);
    expect(__readinessInFlightKeys().sort()).toEqual(
      [readinessSessionKey(null), 'user-a', 'user-b'].sort(),
    );

    const [ra, rb, rd] = await Promise.all([pa, pb, pDevice]);
    expect(ra).toEqual({ checked: 1, ready: 1, errored: 0 });
    expect(rb).toEqual({ checked: 1, ready: 1, errored: 0 });
    expect(rd).toEqual({ checked: 1, ready: 1, errored: 0 });
    expect(__readinessInFlightKeys()).toEqual([]);
    const s = useRoadWalletStore.getState();
    for (const id of [a.version.id, b.version.id, anon.version.id]) {
      expect(s.versions.find((v) => v.id === id)?.fileCache.state).toBe('READY');
    }
  });

  it("User B's refresh does not verify User A's files", async () => {
    const a = await createOperationalDocumentFromFile(
      { uri: 'file:///tmp/picker/cab-card.jpg', mimeType: 'image/jpeg' },
      { documentKind: 'VEHICLE_REGISTRATION', title: 'A' },
      deps({ userId: 'user-a' }),
    );
    useRoadWalletStore.setState(
      normalizeRoadWalletState(JSON.parse(JSON.stringify(useRoadWalletStore.getState()))),
    );
    const rb = await refreshRoadWalletReadinessForSession('user-b', { fileStore, now: () => 1 });
    expect(rb).toEqual({ checked: 0, ready: 0, errored: 0 });
    expect(
      useRoadWalletStore.getState().versions.find((v) => v.id === a.version.id)?.fileCache.state,
    ).toBe('NOT_CACHED');
  });
});

describe('R12 — account-scoped detail readiness', () => {
  const rehydrate = () =>
    useRoadWalletStore.setState(
      normalizeRoadWalletState(JSON.parse(JSON.stringify(useRoadWalletStore.getState()))),
    );
  const readinessDeps = (userId: string | null) => ({
    fileStore,
    now: () => 2,
    ctx: () => ({ userId, tier: 'free' as const, supabaseConfigured: true }),
  });

  it('User A document under User A → verified; under User B → denied with no file read', async () => {
    const a = await createOperationalDocumentFromFile(
      { uri: 'file:///tmp/picker/cab-card.jpg', mimeType: 'image/jpeg' },
      { documentKind: 'VEHICLE_REGISTRATION', title: 'A' },
      deps({ userId: 'user-a' }),
    );
    rehydrate();
    const spy = jest.spyOn(fileStore, 'verify');
    expect(await refreshDocumentReadiness(a.document.id, readinessDeps('user-b'))).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    expect(useRoadWalletStore.getState().versions[0].fileCache.state).toBe('NOT_CACHED');
    expect((await refreshDocumentReadiness(a.document.id, readinessDeps('user-a')))?.state).toBe(
      'READY',
    );
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('unowned document: allowed signed out, denied signed in; unknown id → null', async () => {
    const anon = await createOperationalDocumentFromFile(
      { uri: 'file:///tmp/picker/coi.pdf', mimeType: 'application/pdf' },
      { documentKind: 'CERTIFICATE_OF_INSURANCE', title: 'Anon' },
      deps({ userId: null }),
    );
    rehydrate();
    expect(await refreshDocumentReadiness(anon.document.id, readinessDeps('user-a'))).toBeNull();
    expect((await refreshDocumentReadiness(anon.document.id, readinessDeps(null)))?.state).toBe(
      'READY',
    );
    expect(await refreshDocumentReadiness('unknown', readinessDeps(null))).toBeNull();
  });
});

describe('shareOperationalDocumentVersion (Pass 1B §15–§18)', () => {
  type Tier = 'free' | 'driver_pro' | 'owner_operator' | 'fleet_lite' | 'lifetime';
  const shareDeps = (
    over: { userId?: string | null; tier?: Tier } = {},
    beforeShare?: () => void,
  ) => {
    const ctx = { userId: 'user-a' as string | null, tier: 'driver_pro' as Tier, ...over };
    return {
      fileStore,
      now: () => 9_000,
      ctx: () => ({ userId: ctx.userId, tier: ctx.tier, supabaseConfigured: true }),
      beforeShare,
      set(next: Partial<typeof ctx>) {
        Object.assign(ctx, next);
      },
    };
  };
  const createStandard = () =>
    createOperationalDocumentFromFile(
      { uri: 'file:///tmp/picker/cab-card.jpg', mimeType: 'image/jpeg' },
      { documentKind: 'VEHICLE_REGISTRATION', title: 'Cab card' },
      deps({ tier: 'driver_pro' }),
    );

  it('Free is denied at the effect boundary (not just the button); Driver Pro and Lifetime succeed', async () => {
    const { document, version } = await createStandard();
    await expect(
      shareOperationalDocumentVersion(
        { documentId: document.id, sensitiveConfirmation: 'NONE' },
        shareDeps({ tier: 'free' }),
      ),
    ).rejects.toMatchObject({ reason: 'NOT_ENTITLED' });
    expect(fileStore.shared).toHaveLength(0);

    await shareOperationalDocumentVersion(
      { documentId: document.id, sensitiveConfirmation: 'NONE' },
      shareDeps({ tier: 'driver_pro' }),
    );
    await shareOperationalDocumentVersion(
      { documentId: document.id, sensitiveConfirmation: 'NONE' },
      shareDeps({ tier: 'lifetime' }),
    );
    expect(fileStore.shared).toEqual([
      { relativePath: version.relativePath, mimeType: 'image/jpeg' },
      { relativePath: version.relativePath, mimeType: 'image/jpeg' },
    ]);
  });

  it('wrong account, unknown document and archived documents are denied', async () => {
    const { document } = await createStandard();
    await expect(
      shareOperationalDocumentVersion(
        { documentId: document.id, sensitiveConfirmation: 'NONE' },
        shareDeps({ userId: 'user-b' }),
      ),
    ).rejects.toMatchObject({ reason: 'NOT_VISIBLE' });
    await expect(
      shareOperationalDocumentVersion(
        { documentId: 'nope', sensitiveConfirmation: 'NONE' },
        shareDeps(),
      ),
    ).rejects.toMatchObject({ reason: 'NOT_FOUND' });
    useRoadWalletStore.getState().archiveDocument(document.id, shareDeps().ctx());
    await expect(
      shareOperationalDocumentVersion(
        { documentId: document.id, sensitiveConfirmation: 'NONE' },
        shareDeps(),
      ),
    ).rejects.toMatchObject({ reason: 'ARCHIVED' });
    expect(fileStore.shared).toHaveLength(0);
  });

  it('re-verifies the physical file first: missing, changed hash and content mismatch never open the sheet', async () => {
    const { document, version } = await createStandard();
    fileStore.overwrite(version.relativePath, JPEG2); // same kind, different bytes
    await expect(
      shareOperationalDocumentVersion(
        { documentId: document.id, sensitiveConfirmation: 'NONE' },
        shareDeps(),
      ),
    ).rejects.toMatchObject({ reason: 'FILE_UNAVAILABLE', fileError: 'HASH_MISMATCH' });

    fileStore.overwrite(version.relativePath, PDF); // wrong kind entirely
    await expect(
      shareOperationalDocumentVersion(
        { documentId: document.id, sensitiveConfirmation: 'NONE' },
        shareDeps(),
      ),
    ).rejects.toMatchObject({ reason: 'FILE_UNAVAILABLE', fileError: 'CONTENT_MISMATCH' });

    await fileStore.remove(version.relativePath);
    await expect(
      shareOperationalDocumentVersion(
        { documentId: document.id, sensitiveConfirmation: 'NONE' },
        shareDeps(),
      ),
    ).rejects.toMatchObject({ reason: 'FILE_UNAVAILABLE', fileError: 'MISSING' });

    expect(fileStore.shared).toHaveLength(0);
    const v = useRoadWalletStore.getState().versions[0];
    expect(v.fileCache.state).toBe('ERROR');
    expect(v.sha256).toBe(version.sha256); // never recomputed
  });

  it('a successful share records fresh READY verification and re-checks owner/entitlement immediately before the effect', async () => {
    const { document, version } = await createStandard();
    useRoadWalletStore.getState().setVersionFileCache(version.id, {
      ...version.fileCache,
      state: 'NOT_CACHED',
      verifiedAt: null,
    });

    const ok = shareDeps();
    await shareOperationalDocumentVersion(
      { documentId: document.id, sensitiveConfirmation: 'NONE' },
      ok,
    );
    expect(useRoadWalletStore.getState().versions[0].fileCache).toMatchObject({
      state: 'READY',
      verifiedAt: 9_000,
    });
    expect(fileStore.shared).toHaveLength(1);

    // Entitlement lapses between verification and the share effect.
    const lapsing = shareDeps();
    lapsing.beforeShare = () => lapsing.set({ tier: 'free' });
    await expect(
      shareOperationalDocumentVersion(
        { documentId: document.id, sensitiveConfirmation: 'NONE' },
        lapsing,
      ),
    ).rejects.toMatchObject({ reason: 'NOT_ENTITLED' });
    // Account switches between verification and the share effect.
    const switching = shareDeps();
    switching.beforeShare = () => switching.set({ userId: 'user-b' });
    await expect(
      shareOperationalDocumentVersion(
        { documentId: document.id, sensitiveConfirmation: 'NONE' },
        switching,
      ),
    ).rejects.toMatchObject({ reason: 'NOT_VISIBLE' });
    expect(fileStore.shared).toHaveLength(1);
  });

  it('PERSONAL requires acknowledgement, FINANCIAL requires the stronger one, STANDARD needs none', async () => {
    const cdl = await createOperationalDocumentFromFile(
      { uri: 'file:///tmp/picker/cab-card-2.jpg', mimeType: 'image/jpeg' },
      { documentKind: 'CDL', title: 'CDL' },
      deps({ tier: 'driver_pro' }),
    );
    await expect(
      shareOperationalDocumentVersion(
        { documentId: cdl.document.id, sensitiveConfirmation: 'NONE' },
        shareDeps(),
      ),
    ).rejects.toMatchObject({ reason: 'CONFIRMATION_REQUIRED' });
    await shareOperationalDocumentVersion(
      { documentId: cdl.document.id, sensitiveConfirmation: 'PERSONAL_ACKNOWLEDGED' },
      shareDeps(),
    );

    const w9 = await createOperationalDocumentFromFile(
      { uri: 'file:///tmp/picker/coi.pdf', mimeType: 'application/pdf' },
      { documentKind: 'W9', title: 'W-9' },
      deps({ tier: 'driver_pro' }),
    );
    await expect(
      shareOperationalDocumentVersion(
        { documentId: w9.document.id, sensitiveConfirmation: 'PERSONAL_ACKNOWLEDGED' },
        shareDeps(),
      ),
    ).rejects.toMatchObject({ reason: 'CONFIRMATION_REQUIRED' });
    await shareOperationalDocumentVersion(
      { documentId: w9.document.id, sensitiveConfirmation: 'FINANCIAL_ACKNOWLEDGED' },
      shareDeps(),
    );
    // PDF goes through Share/Export only, as a PDF.
    expect(fileStore.shared.at(-1)).toEqual({
      relativePath: w9.version.relativePath,
      mimeType: 'application/pdf',
    });
    expect(fileStore.shared).toHaveLength(2);
  });

  it('R13: re-reads the LIVE store before sharing — archive during verification denies', async () => {
    const { document } = await createStandard();
    const d = shareDeps();
    d.beforeShare = () => useRoadWalletStore.getState().archiveDocument(document.id, d.ctx());
    await expect(
      shareOperationalDocumentVersion(
        { documentId: document.id, sensitiveConfirmation: 'NONE' },
        d,
      ),
    ).rejects.toMatchObject({ reason: 'ARCHIVED' });
    expect(fileStore.shared).toHaveLength(0);
  });

  it('R13: sensitivity raised during verification requires the stronger CURRENT acknowledgement', async () => {
    const custom = await createOperationalDocumentFromFile(
      { uri: 'file:///tmp/picker/coi.pdf', mimeType: 'application/pdf' },
      { documentKind: 'CUSTOM', title: 'Agreement', sensitivity: 'STANDARD' },
      deps({ tier: 'driver_pro' }),
    );
    const d = shareDeps();
    d.beforeShare = () =>
      useRoadWalletStore
        .getState()
        .updateDocumentMetadata(
          custom.document.id,
          { sensitivity: 'FINANCIAL_SENSITIVE' },
          d.ctx(),
        );
    await expect(
      shareOperationalDocumentVersion(
        { documentId: custom.document.id, sensitiveConfirmation: 'NONE' },
        d,
      ),
    ).rejects.toMatchObject({ reason: 'CONFIRMATION_REQUIRED' });
    // An earlier PERSONAL acknowledgement is not enough once the class became FINANCIAL.
    const d2 = shareDeps();
    d2.beforeShare = () =>
      useRoadWalletStore
        .getState()
        .updateDocumentMetadata(
          custom.document.id,
          { sensitivity: 'FINANCIAL_SENSITIVE' },
          d2.ctx(),
        );
    useRoadWalletStore
      .getState()
      .updateDocumentMetadata(custom.document.id, { sensitivity: 'PERSONAL_SENSITIVE' }, d2.ctx());
    await expect(
      shareOperationalDocumentVersion(
        { documentId: custom.document.id, sensitiveConfirmation: 'PERSONAL_ACKNOWLEDGED' },
        d2,
      ),
    ).rejects.toMatchObject({ reason: 'CONFIRMATION_REQUIRED' });
    expect(fileStore.shared).toHaveLength(0);
    // With the stronger acknowledgement the share proceeds.
    await shareOperationalDocumentVersion(
      { documentId: custom.document.id, sensitiveConfirmation: 'FINANCIAL_ACKNOWLEDGED' },
      shareDeps(),
    );
    expect(fileStore.shared).toHaveLength(1);
  });

  it('denies when the platform share sheet is unavailable, and can target an explicit prior version', async () => {
    const { document, version } = await createStandard();
    fileStore.shareAvailable = false;
    await expect(
      shareOperationalDocumentVersion(
        { documentId: document.id, sensitiveConfirmation: 'NONE' },
        shareDeps(),
      ),
    ).rejects.toMatchObject({ reason: 'SHARE_UNAVAILABLE' });
    fileStore.shareAvailable = true;

    await replaceOperationalDocumentFile(
      document.id,
      { uri: 'file:///tmp/picker/cab-card-2.jpg', mimeType: 'image/jpeg' },
      deps(),
    );
    await shareOperationalDocumentVersion(
      { documentId: document.id, versionId: version.id, sensitiveConfirmation: 'NONE' },
      shareDeps(),
    );
    expect(fileStore.shared.at(-1)?.relativePath).toBe(version.relativePath);
  });
});

describe('replaceOperationalDocumentFile', () => {
  it('creates version N+1 superseding the current version and leaves v1 untouched', async () => {
    const created = await createOperationalDocumentFromFile(
      { uri: 'file:///tmp/picker/cab-card.jpg', mimeType: 'image/jpeg' },
      { documentKind: 'VEHICLE_REGISTRATION', title: 'Cab card' },
      deps(),
    );
    const v1Before = { ...created.version };

    const v2 = await replaceOperationalDocumentFile(
      created.document.id,
      { uri: 'file:///tmp/picker/cab-card-2.jpg', mimeType: 'image/jpeg', name: 'renewal.jpg' },
      deps(),
    );
    expect(v2.id).toBe(ids[2]);
    expect(v2).toMatchObject({
      operationalDocumentId: created.document.id,
      versionNumber: 2,
      supersedesVersionId: v1Before.id,
      sha256: sha256Hex(JPEG2),
      byteSize: JPEG2.length,
      relativePath: `road-wallet/${created.document.id}/${v2.id}.jpg`,
    });
    expect(v2.sha256).not.toBe(v1Before.sha256);

    const s = useRoadWalletStore.getState();
    const v1After = s.versions.find((v) => v.id === v1Before.id);
    expect(v1After).toEqual(v1Before);
    expect(await fileStore.exists(v1Before.relativePath)).toBe(true);
    expect(await fileStore.sha256(v1Before.relativePath)).toBe(v1Before.sha256);
    expect(s.versions).toHaveLength(2);
    expect(JSON.stringify(v2)).not.toContain('renewal');
  });

  it('refuses to replace a document that is not visible in this session', async () => {
    const created = await createOperationalDocumentFromFile(
      { uri: 'file:///tmp/picker/cab-card.jpg', mimeType: 'image/jpeg' },
      { documentKind: 'VEHICLE_REGISTRATION', title: 'Cab card' },
      deps(),
    );
    await expect(
      replaceOperationalDocumentFile(
        created.document.id,
        { uri: 'file:///tmp/picker/cab-card-2.jpg', mimeType: 'image/jpeg' },
        deps({ userId: 'user-b' }),
      ),
    ).rejects.toThrow(/not visible/);
    expect(useRoadWalletStore.getState().versions).toHaveLength(1);
  });

  it('a failed replacement import leaves the document on its current version', async () => {
    const created = await createOperationalDocumentFromFile(
      { uri: 'file:///tmp/picker/cab-card.jpg', mimeType: 'image/jpeg' },
      { documentKind: 'VEHICLE_REGISTRATION', title: 'Cab card' },
      deps(),
    );
    await expect(
      replaceOperationalDocumentFile(
        created.document.id,
        { uri: 'file:///tmp/picker/empty.jpg', mimeType: 'image/jpeg' },
        deps(),
      ),
    ).rejects.toThrow(/EMPTY/);
    const s = useRoadWalletStore.getState();
    expect(s.versions).toHaveLength(1);
    expect(s.versions[0].id).toBe(created.version.id);
  });
});
