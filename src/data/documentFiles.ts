import {
  contentMatchesKind,
  DocumentFileKind,
  documentFileRelativePath,
  FileCacheEntry,
  FileVerification,
  markCaching,
  markError,
  markReady,
  newOpaqueId,
  resolveFileType,
  SecureRandomBytes,
  sha256Hex,
  sniffFileKind,
} from '@/domain';

/**
 * Durable, app-private document-file substrate (Refinement C4).
 *
 * A {@link DocumentFileStore} copies a source file (camera, photo library,
 * document picker — all temporary URIs) into app-private storage under
 * `road-wallet/{documentId}/{versionId}.{ext}`, and can later prove that copy
 * is still present, non-empty, readable and byte-identical (SHA-256).
 *
 * Two implementations: {@link ExpoDocumentFileStore} over the SDK 57
 * `expo-file-system` `File`/`Directory`/`Paths` API + `expo-crypto`, and
 * {@link MemoryDocumentFileStore} for Jest with the same contract.
 *
 * Privacy: paths contain only opaque ids and an extension. Nothing here logs or
 * reports file contents, names or identifiers.
 */

export interface ImportSource {
  /** Temporary URI from a picker/camera, or an existing `file://` URI. */
  uri: string;
  /** MIME type reported by the picker, when any. */
  mimeType?: string | null;
  /** Original filename, used only to derive an extension — never stored. */
  name?: string | null;
}

export interface ImportTarget {
  documentId: string;
  versionId: string;
}

export interface StoredDocumentFile {
  relativePath: string;
  uri: string;
  ext: string;
  mimeType: string;
  kind: DocumentFileKind;
  byteSize: number;
  sha256: string;
}

export interface VerifyOptions {
  /** Kind the caller believes the file is; content is sniffed against it. */
  expectedKind?: DocumentFileKind;
  /** When set, the fresh hash must equal this value. */
  expectedSha256?: string;
}

export type ShareCapability = { available: true } | { available: false; reason: string };

export interface DocumentFileStore {
  /** Copies the source into durable private storage and verifies the copy. */
  importFile(source: ImportSource, target: ImportTarget): Promise<StoredDocumentFile>;
  exists(relativePath: string): Promise<boolean>;
  /** Byte size, or null when the file is missing/unreadable. */
  byteSize(relativePath: string): Promise<number | null>;
  /** Full verification: exists, non-empty, readable, content sniff, SHA-256. */
  verify(relativePath: string, options?: VerifyOptions): Promise<FileVerification>;
  /** SHA-256 hex of the actual bytes on disk. Throws when unreadable. */
  sha256(relativePath: string): Promise<string>;
  /**
   * The exact durable bytes (for cloud upload after re-verification). Throws
   * when the file is missing or unreadable. Never logged.
   */
  readBytes(relativePath: string): Promise<Uint8Array>;
  /** Removes the local copy. No-op when already gone. */
  remove(relativePath: string): Promise<void>;
  /** Absolute URI for a relative path (app-private location). */
  uriFor(relativePath: string): string;
  /** Whether the platform share sheet is genuinely available. */
  shareCapability(): Promise<ShareCapability>;
  /**
   * Explicit, user-initiated Share/Export through the platform share sheet.
   * Throws when {@link shareCapability} is unavailable. This is not
   * "open in system viewer" — that behaviour is unvalidated (see C5 report).
   */
  share(relativePath: string, options: { mimeType: string; dialogTitle?: string }): Promise<void>;
}

