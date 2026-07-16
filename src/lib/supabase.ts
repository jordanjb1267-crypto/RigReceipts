import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Lazy Supabase client. Auth/session persistence (AsyncStorage) is wired in
 * Phase 3 — nothing imports this at app startup yet.
 */
let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (client) return client;

  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'Supabase is not configured. Copy .env.example to .env and set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.',
    );
  }

  client = createClient(url, anonKey);
  return client;
}
