import { create } from 'zustand';

import { DocumentType, ScanTypeSlug } from '@/domain';

/**
 * Ephemeral scan launch context. Not persisted. Cleared after save or discard.
 * Lets a load requirement open the Scan tab with loadId + document type without
 * silently trusting OCR or auto-sending anything.
 */
export interface ScanLaunchContext {
  loadId: string;
  intendedDocType: DocumentType;
  scanType: ScanTypeSlug;
  sourceAction: string;
}

interface ScanContextState {
  context: ScanLaunchContext | null;
  setContext: (context: ScanLaunchContext | null) => void;
  clear: () => void;
}

export const useScanContextStore = create<ScanContextState>((set) => ({
  context: null,
  setContext: (context) => set({ context }),
  clear: () => set({ context: null }),
}));
