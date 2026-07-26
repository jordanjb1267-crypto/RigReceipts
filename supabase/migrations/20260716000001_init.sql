-- RigReceipts V2 — initial schema (roadmap Phase 2).
-- 21 tables: the Master Build Prompt's core-table list minus `users`
-- (Supabase manages auth.users; profiles is the app-side user record —
-- docs/DECISIONS.md, decision 6).

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- Shared by reimbursements and detention_claims (decision 2).
create type claim_status as enum ('pending', 'submitted', 'approved', 'reimbursed', 'denied');

-- ---------------------------------------------------------------------------
-- Reference data (global, read-only to clients)
-- ---------------------------------------------------------------------------

create table expense_categories (
  slug text primary key,
  label text not null,
  sort_order integer not null default 0
);

-- ---------------------------------------------------------------------------
-- User-owned tables
-- ---------------------------------------------------------------------------

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  role text check (
    role in (
      'owner_operator', 'leased_owner_operator', 'company_driver',
      'small_fleet', 'dispatcher_ops', 'just_starting'
    )
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table trucks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  unit_name text not null,
  make text,
  model text,
  model_year integer,
  vin text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table loads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  load_number text not null,
  counterparty text, -- broker / carrier / company
  pickup_city text,
  pickup_state text,
  delivery_city text,
  delivery_state text,
  pickup_date date,
  delivery_date date,
  truck_id uuid references trucks (id) on delete set null,
  trailer_number text,
  status text not null default 'active',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Every captured image/PDF is a document_scan; receipts and load_documents
-- reference scans rather than duplicating storage paths (decision 6).
create table document_scans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  scan_type text not null check (
    scan_type in (
      'receipt', 'fuel', 'repair_invoice', 'lumper', 'bol', 'pod', 'scale_ticket',
      'toll', 'parking', 'meal', 'shower', 'hotel', 'permit', 'inspection', 'other'
    )
  ),
  storage_path text not null, -- object path in the receipts/documents bucket
  ocr_text text,
  ocr_confidence numeric,
  review_status text not null default 'pending_review'
    check (review_status in ('pending_review', 'confirmed')),
  captured_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table load_documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  load_id uuid not null references loads (id) on delete cascade,
  scan_id uuid references document_scans (id) on delete set null,
  doc_type text not null check (
    doc_type in (
      'bol', 'pod', 'rate_confirmation', 'scale_ticket', 'lumper_receipt',
      'fuel_receipt', 'toll_receipt', 'permit', 'inspection', 'other'
    )
  ),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table expenses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  amount_usd numeric(12, 2) not null check (amount_usd >= 0),
  vendor text,
  expense_date date not null default current_date,
  category_slug text not null references expense_categories (slug),
  truck_id uuid references trucks (id) on delete set null,
  load_id uuid references loads (id) on delete set null,
  scan_id uuid references document_scans (id) on delete set null,
  odometer numeric,
  reimbursable boolean not null default false,
  include_in_tax_report boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table receipts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  expense_id uuid references expenses (id) on delete cascade,
  scan_id uuid references document_scans (id) on delete set null,
  vendor text,
  receipt_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table fuel_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  expense_id uuid references expenses (id) on delete set null,
  truck_id uuid references trucks (id) on delete set null,
  fuel_date date not null default current_date,
  gallons numeric,
  price_per_gallon_usd numeric,
  total_usd numeric(12, 2),
  odometer numeric,
  is_def boolean not null default false,
  location text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table maintenance_records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  truck_id uuid references trucks (id) on delete set null,
  service_type text not null,
  vendor text,
  amount_usd numeric(12, 2),
  odometer numeric,
  next_due_odometer numeric,
  next_due_date date,
  expense_id uuid references expenses (id) on delete set null,
  scan_id uuid references document_scans (id) on delete set null,
  serviced_at date not null default current_date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table mileage_trips (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  truck_id uuid references trucks (id) on delete set null,
  load_id uuid references loads (id) on delete set null,
  started_at timestamptz,
  ended_at timestamptz,
  total_miles numeric not null default 0,
  loaded_miles numeric not null default 0,
  deadhead_miles numeric not null default 0,
  source text not null default 'manual' check (source in ('gps', 'manual')),
  route_points jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table detention_claims (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  load_id uuid references loads (id) on delete set null,
  counterparty text, -- broker / carrier / customer
  location text,
  stop_type text check (stop_type in ('pickup', 'delivery')),
  appointment_time timestamptz,
  arrival_time timestamptz,
  departure_time timestamptz,
  free_time_minutes integer not null default 120,
  hourly_rate_usd numeric(12, 2),
  estimated_usd numeric(12, 2),
  manual_override_usd numeric(12, 2),
  status claim_status not null default 'pending',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table reimbursements (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  kind text not null default 'lumper' check (kind in ('lumper', 'other')),
  load_id uuid references loads (id) on delete set null,
  expense_id uuid references expenses (id) on delete set null,
  scan_id uuid references document_scans (id) on delete set null, -- proof document
  amount_usd numeric(12, 2) not null check (amount_usd >= 0),
  counterparty text, -- facility / vendor
  paid_by text check (paid_by in ('driver', 'company', 'other')),
  status claim_status not null default 'pending',
  submitted_at timestamptz,
  resolved_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table rpm_targets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  truck_id uuid references trucks (id) on delete set null,
  fixed_weekly_costs_usd numeric(12, 2) not null default 0,
  variable_cost_per_mile_usd numeric(8, 4) not null default 0,
  projected_total_miles numeric not null default 0,
  expected_loaded_miles numeric not null default 0,
  desired_driver_pay_usd numeric(12, 2) not null default 0,
  desired_profit_reserve_usd numeric(12, 2) not null default 0,
  target_loaded_rpm numeric(8, 4),
  break_even_all_mile_rpm numeric(8, 4),
  effective_from date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table daily_summaries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  summary_date date not null,
  total_expenses_usd numeric(12, 2) not null default 0,
  receipt_count integer not null default 0,
  fuel_usd numeric(12, 2) not null default 0,
  road_life_usd numeric(12, 2) not null default 0,
  miles numeric not null default 0,
  money_owed_usd numeric(12, 2) not null default 0,
  missing_items jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, summary_date)
);

create table weekly_grades (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  week_start date not null,
  overall_grade text,
  breakdown jsonb, -- per-area grades: rate, fuel, deadhead, repairs, paperwork, owed, discipline
  insights text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, week_start)
);

create table monthly_reports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  report_month date not null, -- first day of month
  final_grade text,
  totals jsonb,
  closeout_complete boolean not null default false,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, report_month)
);

