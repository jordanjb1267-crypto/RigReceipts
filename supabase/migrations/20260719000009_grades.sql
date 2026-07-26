-- RigReceipts — Grades feature (Road Grade).
-- Additive and non-destructive: only new columns, constraints, one new table,
-- and its RLS are added. No existing column or row is altered or dropped, so
-- this is safe to apply on top of live data.
--
-- Derived values (loaded_rpm, all_mile_rpm, rate_status, estimated/actual trip
-- cost + contribution) are intentionally NOT stored — they are computed in the
-- app from gross_rate / fuel_surcharge / miles + the driver's cost targets, so
-- there is a single source of truth (per the grades data-model decision).
--
-- Rollback (reverse order), if ever needed:
--   drop table if exists load_receivables;
--   alter table load_documents drop column if exists doc_status;
--   alter table load_documents drop constraint if exists load_documents_doc_type_check;
--     (then re-add the original 10-value doc_type check)
--   alter table loads
--     drop column if exists gross_rate, drop column if exists fuel_surcharge,
--     drop column if exists loaded_miles, drop column if exists deadhead_miles,
--     drop column if exists bol_required;
--   alter table trucks
--     drop column if exists avg_mpg, drop column if exists default_diesel_price_usd;

-- 1. Load revenue + mileage (Rate grade). RPM/rate_status are derived in-app.
alter table loads
  add column if not exists gross_rate numeric(12, 2),
  add column if not exists fuel_surcharge numeric(12, 2),
  add column if not exists loaded_miles numeric,
  add column if not exists deadhead_miles numeric,
  add column if not exists bol_required boolean not null default true;

-- 2. Document workflow status + two new doc types (Paperwork grade).
alter table load_documents
  add column if not exists doc_status text not null default 'captured'
    check (doc_status in ('missing', 'captured', 'reviewed', 'complete'));

alter table load_documents drop constraint if exists load_documents_doc_type_check;
alter table load_documents
  add constraint load_documents_doc_type_check check (
    doc_type in (
      'bol', 'pod', 'rate_confirmation', 'scale_ticket', 'lumper_receipt',
      'fuel_receipt', 'toll_receipt', 'repair_receipt', 'permit', 'inspection',
      'settlement', 'other'
    )
  );

-- 3. Truck fuel-economy inputs (Fuel grade — price-adjusted expectation).
alter table trucks
  add column if not exists avg_mpg numeric,
  add column if not exists default_diesel_price_usd numeric(8, 3);

-- 4. Load-linked receivables (Money Owed grade). General child model that
--    coexists with detention_claims / reimbursements; nothing is migrated off
--    those tables.
create table if not exists load_receivables (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  load_id uuid references loads (id) on delete cascade,
  type text not null default 'other' check (
    type in ('detention', 'lumper', 'reimbursement', 'layover', 'tonu', 'accessorial', 'other')
  ),
  description text,
  amount_expected numeric(12, 2) not null default 0 check (amount_expected >= 0),
  amount_received numeric(12, 2) not null default 0 check (amount_received >= 0),
  status text not null default 'expected' check (
    status in (
      'expected', 'submitted', 'pending', 'partially_paid', 'paid', 'overdue',
      'disputed', 'written_off'
    )
  ),
  date_incurred date,
  date_submitted date,
  date_due date,
  date_received date,
  supporting_document_id uuid references load_documents (id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists load_receivables_owner_status_idx
  on load_receivables (owner_id, status);
create index if not exists load_receivables_load_idx on load_receivables (load_id);

-- RLS: owner-scoped, mirroring every other user-owned table (the auto-enable
-- event trigger also enables RLS on new tables; this is explicit belt-and-braces).
alter table load_receivables enable row level security;
drop policy if exists "own rows" on load_receivables;
create policy "own rows" on load_receivables for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
