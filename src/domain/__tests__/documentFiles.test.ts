import {
  contentMatchesKind,
  DOCUMENT_FILES_ROOT,
  documentFileRelativePath,
  extensionFromName,
  FILE_READINESS,
  FileVerification,
  isFileReady,
  isOpaqueId,
  markCaching,
  markError,
  markEvicted,
  markReady,
  newOpaqueId,
  notCached,
  parseDocumentFileRelativePath,
  resolveFileType,
  sniffFileKind,
  UNKNOWN_FILE_TYPE,
} from '../documentFiles';

const DOC = 'doc_Ab12Cd34Ef56Gh78';
const VER = 'ver_Zz98Yy87Xx76Ww65';

describe('readiness state machine', () => {
  it('has exactly the four states', () => {
    expect(FILE_READINESS).toEqual(['NOT_CACHED', 'CACHING', 'READY', 'ERROR']);
  });

  it('starts NOT_CACHED with no metadata and is never READY from a bare URI', () => {
    const e = notCached();
    expect(e.state).toBe('NOT_CACHED');
    expect(isFileReady(e)).toBe(false);
    const caching = markCaching(e, 'road-wallet/x/y.jpg');
    expect(caching.state).toBe('CACHING');
    expect(caching.relativePath).toBe('road-wallet/x/y.jpg');
    expect(isFileReady(caching)).toBe(false);
  });

  it('becomes READY only from a successful verification, recording size + hash', () => {
    const ok: FileVerification = {
      ok: true,
      byteSize: 1234,
      sha256: 'a'.repeat(64),
      kind: 'IMAGE',
    };
    const ready = markReady(markCaching(notCached(), 'p'), ok, 'image/jpeg', 42);
    expect(ready).toMatchObject({
      state: 'READY',
      relativePath: 'p',
      mimeType: 'image/jpeg',
      byteSize: 1234,
      sha256: 'a'.repeat(64),
      error: null,
      verifiedAt: 42,
    });
    expect(isFileReady(ready)).toBe(true);
  });

  it('a failed verification yields ERROR and does not claim READY', () => {
    const failed: FileVerification = { ok: false, reason: 'EMPTY' };
    const e = markReady(markCaching(notCached(), 'p'), failed, 'image/jpeg', 42);
    expect(e.state).toBe('ERROR');
    expect(e.error).toBe('EMPTY');
    expect(e.verifiedAt).toBeNull();
    expect(isFileReady(e)).toBe(false);
  });

  it('ERROR preserves previously known metadata (path, mime, size, hash)', () => {
    const ok: FileVerification = { ok: true, byteSize: 10, sha256: 'b'.repeat(64), kind: 'PDF' };
    const ready = markReady(
      markCaching(notCached(), 'road-wallet/d/v.pdf'),
      ok,
      'application/pdf',
      1,
    );
    const errored = markError(ready, 'MISSING');
    expect(errored).toMatchObject({
      state: 'ERROR',
      error: 'MISSING',
      relativePath: 'road-wallet/d/v.pdf',
      mimeType: 'application/pdf',
      byteSize: 10,
      sha256: 'b'.repeat(64),
      verifiedAt: null,
    });
  });

  it('eviction returns to NOT_CACHED but remembers what the file was', () => {
    const ok: FileVerification = { ok: true, byteSize: 10, sha256: 'c'.repeat(64), kind: 'PDF' };
    const ready = markReady(markCaching(notCached(), 'p'), ok, 'application/pdf', 1);
    const evicted = markEvicted(ready);
    expect(evicted.state).toBe('NOT_CACHED');
    expect(evicted.relativePath).toBeNull();
    expect(evicted.sha256).toBe('c'.repeat(64));
    expect(evicted.mimeType).toBe('application/pdf');
  });
});

