import { DocumentType } from '@/domain';
import { useCapturesStore } from '@/store/captures';
import { useLoadDocsStore } from '@/store/loadDocs';

/**
 * After explicit user confirmation, file a capture on a load and update the
 * local paperwork slot. Uses existing product mechanisms only.
 *
 * Does not send, share, mark delivered, or mark recipient-accepted.
 */
export function attachConfirmedCaptureToLoad(
  captureId: string,
  loadId: string,
  docType: DocumentType,
): void {
  useCapturesStore.getState().assignCaptureToLoad(captureId, loadId);
  useLoadDocsStore.getState().setDoc(loadId, docType, 'captured', captureId);
}
