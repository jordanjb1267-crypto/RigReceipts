-- RigReceipts — server-side lane-aggregate job (Section 18/52).
--
-- Recomputes the PII-free `lane_rate_aggregates` cache from `rate_board_posts`,
-- replicating the client `computeLaneAggregate` exactly:
--   * eligible = published, not removed, verification_level <> 'self_entered',
--     with both RPMs present, within the window;
--   * threshold = >= 7 eligible posts AND >= 3 distinct contributors;
--   * per-contributor de-domination: each contributor is reduced to a single
--     representative post — sort their posts by verification weight desc then
--     all-mile RPM asc, take the element at index floor(n/2) — so one prolific
--     account can't skew the lane median;
--   * medians over the representatives (percentile_cont = the JS median),
--     range = min/max representative all-mile RPM;
--   * confidence bands identical to laneConfidence().
--
-- Runs as a SECURITY DEFINER function (bypasses RLS to read every contributor's
-- posts and write the cache) with a pinned empty search_path, and EXECUTE
-- revoked from client roles so only the cron job / service role can call it.

create or replace function public.recompute_lane_rate_aggregates(p_window_days integer default 30)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.lane_rate_aggregates where window_days = p_window_days;

  with eligible as (
    select
      p.origin_market,
      p.origin_state,
      p.destination_market,
      p.destination_state,
      p.equipment_type,
      p.user_id as contributor,
      p.loaded_rpm,
      p.all_mile_rpm,
      coalesce(p.deadhead_miles, 0) as deadhead_miles,
      case p.verification_level
        when 'settlement_verified' then 4
        when 'completed_load' then 3
        when 'document_verified' then 2
        else 0
      end as vweight
    from public.rate_board_posts p
    where p.publication_status = 'published'
      and p.moderation_status <> 'removed'
      and p.verification_level <> 'self_entered'
      and p.all_mile_rpm is not null
      and p.loaded_rpm is not null
      and coalesce(p.published_at, p.created_at) >= now() - make_interval(days => p_window_days)
  ),
  lane_stats as (
    select
      origin_market, origin_state, destination_market, destination_state, equipment_type,
      count(*) as post_count,
      count(distinct contributor) as contributor_count
    from eligible
    group by 1, 2, 3, 4, 5
    having count(*) >= 7 and count(distinct contributor) >= 3
  ),
  ranked as (
    select
      e.*,
      row_number() over (
        partition by e.origin_market, e.origin_state, e.destination_market,
                     e.destination_state, e.equipment_type, e.contributor
        order by e.vweight desc, e.all_mile_rpm asc
      ) as rn,
      count(*) over (
        partition by e.origin_market, e.origin_state, e.destination_market,
                     e.destination_state, e.equipment_type, e.contributor
      ) as cnt
    from eligible e
    join lane_stats ls using (
      origin_market, origin_state, destination_market, destination_state, equipment_type
    )
  ),
  representatives as (
    -- index floor(n/2), 1-based: rn = (cnt / 2) + 1  (integer division = floor)
    select * from ranked where rn = (cnt / 2) + 1
  ),
  agg as (
    select
      r.origin_market, r.origin_state, r.destination_market, r.destination_state, r.equipment_type,
      ls.post_count,
      ls.contributor_count,
      round(percentile_cont(0.5) within group (order by r.loaded_rpm)::numeric, 2) as median_loaded_rpm,
      round(percentile_cont(0.5) within group (order by r.all_mile_rpm)::numeric, 2) as median_all_mile_rpm,
      round(percentile_cont(0.5) within group (order by r.deadhead_miles)::numeric, 0) as median_deadhead_miles,
      round(min(r.all_mile_rpm)::numeric, 2) as low_all_mile_rpm,
      round(max(r.all_mile_rpm)::numeric, 2) as high_all_mile_rpm
    from representatives r
    join lane_stats ls using (
      origin_market, origin_state, destination_market, destination_state, equipment_type
    )
    group by 1, 2, 3, 4, 5, ls.post_count, ls.contributor_count
  )
  insert into public.lane_rate_aggregates (
    origin_market, origin_state, destination_market, destination_state, equipment_type,
    window_days, post_count, contributor_count,
    median_loaded_rpm, median_all_mile_rpm, median_deadhead_miles,
    low_all_mile_rpm, high_all_mile_rpm, confidence, recomputed_at, updated_at
  )
  select
    origin_market, origin_state, destination_market, destination_state, equipment_type,
    p_window_days, post_count, contributor_count,
    median_loaded_rpm, median_all_mile_rpm, median_deadhead_miles,
    low_all_mile_rpm, high_all_mile_rpm,
    case
      when contributor_count >= 8 and post_count >= 20 then 'strong'
      when contributor_count >= 5 and post_count >= 12 then 'moderate'
      else 'developing'
    end,
    now(), now()
  from agg;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Server job only: keep it off the client surface.
revoke all on function public.recompute_lane_rate_aggregates(integer) from public, anon, authenticated;

-- Schedule an hourly recompute over the trailing 30 days.
create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('recompute-lane-aggregates');
exception
  when others then null; -- not scheduled yet
end;
$$;

select cron.schedule(
  'recompute-lane-aggregates',
  '17 * * * *',
  $$ select public.recompute_lane_rate_aggregates(30); $$
);

-- DOWN (manual):
--   select cron.unschedule('recompute-lane-aggregates');
--   drop function if exists public.recompute_lane_rate_aggregates(integer);
