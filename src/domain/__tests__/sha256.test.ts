import { bytesToHex, isSha256Hex, sha256Bytes, sha256Hex } from '../sha256';

// Node's crypto is the independent reference implementation for these tests.
// Required lazily and typed locally because the app tsconfig loads no Node types.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodeCrypto = require('node:crypto') as {
  createHash(alg: string): { update(b: Uint8Array): { digest(enc: string): string } };
};

const utf8 = (s: string) => new TextEncoder().encode(s);
const nodeSha = (b: Uint8Array) => nodeCrypto.createHash('sha256').update(b).digest('hex');

describe('sha256Hex (pure JS)', () => {
  it('matches the FIPS 180-4 test vectors', () => {
    expect(sha256Hex(utf8(''))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(sha256Hex(utf8('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sha256Hex(utf8('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('handles padding boundaries (55/56/63/64/65 bytes) and multi-block inputs like Node', () => {
    for (const n of [55, 56, 63, 64, 65, 119, 120, 1000, 4096, 70001]) {
      const bytes = new Uint8Array(n);
      for (let i = 0; i < n; i++) bytes[i] = (i * 31 + 7) & 0xff;
      expect(sha256Hex(bytes)).toBe(nodeSha(bytes));
    }
  });

  it('is stable on identical bytes and differs on different bytes', () => {
    const a = utf8('the same document bytes');
    const b = utf8('the same document bytes');
    const c = utf8('the same document bytes!');
    expect(sha256Hex(a)).toBe(sha256Hex(b));
    expect(sha256Hex(a)).not.toBe(sha256Hex(c));
    expect(sha256Hex(new Uint8Array(a))).toBe(sha256Hex(a));
  });

  it('produces 32 bytes / 64 lowercase hex chars', () => {
    expect(sha256Bytes(utf8('x'))).toHaveLength(32);
    const hex = sha256Hex(utf8('x'));
    expect(hex).toHaveLength(64);
    expect(isSha256Hex(hex)).toBe(true);
    expect(isSha256Hex(hex.toUpperCase())).toBe(false);
    expect(isSha256Hex('abc')).toBe(false);
  });

  it('bytesToHex accepts Uint8Array and ArrayBuffer', () => {
    const u = new Uint8Array([0, 1, 15, 16, 255]);
    expect(bytesToHex(u)).toBe('00010f10ff');
    expect(bytesToHex(u.buffer)).toBe('00010f10ff');
  });
});