/** Verification shared by both stores once the bytes are in hand. */
export function verifyBytes(
  bytes: Uint8Array | null,
  options: VerifyOptions = {},
  hash: (b: Uint8Array) => string = sha256Hex,
): FileVerification {
  if (bytes === null) return { ok: false, reason: 'MISSING' };
  if (bytes.length === 0) return { ok: false, reason: 'EMPTY' };
  const sniffed = sniffFileKind(bytes);
  if (options.expectedKind && !contentMatchesKind(options.expectedKind, sniffed)) {
    return { ok: false, reason: 'CONTENT_MISMATCH' };
  }
  let digest: string;
  try {
    digest = hash(bytes);
  } catch {
    return { ok: false, reason: 'HASH_FAILED' };
  }
  if (options.expectedSha256 && options.expectedSha256 !== digest) {
    return { ok: false, reason: 'HASH_MISMATCH' };
  }
  const kind: DocumentFileKind =
    sniffed === 'UNKNOWN' ? (options.expectedKind ?? 'OTHER') : sniffed;
  return { ok: true, byteSize: bytes.length, sha256: digest, kind };
}

// ---------------------------------------------------------------------------
// In-memory implementation (Jest / deterministic)
// ---------------------------------------------------------------------------

export class MemoryDocumentFileStore implements DocumentFileStore {
  private readonly files = new Map<string, Uint8Array>();
  private readonly sources = new Map<string, { bytes: Uint8Array; mimeType?: string | null }>();
  shareAvailable = true;
  readonly shared: { relativePath: string; mimeType: string }[] = [];
  /** Test hook: relative paths whose reads should fail as unreadable. */
  readonly unreadable = new Set<string>();

  constructor(private readonly root = 'memory:///documents/') {}

  /** Registers a fake picker/camera source so `importFile` can copy from it. */
  addSource(uri: string, bytes: Uint8Array, mimeType?: string | null): void {
    this.sources.set(uri, { bytes, mimeType });
  }

  /** Test hook: overwrite the stored bytes (simulates tampering / truncation). */
  overwrite(relativePath: string, bytes: Uint8Array): void {
    this.files.set(relativePath, bytes);
  }

  uriFor(relativePath: string): string {
    return `${this.root}${relativePath}`;
  }

  async importFile(source: ImportSource, target: ImportTarget): Promise<StoredDocumentFile> {
    const src = this.sources.get(source.uri);
    if (!src) throw new Error('source not found');
    const type = resolveFileType({
      mimeType: source.mimeType ?? src.mimeType,
      name: source.name,
      uri: source.uri,
    });
    const relativePath = documentFileRelativePath(target.documentId, target.versionId, type.ext);
    this.files.set(relativePath, new Uint8Array(src.bytes));
    const verification = await this.verify(relativePath, { expectedKind: type.kind });
    if (!verification.ok) {
      this.files.delete(relativePath);
      throw new Error(`import verification failed: ${verification.reason}`);
    }
    return {
      relativePath,
      uri: this.uriFor(relativePath),
      ext: type.ext,
      mimeType: type.mimeType,
      kind: type.kind,
      byteSize: verification.byteSize,
      sha256: verification.sha256,
    };
  }

  async exists(relativePath: string): Promise<boolean> {
    return this.files.has(relativePath);
  }

  async byteSize(relativePath: string): Promise<number | null> {
    if (this.unreadable.has(relativePath)) return null;
    return this.files.get(relativePath)?.length ?? null;
  }

  private read(relativePath: string): Uint8Array | null {
    if (this.unreadable.has(relativePath)) throw new Error('unreadable');
    return this.files.get(relativePath) ?? null;
  }

  async verify(relativePath: string, options: VerifyOptions = {}): Promise<FileVerification> {
    let bytes: Uint8Array | null;
    try {
      bytes = this.read(relativePath);
    } catch {
      return { ok: false, reason: 'UNREADABLE' };
    }
    return verifyBytes(bytes, options);
  }

  async sha256(relativePath: string): Promise<string> {
    const bytes = this.read(relativePath);
    if (!bytes) throw new Error('file missing');
    return sha256Hex(bytes);
  }

  async readBytes(relativePath: string): Promise<Uint8Array> {
    const bytes = this.read(relativePath);
    if (!bytes) throw new Error('file missing');
    return new Uint8Array(bytes);
  }

