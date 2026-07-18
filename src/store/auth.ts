import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';

import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase';

/**
 * Auth session state. Not persisted here — supabase-js persists the session in
 * AsyncStorage itself; this store mirrors it for the UI. When Supabase is not
 * configured the app stays in device-only mode (`status: 'unconfigured'`).
 */
export type AuthStatus = 'unconfigured' | 'loading' | 'signed_out' | 'signed_in';

interface AuthState {
  status: AuthStatus;
  session: Session | null;
  userId: string | null;
  /** Idempotent: subscribes to auth changes and loads the stored session. */
  init: () => void;
  signOut: () => Promise<void>;
}

let initialized = false;

export const useAuthStore = create<AuthState>((set) => ({
  status: isSupabaseConfigured() ? 'loading' : 'unconfigured',
  session: null,
  userId: null,

  init: () => {
    if (initialized || !isSupabaseConfigured()) return;
    initialized = true;
    const supabase = getSupabaseClient();

    supabase.auth
      .getSession()
      .then(({ data }) => {
        set({
          session: data.session,
          userId: data.session?.user.id ?? null,
          status: data.session ? 'signed_in' : 'signed_out',
        });
      })
      .catch(() => set({ status: 'signed_out' }));

    supabase.auth.onAuthStateChange((_event, session) => {
      set({
        session,
        userId: session?.user.id ?? null,
        status: session ? 'signed_in' : 'signed_out',
      });
    });
  },

  signOut: async () => {
    if (!isSupabaseConfigured()) return;
    await getSupabaseClient().auth.signOut();
  },
}));
