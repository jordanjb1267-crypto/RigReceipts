import { getSupabaseClient } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';

/**
 * Account self-service: export all of the signed-in user's data, and delete the
 * account. Deletion calls the `delete_current_account` RPC, which removes the
 * user's stored files and their auth user (cascading every owner-scoped row).
 * These back the in-app controls required by App Store 5.1.1(v) and Google Play.
 */

/** Owner-scoped tables included in a data export. RLS returns only the caller's rows. */
export const EXPORT_TABLES = [
  'profiles',
  'subscriptions',
  'trucks',
  'loads',
  'load_documents',
  'document_scans',
  'expenses',
  'receipts',
  'fuel_entries',
  'maintenance_records',
  'mileage_trips',
  'detention_claims',
  'reimbursements',
  'rpm_targets',
  'rate_share_cards',
  'rate_board_posts',
  'rate_post_reports',
  'rate_board_blocks',
  'data_entitlements',
] as const;

export interface ExportBundle {
  format: 'rigreceipts.account_export';
  version: 1;
  exportedAt: string;
  userId: string;
  counts: Record<string, number>;
  records: Record<string, unknown[]>;
}

/** Pure: shapes collected rows into the export bundle (no I/O). */
export function buildExportBundle(
  userId: string,
  records: Record<string, unknown[]>,
  now: Date = new Date(),
): ExportBundle {
  const counts: Record<string, number> = {};
  for (const [table, rows] of Object.entries(records)) {
    counts[table] = rows.length;
  }
  return {
    format: 'rigreceipts.account_export',
    version: 1,
    exportedAt: now.toISOString(),
    userId,
    counts,
    records,
  };
}

/** Gathers every owner-scoped table into an export bundle. */
export async function exportUserData(userId: string): Promise<ExportBundle> {
  const supabase = getSupabaseClient();
  const records: Record<string, unknown[]> = {};
  for (const table of EXPORT_TABLES) {
    const { data, error } = await supabase.from(table).select('*');
    // A single table failing must not sink the whole export.
    records[table] = error ? [] : (data ?? []);
  }
  return buildExportBundle(userId, records);
}

/**
 * Permanently deletes the signed-in user's account and all associated data,
 * then signs out locally. Irreversible.
 */
export async function deleteAccount(): Promise<void> {
  const { error } = await getSupabaseClient().rpc('delete_current_account');
  if (error) throw error;
  await useAuthStore.getState().signOut();
}
