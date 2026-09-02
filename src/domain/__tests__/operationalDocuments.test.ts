import { newOpaqueId } from '../documentFiles';
import {
  analyticsSafeDocumentSummary,
  assertImmutableCoreUnchanged,
  currentVersion,
  daysUntilExpiry,
  defaultOfflinePinned,
  defaultSensitivityForKind,
  defaultSubjectForKind,
  deriveValidity,
  DOCUMENT_KIND_INFO,
  DOCUMENT_KINDS,
  DOCUMENT_LIFECYCLES,
  DOCUMENT_VERSION_IMMUTABLE_FIELDS,
  DocumentVersion,
  EXPIRING_SOON_DAYS,
  immutableCore,
  immutableCoreEquals,
  isIsoDate,
  isMaskedReference,
  isVisibleInSession,
  maskReference,
  nextVersionNumber,
  OperationalDocument,
  remoteVersionMatches,
  remoteVersionPath,
  ROAD_WALLET_REMOTE_BUCKET,
  SENSITIVITIES,
  SUBJECT_KINDS,
  toRemoteDocumentRow,
  toRemoteVersionRow,
  validateNewVersion,
  validateOperationalDocument,
  VALIDITY_STATES,
  versionsForDocument,
  visibleDocumentsForSession,
} from '../operationalDocuments';

const fixedId = (seed: number) =>
  newOpaqueId(() => new Uint8Array(Array.from({ length: 16 }, (_, i) => (i * 31 + seed) & 0xff)));

const DOC_ID = fixedId(1);
const V1_ID = fixedId(2);
const V2_ID = fixedId(3);
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

