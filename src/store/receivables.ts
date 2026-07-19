import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { ReceivableStatus, ReceivableType } from '@/domain';

/**
 * Load-linked receivables — money the driver is owed (detention, lumper,
 * reimbursement, …). Local, offline-first child records keyed by loadId. Feeds
 * the Money Owed grade.
 */
export interface ReceivableRecord {
  id: string;
  loadId: string | null;
  type: ReceivableType;
  description: string | null;
  amountExpected: number;
  amountReceived: number;
  status: ReceivableStatus;
  /** ISO dates, or null. */
  dateIncurred: string | null;
  dateSubmitted: string | null;
  dateDue: string | null;
  dateReceived: string | null;
  supportingDocumentId: string | null;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
}

export type NewReceivable = Pick<
  ReceivableRecord,
  'loadId' | 'type' | 'description' | 'amountExpected'
> & {
  amountReceived?: number;
  status?: ReceivableStatus;
  dateIncurred?: string | null;
  dateSubmitted?: string | null;
  dateDue?: string | null;
};

export type ReceivablePatch = Partial<
  Pick<
    ReceivableRecord,
    'type' | 'description' | 'amountExpected' | 'amountReceived' | 'status' | 'dateReceived'
  >
>;

interface ReceivablesState {
  receivables: ReceivableRecord[];
  hydrated: boolean;
  addReceivable: (draft: NewReceivable) => string;
  updateReceivable: (id: string, patch: ReceivablePatch) => void;
  removeReceivable: (id: string) => void;
  clear: () => void;
}

const makeId = () => `rcv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export const useReceivablesStore = create<ReceivablesState>()(
  persist(
    (set) => ({
      receivables: [],
      hydrated: false,
      addReceivable: (draft) => {
        const id = makeId();
        const now = Date.now();
        const record: ReceivableRecord = {
          id,
          loadId: draft.loadId,
          type: draft.type,
          description: draft.description?.trim() || null,
          amountExpected: Math.max(0, draft.amountExpected),
          amountReceived: Math.max(0, draft.amountReceived ?? 0),
          status: draft.status ?? 'expected',
          dateIncurred: draft.dateIncurred ?? null,
          dateSubmitted: draft.dateSubmitted ?? null,
          dateDue: draft.dateDue ?? null,
          dateReceived: null,
          supportingDocumentId: null,
          notes: null,
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({ receivables: [record, ...s.receivables] }));
        return id;
      },
      updateReceivable: (id, patch) =>
        set((s) => ({
          receivables: s.receivables.map((r) =>
            r.id === id ? { ...r, ...patch, updatedAt: Date.now() } : r,
          ),
        })),
      removeReceivable: (id) =>
        set((s) => ({ receivables: s.receivables.filter((r) => r.id !== id) })),
      clear: () => set({ receivables: [] }),
    }),
    {
      name: 'rigreceipts.receivables',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ hydrated: _hydrated, ...rest }) => rest,
      onRehydrateStorage: () => () => {
        useReceivablesStore.setState({ hydrated: true });
      },
    },
  ),
);
