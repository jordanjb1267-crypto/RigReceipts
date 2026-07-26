import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * Local board preferences: hidden posts, blocked contributors, and saved
 * (watched) lanes. Persisted so a driver's hides/blocks/watchlist survive
 * restarts. Cloud-synced watchlists come with auth.
 */
interface RateBoardState {
  hiddenIds: string[];
  blockedContributors: string[];
  watchedLanes: string[];
  hidePost: (id: string) => void;
  blockContributor: (contributorId: string) => void;
  toggleWatchedLane: (laneKey: string) => void;
  isWatched: (laneKey: string) => boolean;
}

export const useRateBoardStore = create<RateBoardState>()(
  persist(
    (set, get) => ({
      hiddenIds: [],
      blockedContributors: [],
      watchedLanes: [],
      hidePost: (id) =>
        set((s) => (s.hiddenIds.includes(id) ? s : { hiddenIds: [...s.hiddenIds, id] })),
      blockContributor: (contributorId) =>
        set((s) =>
          s.blockedContributors.includes(contributorId)
            ? s
            : { blockedContributors: [...s.blockedContributors, contributorId] },
        ),
      toggleWatchedLane: (laneKey) =>
        set((s) => ({
          watchedLanes: s.watchedLanes.includes(laneKey)
            ? s.watchedLanes.filter((k) => k !== laneKey)
            : [...s.watchedLanes, laneKey],
        })),
      isWatched: (laneKey) => get().watchedLanes.includes(laneKey),
    }),
    {
      name: 'rigreceipts.rateBoard',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
