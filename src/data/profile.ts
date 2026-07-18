import { getSupabaseClient } from '@/lib/supabase';
import { Role } from '@/store/onboarding';

/**
 * Bootstraps the signed-in user's rows: upserts their `profiles` record (with
 * the role chosen during onboarding) and ensures a free `subscriptions` row
 * exists. Both tables are owner-scoped by RLS, so this only ever touches the
 * caller's own rows.
 */
export async function bootstrapProfile(userId: string, role: Role | null): Promise<void> {
  const supabase = getSupabaseClient();

  const { error: profileError } = await supabase
    .from('profiles')
    .upsert({ id: userId, role: role ?? undefined }, { onConflict: 'id' });
  if (profileError) throw profileError;

  const { error: subError } = await supabase
    .from('subscriptions')
    .upsert({ owner_id: userId }, { onConflict: 'owner_id', ignoreDuplicates: true });
  if (subError) throw subError;
}

/** Light client-side email shape check before requesting an OTP. */
export function emailLooksValid(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}