const doc = (over: Partial<OperationalDocument> = {}): OperationalDocument => ({
  id: DOC_ID,
  accountOwnerId: 'user-a',
  documentKind: 'INSURANCE',
  subjectKind: 'CARRIER',
  truckId: null,
  trailerNumber: null,
  title: 'Liability policy',
  issuer: null,
  jurisdiction: null,
  issuedAt: null,
  effectiveAt: null,
  expiresAt: '2026-12-31',
  maskedReference: '****1234',
  sensitivity: 'STANDARD',
  lifecycle: 'ACTIVE',
  offlinePinned: true,
  cloudStatus: 'local_only',
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

const version = (over: Partial<DocumentVersion> = {}): DocumentVersion => ({
  id: V1_ID,
  operationalDocumentId: DOC_ID,
  accountOwnerId: 'user-a',
  versionNumber: 1,
  supersedesVersionId: null,
  fileKind: 'IMAGE',
  mimeType: 'image/jpeg',
  extension: 'jpg',
  byteSize: 1234,
  sha256: SHA_A,
  relativePath: `road-wallet/${DOC_ID}/${V1_ID}.jpg`,
  fileCache: {
    state: 'READY',
    relativePath: `road-wallet/${DOC_ID}/${V1_ID}.jpg`,
    mimeType: 'image/jpeg',
    byteSize: 1234,
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

describe('canonical sets', () => {
  it('has the baseline document kinds plus CUSTOM, five subject kinds, three sensitivities', () => {
    expect(DOCUMENT_KINDS).toEqual([
      'CDL',
      'MEDICAL_DOCUMENT',
      'TWIC',
      'VEHICLE_REGISTRATION',
      'TRAILER_REGISTRATION',
      'IRP_CAB_CARD',
      'ANNUAL_INSPECTION',
      'INSURANCE',
      'IFTA',
      'OPERATING_PERMIT',
      'OPERATING_AUTHORITY',
      'CERTIFICATE_OF_INSURANCE',
      'UCR',
      'W9',
      'FACTORING_NOA',
      'BANKING_DOCUMENT',
      'LEASE_AGREEMENT',
      'CUSTOM',
    ]);
    expect(SUBJECT_KINDS).toEqual(['DRIVER', 'CARRIER', 'TRUCK', 'TRAILER', 'GENERAL']);
    expect(SENSITIVITIES).toEqual(['STANDARD', 'PERSONAL_SENSITIVE', 'FINANCIAL_SENSITIVE']);
    expect(DOCUMENT_LIFECYCLES).toEqual(['ACTIVE', 'ARCHIVED']);
    for (const k of DOCUMENT_KINDS) expect(DOCUMENT_KIND_INFO[k].label.length).toBeGreaterThan(0);
  });

  it('validity states describe dates only — there is no compliance state', () => {
    expect(VALIDITY_STATES).toEqual(['NO_EXPIRATION', 'CURRENT', 'EXPIRING_SOON', 'EXPIRED']);
    for (const s of VALIDITY_STATES) expect(s).not.toMatch(/COMPLIANT|LEGAL|ENFORCEMENT|APPROVED/);
    expect(Object.keys(doc())).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/compliant/i)]),
    );
  });
});

describe('sensitivity + offline-pin defaults', () => {
  it('classifies identity documents as PERSONAL_SENSITIVE', () => {
    for (const k of ['CDL', 'MEDICAL_DOCUMENT', 'TWIC'] as const) {
      expect(defaultSensitivityForKind(k)).toBe('PERSONAL_SENSITIVE');
      expect(defaultSubjectForKind(k)).toBe('DRIVER');
    }
  });

  it('classifies tax / factoring / banking / lease documents as FINANCIAL_SENSITIVE', () => {
    for (const k of ['W9', 'FACTORING_NOA', 'BANKING_DOCUMENT', 'LEASE_AGREEMENT'] as const) {
      expect(defaultSensitivityForKind(k)).toBe('FINANCIAL_SENSITIVE');
    }
  });

  it('classifies registration / insurance / IFTA / authority / inspections / permits as STANDARD', () => {
    for (const k of [
      'VEHICLE_REGISTRATION',
      'TRAILER_REGISTRATION',
      'IRP_CAB_CARD',
      'ANNUAL_INSPECTION',
      'INSURANCE',
      'IFTA',
      'OPERATING_PERMIT',
      'OPERATING_AUTHORITY',
      'CERTIFICATE_OF_INSURANCE',
      'UCR',
      'CUSTOM',
    ] as const) {
      expect(defaultSensitivityForKind(k)).toBe('STANDARD');
    }
  });

  it('offlinePinned defaults true for STANDARD/PERSONAL and false for FINANCIAL_SENSITIVE', () => {
    expect(defaultOfflinePinned('STANDARD')).toBe(true);
    expect(defaultOfflinePinned('PERSONAL_SENSITIVE')).toBe(true);
    expect(defaultOfflinePinned('FINANCIAL_SENSITIVE')).toBe(false);
  });
});

describe('validity derivation (calendar days, UTC, EXPIRING_SOON_DAYS = 30)', () => {
  const now = new Date(Date.UTC(2026, 8, 2, 23, 59, 59)); // 2026-09-02 late evening

  it('freezes the 30-day window', () => {
    expect(EXPIRING_SOON_DAYS).toBe(30);
  });

  it('derives all four states with inclusive boundary behaviour', () => {
    expect(deriveValidity(null, now)).toBe('NO_EXPIRATION');
    expect(deriveValidity('2026-09-01', now)).toBe('EXPIRED'); // yesterday
    expect(deriveValidity('2026-09-02', now)).toBe('EXPIRING_SOON'); // today (0 days) is not expired
    expect(deriveValidity('2026-10-02', now)).toBe('EXPIRING_SOON'); // exactly 30 days
    expect(deriveValidity('2026-10-03', now)).toBe('CURRENT'); // 31 days
    expect(deriveValidity('2027-01-01', now)).toBe('CURRENT');
    expect(daysUntilExpiry('2026-10-02', now)).toBe(30);
    expect(daysUntilExpiry('2026-09-01', now)).toBe(-1);
  });

  it('is independent of the time of day and of month boundaries', () => {
    const earlyMorning = new Date(Date.UTC(2026, 8, 2, 0, 0, 1));
    expect(deriveValidity('2026-10-02', earlyMorning)).toBe('EXPIRING_SOON');
    expect(deriveValidity('2026-10-03', earlyMorning)).toBe('CURRENT');
    const feb = new Date(Date.UTC(2028, 1, 1)); // leap year
    expect(daysUntilExpiry('2028-03-02', feb)).toBe(30);
    expect(deriveValidity('2028-03-02', feb)).toBe('EXPIRING_SOON');
    expect(deriveValidity('2028-03-03', feb)).toBe('CURRENT');
  });

  it('treats unparsable expiry as NO_EXPIRATION and validates ISO dates strictly', () => {
    expect(deriveValidity('12/31/2026', now)).toBe('NO_EXPIRATION');
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-2-3')).toBe(false);
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate(null)).toBe(false);
  });
});

describe('masked references', () => {
  it('keeps only the last four alphanumerics behind a mask', () => {
    expect(maskReference('D1234567')).toBe('****4567');
    expect(maskReference('12-3456789')).toBe('****6789');
    expect(maskReference('POL 00 91')).toBe('****0091');
    expect(maskReference('ab')).toBe('****ab');
    expect(maskReference('')).toBeNull();
    expect(maskReference(null)).toBeNull();
  });

  it('recognises masked forms and rejects raw identifiers', () => {
    expect(isMaskedReference('****4567')).toBe(true);
    expect(isMaskedReference('****')).toBe(true);
    expect(isMaskedReference('D1234567')).toBe(false);
    expect(isMaskedReference('****45678')).toBe(false);
    expect(() => validateOperationalDocument(doc({ maskedReference: 'D1234567' }))).toThrow(
      /masked/,
    );
    expect(() => validateOperationalDocument(doc({ maskedReference: '****4567' }))).not.toThrow();
  });
});

