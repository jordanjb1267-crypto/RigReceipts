import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { ScanTypeSlug } from '@/domain';
import { OcrEngineName } from '@/ocr';

/**
 * Local, offline-first capture queue. Scans are saved here immediately and
 * persist across app restarts (spec §7: "store local pending records… avoid
 * data loss on app close"). A later phase syncs `status: 'pending_sync'` rows
 * up to Supabase and flips them to `synced`.
 */
export interface Capture {
  id: string;
  scanType: ScanTypeSlug;
  imageUri: string | null;
  engine: OcrEngineName | null;
  rawText: string;
  vendor: string | null;
  totalUsd: number | null;
  date: string | null;
  gallons: number | null;
  /** pending_sync until an upload succeeds. */
  status: 'pending_sync' | 'synced';
  createdAt: number;
}

export type NewCapture = Omit<Capture, 'id' | 'status' | 'createdAt'>;

interface CapturesState {
  captures: Capture[];
  hydrated: boolean;
  addCapture: (draft: NewCapture) => string;
  removeCapture: (id: string) => void;
  clear: () => void;
}

const makeId = () => `cap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export const useCapturesStore = create<CapturesState>()(
  persist(
    (set) => ({
      captures: [],
      hydrated: false,
      addCapture: (draft) => {
        const id = makeId();
        const capture: Capture = {
          ...draft,
          id,
          status: 'pending_sync',
          createdAt: Date.now(),
        };
        set((s) => ({ captures: [capture, ...s.captures] }));
        return id;
      },
      removeCapture: (id) => set((s) => ({ captures: s.captures.filter((c) => c.id !== id) })),
      clear: () => set({ captures: [] }),
    }),
    {
      name: 'rigreceipts.captures',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ hydrated: _hydrated, ...rest }) => rest,
      onRehydrateStorage: () => () => {
        useCapturesStore.setState({ hydrated: true });
      },
    },
  ),
);

export const selectPendingSyncCount = (s: CapturesState) =>
  s.captures.filter((c) => c.status === 'pending_sync').length;
