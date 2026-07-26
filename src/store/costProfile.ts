import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { CostProfile, QUICK_ESTIMATE_PROFILE } from '@/domain';

/**
 * The viewer's saved cost profile, used by Compare to My Costs and the Rate
 * Check. Null until the user sets it up; callers fall back to the Quick Estimate
 * via {@link effectiveCostProfile}.
 */
interface CostProfileState {
  profile: CostProfile | null;
  setProfile: (profile: CostProfile) => void;
  clear: () => void;
}

export const useCostProfileStore = create<CostProfileState>()(
  persist(
    (set) => ({
      profile: null,
      setProfile: (profile) => set({ profile }),
      clear: () => set({ profile: null }),
    }),
    {
      name: 'rigreceipts.costProfile',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);

/** The profile to compute with — the saved one, or the Quick Estimate preset. */
export function effectiveCostProfile(profile: CostProfile | null): CostProfile {
  return profile ?? QUICK_ESTIMATE_PROFILE;
}