describe('document validation', () => {
  it('accepts a well-formed document and rejects bad ids, enums, dates and titles', () => {
    expect(() => validateOperationalDocument(doc())).not.toThrow();
    expect(() => validateOperationalDocument(doc({ id: 'John Smith' }))).toThrow(/opaque/);
    expect(() =>
      validateOperationalDocument(doc({ documentKind: 'PASSPORT' as unknown as 'CDL' })),
    ).toThrow(/document kind/);
    expect(() => validateOperationalDocument(doc({ expiresAt: '31/12/2026' }))).toThrow(
      /YYYY-MM-DD/,
    );
    expect(() => validateOperationalDocument(doc({ title: '   ' }))).toThrow(/title/);
  });
});

describe('immutable version core', () => {
  it('names exactly the immutable fields', () => {
    expect([...DOCUMENT_VERSION_IMMUTABLE_FIELDS]).toEqual([
      'id',
      'operationalDocumentId',
      'accountOwnerId',
      'versionNumber',
      'supersedesVersionId',
      'fileKind',
      'mimeType',
      'extension',
      'byteSize',
      'sha256',
      'createdAt',
    ]);
    expect(Object.keys(immutableCore(version()))).toEqual([...DOCUMENT_VERSION_IMMUTABLE_FIELDS]);
  });

  it('allows cache/cloud state changes but rejects any immutable field change', () => {
    const v = version();
    expect(() =>
      assertImmutableCoreUnchanged(v, {
        ...v,
        cloudStatus: 'synced',
        remoteStorageBucket: 'documents',
        remoteStoragePath: 'x',
        fileCache: { ...v.fileCache, state: 'ERROR' },
      }),
    ).not.toThrow();
    for (const [k, val] of [
      ['sha256', SHA_B],
      ['byteSize', 1],
      ['mimeType', 'application/pdf'],
      ['versionNumber', 2],
      ['id', V2_ID],
      ['accountOwnerId', 'user-b'],
      ['createdAt', 99],
    ] as const) {
      expect(() => assertImmutableCoreUnchanged(v, { ...v, [k]: val })).toThrow(/immutable/);
    }
    expect(
      immutableCoreEquals(immutableCore(v), immutableCore({ ...v, cloudStatus: 'synced' })),
    ).toBe(true);
    expect(immutableCoreEquals(immutableCore(v), immutableCore({ ...v, sha256: SHA_B }))).toBe(
      false,
    );
  });

  it('does not carry an original filename', () => {
    expect(Object.keys(version())).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/filename|originalName/i)]),
    );
  });
});

describe('version replacement rules', () => {
  const d = doc();
  const v1 = version();

  it('version 1 needs no supersession; later versions must supersede the current one', () => {
    expect(() => validateNewVersion(v1, d, [])).not.toThrow();
    const v2 = version({ id: V2_ID, versionNumber: 2, supersedesVersionId: V1_ID, sha256: SHA_B });
    expect(() => validateNewVersion(v2, d, [v1])).not.toThrow();
    expect(() =>
      validateNewVersion(version({ id: V2_ID, versionNumber: 2, supersedesVersionId: null }), d, [
        v1,
      ]),
    ).toThrow(/must supersede/);
  });

  it('rejects duplicate version numbers and ids inside a document', () => {
    expect(() => validateNewVersion(version({ id: V2_ID, versionNumber: 1 }), d, [v1])).toThrow(
      /duplicate versionNumber/,
    );
    expect(() =>
      validateNewVersion(version({ versionNumber: 2, supersedesVersionId: V1_ID }), d, [v1]),
    ).toThrow(/duplicate version id/);
  });

  it('supersession must point at a prior version of the same document', () => {
    const otherDoc = fixedId(9);
    const foreign = version({ id: fixedId(8), operationalDocumentId: otherDoc });
    expect(() =>
      validateNewVersion(
        version({ id: V2_ID, versionNumber: 2, supersedesVersionId: foreign.id }),
        d,
        [v1, foreign],
      ),
    ).toThrow(/same document/);
    // Pointing "forward" (at a higher-numbered version) is rejected.
    const v3 = version({ id: fixedId(7), versionNumber: 3, supersedesVersionId: V1_ID });
    expect(() =>
      validateNewVersion(version({ id: V2_ID, versionNumber: 2, supersedesVersionId: v3.id }), d, [
        v1,
        v3,
      ]),
    ).toThrow(/prior version/);
  });

  it('rejects versions for another document or owner and malformed evidence', () => {
    expect(() => validateNewVersion(version({ operationalDocumentId: fixedId(5) }), d, [])).toThrow(
      /belong/,
    );
    expect(() => validateNewVersion(version({ accountOwnerId: 'user-b' }), d, [])).toThrow(/owner/);
    expect(() => validateNewVersion(version({ sha256: 'nope' }), d, [])).toThrow(/sha256/);
    expect(() => validateNewVersion(version({ byteSize: 0 }), d, [])).toThrow(/byteSize/);
  });

  it('resolves the current version as the highest version number', () => {
    const v2 = version({ id: V2_ID, versionNumber: 2, supersedesVersionId: V1_ID, sha256: SHA_B });
    expect(currentVersion([v2, v1], DOC_ID)?.id).toBe(V2_ID);
    expect(versionsForDocument([v2, v1], DOC_ID).map((v) => v.versionNumber)).toEqual([1, 2]);
    expect(nextVersionNumber([v2, v1], DOC_ID)).toBe(3);
    expect(nextVersionNumber([], DOC_ID)).toBe(1);
    expect(currentVersion([], DOC_ID)).toBeNull();
  });
});

