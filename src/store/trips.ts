import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * Manually-entered mileage trips. Local, offline-first, and persisted across
 * restarts like the capture queue. Live GPS trips (Phase 10) will append to the
 * same ledger later; for now every trip is hand-entered loaded + deadhead miles.
 */
export interface TripRecord {
  id: string;
  /** ISO `YYYY-MM-DD`, or null to fall back to `createdAt`. */
  date: string | null;
  loadedMiles: number;
  deadheadMiles: number;
  note: string | null;
  createdAt: number;
}

export type NewTrip = Pick<TripRecord, 'date' | 'loadedMiles' | 'deadheadMiles' | 'note'>;

interface TripsState {
  trips: TripRecord[];
  hydrated: boolean;
  addTrip: (draft: NewTrip) => string;
  removeTrip: (id: string) => void;
  clear: () => void;
}

const makeId = () => `trip_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export const useTripsStore = create<TripsState>()(
  persist(
    (set) => ({
      trips: [],
      hydrated: false,
      addTrip: (draft) => {
        const id = makeId();
        const trip: TripRecord = { ...draft, id, createdAt: Date.now() };
        set((s) => ({ trips: [trip, ...s.trips] }));
        return id;
      },
      removeTrip: (id) => set((s) => ({ trips: s.trips.filter((t) => t.id !== id) })),
      clear: () => set({ trips: [] }),
    }),
    {
      name: 'rigreceipts.trips',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ hydrated: _hydrated, ...rest }) => rest,
      onRehydrateStorage: () => () => {
        useTripsStore.setState({ hydrated: true });
      },
    },
  ),
);
