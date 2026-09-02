import {
  base64UrlEncode,
  contentMatchesKind,
  DOCUMENT_FILES_ROOT,
  documentFileRelativePath,
  extensionFromName,
  FILE_READINESS,
  FileVerification,
  isFileReady,
  isHeifImage,
  isOpaqueId,
  markCaching,
  markError,
  markEvicted,
  markReady,
  newOpaqueId,
  notCached,
  OPAQUE_ID_BYTES,
  OPAQUE_ID_LENGTH,
  opaqueIdFromBytes,
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
    // Complete 24-byte ftyp box: size=24, 'ftyp', major 'heic', minor 0, compat 'mif1', 'heic'.
    const heic = new Uint8Array([
      0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0, 0x6d, 0x69, 0x66,
      0x31, 0x68, 0x65, 0x69, 0x63,
    ]);
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
});

describe('opaque identifiers (C4.1 — 128-bit, base64url, fail-closed)', () => {
  const fixed = (values: number[]) => (n: number) => {
    expect(n).toBe(OPAQUE_ID_BYTES);
    return new Uint8Array(values);
  };

  it('encodes a deterministic 16-byte vector to the expected 22-char base64url id', () => {
    const seq = Array.from({ length: 16 }, (_, i) => i); // 00 01 … 0f
    expect(newOpaqueId(fixed(seq))).toBe('AAECAwQFBgcICQoLDA0ODw');
    expect(newOpaqueId(fixed(new Array(16).fill(0)))).toBe('AAAAAAAAAAAAAAAAAAAAAA');
    expect(newOpaqueId(fixed(new Array(16).fill(0xff)))).toBe('_____________________w');
    expect(newOpaqueId(fixed(seq))).toBe(newOpaqueId(fixed(seq)));
  });

  it('is exactly 22 characters, matches the opaque-id grammar, and has no padding', () => {
    const id = newOpaqueId(fixed([0xfb, 0xff, 0xbf, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]));
    expect(id).toHaveLength(OPAQUE_ID_LENGTH);
    expect(OPAQUE_ID_LENGTH).toBe(22);
    expect(OPAQUE_ID_BYTES).toBe(16);
    expect(isOpaqueId(id)).toBe(true);
    expect(id).not.toContain('=');
    expect(id).not.toMatch(/[+/]/);
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it('base64url alphabet maps the high sextets to - and _ (URL/path safe)', () => {
    expect(base64UrlEncode(new Uint8Array([0xfb, 0xff]))).toBe('-_8');
    expect(base64UrlEncode(new Uint8Array([]))).toBe('');
    expect(base64UrlEncode(new Uint8Array([0x66]))).toBe('Zg');
    expect(base64UrlEncode(new Uint8Array([0x66, 0x6f]))).toBe('Zm8');
    expect(base64UrlEncode(new Uint8Array([0x66, 0x6f, 0x6f]))).toBe('Zm9v');
  });

  it('has no default or fallback source: a missing or broken source fails closed', () => {
    expect(() => (newOpaqueId as unknown as () => string)()).toThrow(/secure random byte source/);
    expect(() =>
      newOpaqueId(() => {
        throw new Error('CSPRNG unavailable');
      }),
    ).toThrow('CSPRNG unavailable');
    expect(() => newOpaqueId(() => new Uint8Array(15))).toThrow(/exactly 16/);
    expect(() => newOpaqueId(() => new Uint8Array(22))).toThrow(/exactly 16/);
    expect(() => opaqueIdFromBytes(new Uint8Array(0))).toThrow(/exactly 16/);
  });

  it('never consults Math.random or the clock', () => {
    const rnd = jest.spyOn(Math, 'random');
    const now = jest.spyOn(Date, 'now');
    newOpaqueId(fixed(Array.from({ length: 16 }, (_, i) => 255 - i)));
    expect(rnd).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
    rnd.mockRestore();
    now.mockRestore();
  });

  it('generated ids compose into paths containing only the ids and the extension', () => {
    const doc = newOpaqueId(fixed(Array.from({ length: 16 }, (_, i) => i * 13)));
    const ver = newOpaqueId(fixed(Array.from({ length: 16 }, (_, i) => 200 - i * 3)));
    const path = documentFileRelativePath(doc, ver, 'heic');
    expect(path).toBe(`road-wallet/${doc}/${ver}.heic`);
    expect(parseDocumentFileRelativePath(path)).toEqual({
      documentId: doc,
      versionId: ver,
      ext: 'heic',
    });
    expect(path.replace(doc, '').replace(ver, '')).toBe('road-wallet//.heic');
  });
});

// ---------------------------------------------------------------------------
// HEIC / HEIF brand validation (C4.1)
// ---------------------------------------------------------------------------

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

/** Builds an ISO-BMFF `ftyp` box: [size][ftyp][major][minor][compatible…]. */
function ftyp(
  major: string,
  compatible: string[] = [],
  opts: { sizeOverride?: number; trailing?: number } = {},
) {
  const size = 16 + compatible.length * 4;
  const declared = opts.sizeOverride ?? size;
  const bytes = [
    (declared >>> 24) & 0xff,
    (declared >>> 16) & 0xff,
    (declared >>> 8) & 0xff,
    declared & 0xff,
    ...ascii('ftyp'),
    ...ascii(major),
    0,
    0,
    0,
    0,
    ...compatible.flatMap(ascii),
    ...new Array(opts.trailing ?? 8).fill(0),
  ];
  return new Uint8Array(bytes);
}

describe('HEIC/HEIF sniffing is brand-validated, not generic ftyp', () => {
  it('accepts HEIC major brands and HEIF files whose compatible brands include an HEVC image brand', () => {
    expect(sniffFileKind(ftyp('heic', ['mif1', 'heic']))).toBe('IMAGE'); // iPhone HEIC
    expect(sniffFileKind(ftyp('heix', ['mif1']))).toBe('IMAGE');
    expect(sniffFileKind(ftyp('mif1', ['heic']))).toBe('IMAGE'); // HEIF structural major + HEVC compat
    expect(sniffFileKind(ftyp('mif1', ['msf1', 'hevc']))).toBe('IMAGE');
    expect(isHeifImage(ftyp('heic'))).toBe(true);
  });

  it('rejects generic ISO-BMFF containers that merely carry ftyp', () => {
    for (const major of ['isom', 'mp41', 'mp42', 'iso2', 'qt  ', 'M4A ', 'M4V ']) {
      expect(sniffFileKind(ftyp(major, ['isom', 'mp42']))).toBe('UNKNOWN');
      expect(contentMatchesKind('IMAGE', sniffFileKind(ftyp(major)))).toBe(false);
    }
  });

  it('does not accept a structural HEIF brand alone', () => {
    expect(sniffFileKind(ftyp('mif1'))).toBe('UNKNOWN');
    expect(sniffFileKind(ftyp('mif1', ['msf1']))).toBe('UNKNOWN');
  });

  it('never treats AVIF as HEIC, even when mif1 or an HEVC brand is also listed', () => {
    expect(sniffFileKind(ftyp('avif', ['mif1', 'miaf']))).toBe('UNKNOWN');
    expect(sniffFileKind(ftyp('avis', ['mif1']))).toBe('UNKNOWN');
    expect(sniffFileKind(ftyp('mif1', ['avif']))).toBe('UNKNOWN');
    expect(sniffFileKind(ftyp('heic', ['avif']))).toBe('UNKNOWN');
  });

  it('treats malformed or truncated ftyp boxes as UNKNOWN', () => {
    expect(sniffFileKind(ftyp('heic', ['mif1']).slice(0, 12))).toBe('UNKNOWN'); // shorter than header
    expect(sniffFileKind(ftyp('heic', ['mif1', 'heic'], { sizeOverride: 64, trailing: 0 }))).toBe(
      'UNKNOWN',
    ); // size beyond data
    expect(sniffFileKind(ftyp('heic', [], { sizeOverride: 1 }))).toBe('UNKNOWN'); // extended-size box
    expect(sniffFileKind(ftyp('heic', [], { sizeOverride: 0 }))).toBe('UNKNOWN'); // unsized box
    expect(sniffFileKind(ftyp('heic', [], { sizeOverride: 18 }))).toBe('UNKNOWN'); // misaligned
    expect(sniffFileKind(ftyp('heic', [], { sizeOverride: 12 }))).toBe('UNKNOWN'); // undersized
    const notFtyp = ftyp('heic');
    notFtyp.set(ascii('moov'), 4);
    expect(sniffFileKind(notFtyp)).toBe('UNKNOWN');
  });

  it('leaves JPEG, PNG, WebP and PDF detection unchanged', () => {
    expect(sniffFileKind(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 0]))).toBe('IMAGE');
    expect(sniffFileKind(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      'IMAGE',
    );
    expect(
      sniffFileKind(
        new Uint8Array([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP'), ...ascii('VP8 ')]),
      ),
    ).toBe('IMAGE');
    expect(sniffFileKind(new Uint8Array(ascii('%PDF-1.7\n')))).toBe('PDF');
    // A JPEG is not an HEIF and a PDF is not an image.
    expect(
      isHeifImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])),
    ).toBe(false);
    expect(contentMatchesKind('IMAGE', sniffFileKind(new Uint8Array(ascii('%PDF-1.7\n'))))).toBe(
      false,
    );
  });
});
