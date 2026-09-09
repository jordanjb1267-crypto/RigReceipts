-- RigReceipts Refinement — Pass 3 (Carrier Profile + Carrier Packet foundation).
--
--   carrier_profiles          — one reusable USER_ENTERED identity per owner
--   carrier_packet_templates  — custom reusable templates (built-in STANDARD
--                               broker packet is a product default, never stored)
--   carrier_packets           — DRAFT / READY / SHARED / SUPERSEDED snapshots
--   carrier_packet_items      — exact DocumentVersion pointers (never hashes,
--                               paths, buckets or file bytes)
--
-- Identity: 22-character opaque base64url text PKs. Ordinary product exit is
-- archive / status transition. There is deliberately NO authenticated-client
-- DELETE policy; rows leave via the owner cascade on delete_current_account().
--
-- SHARED / SUPERSEDED historical snapshots are guarded by INVOKER triggers so
-- the broad owner UPDATE policy cannot rewrite evidence.
--
-- Additive only. Migrations 00011–00015 are not rewritten. No service role.
-- COMBINED_PACKET_PDF / COMBINED_PACKET_ZIP / PROFILE_COVER_ARTIFACT = DEFERRED.

-- ---------------------------------------------------------------------------
-- carrier_profiles
-- ---------------------------------------------------------------------------

create table carrier_profiles (
  id text primary key
    check (id ~ '^[A-Za-z0-9_-]{8,64}$'),
  owner_id uuid not null references auth.users (id) on delete cascade,
  legal_name text not null check (char_length(legal_name) between 1 and 120),
  dba_name text null check (dba_name is null or char_length(dba_name) <= 120),
  usdot_number text null check (usdot_number is null or char_length(usdot_number) <= 20),
  mc_number text null check (mc_number is null or char_length(mc_number) <= 20),
  address_line1 text null check (address_line1 is null or char_length(address_line1) <= 120),
  address_line2 text null check (address_line2 is null or char_length(address_line2) <= 120),
  city text null check (city is null or char_length(city) <= 80),
  state_province text null check (state_province is null or char_length(state_province) <= 40),
  postal_code text null check (postal_code is null or char_length(postal_code) <= 20),
  contact_name text null check (contact_name is null or char_length(contact_name) <= 80),
  contact_email text null check (contact_email is null or char_length(contact_email) <= 80),
  contact_phone text null check (contact_phone is null or char_length(contact_phone) <= 40),
  equipment_types text[] not null default '{}',
  identity_source text not null check (identity_source = 'USER_ENTERED'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id),
  unique (id, owner_id)
);

create index carrier_profiles_owner_idx on carrier_profiles (owner_id);

create trigger carrier_profiles_set_updated_at
  before update on carrier_profiles
  for each row execute function set_updated_at();

alter table carrier_profiles enable row level security;

create policy "select own carrier profiles" on carrier_profiles for select to authenticated
  using (owner_id = (select auth.uid()));

create policy "insert own carrier profiles" on carrier_profiles for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy "update own carrier profiles" on carrier_profiles for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- Deliberately NO "for delete" policy. Account deletion cascades from auth.users.

-- ---------------------------------------------------------------------------
-- carrier_packet_templates
-- ---------------------------------------------------------------------------

