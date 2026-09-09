-- IR-R2 — Runtime assurance remediation (additive; do not rewrite 00008 or 00016–00020).
--
-- RR-DB-01: delete_current_account() must set the transaction-local Storage
-- GUC that storage.protect_delete() requires before DELETE storage.objects.
-- 00008 is not rewritten. Scope, SECURITY DEFINER, empty search_path, and
-- auth.uid()-only identity are preserved. Errors are not caught or ignored.
--
-- RR-DB-03: close the demonstrated snapshot-scalar hole. carrier_packet_items
-- document_kind_snapshot / sensitivity_snapshot accept only the canonical
-- OperationalDocument universes. No new enum type. No ownership/FK/policy
-- change.
--
-- READ-ONLY deployment preflight (do not auto-clean; do not run as a
-- destructive migration). On a preexisting target, any matching row is a
-- deployment BLOCK pending owner adjudication:
--
--   SELECT id, owner_id, document_kind_snapshot
--   FROM public.carrier_packet_items
--   WHERE document_kind_snapshot NOT IN (
--     'CDL', 'MEDICAL_DOCUMENT', 'TWIC', 'VEHICLE_REGISTRATION', 'TRAILER_REGISTRATION',
--     'IRP_CAB_CARD', 'ANNUAL_INSPECTION', 'INSURANCE', 'IFTA', 'OPERATING_PERMIT',
--     'OPERATING_AUTHORITY', 'CERTIFICATE_OF_INSURANCE', 'UCR', 'W9', 'FACTORING_NOA',
--     'BANKING_DOCUMENT', 'LEASE_AGREEMENT', 'CUSTOM'
--   );
--
--   SELECT id, owner_id, sensitivity_snapshot
--   FROM public.carrier_packet_items
--   WHERE sensitivity_snapshot NOT IN (
--     'STANDARD', 'PERSONAL_SENSITIVE', 'FINANCIAL_SENSITIVE'
--   );

-- ---------------------------------------------------------------------------
-- RR-DB-01 — account deletion Storage delete context
-- ---------------------------------------------------------------------------

create or replace function public.delete_current_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  -- Transaction-local only (third argument true). Required by
  -- storage.protect_objects_delete / storage.protect_delete().
  perform pg_catalog.set_config(
    'storage.allow_delete_query',
    'true',
    true
  );

  -- Remove the user's stored files (per-user folder in each private bucket).
  delete from storage.objects
  where bucket_id in ('receipts', 'documents', 'reports')
    and (storage.foldername(name))[1] = v_uid::text;

  -- Deleting the auth user cascades every owner-scoped row (FKs on delete cascade).
  delete from auth.users where id = v_uid;
end;
$$;

revoke all on function public.delete_current_account() from public, anon;
grant execute on function public.delete_current_account() to authenticated;

-- ---------------------------------------------------------------------------
-- RR-DB-03 — bounded snapshot enum CHECKs (canonical universes, no new types)
-- ---------------------------------------------------------------------------

alter table public.carrier_packet_items
  add constraint carrier_packet_items_document_kind_snapshot_check
  check (
    document_kind_snapshot in (
      'CDL', 'MEDICAL_DOCUMENT', 'TWIC', 'VEHICLE_REGISTRATION', 'TRAILER_REGISTRATION',
      'IRP_CAB_CARD', 'ANNUAL_INSPECTION', 'INSURANCE', 'IFTA', 'OPERATING_PERMIT',
      'OPERATING_AUTHORITY', 'CERTIFICATE_OF_INSURANCE', 'UCR', 'W9', 'FACTORING_NOA',
      'BANKING_DOCUMENT', 'LEASE_AGREEMENT', 'CUSTOM'
    )
  );

alter table public.carrier_packet_items
  add constraint carrier_packet_items_sensitivity_snapshot_check
  check (
    sensitivity_snapshot in (
      'STANDARD', 'PERSONAL_SENSITIVE', 'FINANCIAL_SENSITIVE'
    )
  );

-- ===========================================================================
-- DOWN (manual rollback)
--   alter table public.carrier_packet_items
--     drop constraint if exists carrier_packet_items_sensitivity_snapshot_check;
--   alter table public.carrier_packet_items
--     drop constraint if exists carrier_packet_items_document_kind_snapshot_check;
--   -- restore 00008 function body
-- ===========================================================================
