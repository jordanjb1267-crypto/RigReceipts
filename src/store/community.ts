import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { ExistingPostRef } from '@/domain';

/**
 * Community posting state: which terms version the user accepted, and a local
 * record of what they have posted (for duplicate detection). The authoritative
 * posts live server-side once auth + Supabase are wired; this mirrors the user's
 * own posts so the pre-publish duplicate check works offline.
 */
interface CommunityState {
  acknowledgedTermsVersion: string | null;
  myPosts: ExistingPostRef[];
  acknowledge: (version: string) => void;
  addPost: (post: ExistingPostRef) => void;
}

export const useCommunityStore = create<CommunityState>()(
  persist(
    (set) => ({
      acknowledgedTermsVersion: null,
      myPosts: [],
      acknowledge: (version) => set({ acknowledgedTermsVersion: version }),
      addPost: (post) => set((s) => ({ myPosts: [post, ...s.myPosts] })),
    }),
    {
      name: 'rigreceipts.community',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
