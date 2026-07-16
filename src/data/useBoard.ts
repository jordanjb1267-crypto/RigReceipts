import { useQuery } from '@tanstack/react-query';

import { BoardData, fetchBoard } from '@/mock/board';
import { useOnboardingStore } from '@/store/onboarding';

/**
 * Home board data. Populated once the user has completed a first useful action
 * during onboarding; otherwise the empty board drives the empty state.
 * Swap `fetchBoard` for the Supabase aggregate query when that loop lands.
 */
export function useBoard() {
  const populated = useOnboardingStore((s) => s.firstActionDone);
  return useQuery<BoardData>({
    queryKey: ['board', { populated }],
    queryFn: () => fetchBoard(populated),
    staleTime: 30_000,
  });
}
