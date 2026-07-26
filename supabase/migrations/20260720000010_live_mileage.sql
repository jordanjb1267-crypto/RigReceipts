-- RigReceipts — Live Mileage Core (V1).
-- Additive and non-destructive: two new tables + owner-scoped RLS. The legacy
-- `mileage_trips` table is left untouched (manual trips still work); the new
-- session/segment model is the canonical mileage source going forward.
--
-- Derived values (RPM, rate status, per-load contribution) are NOT stored —
-- they are computed in-app from miles + the driver's cost targets, reusing the
-- existing Rate Check / RPM Coach engine (one source of truth).
--
-- Rollback (reverse order):
--   drop table if exists mileage_segments;
--   drop table if exists mileage_sessions;

-- 1. Sessions — one Live Mileage run (manual or gps).
create table if not exists mileage_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  vehicle_id uuid references trucks (id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  tracking_mode text not null default 'manual' check (tracking_mode in ('manual', 'gps')),
  source text not null default 'manual' check (source in ('manual', 'gps')),
  total_tracked_miles numeric not null default 0,
  reconciliation_status text not null default 'none'
    check (reconciliation_status in ('none', 'pending', 'reconciled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. Segments — each a run of physical miles in exactly one accounting category.
create table if not exists mileage_segments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  mileage_session_id uuid references mileage_sessions (id) on delete cascade,
  vehicle_id uuid references trucks (id) on delete set null,
  load_id uuid references loads (id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  start_location text,
  end_location text,
  -- Original tracked/entered distance — never overwritten (source-of-truth §13).
  calculated_miles numeric not null default 0,
  -- User correction; wins over calculated_miles when present.
  adjusted_miles numeric,
  accounting_category text not null default 'unclassified' check (
    accounting_category in ('loaded', 'deadhead', 'business_empty', 'personal', 'unclassified')
  ),
  business_subtype text check (
    business_subtype in ('to_pickup', 'repositioning', 'maintenance', 'other')
  ),
  trailer_configuration text not null default 'unknown' check (
    trailer_configuration in ('loaded_trailer', 'empty_trailer', 'bobtail', 'unknown')
  ),
  classification_source text not null default 'user' check (
    classification_source in ('user', 'gps', 'manual', 'system')
  ),
  classification_confidence numeric,
  user_confirmed boolean not null default false,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mileage_sessions_owner_idx on mileage_sessions (owner_id, started_at desc);
create index if not exists mileage_segments_session_idx on mileage_segments (mileage_session_id);
create index if not exists mileage_segments_owner_idx on mileage_segments (owner_id, started_at desc);
create index if not exists mileage_segments_load_idx on mileage_segments (load_id);

-- RLS: owner-scoped, mirroring every other user-owned table.
alter table mileage_sessions enable row level security;
drop policy if exists "own rows" on mileage_sessions;
create policy "own rows" on mileage_sessions for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

alter table mileage_segments enable row level security;
drop policy if exists "own rows" on mileage_segments;
create policy "own rows" on mileage_segments for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
