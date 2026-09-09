-- RigReceipts Refinement — Pass 3.2 (Carrier Packet snapshot integrity).
--
-- Additive only. Does NOT rewrite 20260902000016_carrier_packets.sql
-- or 20260902000017_carrier_packet_integrity_hardening.sql.
-- Compatibility assumptions (CLEAN_BOOTSTRAP remains an evidence gap):
--   * 00016 tables, RLS, and INVOKER functions exist.
--   * 00017 replaced carrier_packets_guard_immutable() and the item guard.
--   * This file REPLACE-s the packet guard again and adds status-shape
--     validation. No SECURITY DEFINER.
--
-- READY → SHARED may change only share-time metadata. Reviewed snapshot
-- columns stay frozen. READY → DRAFT remains allowed.

-- ---------------------------------------------------------------------------
-- H2 — coherent lifecycle timestamp / share-method shape
-- ---------------------------------------------------------------------------

alter table carrier_packets
  add constraint carrier_packets_status_shape
  check (
    (
      status = 'DRAFT'
      and ready_at is null
      and shared_at is null
      and share_method is null
    )
    or (
      status = 'READY'
      and ready_at is not null
      and shared_at is null
      and share_method is null
    )
    or (
      status in ('SHARED', 'SUPERSEDED')
      and ready_at is not null
      and shared_at is not null
      and share_method is not null
    )
  );

-- ---------------------------------------------------------------------------
-- H1 — READY → SHARED preserves the reviewed snapshot
-- H2 — status-shape on INSERT and UPDATE
-- ---------------------------------------------------------------------------

create or replace function carrier_packets_guard_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'DRAFT' then
      if new.ready_at is not null
        or new.shared_at is not null
        or new.share_method is not null
      then
        raise exception 'draft status-shape violation';
      end if;
    elsif new.status = 'READY' then
      if new.ready_at is null
        or new.shared_at is not null
        or new.share_method is not null
      then
        raise exception 'ready status-shape violation';
      end if;
    elsif new.status in ('SHARED', 'SUPERSEDED') then
      if new.ready_at is null
        or new.shared_at is null
        or new.share_method is null
      then
        raise exception 'shared status-shape violation';
      end if;
    else
      raise exception 'invalid packet status';
    end if;
    return new;
  end if;

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
    if new.status <> 'DRAFT' and new.status <> 'READY' then
      raise exception 'invalid packet transition';
    end if;
  elsif old.status = 'READY' then
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
    elsif new.status = 'DRAFT' then
      null;
    elsif new.status = 'SHARED' then
      if new.name is distinct from old.name
        or new.template_source_kind is distinct from old.template_source_kind
        or new.template_source_id is distinct from old.template_source_id
        or new.template_code is distinct from old.template_code
        or new.template_snapshot is distinct from old.template_snapshot
        or new.carrier_profile_id is distinct from old.carrier_profile_id
        or new.profile_snapshot is distinct from old.profile_snapshot
        or new.ready_at is distinct from old.ready_at
        or new.supersedes_packet_id is distinct from old.supersedes_packet_id
      then
        raise exception 'ready to shared may change only share metadata';
      end if;
      if new.shared_at is null then
        raise exception 'ready to shared requires shared_at';
      end if;
      if new.share_method is null
        or new.share_method not in ('OS_SHARE_SHEET', 'OTHER')
      then
        raise exception 'ready to shared requires a valid share_method';
      end if;
    else
      raise exception 'invalid packet transition';
    end if;
  elsif old.status = 'SHARED' then
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
    elsif new.status = 'SUPERSEDED' then
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
    else
      raise exception 'shared packet may only transition to superseded';
    end if;
  else
    raise exception 'invalid packet transition';
  end if;

  if new.status = 'DRAFT' then
    if new.ready_at is not null
      or new.shared_at is not null
      or new.share_method is not null
    then
      raise exception 'draft status-shape violation';
    end if;
  elsif new.status = 'READY' then
    if new.ready_at is null
      or new.shared_at is not null
      or new.share_method is not null
    then
      raise exception 'ready status-shape violation';
    end if;
  elsif new.status in ('SHARED', 'SUPERSEDED') then
    if new.ready_at is null
      or new.shared_at is null
      or new.share_method is null
    then
      raise exception 'shared status-shape violation';
    end if;
  else
    raise exception 'invalid packet status';
  end if;

  return new;
end;
$$;

drop trigger if exists carrier_packets_guard_immutable on carrier_packets;

create trigger carrier_packets_guard_immutable
  before insert or update on carrier_packets
  for each row execute function carrier_packets_guard_immutable();

-- ===========================================================================
-- DOWN (manual rollback)
--   alter table carrier_packets drop constraint if exists carrier_packets_status_shape;
--   -- restore 00017 function body and BEFORE UPDATE-only trigger
-- ===========================================================================