  async remove(relativePath: string): Promise<void> {
    this.files.delete(relativePath);
  }

  async shareCapability(): Promise<ShareCapability> {
    return this.shareAvailable ? { available: true } : { available: false, reason: 'unavailable' };
  }

  async share(relativePath: string, options: { mimeType: string }): Promise<void> {
    const cap = await this.shareCapability();
    if (!cap.available) throw new Error('sharing unavailable');
    if (!this.files.has(relativePath)) throw new Error('file missing');
    this.shared.push({ relativePath, mimeType: options.mimeType });
  }
}

// ---------------------------------------------------------------------------
// Expo SDK 57 implementation
// ---------------------------------------------------------------------------

/** Narrow view of the SDK 57 `expo-file-system` classes this store relies on. */
interface FsFile {
  readonly uri: string;
  readonly exists: boolean;
  readonly size: number;
  readonly type: string;
  bytes(): Promise<Uint8Array>;
  copy(destination: FsFile | FsDirectory, options?: { overwrite?: boolean }): Promise<void>;
  delete(): void;
}
interface FsDirectory {
  readonly uri: string;
  readonly exists: boolean;
  create(options?: { intermediates?: boolean; idempotent?: boolean }): void;
}
interface FileSystemModule {
  File: new (...uris: (string | FsFile | FsDirectory)[]) => FsFile;
  Directory: new (...uris: (string | FsFile | FsDirectory)[]) => FsDirectory;
  Paths: { document: FsDirectory };
}
interface CryptoModule {
  CryptoDigestAlgorithm: { SHA256: string };
  digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>;
  /**
   * Fills the array from the native CSPRNG with no JS fallback (SDK 57 source:
   * `ExpoCrypto.getRandomValues(typedArray)`; throws when the native module is
   * missing). NOTE: `getRandomBytes()` is deliberately NOT used — its SDK 57
   * implementation falls back to `Math.random` under `__DEV__` with remote
   * debugging enabled.
   */
  getRandomValues?<T extends Uint8Array>(typedArray: T): T;
}
interface SharingModule {
  isAvailableAsync(): Promise<boolean>;
  shareAsync(
    url: string,
    options?: { mimeType?: string; UTI?: string; dialogTitle?: string },
  ): Promise<void>;
}

// Native modules are required lazily (repo convention — see ocr/engine.ts and
// location/mileageTracker.ts) so Jest and CI never load them; the memory store
// covers the contract in tests.
function loadFileSystem(): FileSystemModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('expo-file-system');
  return (mod.default ?? mod) as FileSystemModule;
}
function loadCrypto(): CryptoModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-crypto');
    return (mod.default ?? mod) as CryptoModule;
  } catch {
    return null;
  }
}
function loadSharing(): SharingModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-sharing');
    return (mod.default ?? mod) as SharingModule;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Secure opaque identifiers (runtime CSPRNG, fail-closed)
// ---------------------------------------------------------------------------

export class SecureRandomUnavailableError extends Error {
  constructor(detail: string) {
    super(`secure random source unavailable: ${detail}`);
    this.name = 'SecureRandomUnavailableError';
  }
}

type GlobalCrypto = { getRandomValues?: (array: Uint8Array) => Uint8Array } | undefined;

/**
 * Cryptographically secure random bytes, or an explicit failure. Order:
 *   1. `expo-crypto` `getRandomValues` — the native CSPRNG, no JS fallback;
 *   2. `globalThis.crypto.getRandomValues` when genuinely present (Web Crypto /
 *      Node / the Expo winter runtime polyfill backed by expo-crypto);
 *   3. otherwise throw {@link SecureRandomUnavailableError}.
 * Never `Math.random`, never time-based, never sequential.
 */