create table report_exports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('monthly_pdf', 'load_packet_pdf', 'csv', 'tax_summary')),
  storage_path text not null, -- object path in the reports bucket
  monthly_report_id uuid references monthly_reports (id) on delete set null,
  load_id uuid references loads (id) on delete set null,
  created_at timestamptz not null default now()
);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users (id) on delete cascade,
  tier text not null default 'free'
    check (tier in ('free', 'driver_pro', 'owner_operator', 'fleet_lite')),
  revenuecat_app_user_id text,
  entitlements jsonb,
  extra_trucks integer not null default 0,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table coaching_insights (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  insight_type text not null,
  title text not null,
  body text,
  severity text check (severity in ('info', 'attention', 'urgent')),
  related jsonb,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  data jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index trucks_owner_idx on trucks (owner_id);
create index loads_owner_status_idx on loads (owner_id, status);
create index document_scans_owner_captured_idx on document_scans (owner_id, captured_at desc);
create index load_documents_owner_idx on load_documents (owner_id);
create index load_documents_load_idx on load_documents (load_id);
create index expenses_owner_date_idx on expenses (owner_id, expense_date desc);
create index expenses_load_idx on expenses (load_id);
create index receipts_owner_idx on receipts (owner_id);
create index fuel_entries_owner_date_idx on fuel_entries (owner_id, fuel_date desc);
create index maintenance_owner_idx on maintenance_records (owner_id);
create index mileage_owner_started_idx on mileage_trips (owner_id, started_at desc);
create index detention_owner_status_idx on detention_claims (owner_id, status);
create index reimbursements_owner_status_idx on reimbursements (owner_id, status);
create index rpm_targets_owner_idx on rpm_targets (owner_id);
create index daily_summaries_owner_idx on daily_summaries (owner_id, summary_date desc);
create index weekly_grades_owner_idx on weekly_grades (owner_id, week_start desc);
create index monthly_reports_owner_idx on monthly_reports (owner_id, report_month desc);
create index report_exports_owner_idx on report_exports (owner_id);
create index coaching_insights_owner_idx on coaching_insights (owner_id);
create index notifications_owner_unread_idx on notifications (owner_id) where read_at is null;

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'trucks', 'loads', 'document_scans', 'load_documents', 'expenses',
    'receipts', 'fuel_entries', 'maintenance_records', 'mileage_trips',
    'detention_claims', 'reimbursements', 'rpm_targets', 'daily_summaries',
    'weekly_grades', 'monthly_reports', 'subscriptions'
  ]
  loop
    execute format(
      'create trigger %I before update on %I for each row execute function set_updated_at()',
      t || '_set_updated_at', t
    );
  end loop;
end;
$$;
