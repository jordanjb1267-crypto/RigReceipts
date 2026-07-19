import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * The driver's truck fuel-economy inputs, used by the Fuel grade to build a
 * price-adjusted expectation (business miles ÷ MPG × diesel price). Both fields
 * are optional; the Fuel grade stays ungradable until MPG is set.
 */
export interface TruckProfile {
  /** Average miles per gallon. Null until configured. */
  avgMpg: number | null;
  /** Fallback diesel price used only when fuel receipts lack gallons. */
  dieselPricePerGallon: number | null;
}

interface TruckProfileState extends TruckProfile {
  setTruckProfile: (patch: Partial<TruckProfile>) => void;
  clear: () => void;
}

export const useTruckProfileStore = create<TruckProfileState>()(
  persist(
    (set) => ({
      avgMpg: null,
      dieselPricePerGallon: null,
      setTruckProfile: (patch) => set((s) => ({ ...s, ...patch })),
      clear: () => set({ avgMpg: null, dieselPricePerGallon: null }),
    }),
    {
      name: 'rigreceipts.truckProfile',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
