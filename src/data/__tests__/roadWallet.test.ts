import { CloudSyncContext, newOpaqueId, sha256Hex } from '@/domain';
import { normalizeRoadWalletState, useRoadWalletStore } from '@/store/roadWallet';

import { MemoryDocumentFileStore, reverifyDocumentFile } from '../documentFiles';
import {
  createOperationalDocumentFromFile,
  replaceOperationalDocumentFile,
  RoadWalletDeps,
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
