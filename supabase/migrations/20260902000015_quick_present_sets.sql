-- RigReceipts Refinement — Pass 2 (Quick Present custom sets).
--
--   presentation_sets       — owner-scoped CUSTOM sets only (system Roadside /
--                             Shipper sets are product defaults, never stored)
--   presentation_set_items  — logical OperationalDocument ids (never version
--                             ids, titles, paths, hashes or bytes)
--
-- Identity: 22-character opaque base64url text PKs, identical locally and
-- remotely. Ordinary product exit is lifecycle = ARCHIVED (or included = false
-- on an item). There is deliberately NO authenticated-client DELETE policy;
-- rows leave via the owner cascade on delete_current_account().
--
-- Additive only. Migrations 00011–00014 are not rewritten. No service role.
-- PresentationSession is ephemeral client state and is never stored here.

-- ---------------------------------------------------------------------------
-- presentation_sets
-- ---------------------------------------------------------------------------

create table presentation_sets (
  id text primary key
    check (id ~ '^[A-Za-z0-9_-]{8,64}$'),
  owner_id uuid not null references auth.users (id) on delete cascade,
  set_kind text not null check (set_kind = 'CUSTOM'),
  name text not null check (char_length(name) between 1 and 80),
  lifecycle text not null default 'ACTIVE' check (lifecycle in ('ACTIVE', 'ARCHIVED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);

create index presentation_sets_owner_idx
  on presentation_sets (owner_id);

create trigger presentation_sets_set_updated_at
  before update on presentation_sets
  for each row execute function set_updated_at();

alter table presentation_sets enable row level security;

create policy "select own presentation sets" on presentation_sets for select to authenticated
  using (owner_id = (select auth.uid()));

create policy "insert own presentation sets" on presentation_sets for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy "update own presentation sets" on presentation_sets for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- Deliberately NO "for delete" policy. Account deletion cascades from auth.users.

-- ---------------------------------------------------------------------------
-- presentation_set_items
-- ---------------------------------------------------------------------------

create table presentation_set_items (
  id text primary key
    check (id ~ '^[A-Za-z0-9_-]{8,64}$'),
  owner_id uuid not null references auth.users (id) on delete cascade,
  presentation_set_id text not null,
  operational_document_id text not null,
  position integer not null check (position >= 0),
  included boolean not null default true,
  unique (id, presentation_set_id, owner_id),
  unique (presentation_set_id, operational_document_id),
  foreign key (presentation_set_id, owner_id)
    references presentation_sets (id, owner_id) on delete cascade,
  foreign key (operational_document_id, owner_id)
    references operational_documents (id, owner_id)
);

create index presentation_set_items_owner_idx
  on presentation_set_items (owner_id);
create index presentation_set_items_set_idx
  on presentation_set_items (presentation_set_id, position);

alter table presentation_set_items enable row level security;

create policy "select own presentation set items" on presentation_set_items for select to authenticated
  using (owner_id = (select auth.uid()));

create policy "insert own presentation set items" on presentation_set_items for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy "update own presentation set items" on presentation_set_items for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- Deliberately NO "for delete" policy. Removal is included = false; the parent
-- set archive or the owner cascade is the row-exit path.

-- ===========================================================================
-- DOWN (manual rollback)
--   drop table if exists presentation_set_items;
--   drop table if exists presentation_sets;
-- ===========================================================================
