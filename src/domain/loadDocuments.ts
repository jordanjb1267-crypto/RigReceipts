/**
 * Product-local load paperwork reconciliation.
 *
 * `LoadDocument != OperationalDocument != CarrierPacket`.
 * This module does not mint Road Wallet `DocumentVersion`s, does not share
 * Carrier Packet identity, and does not invent a universal document model.
 *
 * Canonical distinctions for load paperwork:
 *   DocumentRequirement  — a derived need on a load (POD required, …)
 *   DocumentArtifact     — a captured or manually recorded instance
 *   DocumentVersion      — Road Wallet only; load paperwork never creates one
 *
 * Persistence stays as it is:
 *   - `LoadDocRecord` remains the one local paperwork *slot* per
 *     `(loadId, docType)` — current missing/captured/reviewed/complete status.
 *   - Multiple same-type instances live as attached captures (artifacts).
 *   - Stops are not in the current load-document domain; they are not invented.
 *   - Revised/rescanned documents: prior captures remain; the slot's `scanId`
 *     points at the latest explicitly confirmed artifact.
 *
 * Local statuses (`missing` / `captured` / `reviewed` / `complete`) are
 * paperwork semantics only.
 *   local complete  !=  shared
 *   local complete  !=  delivered
 *   local complete  !=  recipient accepted
 */

import {
  AttachableCapture,
  DOCUMENT_STATUSES,
  DOCUMENT_TYPES,
  DocumentStatus,
  DocumentType,
  documentTypeForScanType,
  documentTypeLabel,
  isDocumentPresent,
  ManualLoadDoc,
  presentDocTypesForLoad,
  requiredDocsForLoad,
} from './documents';
import { ScanTypeSlug, scanTypeToExpenseCategory } from './scanTypes';
import { StorageClass, storageClassForScanType } from './storageClass';

/** Local paperwork states. Never shared / delivered / accepted. */
export const LOAD_PAPERWORK_LOCAL_STATUSES = DOCUMENT_STATUSES;
export type LoadPaperworkLocalStatus = DocumentStatus;

/**
 * Inert, provider-neutral projection. Values cannot manufacture delivery or
 * acceptance truth. No production provider is bound here.
 */
export const LOAD_DOCUMENT_EXCHANGE_STATES = ['not_projected', 'local_only', 'unknown'] as const;
export type LoadDocumentExchangeState = (typeof LOAD_DOCUMENT_EXCHANGE_STATES)[number];

export interface LoadDocumentExchangeProjection {
  providerKind: 'unspecified';
  state: LoadDocumentExchangeState;
}

export const DEFAULT_LOAD_DOCUMENT_EXCHANGE: LoadDocumentExchangeProjection = {
  providerKind: 'unspecified',
  state: 'local_only',
};

export type LoadDocumentRequirementState = 'open' | 'satisfied';

export interface LoadDocumentRequirement {
  loadId: string;
  docType: DocumentType;
  required: boolean;
  label: string;
  /** Slot status when a `LoadDocRecord` exists; otherwise `missing`. */
  localStatus: LoadPaperworkLocalStatus;
  state: LoadDocumentRequirementState;
  artifactCount: number;
  /** Current slot pointer; not a Road Wallet version id. */
  currentArtifactId: string | null;
  exchange: LoadDocumentExchangeProjection;
}

export type LoadDocumentArtifactSource = 'capture' | 'manual_slot';

export interface LoadDocumentArtifact {
  id: string;
  loadId: string;
  docType: DocumentType;
  source: LoadDocumentArtifactSource;
  captureId: string | null;
  localStatus: LoadPaperworkLocalStatus;
  exchange: LoadDocumentExchangeProjection;
}

export interface LoadDocumentReconciliation {
  loadId: string;
  requirements: LoadDocumentRequirement[];
  artifacts: LoadDocumentArtifact[];
  /**
   * Honest capability notes. `loadId + docType` is a status slot, not a
   * versioned artifact identity.
   */
  slotUniqueness: 'loadId_plus_docType';
  multipleSameTypeVia: 'capture_artifacts';
  stopScopedDocuments: false;
  immutableVersionHistory: 'road_wallet_document_version_only';
}

export interface LoadPaperworkSlot {
  id: string;
  loadId: string;
  docType: DocumentType;
  status: LoadPaperworkLocalStatus;
  scanId: string | null;
}

export interface LoadPaperworkCapture {
  id: string;
  loadId?: string | null;
  scanType: string;
  intendedDocType?: DocumentType | null;
}

/**
 * Best scan type for a load-document requirement. Unmapped types stay `other`
 * and rely on `intendedDocType` so we do not invent a second taxonomy.
 */
/**
 * Load-document types that must not book an expense when captured via `other`
 * (or any expense-mapped scan type) with an explicit intendedDocType.
 * Rate confirmation has no dedicated scan slug — the 15-type canon is unchanged.
 */
export const NON_EXPENSE_LOAD_DOC_TYPES: readonly DocumentType[] = [
  'rate_confirmation',
  'bol',
  'pod',
  'settlement',
];

export function scanTypeForDocumentType(docType: DocumentType): ScanTypeSlug {
  switch (docType) {
    case 'rate_confirmation':
      return 'other';
    case 'bol':
      return 'bol';
    case 'pod':
      return 'pod';
    case 'fuel_receipt':
      return 'fuel';
    case 'lumper_receipt':
      return 'lumper';
    case 'toll_receipt':
      return 'toll';
    case 'repair_receipt':
      return 'repair_invoice';
    case 'scale_ticket':
      return 'scale_ticket';
    case 'settlement':
      return 'other';
    case 'other':
      return 'other';
    default: {
      const exhaustive: never = docType;
      return exhaustive;
    }
  }
}

