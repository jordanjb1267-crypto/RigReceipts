import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { AllowanceResult, checkAllowance, currentMonthKey, MeteredAction, Tier } from '@/domain';

/**
 * Local subscription + usage state. The tier becomes RevenueCat-driven when the
 * real adapter lands; the monthly counters implement the Section-40 free caps
 * and reset when the month key changes.
 */
interface SubscriptionState {
  tier: Tier;
  monthKey: string;
  used: Record<MeteredAction, number>;
  setTier: (tier: Tier) => void;
  /** Checks the cap for an action this month. */
  allowance: (action: MeteredAction) => AllowanceResult;
  /** Records one use of an action (call after the action succeeds). */
  recordUse: (action: MeteredAction) => void;
}

const EMPTY_USED: Record<MeteredAction, number> = {
  rate_check: 0,
  broker_check: 0,
  compare_to_costs: 0,
};

export const useSubscriptionStore = create<SubscriptionState>()(
  persist(
    (set, get) => ({
      tier: 'free',
      monthKey: currentMonthKey(),
      used: { ...EMPTY_USED },

      setTier: (tier) => set({ tier }),

      allowance: (action) => {
        const s = rolled(get());
        return checkAllowance(s.tier, action, s.used[action]);
      },

      recordUse: (action) => {
        const s = rolled(get());
        set({
          monthKey: s.monthKey,
          used: { ...s.used, [action]: s.used[action] + 1 },
        });
      },
    }),
    {
      name: 'rigreceipts.subscription',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);

/** Rolls counters forward when the calendar month has changed. */
function rolled(s: Pick<SubscriptionState, 'tier' | 'monthKey' | 'used'>): {
  tier: Tier;
  monthKey: string;
  used: Record<MeteredAction, number>;
} {
  const nowKey = currentMonthKey();
  if (s.monthKey === nowKey) return s;
  return { tier: s.tier, monthKey: nowKey, used: { ...EMPTY_USED } };
}
