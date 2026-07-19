import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { BrokerExperience } from '@/domain';

/**
 * The driver's private broker watchlist and logged experiences. Local-only for
 * now (the additive spec keeps broker history private to the driver); a later
 * phase can sync it. Feeds Broker Check summaries.
 */
export interface BrokerRecord {
  id: string;
  name: string;
  mcNumber: string | null;
  experiences: BrokerExperience[];
  createdAt: number;
}

interface BrokerWatchState {
  brokers: BrokerRecord[];
  addBroker: (name: string, mcNumber?: string | null) => string;
  logExperience: (id: string, experience: BrokerExperience) => void;
  removeBroker: (id: string) => void;
}

const makeId = () => `brk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export const useBrokerWatchStore = create<BrokerWatchState>()(
  persist(
    (set) => ({
      brokers: [],
      addBroker: (name, mcNumber) => {
        const id = makeId();
        set((s) => ({
          brokers: [
            {
              id,
              name: name.trim(),
              mcNumber: mcNumber?.trim() || null,
              experiences: [],
              createdAt: Date.now(),
            },
            ...s.brokers,
          ],
        }));
        return id;
      },
      logExperience: (id, experience) =>
        set((s) => ({
          brokers: s.brokers.map((b) =>
            b.id === id ? { ...b, experiences: [experience, ...b.experiences] } : b,
          ),
        })),
      removeBroker: (id) => set((s) => ({ brokers: s.brokers.filter((b) => b.id !== id) })),
    }),
    {
      name: 'rigreceipts.brokerWatch',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
