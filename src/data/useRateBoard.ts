import { useQuery } from '@tanstack/react-query';

import { CommunityRatePost } from '@/domain';
import { MOCK_RATE_BOARD } from '@/mock/rateBoard';

function fetchRateBoard(): Promise<CommunityRatePost[]> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (process.env.EXPO_PUBLIC_MOCK_BOARD_ERROR === '1') {
        reject(new Error('Rate Board temporarily unavailable'));
        return;
      }
      resolve(MOCK_RATE_BOARD);
    }, 350);
  });
}

/** Community Rate Board feed. Swap `fetchRateBoard` for the Supabase query later. */
export function useRateBoard() {
  return useQuery<CommunityRatePost[]>({
    queryKey: ['rateBoard'],
    queryFn: fetchRateBoard,
    staleTime: 30_000,
  });
}
