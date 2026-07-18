import {
  CommunityRatePost,
  contributorAliasFor,
  EquipmentType,
  laneKey,
  RateReportCategory,
  RateStatus,
  SafeRateCard,
  VerificationLevel,
} from '@/domain';
import { getSupabaseClient } from '@/lib/supabase';

/**
 * Live Community Rate Board reads/writes against `rate_board_posts` and
 * friends. The feed never selects `user_id` — clients only ever see the
 * per-lane pseudonymous `contributor_alias` (Section 22); the id is looked up
 * post-by-post solely to write a block row. All queries run under RLS: the
 * read policy already excludes removed posts and blocked contributors.
 */

/** Wire shape of the privacy-safe snapshot columns the feed selects. */
export interface RateBoardPostRow {
  id: string;
  contributor_alias: string;
  origin_market: string;
  origin_state: string;
  destination_market: string;
  destination_state: string;
  equipment_type: string;
  rate_status: string;
  verification_level: string;
  gross_rate: number | string | null;
  fuel_surcharge_included: boolean;
  loaded_miles: number | string | null;
  deadhead_miles: number | string | null;
  loaded_rpm: number | string | null;
  all_mile_rpm: number | string | null;
  load_date_bucket: string | null;
  published_at: string | null;
  created_at: string;
}

export const POST_COLUMNS =
  'id, contributor_alias, origin_market, origin_state, destination_market, ' +
  'destination_state, equipment_type, rate_status, verification_level, ' +
  'gross_rate, fuel_surcharge_included, loaded_miles, deadhead_miles, ' +
  'loaded_rpm, all_mile_rpm, load_date_bucket, published_at, created_at';

const num = (v: number | string | null): number | null => (v === null ? null : Number(v));

/** Maps a published `rate_board_posts` row to the client post shape. */
export function mapPostRow(row: RateBoardPostRow, now: Date = new Date()): CommunityRatePost {
  const posted = new Date(row.published_at ?? row.created_at).getTime();
  const postedDaysAgo = Math.max(0, Math.floor((now.getTime() - posted) / 86_400_000));
  return {
    id: row.id,
    contributorId: row.contributor_alias,
    originMetro: row.origin_market,
    originState: row.origin_state,
    destinationMetro: row.destination_market,
    destinationState: row.destination_state,
    equipmentType: row.equipment_type as EquipmentType,
    rateStatus: row.rate_status as RateStatus,
    verificationLevel: row.verification_level as VerificationLevel,
    grossRate: num(row.gross_rate),
    loadedMiles: num(row.loaded_miles),
    deadheadMiles: num(row.deadhead_miles),
    loadedRpm: num(row.loaded_rpm),
    allMileRpm: num(row.all_mile_rpm),
    loadDateBucket: row.load_date_bucket,
    postedDaysAgo,
  };
}

/** Recent published posts (RLS filters removed posts + blocked contributors). */
export async function fetchLiveRateBoard(): Promise<CommunityRatePost[]> {
  const { data, error } = await getSupabaseClient()
    .from('rate_board_posts')
    .select(POST_COLUMNS)
    .eq('publication_status', 'published')
    .order('published_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return ((data ?? []) as unknown as RateBoardPostRow[]).map((row) => mapPostRow(row));
}

export interface PublishRateCardInput {
  userId: string;
  /** The sanitized public card — the ONLY payload that leaves the device. */
  card: SafeRateCard;
  termsVersion: string;
}

/**
 * Publishes a rate card: stores the private `rate_share_cards` row, then the
 * denormalized privacy-safe snapshot on `rate_board_posts`. Both inserts are
 * owner-scoped by RLS; the DB check constraint independently rejects publishing
 * self-entered rates. Returns the new post id.
 */
export async function publishRateCardToBoard(input: PublishRateCardInput): Promise<string> {
  const { userId, card, termsVersion } = input;
  const supabase = getSupabaseClient();

  const snapshot = {
    origin_market: card.originMetro,
    origin_state: card.originState,
    destination_market: card.destinationMetro,
    destination_state: card.destinationState,
    equipment_type: card.equipmentType,
    rate_status: card.rateStatus,
    verification_level: card.verificationLevel,
    gross_rate: card.grossRate,
    fuel_surcharge_included: card.fuelSurchargeIncluded,
    loaded_miles: card.loadedMiles,
    deadhead_miles: card.deadheadMiles,
    loaded_rpm: card.loadedRpm,
    all_mile_rpm: card.allMileRpm,
    load_date_bucket: card.loadDateBucket,
  };

  const { data: cardRow, error: cardError } = await supabase
    .from('rate_share_cards')
    .insert({ owner_id: userId, card_visibility: 'public', ...snapshot })
    .select('id')
    .single();
  if (cardError) throw cardError;

  const lane = laneKey({
    originMetro: card.originMetro,
    originState: card.originState,
    destinationMetro: card.destinationMetro,
    destinationState: card.destinationState,
    equipmentType: card.equipmentType,
  });

  const { data: postRow, error: postError } = await supabase
    .from('rate_board_posts')
    .insert({
      rate_share_card_id: cardRow.id,
      user_id: userId,
      publication_status: 'published',
      contributor_alias: contributorAliasFor(userId, lane),
      community_terms_version: termsVersion,
      published_at: new Date().toISOString(),
      ...snapshot,
    })
    .select('id')
    .single();
  if (postError) throw postError;
  return postRow.id;
}

/** Files a report on a post. Repeat reports by the same user are no-ops. */
export async function reportPost(
  reporterId: string,
  postId: string,
  category: RateReportCategory,
): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('rate_post_reports')
    .upsert(
      { post_id: postId, reporter_id: reporterId, category },
      { onConflict: 'post_id,reporter_id', ignoreDuplicates: true },
    );
  if (error) throw error;
}

/**
 * Blocks the contributor behind a post so the RLS read policy excludes them
 * server-side (the local store already hides them immediately). The feed never
 * carries `user_id`; it is looked up here only to write the block row.
 */
export async function blockContributorByPost(blockerId: string, postId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('rate_board_posts')
    .select('user_id')
    .eq('id', postId)
    .maybeSingle();
  if (error) throw error;
  const blockedId = (data as { user_id: string } | null)?.user_id;
  if (!blockedId || blockedId === blockerId) return; // gone, or own post
  const { error: blockError } = await supabase
    .from('rate_board_blocks')
    .upsert(
      { blocker_id: blockerId, blocked_user_id: blockedId },
      { onConflict: 'blocker_id,blocked_user_id', ignoreDuplicates: true },
    );
  if (blockError) throw blockError;
}
