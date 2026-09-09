/**
 * Durable document-file substrate — pure rules (Refinement C4).
 *
 * Road Wallet will promise local/offline access, so a temporary picker URI is
 * never enough. These rules define how a file is typed, where it lives inside
 * app-private storage, and when it may be called READY. No dependency on the
 * (later) OperationalDocument domain.
 */

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

export const FILE_READINESS = ['NOT_CACHED', 'CACHING', 'READY', 'ERROR'] as const;
export type FileReadiness = (typeof FILE_READINESS)[number];

export type FileVerificationFailure =
  'MISSING' | 'EMPTY' | 'UNREADABLE' | 'HASH_FAILED' | 'CONTENT_MISMATCH' | 'HASH_MISMATCH';

export type FileVerification =
  | { ok: true; byteSize: number; sha256: string; kind: DocumentFileKind }
  | { ok: false; reason: FileVerificationFailure };

/**
 * Local cache entry for one file version. `READY` is only ever produced by
 * {@link markReady} from a successful {@link FileVerification}; a URI string
 * alone never counts. `ERROR` keeps the metadata already known so the failure
 * can be diagnosed and retried without losing the record.
 */
export interface FileCacheEntry {
  state: FileReadiness;
  relativePath: string | null;
  mimeType: string | null;
  byteSize: number | null;
  sha256: string | null;
  error: FileVerificationFailure | 'IMPORT_FAILED' | null;
  verifiedAt: number | null;
}

export const notCached = (): FileCacheEntry => ({
  state: 'NOT_CACHED',
  relativePath: null,
  mimeType: null,
  byteSize: null,
  sha256: null,
  error: null,
  verifiedAt: null,
});

export function markCaching(entry: FileCacheEntry, relativePath: string | null): FileCacheEntry {
  return {
    ...entry,
    state: 'CACHING',
    relativePath: relativePath ?? entry.relativePath,
    error: null,
  };
}

export function markReady(
  entry: FileCacheEntry,
  verification: FileVerification,
  mimeType: string,
  now: number,
): FileCacheEntry {
  if (!verification.ok) return markError(entry, verification.reason);
  return {
    ...entry,
    state: 'READY',
    mimeType,
    byteSize: verification.byteSize,
    sha256: verification.sha256,
    error: null,
    verifiedAt: now,
  };
}

export function markError(
  entry: FileCacheEntry,
  error: FileVerificationFailure | 'IMPORT_FAILED',
): FileCacheEntry {
  return { ...entry, state: 'ERROR', error, verifiedAt: null };
}

export function markEvicted(entry: FileCacheEntry): FileCacheEntry {
  return {
    ...notCached(),
    mimeType: entry.mimeType,
    sha256: entry.sha256,
    byteSize: entry.byteSize,
  };
}

export const isFileReady = (entry: Pick<FileCacheEntry, 'state'>): boolean =>
  entry.state === 'READY';

// ---------------------------------------------------------------------------
// File typing (extension / MIME / kind)
// ---------------------------------------------------------------------------

export type DocumentFileKind = 'IMAGE' | 'PDF' | 'OTHER';

interface KnownType {
  ext: string;
  mimeType: string;
  kind: DocumentFileKind;
  aliases: readonly string[];
}

/** Allowlist. Anything else is stored as opaque binary, never coerced to an image. */
const KNOWN_TYPES: readonly KnownType[] = [
  { ext: 'jpg', mimeType: 'image/jpeg', kind: 'IMAGE', aliases: ['jpeg', 'jpg', 'image/jpg'] },
  { ext: 'png', mimeType: 'image/png', kind: 'IMAGE', aliases: ['png'] },
  { ext: 'heic', mimeType: 'image/heic', kind: 'IMAGE', aliases: ['heic', 'heif', 'image/heif'] },
  { ext: 'webp', mimeType: 'image/webp', kind: 'IMAGE', aliases: ['webp'] },
  { ext: 'pdf', mimeType: 'application/pdf', kind: 'PDF', aliases: ['pdf', 'application/x-pdf'] },
];

export const UNKNOWN_FILE_TYPE = {
  ext: 'bin',
  mimeType: 'application/octet-stream',
  kind: 'OTHER' as DocumentFileKind,
} as const;

export interface ResolvedFileType {
  ext: string;
  mimeType: string;
  kind: DocumentFileKind;
}

