import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { LoadStatus } from '@/domain';

/**
 * Local, offline-first load folders. Each is the header record for a run; its
 * documents (BOL/POD/scale/lumper) and detention link in from captures in a
 * later phase. Persisted across restarts like the capture and trip ledgers.
 */
export interface LoadRecord {
  id: string;
  loadNumber: string;
  broker: string | null;
  origin: string | null;
  destination: string | null;
  status: LoadStatus;
  note: string | null;
  createdAt: number;
}

export type NewLoad = Pick<
  LoadRecord,
  'loadNumber' | 'broker' | 'origin' | 'destination' | 'note'
> & {
  status?: LoadStatus;
};

interface LoadsState {
  loads: LoadRecord[];
  hydrated: boolean;
  addLoad: (draft: NewLoad) => string;
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
        const load: LoadRecord = {
          id,
          loadNumber: draft.loadNumber.trim(),
          broker: trimOrNull(draft.broker),
          origin: trimOrNull(draft.origin),
          destination: trimOrNull(draft.destination),
          status: draft.status ?? 'booked',
          note: trimOrNull(draft.note),
          createdAt: Date.now(),
        };
        set((s) => ({ loads: [load, ...s.loads] }));
        return id;
      },
      setStatus: (id, status) =>
        set((s) => ({ loads: s.loads.map((l) => (l.id === id ? { ...l, status } : l)) })),
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
