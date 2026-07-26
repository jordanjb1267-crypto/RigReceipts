-- RigReceipts — Freight Intelligence RLS (Section 48: "Apply Row-Level Security
-- to all new tables"). Mirrors the owner-only pattern from 0002_rls.sql, with
-- read-through policies for the public board and public lane aggregates, and
-- service-role-only access to moderation cases.

-- ---------------------------------------------------------------------------
-- rate_share_cards — private to the creator
-- ---------------------------------------------------------------------------

alter table rate_share_cards enable row level security;

create policy "own rate cards"
  on rate_share_cards for all
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- rate_board_posts — owners manage their own; everyone reads eligible published
-- posts except those from contributors they have blocked (Section 22).
-- ---------------------------------------------------------------------------

alter table rate_board_posts enable row level security;

create policy "manage own posts"
  on rate_board_posts for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "read eligible published posts"
  on rate_board_posts for select
  to authenticated
  using (
    publication_status = 'published'
    and moderation_status <> 'removed'
    and not exists (
      select 1 from rate_board_blocks b
      where b.blocker_id = (select auth.uid())
        and b.blocked_user_id = rate_board_posts.user_id
    )
  );

-- ---------------------------------------------------------------------------
-- rate_post_reports — a reporter can create and see their own reports
-- ---------------------------------------------------------------------------

alter table rate_post_reports enable row level security;

create policy "own reports"
  on rate_post_reports for all
  to authenticated
  using (reporter_id = (select auth.uid()))
  with check (reporter_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- rate_board_blocks — a user manages only their own block list
-- ---------------------------------------------------------------------------

alter table rate_board_blocks enable row level security;

create policy "own blocks"
  on rate_board_blocks for all
  to authenticated
  using (blocker_id = (select auth.uid()))
  with check (blocker_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- rate_board_moderation_cases — no client access; service role (admin) only.
-- RLS enabled with no permissive policy = clients see nothing; the service role
-- bypasses RLS for the moderation queue and admin removal (Section 51).
-- ---------------------------------------------------------------------------

alter table rate_board_moderation_cases enable row level security;

-- ---------------------------------------------------------------------------
-- lane_rate_aggregates — public, PII-free: readable by all authenticated users;
-- writes happen via the service role (recalculateLaneAggregates job).
-- ---------------------------------------------------------------------------

alter table lane_rate_aggregates enable row level security;

create policy "read lane aggregates"
  on lane_rate_aggregates for select
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- data_entitlements — a user reads only their own; writes via service role.
-- ---------------------------------------------------------------------------

alter table data_entitlements enable row level security;

create policy "read own data entitlements"
  on data_entitlements for select
  to authenticated
  using (user_id = (select auth.uid()));