create table carrier_packet_templates (
  id text primary key
    check (id ~ '^[A-Za-z0-9_-]{8,64}$'),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  lifecycle text not null default 'ACTIVE' check (lifecycle in ('ACTIVE', 'ARCHIVED')),
  definition jsonb not null check (jsonb_typeof(definition) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  check ((definition ->> 'schemaVersion') = '1')
);

create index carrier_packet_templates_owner_idx on carrier_packet_templates (owner_id);

create trigger carrier_packet_templates_set_updated_at
  before update on carrier_packet_templates
  for each row execute function set_updated_at();

alter table carrier_packet_templates enable row level security;

create policy "select own carrier packet templates" on carrier_packet_templates for select to authenticated
  using (owner_id = (select auth.uid()));

create policy "insert own carrier packet templates" on carrier_packet_templates for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy "update own carrier packet templates" on carrier_packet_templates for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- Deliberately NO "for delete" policy. Archive is the ordinary exit.

-- ---------------------------------------------------------------------------
-- carrier_packets
-- ---------------------------------------------------------------------------

create table carrier_packets (
  id text primary key
    check (id ~ '^[A-Za-z0-9_-]{8,64}$'),
  owner_id uuid not null references auth.users (id) on delete cascade,
  status text not null check (status in ('DRAFT', 'READY', 'SHARED', 'SUPERSEDED')),
  name text not null check (char_length(name) between 1 and 80),
  template_source_kind text not null check (template_source_kind in ('BUILTIN', 'CUSTOM')),
  template_source_id text null,
  template_code text null,
  template_snapshot jsonb not null check (jsonb_typeof(template_snapshot) = 'object'),
  carrier_profile_id text null,
  profile_snapshot jsonb null check (profile_snapshot is null or jsonb_typeof(profile_snapshot) = 'object'),
  recipient_label text null check (recipient_label is null or char_length(recipient_label) <= 120),
  share_method text null check (share_method is null or share_method in ('OS_SHARE_SHEET', 'OTHER')),
  ready_at timestamptz null,
  shared_at timestamptz null,
  supersedes_packet_id text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  check (
    (template_source_kind = 'BUILTIN' and template_code is not null and template_source_id is null)
    or
    (template_source_kind = 'CUSTOM' and template_source_id is not null and template_code is null)
  ),
  foreign key (carrier_profile_id, owner_id)
    references carrier_profiles (id, owner_id),
  foreign key (template_source_id, owner_id)
    references carrier_packet_templates (id, owner_id),
  foreign key (supersedes_packet_id, owner_id)
    references carrier_packets (id, owner_id)
);

create index carrier_packets_owner_idx on carrier_packets (owner_id);
create index carrier_packets_status_idx on carrier_packets (owner_id, status);

create trigger carrier_packets_set_updated_at
  before update on carrier_packets
  for each row execute function set_updated_at();

alter table carrier_packets enable row level security;

create policy "select own carrier packets" on carrier_packets for select to authenticated
  using (owner_id = (select auth.uid()));

create policy "insert own carrier packets" on carrier_packets for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy "update own carrier packets" on carrier_packets for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- Deliberately NO "for delete" policy.

-- ---------------------------------------------------------------------------
-- carrier_packet_items
-- ---------------------------------------------------------------------------

create table carrier_packet_items (
  id text primary key
    check (id ~ '^[A-Za-z0-9_-]{8,64}$'),
  owner_id uuid not null references auth.users (id) on delete cascade,
  carrier_packet_id text not null,
  requirement_key text not null check (char_length(requirement_key) between 1 and 40),
  requirement_label text not null check (char_length(requirement_label) between 1 and 80),
  required boolean not null,
  position integer not null check (position >= 0),
  operational_document_id text not null,
  document_version_id text not null,
  document_kind_snapshot text not null,
  sensitivity_snapshot text not null,
  expires_at_snapshot date null,
  title_snapshot text null check (title_snapshot is null or char_length(title_snapshot) <= 120),
  created_at timestamptz not null default now(),
  unique (id, owner_id),
  unique (carrier_packet_id, requirement_key),
  unique (carrier_packet_id, operational_document_id),
  foreign key (carrier_packet_id, owner_id)
    references carrier_packets (id, owner_id) on delete cascade,
  foreign key (operational_document_id, owner_id)
    references operational_documents (id, owner_id),
  foreign key (document_version_id, operational_document_id, owner_id)
    references document_versions (id, operational_document_id, owner_id)
);

create index carrier_packet_items_owner_idx on carrier_packet_items (owner_id);
create index carrier_packet_items_packet_idx on carrier_packet_items (carrier_packet_id, position);

alter table carrier_packet_items enable row level security;

create policy "select own carrier packet items" on carrier_packet_items for select to authenticated
  using (owner_id = (select auth.uid()));

create policy "insert own carrier packet items" on carrier_packet_items for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy "update own carrier packet items" on carrier_packet_items for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- Deliberately NO "for delete" policy.

-- ---------------------------------------------------------------------------
-- Historical snapshot guards (SECURITY INVOKER — no DEFINER)
-- ---------------------------------------------------------------------------

create function carrier_packets_guard_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if old.status = 'SUPERSEDED' then
      raise exception 'superseded packet is terminal';
    end if;
    if old.status = 'SHARED' then
      if new.status = 'SUPERSEDED' then
        if new.id is distinct from old.id
          or new.owner_id is distinct from old.owner_id
          or new.name is distinct from old.name
          or new.template_source_kind is distinct from old.template_source_kind
          or new.template_source_id is distinct from old.template_source_id
          or new.template_code is distinct from old.template_code
          or new.template_snapshot is distinct from old.template_snapshot
          or new.carrier_profile_id is distinct from old.carrier_profile_id
          or new.profile_snapshot is distinct from old.profile_snapshot
          or new.recipient_label is distinct from old.recipient_label
          or new.share_method is distinct from old.share_method
          or new.ready_at is distinct from old.ready_at
          or new.shared_at is distinct from old.shared_at
          or new.supersedes_packet_id is distinct from old.supersedes_packet_id
        then
          raise exception 'shared to superseded may change only status and updated_at';
        end if;
      elsif new.status = 'SHARED' then
        if new is distinct from old and (
          new.name is distinct from old.name
          or new.template_snapshot is distinct from old.template_snapshot
          or new.profile_snapshot is distinct from old.profile_snapshot
          or new.recipient_label is distinct from old.recipient_label
          or new.share_method is distinct from old.share_method
          or new.shared_at is distinct from old.shared_at
          or new.template_source_kind is distinct from old.template_source_kind
          or new.template_source_id is distinct from old.template_source_id
          or new.template_code is distinct from old.template_code
          or new.carrier_profile_id is distinct from old.carrier_profile_id
          or new.ready_at is distinct from old.ready_at
          or new.supersedes_packet_id is distinct from old.supersedes_packet_id
        ) then
          raise exception 'shared packet snapshot is immutable';
        end if;
      else
        raise exception 'shared packet may only transition to superseded';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger carrier_packets_guard_immutable
  before update on carrier_packets
  for each row execute function carrier_packets_guard_immutable();

create function carrier_packet_items_guard_immutable()
returns trigger
language plpgsql
as $$
declare
  parent_status text;
begin
  select status into parent_status
  from carrier_packets
  where id = coalesce(new.carrier_packet_id, old.carrier_packet_id)
    and owner_id = coalesce(new.owner_id, old.owner_id);
  if parent_status in ('SHARED', 'SUPERSEDED') then
    raise exception 'cannot mutate items of a historical packet';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger carrier_packet_items_guard_immutable
  before insert or update on carrier_packet_items
  for each row execute function carrier_packet_items_guard_immutable();

-- ===========================================================================
-- DOWN (manual rollback)
--   drop trigger if exists carrier_packet_items_guard_immutable on carrier_packet_items;
--   drop trigger if exists carrier_packets_guard_immutable on carrier_packets;
--   drop function if exists carrier_packet_items_guard_immutable();
--   drop function if exists carrier_packets_guard_immutable();
--   drop table if exists carrier_packet_items;
--   drop table if exists carrier_packets;
--   drop table if exists carrier_packet_templates;
--   drop table if exists carrier_profiles;
-- ===========================================================================
