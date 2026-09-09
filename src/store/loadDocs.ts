import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { DocumentStatus, DocumentType } from '@/domain';

/**
 * Load paperwork *slot* (the load packet). Local, offline-first, keyed by
 * loadId + docType. This is the current local status for a requirement type —
 * not a versioned artifact and not a Road Wallet DocumentVersion.
 * Multiple same-type captures attach as artifacts; this slot points at the
 * current `scanId` after explicit confirmation. A document is "present" for the
 * Paperwork grade once its status is anything but `missing`.
 */
export interface LoadDocRecord {
  id: string;
  loadId: string;
  docType: DocumentType;
  status: DocumentStatus;
  /** Linked capture id, when the doc came from a scan. */
  scanId: string | null;
  createdAt: number;
  updatedAt: number;
}

interface LoadDocsState {
  docs: LoadDocRecord[];
  hydrated: boolean;
  /** Upsert a document for a load+type (marking it captured/reviewed/complete). */
  setDoc: (
    loadId: string,
    docType: DocumentType,
    status: DocumentStatus,
    scanId?: string | null,
  ) => void;
  removeDoc: (loadId: string, docType: DocumentType) => void;
  removeForLoad: (loadId: string) => void;
  clear: () => void;
}

const makeId = () => `ldoc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export const useLoadDocsStore = create<LoadDocsState>()(
  persist(
    (set) => ({
      docs: [],
      hydrated: false,
      setDoc: (loadId, docType, status, scanId = null) =>
        set((s) => {
          const now = Date.now();
          const existing = s.docs.find((d) => d.loadId === loadId && d.docType === docType);
          if (existing) {
            return {
              docs: s.docs.map((d) =>
                d.id === existing.id ? { ...d, status, scanId, updatedAt: now } : d,
              ),
            };
          }
          const record: LoadDocRecord = {
            id: makeId(),
            loadId,
            docType,
            status,
            scanId,
            createdAt: now,
            updatedAt: now,
          };
          return { docs: [record, ...s.docs] };
        }),
      removeDoc: (loadId, docType) =>
        set((s) => ({
          docs: s.docs.filter((d) => !(d.loadId === loadId && d.docType === docType)),
        })),
      removeForLoad: (loadId) => set((s) => ({ docs: s.docs.filter((d) => d.loadId !== loadId) })),
      clear: () => set({ docs: [] }),
    }),
    {
      name: 'rigreceipts.loadDocs',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ hydrated: _hydrated, ...rest }) => rest,
      onRehydrateStorage: () => () => {
        useLoadDocsStore.setState({ hydrated: true });
      },
    },
  ),
);
