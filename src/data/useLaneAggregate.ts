import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  computeLaneAggregate,
  EligiblePost,
  EquipmentType,
  LaneAggregate,
  LaneConfidence,
  laneKey,
} from '@/domain';
import { useRateBoard } from '@/data/useRateBoard';
import { getSupabaseClient } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';

/**
 * Lane snapshot for the lane-detail screen. Signed-in users read the
 * server-computed `lane_rate_aggregates` cache (authoritative, PII-free,
 * recomputed by the hourly job); signed-out / device-only users compute from
 * the labeled sample feed so the demo lane stays populated.
 */

const WINDOW_DAYS = 30;

export interface LaneParams {
  originMetro: string;
  originState: string;
  destinationMetro: string;
  destinationState: string;
  equipmentType: EquipmentType;
}

export interface LaneAggregateResult {
  aggregate: LaneAggregate | null;
  /** Window the medians cover (days), or null for the client-computed sample. */
  windowDays: number | null;
  /** Verified posts observed for the lane (drives the fallback copy). */
  lanePostCount: number;
  source: 'server' | 'sample';
  loading: boolean;
}

/** Wire shape of the columns the lane-aggregate query selects. */
export interface LaneAggregateRow {
  post_count: number | string;
  contributor_count: number | string;
  median_loaded_rpm: number | string;
  median_all_mile_rpm: number | string;
  median_deadhead_miles: number | string;
  low_all_mile_rpm: number | string;
  high_all_mile_rpm: number | string;
  confidence: string;
}

const AGGREGATE_COLUMNS =
  'post_count, contributor_count, median_loaded_rpm, median_all_mile_rpm, ' +
  'median_deadhead_miles, low_all_mile_rpm, high_all_mile_rpm, confidence';

/** Maps a `lane_rate_aggregates` row to the UI aggregate shape. */
export function mapLaneAggregateRow(row: LaneAggregateRow): LaneAggregate {
  return {
    postCount: Number(row.post_count),
    contributorCount: Number(row.contributor_count),
    medianLoadedRpm: Number(row.median_loaded_rpm),
    medianAllMileRpm: Number(row.median_all_mile_rpm),
    medianDeadheadMiles: Number(row.median_deadhead_miles),
    lowAllMileRpm: Number(row.low_all_mile_rpm),
    highAllMileRpm: Number(row.high_all_mile_rpm),
    confidence: row.confidence as LaneConfidence,
  };
}

async function fetchLaneAggregate(lane: LaneParams): Promise<LaneAggregate | null> {
  const { data, error } = await getSupabaseClient()
    .from('lane_rate_aggregates')
    .select(AGGREGATE_COLUMNS)
    .eq('origin_market', lane.originMetro)
    .eq('origin_state', lane.originState)
    .eq('destination_market', lane.destinationMetro)
    .eq('destination_state', lane.destinationState)
    .eq('equipment_type', lane.equipmentType)
    .eq('window_days', WINDOW_DAYS)
    .maybeSingle();
  if (error) throw error;
  return data ? mapLaneAggregateRow(data as unknown as LaneAggregateRow) : null;
}

export function useLaneAggregate(lane: LaneParams): LaneAggregateResult {
  const live = useAuthStore((s) => s.status === 'signed_in');
  const key = laneKey(lane);

  const server = useQuery<LaneAggregate | null>({
    queryKey: ['laneAggregate', key, WINDOW_DAYS],
    queryFn: () => fetchLaneAggregate(lane),
    enabled: live,
    staleTime: 60_000,
  });

  // Sample source for signed-out users; react-query dedupes with the board feed.
  const { data: posts } = useRateBoard();

  return useMemo(() => {
    if (live) {
      return {
        aggregate: server.data ?? null,
        windowDays: WINDOW_DAYS,
        lanePostCount: server.data?.postCount ?? 0,
        source: 'server',
        loading: server.isPending,
      };
    }
    const lanePosts = (posts ?? []).filter((p) => laneKey(p) === key);
    const eligible: EligiblePost[] = lanePosts.map((p) => ({
      contributorId: p.contributorId,
      loadedRpm: p.loadedRpm ?? 0,
      allMileRpm: p.allMileRpm ?? 0,
      deadheadMiles: p.deadheadMiles ?? 0,
      verificationLevel: p.verificationLevel,
    }));
    return {
      aggregate: computeLaneAggregate(eligible),
      windowDays: null,
      lanePostCount: lanePosts.length,
      source: 'sample',
      loading: false,
    };
  }, [live, server.data, server.isPending, posts, key]);
}
