import { useQuery } from '@tanstack/react-query';

import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase';

/**
 * Owner-scoped truck list for Road Wallet truck association (Pass 1B §11).
 * Trucks live only in the remote `trucks` table (RLS: own rows), so this is
 * empty in device-only / signed-out mode — documents then store `truckId = null`.
 * The same-owner database FK on `operational_documents` remains the guarantee;
 * this list just lets the UI offer the right options.
 */
export interface OwnedTruck {
  id: string;
  ownerId: string;
  unitName: string;
}

interface TruckRow {
  id: string;
  owner_id: string;
  unit_name: string;
}

/** Keeps only rows that genuinely belong to `userId` (defensive on top of RLS). */
export function ownedTrucksFromRows(rows: readonly TruckRow[], userId: string): OwnedTruck[] {
  return rows
    .filter((r) => r.owner_id === userId && typeof r.id === 'string')
    .map((r) => ({ id: r.id, ownerId: r.owner_id, unitName: r.unit_name || 'Unit' }));
}

export async function fetchOwnedTrucks(userId: string | null): Promise<OwnedTruck[]> {
  if (!userId || !isSupabaseConfigured()) return [];
  const { data, error } = await getSupabaseClient()
    .from('trucks')
    .select('id, owner_id, unit_name')
    .eq('owner_id', userId)
    .order('unit_name');
  if (error || !data) return [];
  return ownedTrucksFromRows(data as TruckRow[], userId);
}

export function useOwnedTrucks(userId: string | null) {
  return useQuery({
    queryKey: ['owned-trucks', userId],
    queryFn: () => fetchOwnedTrucks(userId),
    enabled: !!userId && isSupabaseConfigured(),
    staleTime: 60_000,
  });
}

/** Label for a persisted truck association, or null when it does not resolve for this account. */
export function resolveTruckLabel(
  truckId: string | null,
  trucks: readonly OwnedTruck[] | undefined,
): string | null {
  if (!truckId) return null;
  return trucks?.find((t) => t.id === truckId)?.unitName ?? null;
}
