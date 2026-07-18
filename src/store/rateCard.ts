import { create } from 'zustand';

import { DEFAULT_CARD_VISIBILITY, RateCardSource, RateCardVisibility } from '@/domain';

/**
 * Holds the draft rate card while the sharing flow is open. Not persisted — a
 * card is generated on demand from a rate check or load, and the modal reads it.
 */
interface RateCardState {
  source: RateCardSource | null;
  visibility: RateCardVisibility;
  setSource: (source: RateCardSource) => void;
  setVisibility: (patch: Partial<RateCardVisibility>) => void;
  reset: () => void;
}

export const useRateCardStore = create<RateCardState>((set) => ({
  source: null,
  visibility: { ...DEFAULT_CARD_VISIBILITY },
  setSource: (source) => set({ source, visibility: { ...DEFAULT_CARD_VISIBILITY } }),
  setVisibility: (patch) => set((s) => ({ visibility: { ...s.visibility, ...patch } })),
  reset: () => set({ source: null, visibility: { ...DEFAULT_CARD_VISIBILITY } }),
}));