describe('session visibility (account scope)', () => {
  const a = doc({ id: fixedId(11), accountOwnerId: 'user-a' });
  const b = doc({ id: fixedId(12), accountOwnerId: 'user-b' });
  const anon = doc({ id: fixedId(13), accountOwnerId: null });

  it('shows each user only their own documents and never rebinds ownership', () => {
    expect(visibleDocumentsForSession([a, b, anon], 'user-a')).toEqual([a]);
    expect(visibleDocumentsForSession([a, b, anon], 'user-b')).toEqual([b]);
    expect(a.accountOwnerId).toBe('user-a');
    expect(isVisibleInSession(a, 'user-b')).toBe(false);
  });

  it('signed out sees only unowned documents; unowned are never auto-claimed', () => {
    expect(visibleDocumentsForSession([a, b, anon], null)).toEqual([anon]);
    expect(isVisibleInSession(anon, 'user-a')).toBe(false);
    expect(anon.accountOwnerId).toBeNull();
  });
});

describe('analytics-safe summary', () => {
  it('exposes kind/subject/sensitivity/validity only — no title, issuer, reference or ids', () => {
    const summary = analyticsSafeDocumentSummary(
      doc({ title: 'Acme COI', issuer: 'Acme Insurance', maskedReference: '****9999' }),
      new Date(Date.UTC(2026, 8, 2)),
    );
    expect(summary).toEqual({
      documentKind: 'INSURANCE',
      subjectKind: 'CARRIER',
      sensitivity: 'STANDARD',
      hasExpiration: true,
      validity: 'CURRENT',
    });
    const json = JSON.stringify(summary);
    expect(json).not.toContain('Acme');
    expect(json).not.toContain('9999');
    expect(json).not.toContain(DOC_ID);
  });
});

describe('remote mapping', () => {
  it('keeps the same opaque ids remotely and derives the owner-first object key', () => {
    const row = toRemoteVersionRow(version(), 'user-a');
    expect(row.id).toBe(V1_ID);
    expect(row.operational_document_id).toBe(DOC_ID);
    expect(row.storage_bucket).toBe('documents');
    expect(ROAD_WALLET_REMOTE_BUCKET).toBe('documents');
    expect(row.storage_path).toBe(`user-a/road-wallet/${DOC_ID}/${V1_ID}.jpg`);
    expect(remoteVersionPath('u', 'd', 'v', 'pdf')).toBe('u/road-wallet/d/v.pdf');
    expect(Object.keys(row)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/filename|local|uri|relative/i)]),
    );
    const docRow = toRemoteDocumentRow(doc(), 'user-a');
    expect(docRow.id).toBe(DOC_ID);
    expect(docRow.owner_id).toBe('user-a');
    expect(docRow.masked_reference).toBe('****1234');
    expect(Object.keys(docRow)).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/path|_uri$|^uri$|ocr|compliant|filename|raw_/i),
      ]),
    );
  });

  it('matches an existing remote row only when every immutable field agrees', () => {
    const v = version();
    const row = toRemoteVersionRow(v, 'user-a');
    expect(remoteVersionMatches(v, 'user-a', row)).toBe(true);
    expect(
      remoteVersionMatches(v, 'user-a', { ...row, byte_size: '1234' as unknown as number }),
    ).toBe(true);
    expect(remoteVersionMatches(v, 'user-a', { ...row, sha256: SHA_B })).toBe(false);
    expect(remoteVersionMatches(v, 'user-a', { ...row, version_number: 2 })).toBe(false);
    expect(remoteVersionMatches(v, 'user-a', { ...row, owner_id: 'user-b' })).toBe(false);
    expect(remoteVersionMatches(v, 'user-a', {})).toBe(false);
  });
});
