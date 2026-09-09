-- RigReceipts Refinement — Pass 3.1 (Carrier Packet integrity closure).
--
-- Additive only. Does NOT rewrite 20260902000016_carrier_packets.sql.
-- Compatibility assumptions (CLEAN_BOOTSTRAP remains an evidence gap):
--   * 00016 tables, RLS, and INVOKER functions exist.
--   * set_updated_at() exists from earlier migrations.
--   * delete_current_account() remains the only ordinary account-deletion path;
--     carrier_packets.owner_id → auth.users ON DELETE CASCADE still applies;
--     carrier_packet_items → carrier_packets ON DELETE CASCADE still applies.
--   * This file REPLACE-s the 00016 guard functions and recreates the item
--     trigger so DELETE is covered. No SECURITY DEFINER.
--
-- Narrow DRAFT-only client DELETE of packet items is NOT historical deletion.

-- ---------------------------------------------------------------------------
-- H13 — a packet cannot supersede itself
-- ---------------------------------------------------------------------------

alter table carrier_packets
  add constraint carrier_packets_no_self_supersede
  check (supersedes_packet_id is null or supersedes_packet_id <> id);

-- ---------------------------------------------------------------------------
-- H3 — DRAFT-only authenticated DELETE of packet items
-- ---------------------------------------------------------------------------

create policy "delete own draft carrier packet items" on carrier_packet_items
  for delete to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (
      select 1
      from carrier_packets p
      where p.id = carrier_packet_items.carrier_packet_id
        and p.owner_id = carrier_packet_items.owner_id
        and p.status = 'DRAFT'
    )
  );

-- ---------------------------------------------------------------------------
-- Cascade marker so account deletion can remove historical items
-- ---------------------------------------------------------------------------

create function carrier_packets_mark_cascade_delete()
returns trigger
language plpgsql
as $$
begin
  perform set_config('rigreceipts.deleting_carrier_packet', 'on', true);
  return old;
end;
$$;

create trigger carrier_packets_mark_cascade_delete
  before delete on carrier_packets
  for each row execute function carrier_packets_mark_cascade_delete();

-- ---------------------------------------------------------------------------
-- H4 — item guard is INSERT/UPDATE/DELETE and old+new parent aware
-- ---------------------------------------------------------------------------

create or replace function carrier_packet_items_guard_immutable()
returns trigger
language plpgsql
as $$
declare
  old_parent_status text;
  new_parent_status text;
begin
  if tg_op = 'INSERT' then
    select status into new_parent_status
    from carrier_packets
    where id = new.carrier_packet_id
      and owner_id = new.owner_id;
    if new_parent_status is null then
      raise exception 'packet item parent must exist';
    end if;
    if new_parent_status <> 'DRAFT' then
      raise exception 'cannot insert items unless parent is draft';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    select status into old_parent_status
    from carrier_packets
    where id = old.carrier_packet_id
      and owner_id = old.owner_id;
    select status into new_parent_status
    from carrier_packets
    where id = new.carrier_packet_id
      and owner_id = new.owner_id;
    if old_parent_status is null or new_parent_status is null then
      raise exception 'packet item parent must exist';
    end if;
    if old_parent_status <> 'DRAFT' or new_parent_status <> 'DRAFT' then
      raise exception 'cannot update items unless old and new parents are draft';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    -- Account deletion / parent cascade: GUC set by carrier_packets BEFORE DELETE,
    -- or the parent row is already gone.
    if current_setting('rigreceipts.deleting_carrier_packet', true) = 'on' then
      return old;
    end if;
    select status into old_parent_status
    from carrier_packets
    where id = old.carrier_packet_id
      and owner_id = old.owner_id;
    if old_parent_status is null then
      return old;
    end if;
    if old_parent_status <> 'DRAFT' then
      raise exception 'cannot delete items unless parent is draft';
    end if;
    return old;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists carrier_packet_items_guard_immutable on carrier_packet_items;

create trigger carrier_packet_items_guard_immutable
  before insert or update or delete on carrier_packet_items
  for each row execute function carrier_packet_items_guard_immutable();

-- ---------------------------------------------------------------------------
-- H5 / H6 — packet lifecycle matrix + immutable identity / created_at
-- ---------------------------------------------------------------------------

create or replace function carrier_packets_guard_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if new.id is distinct from old.id
    or new.owner_id is distinct from old.owner_id
    or new.created_at is distinct from old.created_at
  then
    raise exception 'packet identity is immutable';
  end if;

  if old.status = 'SUPERSEDED' then
    raise exception 'superseded packet is terminal';
  end if;

  if old.status = 'DRAFT' then
    if new.status = 'DRAFT' or new.status = 'READY' then
      return new;
    end if;
    raise exception 'invalid packet transition';
  end if;

  if old.status = 'READY' then
    if new.status = 'READY' then
      if new.name is distinct from old.name
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
        raise exception 'ready packet snapshot is immutable';
      end if;
      return new;
    end if;
    if new.status = 'DRAFT' or new.status = 'SHARED' then
      return new;
    end if;
    raise exception 'invalid packet transition';
  end if;

  if old.status = 'SHARED' then
    if new.status = 'SHARED' then
      if new.name is distinct from old.name
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
        or new.status is distinct from old.status
      then
        raise exception 'shared packet snapshot is immutable';
      end if;
      return new;
    end if;
    if new.status = 'SUPERSEDED' then
      if new.name is distinct from old.name
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
        or new.created_at is distinct from old.created_at
      then
        raise exception 'shared to superseded may change only status and updated_at';
      end if;
      return new;
    end if;
    raise exception 'shared packet may only transition to superseded';
  end if;

  raise exception 'invalid packet transition';
end;
$$;

-- ===========================================================================
-- DOWN (manual rollback)
--   drop policy if exists "delete own draft carrier packet items" on carrier_packet_items;
--   drop trigger if exists carrier_packets_mark_cascade_delete on carrier_packets;
--   drop function if exists carrier_packets_mark_cascade_delete();
--   alter table carrier_packets drop constraint if exists carrier_packets_no_self_supersede;
--   -- restore 00016 function bodies / item trigger shape
-- ===========================================================================
