import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/** Role options (Master Additive Integration Prompt, Section 27). */
export const ROLES = [
  'owner_operator',
  'leased_owner_operator',
  'company_driver',
  'small_fleet',
  'dispatcher_ops',
  'just_starting',
] as const;
export type Role = (typeof ROLES)[number];

/** First-job options (Section 28); each branches to a first useful action. */
export const FIRST_JOBS = [
  'check_rate',
  'scan_rate_con',
  'scan_receipt',
  'track_miles',
  'organize_load',
  'see_community_rates',
] as const;
export type FirstJob = (typeof FIRST_JOBS)[number];

export type AccountMode = 'device' | 'account';

interface OnboardingState {
  role: Role | null;
  firstJob: FirstJob | null;
  /** True once the user completes their first useful action (O5). */
  firstActionDone: boolean;
  onboardingComplete: boolean;
  accountMode: AccountMode | null;
  /** Set once AsyncStorage has been read so the router can gate safely. */
  hydrated: boolean;

  setRole: (role: Role) => void;
  setFirstJob: (job: FirstJob) => void;
  completeFirstAction: () => void;
  finishOnboarding: () => void;
  setAccountMode: (mode: AccountMode) => void;
  reset: () => void;
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set) => ({
      role: null,
      firstJob: null,
      firstActionDone: false,
      onboardingComplete: false,
      accountMode: null,
      hydrated: false,

      setRole: (role) => set({ role }),
      setFirstJob: (firstJob) => set({ firstJob }),
      completeFirstAction: () => set({ firstActionDone: true }),
      finishOnboarding: () => set({ onboardingComplete: true }),
      setAccountMode: (accountMode) => set({ accountMode }),
      reset: () =>
        set({
          role: null,
          firstJob: null,
          firstActionDone: false,
          onboardingComplete: false,
          accountMode: null,
        }),
    }),
    {
      name: 'rigreceipts.onboarding',
      storage: createJSONStorage(() => AsyncStorage),
      // `hydrated` is runtime-only; never persist it.
      partialize: ({ hydrated: _hydrated, ...rest }) => rest,
      onRehydrateStorage: () => () => {
        useOnboardingStore.setState({ hydrated: true });
      },
    },
  ),
);
