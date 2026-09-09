-- IR-R3 — Account-delete dependency ordering (additive; do not rewrite 00008 or 00021).
--
-- RR-DB-04: delete_current_account() cannot rely on unordered sibling cascades
-- from auth.users. Runtime proved:
--   auth.users → operational_documents ON DELETE CASCADE
--   can fire while carrier_packet_items still exist with
--   NO ACTION FKs to OperationalDocument / DocumentVersion
--   → SQLSTATE 23503 on carrier_packet_items_operational_document_id_owner_id_fkey.
--
-- presentation_set_items has the same unordered sibling-cascade shape against
-- operational_documents. Close that class in this function, not later.
--
-- Do NOT change those NO ACTION FKs to ON DELETE CASCADE: they protect
-- historical packet / presentation evidence if a source document is removed
-- outside full account deletion.
--
-- Orchestration (one transaction; errors are not caught):
--   1. authenticate
--   2. transaction-local storage.allow_delete_query
--   3. bounded Storage DELETE
--   4. DELETE public.carrier_packets WHERE owner_id = v_uid
--      (BEFORE DELETE marker → item guard → packet→item CASCADE)
--   5. DELETE public.presentation_sets WHERE owner_id = v_uid
--      (set→item CASCADE before documents are removed)
--   6. DELETE auth.users WHERE id = v_uid
--
-- Do not directly delete carrier_packet_items, presentation_set_items,
-- operational_documents, or document_versions.

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

  -- Packet graph first: BEFORE DELETE sets rigreceipts.deleting_carrier_packet
  -- and ON DELETE CASCADE removes carrier_packet_items. Do not delete items
  -- directly (that would bypass the historical item guard).
  delete from public.carrier_packets
  where owner_id = v_uid;

  -- Presentation graph next: ON DELETE CASCADE removes presentation_set_items
  -- before OperationalDocuments are owner-cascaded from auth.users.
  delete from public.presentation_sets
  where owner_id = v_uid;

  -- Remaining owner-scoped rows (documents, versions, profile, templates, …)
  -- cascade from auth.users once packet/presentation items no longer reference
  -- Road Wallet documents.
  delete from auth.users where id = v_uid;
end;
$$;

revoke all on function public.delete_current_account() from public, anon;
grant execute on function public.delete_current_account() to authenticated;

-- ===========================================================================
-- DOWN (manual rollback)
--   -- restore 00021 function body
-- ===========================================================================
