-- RigReceipts V2 — Row Level Security.
-- Every user-owned table: owners can do everything with their own rows, nothing else.
-- expense_categories: global reference data — readable by signed-in users, writable by no client.

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------

alter table expense_categories enable row level security;

create policy "categories are readable by authenticated users"
  on expense_categories for select
  to authenticated
  using (true);
-- No insert/update/delete policies: clients cannot write reference data.

-- ---------------------------------------------------------------------------
-- profiles (PK is the auth user id)
-- ---------------------------------------------------------------------------

alter table profiles enable row level security;

create policy "own profile"
  on profiles for all
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- owner_id tables
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'trucks', 'loads', 'document_scans', 'load_documents', 'expenses', 'receipts',
    'fuel_entries', 'maintenance_records', 'mileage_trips', 'detention_claims',
    'reimbursements', 'rpm_targets', 'daily_summaries', 'weekly_grades',
    'monthly_reports', 'report_exports', 'subscriptions', 'coaching_insights',
    'notifications'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy "own rows" on %I for all to authenticated '
      || 'using (owner_id = (select auth.uid())) '
      || 'with check (owner_id = (select auth.uid()))',
      t
    );
  end loop;
end;
$$;