function findType(token: string | null | undefined): ResolvedFileType | null {
  if (!token) return null;
  const t = token.trim().toLowerCase().replace(/^\./, '');
  if (!t) return null;
  const hit = KNOWN_TYPES.find((k) => k.ext === t || k.mimeType === t || k.aliases.includes(t));
  return hit ? { ext: hit.ext, mimeType: hit.mimeType, kind: hit.kind } : null;
}

/** Extension from a URI or filename, ignoring query strings. */
export function extensionFromName(nameOrUri: string | null | undefined): string | null {
  if (!nameOrUri) return null;
  const clean = nameOrUri.split('?')[0].split('#')[0];
  const m = clean.match(/\.([a-zA-Z0-9]{1,8})$/);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Safely determines extension + MIME + kind. A declared MIME type wins over a
 * filename extension (pickers report it from the OS); unknown or missing
 * information degrades to opaque binary rather than guessing.
 */
export function resolveFileType(input: {
  mimeType?: string | null;
  name?: string | null;
  uri?: string | null;
}): ResolvedFileType {
  return (
    findType(input.mimeType) ??
    findType(extensionFromName(input.name)) ??
    findType(extensionFromName(input.uri)) ?? { ...UNKNOWN_FILE_TYPE }
  );
}

/** Content sniffing on the leading bytes — what the file actually is. */
export function sniffFileKind(bytes: Uint8Array): DocumentFileKind | 'UNKNOWN' {
  if (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  ) {
    return 'PDF'; // %PDF-
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'IMAGE'; // JPEG
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'IMAGE'; // PNG
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'IMAGE'; // RIFF....WEBP
  }
  if (isHeifImage(bytes)) return 'IMAGE';
  return 'UNKNOWN';
}

/**
 * HEIC/HEIF still-image brands (ISO/IEC 23008-12). `mif1`/`msf1` are structural
 * brands shared with AVIF and image sequences, so they are deliberately not
 * sufficient on their own; an HEVC-coded image brand must be present.
 */
const HEIC_IMAGE_BRANDS: ReadonlySet<string> = new Set([
  'heic',
  'heix',
  'hevc',
  'hevx',
  'heim',
  'heis',
  'hevm',
  'hevs',
]);

/** AVIF brands — not a supported type; never silently treated as HEIC. */
const AVIF_BRANDS: ReadonlySet<string> = new Set(['avif', 'avis']);

const fourcc = (bytes: Uint8Array, offset: number): string =>
  String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);

/**
 * Bounded HEIC/HEIF detector over the ISO-BMFF `ftyp` box:
 * `[size:4][ 'ftyp' ][major:4][minor:4][compatible:4...]`.
 *
 * Accepts only when the box is well-formed and complete, the major or a
 * compatible brand is an HEVC image brand, and no AVIF brand appears anywhere.
 * Generic containers (`isom`, `mp41`, `mp42`, `iso2`, `qt  `, ...) that merely
 * carry `ftyp` are rejected.
 */
export function isHeifImage(bytes: Uint8Array): boolean {
  if (bytes.length < 16) return false;
  if (fourcc(bytes, 4) !== 'ftyp') return false;
  const boxSize = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  // Extended (size === 1) or unsized (size === 0) boxes, undersized boxes,
  // misaligned brand lists and truncated boxes are all treated as malformed.
  if (boxSize < 16 || boxSize % 4 !== 0 || boxSize > bytes.length) return false;

  const brands: string[] = [fourcc(bytes, 8)];
  for (let offset = 16; offset + 4 <= boxSize; offset += 4) brands.push(fourcc(bytes, offset));

  if (brands.some((b) => AVIF_BRANDS.has(b))) return false;
  return brands.some((b) => HEIC_IMAGE_BRANDS.has(b));
}

/**
 * Whether sniffed content is acceptable for the declared kind. Declared images
 * must look like images and declared PDFs must look like PDFs; opaque binaries
 * accept anything. This is the "image validation where practical" step.
 */
