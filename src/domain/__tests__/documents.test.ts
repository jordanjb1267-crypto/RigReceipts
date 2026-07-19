import {
  documentTypeForScanType,
  isRecognizedDocScanType,
  ManualLoadDoc,
  presentDocTypesForLoad,
  requiredDocsForLoad,
} from '../documents';

describe('documentTypeForScanType', () => {
  it('maps recognized scan types to load documents', () => {
    expect(documentTypeForScanType('bol')).toBe('bol');
    expect(documentTypeForScanType('repair_invoice')).toBe('repair_receipt');
    expect(documentTypeForScanType('receipt')).toBe('other');
  });
  it('flags recognized doc scan types', () => {
    expect(isRecognizedDocScanType('pod')).toBe(true);
    expect(isRecognizedDocScanType('meal')).toBe(false);
  });
});

describe('requiredDocsForLoad', () => {
  it('requires rate confirmation + POD always, BOL when applicable', () => {
    expect(requiredDocsForLoad(true)).toEqual(['rate_confirmation', 'pod', 'bol']);
    expect(requiredDocsForLoad(false)).toEqual(['rate_confirmation', 'pod']);
  });
});

describe('presentDocTypesForLoad', () => {
  const manual: ManualLoadDoc[] = [
    { loadId: 'L1', docType: 'rate_confirmation', status: 'captured' },
    { loadId: 'L1', docType: 'pod', status: 'missing' }, // missing → not present
    { loadId: 'L2', docType: 'bol', status: 'complete' }, // other load
  ];
  const captures = [
    { loadId: 'L1', scanType: 'bol' }, // → bol
    { loadId: 'L1', scanType: 'meal' }, // → other, ignored
    { loadId: null, scanType: 'pod' }, // unattached, ignored
    { loadId: 'L2', scanType: 'pod' }, // other load
  ];

  it('merges manual docs and attached scans, deduped, per load', () => {
    const present = presentDocTypesForLoad('L1', manual, captures).sort();
    expect(present).toEqual(['bol', 'rate_confirmation']);
  });

  it('excludes missing manual docs and unrecognized/unattached scans', () => {
    expect(presentDocTypesForLoad('L1', manual, captures)).not.toContain('pod');
  });

  it('does not leak across loads', () => {
    expect(presentDocTypesForLoad('L2', manual, captures).sort()).toEqual(['bol', 'pod']);
  });

  it('is empty for a load with nothing attached', () => {
    expect(presentDocTypesForLoad('L3', manual, captures)).toEqual([]);
  });
});
