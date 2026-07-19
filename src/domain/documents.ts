/**
 * Load document types + workflow status (Paperwork grade). Extends the existing
 * `load_documents.doc_type` set with `repair_receipt` and `settlement`; adds a
 * capture→review→complete workflow status. A document is "present" for grading
 * once it exists in any state other than `missing`.
 */

export const DOCUMENT_TYPES = [
  'rate_confirmation',
  'bol',
  'pod',
  'fuel_receipt',
  'lumper_receipt',
  'toll_receipt',
  'repair_receipt',
  'scale_ticket',
  'settlement',
  'other',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_STATUSES = ['missing', 'captured', 'reviewed', 'complete'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

const DOCUMENT_LABELS: Record<DocumentType, string> = {
  rate_confirmation: 'Rate confirmation',
  bol: 'BOL',
  pod: 'POD',
  fuel_receipt: 'Fuel receipt',
  lumper_receipt: 'Lumper receipt',
  toll_receipt: 'Toll receipt',
  repair_receipt: 'Repair receipt',
  scale_ticket: 'Scale ticket',
  settlement: 'Settlement',
  other: 'Other',
};

export const documentTypeLabel = (t: DocumentType): string => DOCUMENT_LABELS[t] ?? t;

/** A document counts as present for grading once it is anything but `missing`. */
export const isDocumentPresent = (status: DocumentStatus): boolean => status !== 'missing';

/**
 * The documents expected for a completed load. Rate confirmation and POD are
 * always required; BOL is required unless the load opts out (e.g. some drayage
 * / power-only runs). Additional captured documents improve completeness but are
 * never *required*, so they can't fail a driver on their own.
 */
export function requiredDocsForLoad(bolRequired: boolean): DocumentType[] {
  const req: DocumentType[] = ['rate_confirmation', 'pod'];
  if (bolRequired) req.push('bol');
  return req;
}

/** Best-effort mapping from a scan type to a load document type, when linking scans. */
export function documentTypeForScanType(scanType: string): DocumentType {
  switch (scanType) {
    case 'bol':
      return 'bol';
    case 'pod':
      return 'pod';
    case 'fuel':
      return 'fuel_receipt';
    case 'lumper':
      return 'lumper_receipt';
    case 'toll':
      return 'toll_receipt';
    case 'repair_invoice':
      return 'repair_receipt';
    case 'scale_ticket':
      return 'scale_ticket';
    default:
      return 'other';
  }
}

/** A scan type maps to a recognized load document (not the catch-all `other`). */
export const isRecognizedDocScanType = (scanType: string): boolean =>
  documentTypeForScanType(scanType) !== 'other';

export interface ManualLoadDoc {
  loadId: string;
  docType: DocumentType;
  status: DocumentStatus;
}

export interface AttachableCapture {
  loadId?: string | null;
  scanType: string;
}

/**
 * The document types present on a load, merging two sources: manually-marked
 * documents (not `missing`) and captured scans attached to the load whose scan
 * type maps to a recognized document. Deduplicated. Feeds the Paperwork grade.
 */
export function presentDocTypesForLoad(
  loadId: string,
  manualDocs: readonly ManualLoadDoc[],
  captures: readonly AttachableCapture[],
): DocumentType[] {
  const set = new Set<DocumentType>();
  for (const d of manualDocs) {
    if (d.loadId === loadId && isDocumentPresent(d.status)) set.add(d.docType);
  }
  for (const c of captures) {
    if (c.loadId !== loadId) continue;
    const t = documentTypeForScanType(c.scanType);
    if (t !== 'other') set.add(t);
  }
  return [...set];
}
