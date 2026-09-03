-- IR-R1 — Independent review remediation (additive; do not rewrite 00016–00019).
--
-- IR-01: Remove the redundant DIRECT carrier_packet_items.owner_id → auth.users
-- foreign key. owner_id stays. Same-owner composite FKs stay. Account deletion
-- for CarrierPacketItems is then packet-mediated:
--   auth.users → carrier_packets → carrier_packet_items
-- so the packet BEFORE DELETE cascade marker can govern historical item DELETE.
--
-- IR-04: Path-aware documents-bucket policies. Road Wallet evidence objects
-- ({uid}/road-wallet/...) are insert-once for the authenticated owner.
-- SELECT + INSERT remain. UPDATE + DELETE are not granted on that prefix.
-- Legacy non-road-wallet documents keep own-path UPDATE/DELETE.
-- Account-deletion SECURITY DEFINER remains responsible for sweeping owned
-- storage objects.
--
-- IR-06 is DEFERRED_DEFENSE_IN_DEPTH (no DocumentVersion service-role trigger).
-- IR-07 is DEPLOYMENT_PREFLIGHT (no 00013/00014 rewrite).

-- ---------------------------------------------------------------------------
-- IR-01 — drop only the direct item → auth.users FK
-- PostgreSQL default name from:
--   owner_id uuid not null references auth.users (id) on delete cascade
-- ---------------------------------------------------------------------------
alter table public.carrier_packet_items
  drop constraint if exists carrier_packet_items_owner_id_fkey;

-- ---------------------------------------------------------------------------
-- IR-04 — replace documents_owner_access with path-aware policies
-- ---------------------------------------------------------------------------
drop policy if exists "documents_owner_access" on storage.objects;

drop policy if exists "documents_owner_select" on storage.objects;
drop policy if exists "documents_owner_insert" on storage.objects;
drop policy if exists "documents_owner_update" on storage.objects;
drop policy if exists "documents_owner_delete" on storage.objects;

create policy "documents_owner_select"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "documents_owner_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Own-path UPDATE remains only for NON-road-wallet documents.
create policy "documents_owner_update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'documents'
  and (storage.foldername(name))[1] = auth.uid()::text
  and (storage.foldername(name))[2] is distinct from 'road-wallet'
)
with check (
  bucket_id = 'documents'
  and (storage.foldername(name))[1] = auth.uid()::text
  and (storage.foldername(name))[2] is distinct from 'road-wallet'
);

-- Own-path DELETE remains only for NON-road-wallet documents.
create policy "documents_owner_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'documents'
  and (storage.foldername(name))[1] = auth.uid()::text
  and (storage.foldername(name))[2] is distinct from 'road-wallet'
);
