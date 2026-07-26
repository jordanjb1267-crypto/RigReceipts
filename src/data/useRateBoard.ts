import { useQuery } from '@tanstack/react-query';

import { CommunityRatePost } from '@/domain';
import { fetchLiveRateBoard } from '@/data/rateBoardApi';
import { MOCK_RATE_BOARD } from '@/mock/rateBoard';
import { useAuthStore } from '@/store/auth';

export type RateBoardSource = 'live' | 'sample';

function fetchSampleRateBoard(): Promise<CommunityRatePost[]> {
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

/**
 * Community Rate Board feed. Signed-in users read the live `rate_board_posts`
 * feed (the RLS read policy requires a session and filters removed posts and
 * blocked contributors); signed-out / device-only users see the labeled sample
 * board.
 */
export function useRateBoard() {
  const live = useAuthStore((s) => s.status === 'signed_in');
  const query = useQuery<CommunityRatePost[]>({
    queryKey: ['rateBoard', { live }],
    queryFn: live ? fetchLiveRateBoard : fetchSampleRateBoard,
    staleTime: 30_000,
  });
  return { ...query, source: (live ? 'live' : 'sample') as RateBoardSource };
}