export const secureRandomBytes: SecureRandomBytes = (byteCount) => {
  const out = new Uint8Array(byteCount);

  const expoCrypto = loadCrypto();
  if (expoCrypto && typeof expoCrypto.getRandomValues === 'function') {
    try {
      const filled = expoCrypto.getRandomValues(out);
      if (filled instanceof Uint8Array && filled.length === byteCount) return filled;
      throw new Error('expo-crypto returned an unexpected buffer');
    } catch (err) {
      throw new SecureRandomUnavailableError(
        err instanceof Error ? err.message : 'expo-crypto getRandomValues failed',
      );
    }
  }

  const webCrypto = (globalThis as { crypto?: GlobalCrypto }).crypto;
  if (webCrypto && typeof webCrypto.getRandomValues === 'function') {
    const filled = webCrypto.getRandomValues(out);
    if (filled instanceof Uint8Array && filled.length === byteCount) return filled;
    throw new SecureRandomUnavailableError('globalThis.crypto returned an unexpected buffer');
  }

  throw new SecureRandomUnavailableError('no CSPRNG (expo-crypto or globalThis.crypto) found');
};

/** New 128-bit random opaque id for document / version paths. Fails closed. */
export const newSecureOpaqueId = (): string => newOpaqueId(secureRandomBytes);

const UTI_FOR_MIME: Record<string, string> = {
  'application/pdf': 'com.adobe.pdf',
  'image/jpeg': 'public.jpeg',
  'image/png': 'public.png',
  'image/heic': 'public.heic',
  'image/webp': 'org.webmproject.webp',
};

export class ExpoDocumentFileStore implements DocumentFileStore {
  private fsCache: FileSystemModule | null = null;

  private fs(): FileSystemModule {
    if (!this.fsCache) this.fsCache = loadFileSystem();
    return this.fsCache;
  }

  private file(relativePath: string): FsFile {
    const { File, Paths } = this.fs();
    return new File(Paths.document, relativePath);
  }

  uriFor(relativePath: string): string {
    return this.file(relativePath).uri;
  }

  /** SHA-256 via expo-crypto (native) with the pure-JS digest as fallback. */
  private async digest(bytes: Uint8Array): Promise<string> {
    const crypto = loadCrypto();
    if (crypto) {
      const buf = await crypto.digest(crypto.CryptoDigestAlgorithm.SHA256, bytes);
      let hex = '';
      for (const b of new Uint8Array(buf)) hex += b.toString(16).padStart(2, '0');
      return hex;
    }
    return sha256Hex(bytes);
  }

  async importFile(source: ImportSource, target: ImportTarget): Promise<StoredDocumentFile> {
    const { File, Directory, Paths } = this.fs();
    const type = resolveFileType({ mimeType: source.mimeType, name: source.name, uri: source.uri });
    const relativePath = documentFileRelativePath(target.documentId, target.versionId, type.ext);

    const dir = new Directory(Paths.document, 'road-wallet', target.documentId);
    dir.create({ intermediates: true, idempotent: true });

    const src = new File(source.uri);
    if (!src.exists) throw new Error('source file missing');
    const dest = new File(dir, `${target.versionId}.${type.ext}`);
    await src.copy(dest, { overwrite: true });

    const verification = await this.verify(relativePath, { expectedKind: type.kind });
    if (!verification.ok) {
      try {
        dest.delete();
      } catch {
        // Best effort; the entry stays ERROR either way.
      }
      throw new Error(`import verification failed: ${verification.reason}`);
    }
    return {
      relativePath,
      uri: dest.uri,
      ext: type.ext,
      mimeType: type.mimeType,
      kind: type.kind,
      byteSize: verification.byteSize,
      sha256: verification.sha256,
    };
  }

  async exists(relativePath: string): Promise<boolean> {
    return this.file(relativePath).exists;
  }

  async byteSize(relativePath: string): Promise<number | null> {
    const f = this.file(relativePath);
    return f.exists ? f.size : null;
  }

