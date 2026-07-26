import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * Drives the Road-Board "finish setting up" checklist (design handoff §State).
 * Two of the five rows derive from the onboarding store (first load checked,
 * told us how you run) and are never toggled here; the three below are the
 * remaining setup steps. The widget hides once everything is done or dismissed.
 */
interface ActivationState {
  /** Set true when a cost profile is saved (RPM Coach). */
  costsAdded: boolean;
  /** Set true once a mileage session has been started. */
  mileageEnabled: boolean;
  /** Mirrors auth.status === 'signed_in'. */
  accountLinked: boolean;
  /** User hid the widget. */
  dismissed: boolean;
  hydrated: boolean;

  setCostsAdded: (v: boolean) => void;
  setMileageEnabled: (v: boolean) => void;
  setAccountLinked: (v: boolean) => void;
  dismiss: () => void;
  reset: () => void;
  /** True when all three self-managed steps are done. */
  complete: () => boolean;
}

export const useActivationStore = create<ActivationState>()(
  persist(
    (set, get) => ({
      costsAdded: false,
      mileageEnabled: false,
      accountLinked: false,
      dismissed: false,
      hydrated: false,

      setCostsAdded: (costsAdded) => set({ costsAdded }),
      setMileageEnabled: (mileageEnabled) => set({ mileageEnabled }),
      setAccountLinked: (accountLinked) => set({ accountLinked }),
      dismiss: () => set({ dismissed: true }),
      reset: () =>
        set({ costsAdded: false, mileageEnabled: false, accountLinked: false, dismissed: false }),
      complete: () => {
        const s = get();
        return s.costsAdded && s.mileageEnabled && s.accountLinked;
      },
    }),
    {
      name: 'rigreceipts.activation',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ hydrated: _hydrated, ...rest }) => rest,
      onRehydrateStorage: () => () => {
        useActivationStore.setState({ hydrated: true });
      },
    },
  ),
);