export function contentMatchesKind(
  declared: DocumentFileKind,
  sniffed: DocumentFileKind | 'UNKNOWN',
): boolean {
  switch (declared) {
    case 'IMAGE':
      return sniffed === 'IMAGE';
    case 'PDF':
      return sniffed === 'PDF';
    case 'OTHER':
      return true;
    default: {
      const exhaustive: never = declared;
      return exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Private path scheme
// ---------------------------------------------------------------------------

export const DOCUMENT_FILES_ROOT = 'road-wallet';

/**
 * Opaque identifier shape: URL-safe, no whitespace or punctuation that could
 * smuggle a name, CDL, EIN, VIN or policy number into a path.
 */
const OPAQUE_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
export const isOpaqueId = (id: string): boolean => OPAQUE_ID_RE.test(id);

const EXT_RE = /^[a-z0-9]{1,8}$/;

/**
 * `road-wallet/{logicalDocumentId}/{versionId}.{ext}` relative to the
 * app-private document directory. Rejects anything that is not an opaque id so
 * the path can never carry user-entered text.
 */
export function documentFileRelativePath(
  documentId: string,
  versionId: string,
  ext: string,
): string {
  if (!isOpaqueId(documentId)) throw new Error('documentId must be an opaque id');
  if (!isOpaqueId(versionId)) throw new Error('versionId must be an opaque id');
  const e = ext.toLowerCase().replace(/^\./, '');
  if (!EXT_RE.test(e)) throw new Error('invalid extension');
  return `${DOCUMENT_FILES_ROOT}/${documentId}/${versionId}.${e}`;
}

/** Parses a relative path produced by {@link documentFileRelativePath}. */
export function parseDocumentFileRelativePath(
  relativePath: string,
): { documentId: string; versionId: string; ext: string } | null {
  const m = relativePath.match(
    /^road-wallet\/([A-Za-z0-9_-]{8,64})\/([A-Za-z0-9_-]{8,64})\.([a-z0-9]{1,8})$/,
  );
  return m ? { documentId: m[1], versionId: m[2], ext: m[3] } : null;
}

// ---------------------------------------------------------------------------
// Opaque identifiers — 128-bit random, base64url, fail-closed
// ---------------------------------------------------------------------------

/** Random input per identifier: 16 bytes = 128 bits. */
export const OPAQUE_ID_BYTES = 16;
/** base64url of 16 bytes without padding is exactly 22 characters. */
export const OPAQUE_ID_LENGTH = 22;

const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** RFC 4648 §5 base64url without `=` padding. Output stays within `[A-Za-z0-9_-]`. */
export function base64UrlEncode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 3 <= bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out +=
      BASE64URL_ALPHABET[(n >>> 18) & 63] +
      BASE64URL_ALPHABET[(n >>> 12) & 63] +
      BASE64URL_ALPHABET[(n >>> 6) & 63] +
      BASE64URL_ALPHABET[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += BASE64URL_ALPHABET[(n >>> 18) & 63] + BASE64URL_ALPHABET[(n >>> 12) & 63];
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out +=
      BASE64URL_ALPHABET[(n >>> 18) & 63] +
      BASE64URL_ALPHABET[(n >>> 12) & 63] +
      BASE64URL_ALPHABET[(n >>> 6) & 63];
  }
  return out;
}

/** A source of cryptographically secure random bytes. Must throw when it cannot deliver. */
export type SecureRandomBytes = (byteCount: number) => Uint8Array;

/**
 * Encodes exactly {@link OPAQUE_ID_BYTES} random bytes as a 22-character
 * base64url identifier. Pure; used by tests with deterministic vectors.
 */
export function opaqueIdFromBytes(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array) || bytes.length !== OPAQUE_ID_BYTES) {
    throw new Error(`opaque id requires exactly ${OPAQUE_ID_BYTES} random bytes`);
  }
  const id = base64UrlEncode(bytes);
  if (id.length !== OPAQUE_ID_LENGTH || !isOpaqueId(id)) {
    throw new Error('opaque id encoding produced an invalid identifier');
  }
  return id;
}

/**
 * Generates a 128-bit random opaque identifier from the given secure byte
 * source. There is deliberately no default source and no fallback: callers
 * inject a CSPRNG (see `newSecureOpaqueId` in `src/data/documentFiles.ts`) or
 * a deterministic vector in tests. Any source failure fails closed.
 */
export function newOpaqueId(randomBytes: SecureRandomBytes): string {
  if (typeof randomBytes !== 'function') {
    throw new Error('newOpaqueId requires a secure random byte source');
  }
  return opaqueIdFromBytes(randomBytes(OPAQUE_ID_BYTES));
}
