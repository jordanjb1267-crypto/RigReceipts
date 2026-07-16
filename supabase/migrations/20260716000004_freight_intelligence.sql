-- RigReceipts — Freight Intelligence additive schema (Master Additive
-- Integration Prompt, Section 48). Additive and reversible: it only creates new
-- enums/tables and widens the subscriptions.tier check. Existing tables are not
-- renamed or dropped. RLS is applied in the companion 0005 migration.
--
-- To roll back: see the DOWN block at the end of this file.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type rate_status as enum ('offered', 'accepted', 'completed');

-- settlement_verified is reserved for a future release (Section 19).
create type verification_level as enum (
  'self_entered', 'document_verified', 'completed_load', 'settlement_verified'
);

create type card_visibility as enum ('private', 'external', 'public');

create type rate_publication_status as enum ('draft', 'pending', 'published', 'removed');

create type rate_moderation_status as enum ('none', 'flagged', 'under_review', 'approved', 'removed');

create type rate_report_category as enum (
  'incorrect_rate', 'duplicate_post', 'active_load_listing', 'contact_information',
  'private_shipment_information', 'misleading_verification', 'broker_harassment',
  'spam', 'other'
);

create type data_entitlement_kind as enum (
  'basic_community_intelligence', 'licensed_market_intelligence', 'high_volume_market_intelligence'
);

-- ---------------------------------------------------------------------------
-- Widen existing subscription tiers to include the lifetime entitlement
-- ---------------------------------------------------------------------------

alter table subscriptions drop constraint if exists subscriptions_tier_check;
alter table subscriptions
  add constraint subscriptions_tier_check
  check (tier in ('free', 'driver_pro', 'owner_operator', 'fleet_lite', 'lifetime'));

-- ---------------------------------------------------------------------------
-- rate_share_cards — privacy-safe cards a user generates from a load/rate check
-- ---------------------------------------------------------------------------

create table rate_share_cards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  -- rate_check_id references a future rate_checks table; kept nullable for now.
  rate_check_id uuid,
  load_id uuid references loads (id) on delete set null,
  origin_market text not null,
  origin_state text not null,
  destination_market text not null,
  destination_state text not null,
  equipment_type text not null,
  rate_status rate_status not null,
  gross_rate numeric(12, 2),
  fuel_surcharge_included boolean not null default false,
  loaded_miles numeric,
  deadhead_miles numeric,
  loaded_rpm numeric(8, 4),
  all_mile_rpm numeric(8, 4),
  load_date_bucket text,
  verification_level verification_level not null default 'self_entered',
  card_visibility card_visibility not null default 'private',
  generated_image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- rate_board_posts — a card published to the Community Rate Board.
-- Carries a denormalized privacy-safe snapshot so the board can render without
-- exposing the private rate_share_cards table to other users.
-- ---------------------------------------------------------------------------

create table rate_board_posts (
  id uuid primary key default gen_random_uuid(),
  rate_share_card_id uuid references rate_share_cards (id) on delete set null,
  user_id uuid not null references auth.users (id) on delete cascade,
  publication_status rate_publication_status not null default 'draft',
  moderation_status rate_moderation_status not null default 'none',
  -- Anonymous, rotating alias — never the contributor's real identity (Section 22).
  contributor_alias text not null,
  community_terms_version text not null,
  -- Privacy-safe published snapshot (sanitizeRateShareCard output):
  origin_market text not null,
  origin_state text not null,
  destination_market text not null,
  destination_state text not null,
  equipment_type text not null,
  rate_status rate_status not null,
  verification_level verification_level not null,
  gross_rate numeric(12, 2),
  fuel_surcharge_included boolean not null default false,
  loaded_miles numeric,
  deadhead_miles numeric,
  loaded_rpm numeric(8, 4),
  all_mile_rpm numeric(8, 4),
  load_date_bucket text,
  published_at timestamptz,
  removed_at timestamptz,
  removal_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Public posts require an eligible verification level (Section 19). Self-entered
  -- cannot be published in v1.
  constraint public_posts_are_verified check (
    publication_status <> 'published' or verification_level <> 'self_entered'
  )
);

