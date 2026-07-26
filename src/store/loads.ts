import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { LoadStatus } from '@/domain';

/**
 * Local, offline-first load folders. Each is the header record for a run.
 * Revenue + mileage (added for the Rate grade) are optional so older loads and
 * quick "just a folder" entries stay valid; RPM and rate status are derived,
 * never stored. Documents and receivables link in from their own stores.
 */
export interface LoadRecord {
  id: string;
  loadNumber: string;
  broker: string | null;
  origin: string | null;
  destination: string | null;
  status: LoadStatus;
  note: string | null;
  // Rate grade inputs (optional; null until entered).
  grossRate: number | null;
  fuelSurcharge: number | null;
  loadedMiles: number | null;
  deadheadMiles: number | null;
  /** Whether a BOL is required for this load (Paperwork grade). Defaults true. */
  bolRequired: boolean;
  createdAt: number;
  updatedAt: number;
}

export type NewLoad = Pick<
  LoadRecord,
  'loadNumber' | 'broker' | 'origin' | 'destination' | 'note'
> & {
  status?: LoadStatus;
  grossRate?: number | null;
  fuelSurcharge?: number | null;
  loadedMiles?: number | null;
  deadheadMiles?: number | null;
  bolRequired?: boolean;
};

/** Fields the user can edit on an existing load. */
export type LoadPatch = Partial<
  Pick<
    LoadRecord,
    | 'broker'
    | 'origin'
    | 'destination'
    | 'note'
    | 'status'
    | 'grossRate'
    | 'fuelSurcharge'
    | 'loadedMiles'
    | 'deadheadMiles'
    | 'bolRequired'
  >
>;

interface LoadsState {
  loads: LoadRecord[];
  hydrated: boolean;
  addLoad: (draft: NewLoad) => string;
  updateLoad: (id: string, patch: LoadPatch) => void;
  setStatus: (id: string, status: LoadStatus) => void;
  removeLoad: (id: string) => void;
  clear: () => void;
}

const makeId = () => `load_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const trimOrNull = (v: string | null): string | null => (v && v.trim() ? v.trim() : null);

export const useLoadsStore = create<LoadsState>()(
  persist(
    (set) => ({
      loads: [],
      hydrated: false,
      addLoad: (draft) => {
        const id = makeId();
        const now = Date.now();
        const load: LoadRecord = {
          id,
          loadNumber: draft.loadNumber.trim(),
          broker: trimOrNull(draft.broker),
          origin: trimOrNull(draft.origin),
          destination: trimOrNull(draft.destination),
          status: draft.status ?? 'booked',
          note: trimOrNull(draft.note),
          grossRate: draft.grossRate ?? null,
          fuelSurcharge: draft.fuelSurcharge ?? null,
          loadedMiles: draft.loadedMiles ?? null,
          deadheadMiles: draft.deadheadMiles ?? null,
          bolRequired: draft.bolRequired ?? true,
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({ loads: [load, ...s.loads] }));
        return id;
      },
      updateLoad: (id, patch) =>
        set((s) => ({
          loads: s.loads.map((l) => (l.id === id ? { ...l, ...patch, updatedAt: Date.now() } : l)),
        })),
      setStatus: (id, status) =>
        set((s) => ({
          loads: s.loads.map((l) => (l.id === id ? { ...l, status, updatedAt: Date.now() } : l)),
        })),
      removeLoad: (id) => set((s) => ({ loads: s.loads.filter((l) => l.id !== id) })),
      clear: () => set({ loads: [] }),
    }),
    {
      name: 'rigreceipts.loads',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ hydrated: _hydrated, ...rest }) => rest,
      onRehydrateStorage: () => () => {
        useLoadsStore.setState({ hydrated: true });
      },
    },
  ),
);

/** Back-fills defaults for loads persisted before the revenue fields existed. */
export function normalizeLoad(l: LoadRecord): LoadRecord {
  return {
    ...l,
    grossRate: l.grossRate ?? null,
    fuelSurcharge: l.fuelSurcharge ?? null,
    loadedMiles: l.loadedMiles ?? null,
    deadheadMiles: l.deadheadMiles ?? null,
    bolRequired: l.bolRequired ?? true,
    updatedAt: l.updatedAt ?? l.createdAt,
  };
}