describe('file typing', () => {
  it('derives extensions from names and URIs, ignoring query strings', () => {
    expect(extensionFromName('scan.JPG')).toBe('jpg');
    expect(extensionFromName('file:///tmp/a/b/insurance.pdf?x=1#frag')).toBe('pdf');
    expect(extensionFromName('content://media/1234')).toBeNull();
    expect(extensionFromName(null)).toBeNull();
  });

  it('prefers the declared MIME type, then name, then uri', () => {
    expect(resolveFileType({ mimeType: 'application/pdf', name: 'x.jpg' })).toEqual({
      ext: 'pdf',
      mimeType: 'application/pdf',
      kind: 'PDF',
    });
    expect(resolveFileType({ name: 'IMG_0001.JPEG' })).toEqual({
      ext: 'jpg',
      mimeType: 'image/jpeg',
      kind: 'IMAGE',
    });
    expect(resolveFileType({ uri: 'file:///tmp/photo.HEIC' })).toEqual({
      ext: 'heic',
      mimeType: 'image/heic',
      kind: 'IMAGE',
    });
    expect(resolveFileType({ mimeType: 'image/heif' }).ext).toBe('heic');
    expect(resolveFileType({ mimeType: 'application/x-pdf' }).kind).toBe('PDF');
  });

  it('never coerces a PDF into an image type', () => {
    expect(resolveFileType({ mimeType: 'application/pdf', uri: 'file:///a.jpg' }).kind).toBe('PDF');
    expect(resolveFileType({ name: 'statement.pdf' }).mimeType).toBe('application/pdf');
  });

  it('degrades unknown types to opaque binary instead of guessing', () => {
    expect(resolveFileType({ mimeType: 'application/msword', name: 'x.docx' })).toEqual(
      UNKNOWN_FILE_TYPE,
    );
    expect(resolveFileType({})).toEqual(UNKNOWN_FILE_TYPE);
    expect(resolveFileType({ name: 'evil.exe' }).ext).toBe('bin');
  });

  it('sniffs real content and checks it against the declared kind', () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const webp = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50,
    ]);
    const heic = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);
    expect(sniffFileKind(pdf)).toBe('PDF');
    expect(sniffFileKind(jpeg)).toBe('IMAGE');
    expect(sniffFileKind(png)).toBe('IMAGE');
    expect(sniffFileKind(webp)).toBe('IMAGE');
    expect(sniffFileKind(heic)).toBe('IMAGE');
    expect(sniffFileKind(new Uint8Array([1, 2, 3]))).toBe('UNKNOWN');
    expect(sniffFileKind(new Uint8Array([]))).toBe('UNKNOWN');

    expect(contentMatchesKind('PDF', 'PDF')).toBe(true);
    expect(contentMatchesKind('PDF', 'IMAGE')).toBe(false);
    expect(contentMatchesKind('IMAGE', 'PDF')).toBe(false);
    expect(contentMatchesKind('IMAGE', 'UNKNOWN')).toBe(false);
    expect(contentMatchesKind('OTHER', 'UNKNOWN')).toBe(true);
  });
});

describe('private path scheme', () => {
  it('builds deterministic opaque paths under road-wallet/{doc}/{version}.{ext}', () => {
    expect(DOCUMENT_FILES_ROOT).toBe('road-wallet');
    expect(documentFileRelativePath(DOC, VER, 'jpg')).toBe(`road-wallet/${DOC}/${VER}.jpg`);
    expect(documentFileRelativePath(DOC, VER, '.PDF')).toBe(`road-wallet/${DOC}/${VER}.pdf`);
    expect(documentFileRelativePath(DOC, VER, 'jpg')).toBe(
      documentFileRelativePath(DOC, VER, 'jpg'),
    );
  });

  it('round-trips through the parser', () => {
    expect(parseDocumentFileRelativePath(`road-wallet/${DOC}/${VER}.pdf`)).toEqual({
      documentId: DOC,
      versionId: VER,
      ext: 'pdf',
    });
    expect(parseDocumentFileRelativePath('receipts/x/y.jpg')).toBeNull();
    expect(parseDocumentFileRelativePath('road-wallet/John Smith/CDL.jpg')).toBeNull();
  });

  it('refuses ids that could carry sensitive or user-entered text', () => {
    const bad = [
      'John Smith',
      'CDL D1234567 TX',
      'EIN 12-3456789',
      '1HGCM82633A004352 VIN',
      'policy#889-22',
      'Acme Logistics',
      'a/b',
      '../../etc',
      'short',
      '',
    ];
    for (const id of bad) {
      expect(isOpaqueId(id)).toBe(false);
      expect(() => documentFileRelativePath(id, VER, 'jpg')).toThrow(/opaque id/);
      expect(() => documentFileRelativePath(DOC, id, 'jpg')).toThrow(/opaque id/);
    }
    expect(() => documentFileRelativePath(DOC, VER, 'jp g')).toThrow(/extension/);
    expect(() => documentFileRelativePath(DOC, VER, 'a/b')).toThrow(/extension/);
  });

  it('paths built from opaque ids contain nothing but the ids and the extension', () => {
    const path = documentFileRelativePath(DOC, VER, 'pdf');
    expect(path.replace(DOC, '').replace(VER, '')).toBe('road-wallet//.pdf');
    expect(path).not.toMatch(/\s/);
    expect(path).not.toMatch(/[@#$%&*()<>:"'\\]/);
  });

  it('generates opaque ids of the accepted shape, deterministically for a fixed byte source', () => {
    const fixed = (n: number) => new Uint8Array(Array.from({ length: n }, (_, i) => i * 7));
    const a = newOpaqueId(fixed);
    const b = newOpaqueId(fixed);
    expect(a).toBe(b);
    expect(a).toHaveLength(22);
    expect(isOpaqueId(a)).toBe(true);
    const random = newOpaqueId();
    expect(isOpaqueId(random)).toBe(true);
    expect(newOpaqueId()).not.toBe(newOpaqueId());
  });
});
