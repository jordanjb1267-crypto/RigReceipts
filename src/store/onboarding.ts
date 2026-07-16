import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/** Role options from the Master Build Prompt (Screen O3). */
export const ROLES = ['company_driver', 'owner_operator', 'small_fleet', 'hotshot_local'] as const;
export type Role = (typeof ROLES)[number];

/** First-job options from Screen O4; each branches to a first useful action. */
export const FIRST_JOBS = [
  'scan_receipts',
  'save_load_docs',
  'track_money_owed',
  'check_rate',
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