/** Resolve the load-document type a capture represents. */
export function expenseCategoryForCapture(capture: {
  scanType: ScanTypeSlug;
  intendedDocType?: DocumentType | null;
}) {
  if (capture.intendedDocType && NON_EXPENSE_LOAD_DOC_TYPES.includes(capture.intendedDocType)) {
    return null;
  }
  return scanTypeToExpenseCategory(capture.scanType);
}

export function storageClassForCapture(capture: {
  scanType: ScanTypeSlug;
  intendedDocType?: DocumentType | null;
}): StorageClass {
  if (capture.intendedDocType && NON_EXPENSE_LOAD_DOC_TYPES.includes(capture.intendedDocType)) {
    return 'LOAD_DOCUMENT';
  }
  return storageClassForScanType(capture.scanType);
}

export function resolvedLoadDocType(
  capture: Pick<AttachableCapture, 'scanType' | 'intendedDocType'>,
): DocumentType | null {
  if (capture.intendedDocType) return capture.intendedDocType;
  const mapped = documentTypeForScanType(capture.scanType);
  return mapped === 'other' ? null : mapped;
}

export function isLoadPaperworkLocalStatus(value: string): value is LoadPaperworkLocalStatus {
  return (LOAD_PAPERWORK_LOCAL_STATUSES as readonly string[]).includes(value);
}

export function isLoadDocumentExchangeState(value: string): value is LoadDocumentExchangeState {
  return (LOAD_DOCUMENT_EXCHANGE_STATES as readonly string[]).includes(value);
}

/**
 * Exchange projections cannot hold delivery or acceptance. Those words are
 * rejected so UI/tests cannot accidentally promote local paperwork.
 */
export function assertInertExchangeProjection(
  projection: LoadDocumentExchangeProjection,
): LoadDocumentExchangeProjection {
  if (projection.providerKind !== 'unspecified') {
    throw new Error('exchange projection must stay provider-neutral');
  }
  if (!isLoadDocumentExchangeState(projection.state)) {
    throw new Error('exchange projection state is not inert');
  }
  return projection;
}

export function reconcileLoadDocuments(input: {
  loadId: string;
  bolRequired: boolean;
  slots: readonly LoadPaperworkSlot[];
  captures: readonly LoadPaperworkCapture[];
}): LoadDocumentReconciliation {
  const present = new Set(
    presentDocTypesForLoad(
      input.loadId,
      input.slots.map((s) => ({
        loadId: s.loadId,
        docType: s.docType,
        status: s.status,
      })),
      input.captures,
    ),
  );

  const artifacts: LoadDocumentArtifact[] = [];
  for (const capture of input.captures) {
    if (capture.loadId !== input.loadId) continue;
    const docType = resolvedLoadDocType(capture);
    if (!docType) continue;
    artifacts.push({
      id: capture.id,
      loadId: input.loadId,
      docType,
      source: 'capture',
      captureId: capture.id,
      localStatus: 'captured',
      exchange: DEFAULT_LOAD_DOCUMENT_EXCHANGE,
    });
  }

  const usedSlotIds = new Set(artifacts.map((a) => a.captureId).filter(Boolean));
  for (const slot of input.slots) {
    if (slot.loadId !== input.loadId) continue;
    if (!isDocumentPresent(slot.status)) continue;
    if (slot.scanId && usedSlotIds.has(slot.scanId)) continue;
    artifacts.push({
      id: slot.id,
      loadId: input.loadId,
      docType: slot.docType,
      source: 'manual_slot',
      captureId: slot.scanId,
      localStatus: slot.status,
      exchange: DEFAULT_LOAD_DOCUMENT_EXCHANGE,
    });
  }

  const required = requiredDocsForLoad(input.bolRequired);
  const extraTypes = new Set<DocumentType>([
    ...required,
    ...input.slots.filter((s) => s.loadId === input.loadId).map((s) => s.docType),
    ...artifacts.map((a) => a.docType),
  ]);

  const requirements: LoadDocumentRequirement[] = DOCUMENT_TYPES.filter((docType) =>
    extraTypes.has(docType),
  ).map((docType) => {
    const slot = input.slots.find((s) => s.loadId === input.loadId && s.docType === docType);
    const typeArtifacts = artifacts.filter((a) => a.docType === docType);
    const requiredForLoad = required.includes(docType);
    const localStatus = slot?.status ?? 'missing';
    const satisfied = present.has(docType);
    return {
      loadId: input.loadId,
      docType,
      required: requiredForLoad,
      label: documentTypeLabel(docType),
      localStatus,
      state: satisfied ? 'satisfied' : 'open',
      artifactCount: typeArtifacts.length,
      currentArtifactId: slot?.scanId ?? typeArtifacts[0]?.id ?? null,
      exchange: DEFAULT_LOAD_DOCUMENT_EXCHANGE,
    };
  });

  return {
    loadId: input.loadId,
    requirements,
    artifacts,
    slotUniqueness: 'loadId_plus_docType',
    multipleSameTypeVia: 'capture_artifacts',
    stopScopedDocuments: false,
    immutableVersionHistory: 'road_wallet_document_version_only',
  };
}

export function missingRequiredDocTypes(
  loadId: string,
  bolRequired: boolean,
  manualDocs: readonly ManualLoadDoc[],
  captures: readonly AttachableCapture[],
): DocumentType[] {
  const present = new Set(presentDocTypesForLoad(loadId, manualDocs, captures));
  return requiredDocsForLoad(bolRequired).filter((t) => !present.has(t));
}

export const LOAD_DOCUMENT_IDENTITY_NOTE =
  'Load paperwork uses a local (loadId, docType) status slot plus capture artifacts. Road Wallet DocumentVersion and CarrierPacketItem identity are unchanged.';
