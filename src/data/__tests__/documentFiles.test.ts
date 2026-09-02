import { notCached, sha256Hex } from '@/domain';

import {
  cacheDocumentFile,
  DocumentFileStore,
  ExpoDocumentFileStore,
  MemoryDocumentFileStore,
  reverifyDocumentFile,
  verifyBytes,
} from '../documentFiles';

const DOC = 'doc_Ab12Cd34Ef56Gh78';
const VER = 'ver_Zz98Yy87Xx76Ww65';
const VER2 = 'ver_Qq11Rr22Ss33Tt44';

const JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 1, 2, 3, 4,
]);
const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
const EMPTY = new Uint8Array([]);

let store: MemoryDocumentFileStore;

beforeEach(() => {
  store = new MemoryDocumentFileStore();
  store.addSource('file:///tmp/picker/scan.jpg', JPEG, 'image/jpeg');
  store.addSource('file:///tmp/picker/coi.pdf', PDF, 'application/pdf');
  store.addSource('file:///tmp/picker/empty.jpg', EMPTY, 'image/jpeg');
  store.addSource('file:///tmp/picker/mislabelled.jpg', PDF, 'image/jpeg');
});

describe('verifyBytes', () => {
  it('rejects missing and zero-byte files before hashing', () => {
    expect(verifyBytes(null)).toEqual({ ok: false, reason: 'MISSING' });
    expect(verifyBytes(EMPTY)).toEqual({ ok: false, reason: 'EMPTY' });
  });

  it('verifies real bytes with size, stable hash and sniffed kind', () => {
    const v = verifyBytes(JPEG, { expectedKind: 'IMAGE' });
    expect(v).toEqual({ ok: true, byteSize: JPEG.length, sha256: sha256Hex(JPEG), kind: 'IMAGE' });
  });

  it('flags content that does not match the declared kind', () => {
    expect(verifyBytes(PDF, { expectedKind: 'IMAGE' })).toEqual({
      ok: false,
      reason: 'CONTENT_MISMATCH',
    });
    expect(verifyBytes(JPEG, { expectedKind: 'PDF' })).toEqual({
      ok: false,
      reason: 'CONTENT_MISMATCH',
    });
  });

  it('flags a hash mismatch and a failing hasher', () => {
    expect(verifyBytes(JPEG, { expectedSha256: 'f'.repeat(64) })).toEqual({
      ok: false,
      reason: 'HASH_MISMATCH',
    });
    expect(
      verifyBytes(JPEG, {}, () => {
        throw new Error('no digest');
      }),
    ).toEqual({ ok: false, reason: 'HASH_FAILED' });
  });
});

describe('MemoryDocumentFileStore', () => {
  it('imports into the opaque private path and returns exact metadata', async () => {
    const stored = await store.importFile(
      { uri: 'file:///tmp/picker/scan.jpg', mimeType: 'image/jpeg', name: 'John Smith CDL.jpg' },
      { documentId: DOC, versionId: VER },
    );
    expect(stored.relativePath).toBe(`road-wallet/${DOC}/${VER}.jpg`);
    expect(stored.uri).toBe(`memory:///documents/road-wallet/${DOC}/${VER}.jpg`);
    expect(stored).toMatchObject({
      ext: 'jpg',
      mimeType: 'image/jpeg',
      kind: 'IMAGE',
      byteSize: JPEG.length,
      sha256: sha256Hex(JPEG),
    });
    // The original filename never reaches the stored path.
    expect(stored.relativePath).not.toContain('John');
    expect(stored.uri).not.toContain('CDL');
  });

  it('stores a PDF as a PDF (not coerced to an image)', async () => {
    const stored = await store.importFile(
      { uri: 'file:///tmp/picker/coi.pdf', mimeType: 'application/pdf' },
      { documentId: DOC, versionId: VER },
    );
    expect(stored.ext).toBe('pdf');
    expect(stored.kind).toBe('PDF');
    expect(stored.mimeType).toBe('application/pdf');
    expect(await store.verify(stored.relativePath, { expectedKind: 'PDF' })).toMatchObject({
      ok: true,
      kind: 'PDF',
    });
  });

  it('rejects a zero-byte import and leaves nothing behind', async () => {
    await expect(
      store.importFile(
        { uri: 'file:///tmp/picker/empty.jpg', mimeType: 'image/jpeg' },
        { documentId: DOC, versionId: VER },
      ),
    ).rejects.toThrow(/EMPTY/);
    expect(await store.exists(`road-wallet/${DOC}/${VER}.jpg`)).toBe(false);
  });

  it('rejects an import whose bytes contradict the declared image type', async () => {
    await expect(
      store.importFile(
        { uri: 'file:///tmp/picker/mislabelled.jpg', mimeType: 'image/jpeg' },
        { documentId: DOC, versionId: VER },
      ),
    ).rejects.toThrow(/CONTENT_MISMATCH/);
  });

  it('rejects a missing source', async () => {
    await expect(
      store.importFile({ uri: 'file:///nope' }, { documentId: DOC, versionId: VER }),
    ).rejects.toThrow(/source not found/);
  });

  it('reports missing / unreadable files honestly', async () => {
    expect(await store.exists('road-wallet/x/y.jpg')).toBe(false);
    expect(await store.byteSize('road-wallet/x/y.jpg')).toBeNull();
    expect(await store.verify('road-wallet/x/y.jpg')).toEqual({ ok: false, reason: 'MISSING' });
    await expect(store.sha256('road-wallet/x/y.jpg')).rejects.toThrow(/missing/);

    const stored = await store.importFile(
      { uri: 'file:///tmp/picker/scan.jpg' },
      { documentId: DOC, versionId: VER },
    );
    store.unreadable.add(stored.relativePath);
    expect(await store.verify(stored.relativePath)).toEqual({ ok: false, reason: 'UNREADABLE' });
    expect(await store.byteSize(stored.relativePath)).toBeNull();
  });

  it('hashes identical bytes identically and different bytes differently', async () => {
    const a = await store.importFile(
      { uri: 'file:///tmp/picker/scan.jpg' },
      { documentId: DOC, versionId: VER },
    );
    const b = await store.importFile(
      { uri: 'file:///tmp/picker/scan.jpg' },
      { documentId: DOC, versionId: VER2 },
    );
    const c = await store.importFile(
      { uri: 'file:///tmp/picker/coi.pdf' },
      { documentId: DOC, versionId: 'ver_Uu55Vv66Ww77Xx88' },
    );
    expect(a.sha256).toBe(b.sha256);
    expect(await store.sha256(a.relativePath)).toBe(await store.sha256(b.relativePath));
    expect(a.sha256).not.toBe(c.sha256);
  });

  it('deletes a file and is a no-op when already gone', async () => {
    const stored = await store.importFile(
      { uri: 'file:///tmp/picker/scan.jpg' },
      { documentId: DOC, versionId: VER },
    );
    expect(await store.exists(stored.relativePath)).toBe(true);
    await store.remove(stored.relativePath);
    expect(await store.exists(stored.relativePath)).toBe(false);
    await expect(store.remove(stored.relativePath)).resolves.toBeUndefined();
  });

  it('exposes Share/Export only when the capability is available', async () => {
    const stored = await store.importFile(
      { uri: 'file:///tmp/picker/coi.pdf' },
      { documentId: DOC, versionId: VER },
    );
    expect(await store.shareCapability()).toEqual({ available: true });
    await store.share(stored.relativePath, { mimeType: 'application/pdf' });
    expect(store.shared).toEqual([
      { relativePath: stored.relativePath, mimeType: 'application/pdf' },
    ]);

    store.shareAvailable = false;
    expect((await store.shareCapability()).available).toBe(false);
    await expect(store.share(stored.relativePath, { mimeType: 'application/pdf' })).rejects.toThrow(
      /unavailable/,
    );
    expect(store.shared).toHaveLength(1);
  });
});

