import { SCAN_TYPES, scanTypeToExpenseCategory, ScanTypeSlug } from '../scanTypes';
import {
  bucketForScanType,
  bucketForStorageClass,
  SCAN_TYPE_STORAGE_CLASS,
  STORAGE_BUCKETS,
  STORAGE_CLASSES,
  StorageClass,
  storageClassForScanType,
} from '../storageClass';

describe('storage classes -> buckets (C2)', () => {
  it('maps every class to exactly the handoff bucket', () => {
    expect(bucketForStorageClass('EXPENSE_RECEIPT')).toBe('receipts');
    expect(bucketForStorageClass('LOAD_DOCUMENT')).toBe('documents');
    expect(bucketForStorageClass('ROAD_WALLET_DOCUMENT')).toBe('documents');
    expect(bucketForStorageClass('GENERATED_ARTIFACT')).toBe('reports');
  });

  it('is exhaustive over the class list and only ever names a known bucket', () => {
    expect(STORAGE_CLASSES).toEqual([
      'EXPENSE_RECEIPT',
      'LOAD_DOCUMENT',
      'ROAD_WALLET_DOCUMENT',
      'GENERATED_ARTIFACT',
    ]);
    for (const cls of STORAGE_CLASSES) {
      expect(STORAGE_BUCKETS).toContain(bucketForStorageClass(cls));
    }
  });
});

describe('scan type -> storage class (explicit, not inferred from accounting)', () => {
  const RECEIPTS: ScanTypeSlug[] = [
    'receipt',
    'fuel',
    'repair_invoice',
    'lumper',
    'toll',
    'parking',
    'meal',
    'shower',
    'hotel',
  ];
  const DOCUMENTS: ScanTypeSlug[] = ['bol', 'pod', 'inspection', 'permit', 'scale_ticket'];

  it('sends receipt-like scans to receipts', () => {
    for (const t of RECEIPTS) {
      expect(storageClassForScanType(t)).toBe<StorageClass>('EXPENSE_RECEIPT');
      expect(bucketForScanType(t)).toBe('receipts');
    }
  });

  it('sends BOL/POD/inspection/permit/scale ticket to documents', () => {
    for (const t of DOCUMENTS) {
      expect(storageClassForScanType(t)).toBe<StorageClass>('LOAD_DOCUMENT');
      expect(bucketForScanType(t)).toBe('documents');
    }
  });

  it('keeps ambiguous "other" on the historical receipts default', () => {
    expect(storageClassForScanType('other')).toBe('EXPENSE_RECEIPT');
    expect(bucketForScanType('other')).toBe('receipts');
  });

  it('classifies every canonical scan type exactly once', () => {
    const covered = [...RECEIPTS, ...DOCUMENTS, 'other'];
    expect(new Set(covered).size).toBe(SCAN_TYPES.length);
    for (const { slug } of SCAN_TYPES) {
      expect(SCAN_TYPE_STORAGE_CLASS[slug]).toBeDefined();
      expect(STORAGE_CLASSES).toContain(SCAN_TYPE_STORAGE_CLASS[slug]);
    }
  });

  it('keeps accounting classification independent of storage classification', () => {
    // Stored in documents, still books an expense.
    expect(bucketForScanType('permit')).toBe('documents');
    expect(scanTypeToExpenseCategory('permit')).toBe('permits_registration');
    expect(bucketForScanType('scale_ticket')).toBe('documents');
    expect(scanTypeToExpenseCategory('scale_ticket')).toBe('scales');
    // Stored in documents, never an expense.
    expect(bucketForScanType('bol')).toBe('documents');
    expect(scanTypeToExpenseCategory('bol')).toBeNull();
    // Stored in receipts, books an expense.
    expect(bucketForScanType('fuel')).toBe('receipts');
    expect(scanTypeToExpenseCategory('fuel')).toBe('fuel');
  });
});
