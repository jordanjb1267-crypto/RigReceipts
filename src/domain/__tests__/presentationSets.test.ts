import { newOpaqueId } from '@/domain/documentFiles';
import {
  evaluatePreflightItem,
  fromRemotePresentationSetItemRow,
  fromRemotePresentationSetRow,
  isFinancialBlockedFromQuickPresent,
  isQuickPresentEligibleDocument,
  mergeRecoveredPresentationSet,
  PRESENTATION_SET_CANDIDATE_COPY,
  QUICK_PRESENT_DISCLAIMER,
  QUICK_PRESENT_FORBIDDEN_COPY,
  ROADSIDE_CANDIDATE_KINDS,
  SHIPPER_CANDIDATE_KINDS,
  suggestSystemSetItems,
  summarizePreflight,
  validatePresentationSet,
  validatePresentationSetItem,
  validatePresentationSetName,
} from '@/domain/presentationSets';
import { DocumentVersion, OperationalDocument } from '@/domain/operationalDocuments';

const id = (seed: number) =>
  newOpaqueId(() => new Uint8Array(Array.from({ length: 16 }, (_, i) => (i * 17 + seed) & 0xff)));

const DOC = id(1);
const SET = id(2);
const ITEM = id(3);
const VER = id(4);

const doc = (over: Partial<OperationalDocument> = {}): OperationalDocument => ({
  id: DOC,
  accountOwnerId: 'user-a',
  documentKind: 'CDL',
  subjectKind: 'DRIVER',
  truckId: null,
  trailerNumber: null,
  title: 'CDL',
  issuer: null,
  jurisdiction: null,
  issuedAt: null,
  effectiveAt: null,
  expiresAt: '2027-01-01',
  maskedReference: null,
  sensitivity: 'PERSONAL_SENSITIVE',
  lifecycle: 'ACTIVE',
  offlinePinned: true,
  cloudStatus: 'local_only',
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

const version = (over: Partial<DocumentVersion> = {}): DocumentVersion => ({
  id: VER,
  operationalDocumentId: DOC,
  accountOwnerId: 'user-a',
  versionNumber: 1,
  supersedesVersionId: null,
  fileKind: 'IMAGE',
  mimeType: 'image/jpeg',
  extension: 'jpg',
  byteSize: 10,
  sha256: 'a'.repeat(64),
  relativePath: `road-wallet/${DOC}/${VER}.jpg`,
  fileCache: {
    state: 'READY',
    relativePath: `road-wallet/${DOC}/${VER}.jpg`,
    mimeType: 'image/jpeg',
    byteSize: 10,
    sha256: 'a'.repeat(64),
    error: null,
    verifiedAt: 1,
  },
  cloudStatus: 'local_only',
  remoteStorageBucket: null,
  remoteStoragePath: null,
  createdAt: 1,
  ...over,
});

describe('system set candidates', () => {
  it('Roadside and Shipper are product defaults, never a legal list', () => {
    expect(ROADSIDE_CANDIDATE_KINDS).toEqual([
      'CDL',
      'MEDICAL_DOCUMENT',
      'VEHICLE_REGISTRATION',
      'TRAILER_REGISTRATION',
      'IRP_CAB_CARD',
      'ANNUAL_INSPECTION',
      'INSURANCE',
      'IFTA',
      'OPERATING_PERMIT',
    ]);
    expect(SHIPPER_CANDIDATE_KINDS).toEqual([
      'CDL',
      'TWIC',
      'CERTIFICATE_OF_INSURANCE',
      'INSURANCE',
    ]);
    expect(SHIPPER_CANDIDATE_KINDS).not.toEqual(expect.arrayContaining(['W9', 'FACTORING_NOA']));
  });

  it('suggests only visible ACTIVE non-financial wallet matches', () => {
    const cdl = doc();
    const w9 = doc({
      id: id(8),
      documentKind: 'W9',
      subjectKind: 'CARRIER',
      sensitivity: 'FINANCIAL_SENSITIVE',
      title: 'W-9',
    });
    const other = doc({ id: id(9), accountOwnerId: 'user-b', title: 'Other CDL' });
    const suggested = suggestSystemSetItems('ROADSIDE', [cdl, w9, other], 'user-a');
    expect(suggested.map((d) => d.id)).toEqual([cdl.id]);
  });
});

describe('financial exclusion', () => {
  it('blocks known financial kinds and CUSTOM classified financial', () => {
    expect(isFinancialBlockedFromQuickPresent(doc({ documentKind: 'W9', sensitivity: 'FINANCIAL_SENSITIVE' }))).toBe(
      true,
    );
    expect(
      isFinancialBlockedFromQuickPresent(
        doc({ documentKind: 'CUSTOM', subjectKind: 'GENERAL', sensitivity: 'FINANCIAL_SENSITIVE', title: 'Bank' }),
      ),
    ).toBe(true);
    expect(isQuickPresentEligibleDocument(doc({ documentKind: 'W9', sensitivity: 'FINANCIAL_SENSITIVE' }), 'user-a')).toBe(
      false,
    );
  });
});

describe('validation', () => {
  it('accepts a 1–80 name and opaque custom set', () => {
    expect(validatePresentationSetName('  Roadside pack  ')).toBe('Roadside pack');
    expect(() => validatePresentationSetName('')).toThrow();
    expect(() => validatePresentationSetName('x'.repeat(81))).toThrow();
    validatePresentationSet({
      id: SET,
      accountOwnerId: 'user-a',
      setKind: 'CUSTOM',
      name: 'Mine',
      lifecycle: 'ACTIVE',
      cloudStatus: 'local_only',
      createdAt: 1,
      updatedAt: 1,
    });
    validatePresentationSetItem({
      id: ITEM,
      presentationSetId: SET,
      accountOwnerId: 'user-a',
      operationalDocumentId: DOC,
      position: 0,
      included: true,
    });
  });
});

describe('preflight', () => {
  it('READY only for a freshly verified IMAGE; PDF is external-only; financial is blocked', () => {
    const image = evaluatePreflightItem(DOC, 'user-a', [doc()], [version()]);
    expect(image.state).toBe('READY');
    const pdf = evaluatePreflightItem(DOC, 'user-a', [doc()], [version({ fileKind: 'PDF', mimeType: 'application/pdf' })]);
    expect(pdf.state).toBe('PDF_EXTERNAL_ONLY');
    const fin = evaluatePreflightItem(
      DOC,
      'user-a',
      [doc({ documentKind: 'W9', subjectKind: 'CARRIER', sensitivity: 'FINANCIAL_SENSITIVE' })],
      [version()],
    );
    expect(fin.state).toBe('FINANCIAL_BLOCKED');
    const archived = evaluatePreflightItem(DOC, 'user-a', [doc({ lifecycle: 'ARCHIVED' })], [version()]);
    expect(archived.state).toBe('ARCHIVED');
    const summary = summarizePreflight([image, pdf]);
    expect(summary.overall).toBe('PARTIAL');
    expect(summary.readyCount).toBe(1);
    expect(summarizePreflight([]).overall).toBe('EMPTY');
    expect(summarizePreflight([image]).overall).toBe('READY');
  });

  it('maps cache errors and offers restore only for backed-up missing files', () => {
    const missing = evaluatePreflightItem(
      DOC,
      'user-a',
      [doc()],
      [
        version({
          cloudStatus: 'synced',
          fileCache: {
            state: 'ERROR',
            relativePath: `road-wallet/${DOC}/${VER}.jpg`,
            mimeType: 'image/jpeg',
            byteSize: 10,
            sha256: 'a'.repeat(64),
            error: 'MISSING',
            verifiedAt: null,
          },
        }),
      ],
    );
    expect(missing.state).toBe('MISSING_FILE');
    expect(missing.canRestore).toBe(true);
  });
});

describe('remote mapping + merge', () => {
  it('rejects malformed remote set/item rows', () => {
    const row = {
      id: SET,
      owner_id: 'user-a',
      set_kind: 'CUSTOM',
      name: 'Pack',
      lifecycle: 'ACTIVE',
      created_at: '2026-09-02T00:00:00.000Z',
      updated_at: '2026-09-02T00:00:00.000Z',
    };
    expect(fromRemotePresentationSetRow(row, 'user-a')?.name).toBe('Pack');
    expect(fromRemotePresentationSetRow({ ...row, set_kind: 'SYSTEM_ROADSIDE' }, 'user-a')).toBeNull();
    expect(fromRemotePresentationSetRow({ ...row, owner_id: 'user-b' }, 'user-a')).toBeNull();
    const parent = fromRemotePresentationSetRow(row, 'user-a')!;
    const item = {
      id: ITEM,
      owner_id: 'user-a',
      presentation_set_id: SET,
      operational_document_id: DOC,
      position: 0,
      included: true,
    };
    expect(fromRemotePresentationSetItemRow(item, 'user-a', parent)?.operationalDocumentId).toBe(DOC);
    expect(fromRemotePresentationSetItemRow({ ...item, position: 1.5 }, 'user-a', parent)).toBeNull();
    expect(fromRemotePresentationSetItemRow({ ...item, included: 'yes' }, 'user-a', parent)).toBeNull();
  });

  it('keeps unsynced local sets and replaces only newer synced remote metadata', () => {
    const remote = {
      id: SET,
      accountOwnerId: 'user-a' as const,
      setKind: 'CUSTOM' as const,
      name: 'Remote',
      lifecycle: 'ACTIVE' as const,
      cloudStatus: 'synced' as const,
      createdAt: 1,
      updatedAt: 50,
    };
    expect(mergeRecoveredPresentationSet(undefined, remote).action).toBe('import');
    expect(
      mergeRecoveredPresentationSet({ ...remote, name: 'Local', cloudStatus: 'pending_sync', updatedAt: 1 }, remote)
        .action,
    ).toBe('keep_local');
    expect(
      mergeRecoveredPresentationSet({ ...remote, name: 'Old', updatedAt: 10 }, remote).action,
    ).toBe('replace_metadata');
  });
});

describe('copy safety', () => {
  it('never uses the forbidden compliance phrases', () => {
    const haystack = `${QUICK_PRESENT_DISCLAIMER}\n${PRESENTATION_SET_CANDIDATE_COPY}`;
    for (const phrase of QUICK_PRESENT_FORBIDDEN_COPY) {
      expect(haystack.toLowerCase()).not.toContain(phrase.toLowerCase());
    }
    expect(PRESENTATION_SET_CANDIDATE_COPY).toMatch(/Suggested from the documents in your wallet/);
    expect(PRESENTATION_SET_CANDIDATE_COPY).toMatch(/not required documents/);
    expect(QUICK_PRESENT_DISCLAIMER).toMatch(/Carry originals where required/);
  });
});