  async verify(relativePath: string, options: VerifyOptions = {}): Promise<FileVerification> {
    const f = this.file(relativePath);
    if (!f.exists) return { ok: false, reason: 'MISSING' };
    if (f.size <= 0) return { ok: false, reason: 'EMPTY' };
    let bytes: Uint8Array;
    try {
      bytes = await f.bytes();
    } catch {
      return { ok: false, reason: 'UNREADABLE' };
    }
    let hash: string;
    try {
      hash = await this.digest(bytes);
    } catch {
      return { ok: false, reason: 'HASH_FAILED' };
    }
    return verifyBytes(bytes, options, () => hash);
  }

  async sha256(relativePath: string): Promise<string> {
    const f = this.file(relativePath);
    if (!f.exists) throw new Error('file missing');
    return this.digest(await f.bytes());
  }

  async readBytes(relativePath: string): Promise<Uint8Array> {
    const f = this.file(relativePath);
    if (!f.exists) throw new Error('file missing');
    const bytes = await f.bytes();
    if (!(bytes instanceof Uint8Array)) throw new Error('file unreadable');
    return bytes;
  }

  async remove(relativePath: string): Promise<void> {
    const f = this.file(relativePath);
    if (f.exists) f.delete();
  }

  async shareCapability(): Promise<ShareCapability> {
    const sharing = loadSharing();
    if (!sharing) return { available: false, reason: 'expo-sharing not linked' };
    return (await sharing.isAvailableAsync())
      ? { available: true }
      : { available: false, reason: 'platform share sheet unavailable' };
  }

  async share(
    relativePath: string,
    options: { mimeType: string; dialogTitle?: string },
  ): Promise<void> {
    const cap = await this.shareCapability();
    if (!cap.available) throw new Error(`sharing unavailable: ${cap.reason}`);
    const sharing = loadSharing();
    if (!sharing) throw new Error('sharing unavailable');
    const f = this.file(relativePath);
    if (!f.exists) throw new Error('file missing');
    await sharing.shareAsync(f.uri, {
      mimeType: options.mimeType,
      UTI: UTI_FOR_MIME[options.mimeType],
      dialogTitle: options.dialogTitle,
    });
  }
}

// ---------------------------------------------------------------------------
// Readiness orchestration
// ---------------------------------------------------------------------------

/**
 * Drives a cache entry NOT_CACHED → CACHING → READY | ERROR by importing the
 * source and verifying the durable copy. READY is only reached through a
 * successful {@link DocumentFileStore.verify}; on failure the entry becomes
 * ERROR and keeps whatever metadata it already had.
 */
export async function cacheDocumentFile(
  store: DocumentFileStore,
  entry: FileCacheEntry,
  source: ImportSource,
  target: ImportTarget,
  now: () => number = Date.now,
): Promise<{ entry: FileCacheEntry; stored: StoredDocumentFile | null }> {
  const caching = markCaching(entry, null);
  try {
    const stored = await store.importFile(source, target);
    const verification = await store.verify(stored.relativePath, {
      expectedKind: stored.kind,
      expectedSha256: stored.sha256,
    });
    const next = markReady(
      { ...caching, relativePath: stored.relativePath },
      verification,
      stored.mimeType,
      now(),
    );
    return { entry: next, stored: next.state === 'READY' ? stored : null };
  } catch {
    return { entry: markError(caching, 'IMPORT_FAILED'), stored: null };
  }
}

/**
 * Re-verifies an existing entry (e.g. before presenting offline). A READY entry
 * whose file went missing or changed drops to ERROR; nothing is deleted.
 */
export async function reverifyDocumentFile(
  store: DocumentFileStore,
  entry: FileCacheEntry,
  expectedKind: DocumentFileKind | undefined,
  now: () => number = Date.now,
): Promise<FileCacheEntry> {
  if (!entry.relativePath) return markError(entry, 'MISSING');
  const verification = await store.verify(entry.relativePath, {
    expectedKind,
    expectedSha256: entry.sha256 ?? undefined,
  });
  return markReady(entry, verification, entry.mimeType ?? 'application/octet-stream', now());
}