-- ---------------------------------------------------------------------------
-- rate_post_reports / rate_board_blocks / moderation cases
-- ---------------------------------------------------------------------------

create table rate_post_reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references rate_board_posts (id) on delete cascade,
  reporter_id uuid not null references auth.users (id) on delete cascade,
  category rate_report_category not null,
  note text,
  created_at timestamptz not null default now(),
  unique (post_id, reporter_id)
);

create table rate_board_blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (blocker_id, blocked_user_id),
  constraint no_self_block check (blocker_id <> blocked_user_id)
);

create table rate_board_moderation_cases (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references rate_board_posts (id) on delete cascade,
  status rate_moderation_status not null default 'flagged',
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text,
  moderator_id uuid references auth.users (id) on delete set null,
  report_count integer not null default 0,
  audit jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- lane_rate_aggregates — cached, PII-free lane summaries (Section 18/52)
-- ---------------------------------------------------------------------------

create table lane_rate_aggregates (
  id uuid primary key default gen_random_uuid(),
  origin_market text not null,
  origin_state text not null,
  destination_market text not null,
  destination_state text not null,
  equipment_type text not null,
  window_days integer not null,
  post_count integer not null default 0,
  contributor_count integer not null default 0,
  median_loaded_rpm numeric(8, 4),
  median_all_mile_rpm numeric(8, 4),
  median_deadhead_miles numeric,
  low_all_mile_rpm numeric(8, 4),
  high_all_mile_rpm numeric(8, 4),
  confidence text not null default 'limited',
  recomputed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (origin_market, origin_state, destination_market, destination_state, equipment_type, window_days)
);

-- ---------------------------------------------------------------------------
-- data_entitlements — provider-agnostic layer for future licensed data (Section 44)
-- ---------------------------------------------------------------------------

create table data_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  entitlement data_entitlement_kind not null,
  source text not null default 'subscription',
  active boolean not null default true,
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, entitlement)
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index rate_share_cards_owner_idx on rate_share_cards (owner_id, created_at desc);
create index rate_board_posts_owner_idx on rate_board_posts (user_id);
create index rate_board_posts_feed_idx
  on rate_board_posts (published_at desc)
  where publication_status = 'published' and moderation_status <> 'removed';
create index rate_board_posts_lane_idx
  on rate_board_posts (origin_market, destination_market, equipment_type);
create index rate_post_reports_post_idx on rate_post_reports (post_id);
create index rate_board_blocks_blocker_idx on rate_board_blocks (blocker_id);
create index moderation_cases_status_idx on rate_board_moderation_cases (status);
create index lane_aggregates_lane_idx
  on lane_rate_aggregates (origin_market, destination_market, equipment_type);
create index data_entitlements_user_idx on data_entitlements (user_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers (reuses set_updated_at() from 0001_init.sql)
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'rate_share_cards', 'rate_board_posts', 'rate_board_moderation_cases',
    'lane_rate_aggregates', 'data_entitlements'
  ]
  loop
    execute format(
      'create trigger %I before update on %I for each row execute function set_updated_at()',
      t || '_set_updated_at', t
    );
  end loop;
end;
$$;

-- ===========================================================================
-- DOWN (manual rollback)
--   drop table if exists data_entitlements, lane_rate_aggregates,
--     rate_board_moderation_cases, rate_board_blocks, rate_post_reports,
--     rate_board_posts, rate_share_cards cascade;
--   drop type if exists data_entitlement_kind, rate_report_category,
--     rate_moderation_status, rate_publication_status, card_visibility,
--     verification_level, rate_status;
--   alter table subscriptions drop constraint if exists subscriptions_tier_check;
--   alter table subscriptions add constraint subscriptions_tier_check
--     check (tier in ('free','driver_pro','owner_operator','fleet_lite'));
-- ===========================================================================