describe('store contract parity', () => {
  const REQUIRED: (keyof DocumentFileStore)[] = [
    'importFile',
    'exists',
    'byteSize',
    'verify',
    'sha256',
    'remove',
    'uriFor',
    'shareCapability',
    'share',
  ];

  it('both implementations expose every required method', () => {
    const memory = new MemoryDocumentFileStore();
    const expo = new ExpoDocumentFileStore();
    for (const m of REQUIRED) {
      expect(typeof memory[m]).toBe('function');
      expect(typeof expo[m]).toBe('function');
    }
  });
});

describe('cacheDocumentFile / reverifyDocumentFile', () => {
  it('goes NOT_CACHED -> READY only after import + verification succeed', async () => {
    const result = await cacheDocumentFile(
      store,
      notCached(),
      { uri: 'file:///tmp/picker/scan.jpg', mimeType: 'image/jpeg' },
      { documentId: DOC, versionId: VER },
      () => 1000,
    );
    expect(result.entry).toMatchObject({
      state: 'READY',
      relativePath: `road-wallet/${DOC}/${VER}.jpg`,
      mimeType: 'image/jpeg',
      byteSize: JPEG.length,
      sha256: sha256Hex(JPEG),
      error: null,
      verifiedAt: 1000,
    });
    expect(result.stored?.sha256).toBe(sha256Hex(JPEG));
  });

  it('a failed import yields ERROR (never READY) and keeps prior metadata', async () => {
    const prior = { ...notCached(), mimeType: 'image/jpeg', sha256: 'd'.repeat(64) };
    const result = await cacheDocumentFile(
      store,
      prior,
      { uri: 'file:///tmp/picker/empty.jpg', mimeType: 'image/jpeg' },
      { documentId: DOC, versionId: VER },
    );
    expect(result.entry.state).toBe('ERROR');
    expect(result.entry.error).toBe('IMPORT_FAILED');
    expect(result.entry.mimeType).toBe('image/jpeg');
    expect(result.entry.sha256).toBe('d'.repeat(64));
    expect(result.stored).toBeNull();
  });

  it('re-verification drops a READY entry to ERROR when the file goes missing or changes', async () => {
    const { entry } = await cacheDocumentFile(
      store,
      notCached(),
      { uri: 'file:///tmp/picker/scan.jpg', mimeType: 'image/jpeg' },
      { documentId: DOC, versionId: VER },
    );
    expect((await reverifyDocumentFile(store, entry, 'IMAGE')).state).toBe('READY');

    store.overwrite(entry.relativePath as string, new Uint8Array([0xff, 0xd8, 0xff, 0x00]));
    const tampered = await reverifyDocumentFile(store, entry, 'IMAGE');
    expect(tampered.state).toBe('ERROR');
    expect(tampered.error).toBe('HASH_MISMATCH');
    expect(tampered.sha256).toBe(entry.sha256);

    await store.remove(entry.relativePath as string);
    const gone = await reverifyDocumentFile(store, entry, 'IMAGE');
    expect(gone.state).toBe('ERROR');
    expect(gone.error).toBe('MISSING');
    expect(gone.relativePath).toBe(entry.relativePath);
  });

  it('an entry with no path cannot be READY', async () => {
    const e = await reverifyDocumentFile(store, notCached(), 'IMAGE');
    expect(e.state).toBe('ERROR');
    expect(e.error).toBe('MISSING');
  });
});
