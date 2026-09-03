import { ScanTypeSlug } from './scanTypes';

/**
 * Provider-neutral storage classification (Refinement C2).
 *
 * Every new binary write names a conceptual storage class; the class — not the
 * caller — decides the physical bucket. Accounting classification is separate:
 * a permit or scale ticket lives in `documents` and can still produce an
 * `expenses` row via `scanTypeToExpenseCategory`.
 */

export const STORAGE_CLASSES = [
  'EXPENSE_RECEIPT',
  'LOAD_DOCUMENT',
  'ROAD_WALLET_DOCUMENT',
  'GENERATED_ARTIFACT',
] as const;
export type StorageClass = (typeof STORAGE_CLASSES)[number];

/** The three private buckets created in `20260716000003_storage.sql`. */
export const STORAGE_BUCKETS = ['receipts', 'documents', 'reports'] as const;
export type StorageBucket = (typeof STORAGE_BUCKETS)[number];

export function bucketForStorageClass(storageClass: StorageClass): StorageBucket {
  switch (storageClass) {
    case 'EXPENSE_RECEIPT':
      return 'receipts';
    case 'LOAD_DOCUMENT':
      return 'documents';
    case 'ROAD_WALLET_DOCUMENT':
      return 'documents';
    case 'GENERATED_ARTIFACT':
      return 'reports';
    default: {
      const exhaustive: never = storageClass;
      return exhaustive;
    }
  }
}

/**
 * Explicit per-scan-type classification for the existing Scan capture path.
 * `other` is ambiguous and keeps the historical receipt behaviour until a user
 * explicitly reclassifies it (future UX).
 */
export const SCAN_TYPE_STORAGE_CLASS: Record<ScanTypeSlug, StorageClass> = {
  receipt: 'EXPENSE_RECEIPT',
  fuel: 'EXPENSE_RECEIPT',
  repair_invoice: 'EXPENSE_RECEIPT',
  lumper: 'EXPENSE_RECEIPT',
  toll: 'EXPENSE_RECEIPT',
  parking: 'EXPENSE_RECEIPT',
  meal: 'EXPENSE_RECEIPT',
  shower: 'EXPENSE_RECEIPT',
  hotel: 'EXPENSE_RECEIPT',
  bol: 'LOAD_DOCUMENT',
  pod: 'LOAD_DOCUMENT',
  inspection: 'LOAD_DOCUMENT',
  permit: 'LOAD_DOCUMENT',
  scale_ticket: 'LOAD_DOCUMENT',
  other: 'EXPENSE_RECEIPT',
};

export function storageClassForScanType(scanType: ScanTypeSlug): StorageClass {
  return SCAN_TYPE_STORAGE_CLASS[scanType];
}

export function bucketForScanType(scanType: ScanTypeSlug): StorageBucket {
  return bucketForStorageClass(storageClassForScanType(scanType));
}
