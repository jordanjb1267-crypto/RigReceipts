-- RigReceipts Refinement — Pass 1A.1 (Road Wallet integrity hardening).
--
-- Additive hardening on top of 20260902000013_road_wallet_core.sql (which is
-- not rewritten). Three responsibilities:
--
--   H1  Remove authenticated-client DELETE authority from operational_documents.
--       document_versions references operational_documents ON DELETE CASCADE,
--       so a client-side document delete would have cascade-deleted immutable
--       version evidence. Ordinary product deletion is ARCHIVE (lifecycle),
--       not a physical row delete. Account deletion still works exactly as
--       before through delete_current_account() (SECURITY DEFINER: removes the
--       user's storage objects, deletes the auth.users row, and every owner_id
--       foreign key cascades). That function is not touched here.
--
--   H4  Enforce, at the database, that a document's truck belongs to the same
--       owner: composite FK (truck_id, owner_id) -> trucks (id, owner_id) with
--       ON DELETE SET NULL (truck_id) so that deleting a truck nulls only the
--       association and never the document's owner_id (PostgreSQL 15+ column
--       list on SET NULL; Supabase runs Postgres 15/17). trucks RLS unchanged.
--
--   H5  Known-sensitive kinds carry a fixed sensitivity class:
--         CDL / MEDICAL_DOCUMENT / TWIC                     -> PERSONAL_SENSITIVE
--         W9 / FACTORING_NOA / BANKING_DOCUMENT / LEASE_AGREEMENT
--                                                            -> FINANCIAL_SENSITIVE
--       Other kinds (incl. CUSTOM) keep their configurable sensitivity.

-- ---------------------------------------------------------------------------
-- H1 — least-privilege owner policies on operational_documents (no DELETE)
-- ---------------------------------------------------------------------------

drop policy if exists "own rows" on operational_documents;

create policy "select own documents" on operational_documents for select to authenticated
  using (owner_id = (select auth.uid()));

create policy "insert own documents" on operational_documents for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy "update own documents" on operational_documents for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- Deliberately NO "for delete" policy for authenticated clients: the ordinary
-- lifecycle exit is lifecycle = 'ARCHIVED'. Rows leave only via the
-- auth.users owner cascade (delete_current_account) or privileged maintenance.

-- ---------------------------------------------------------------------------
-- H4 — same-owner truck association
-- ---------------------------------------------------------------------------

-- Composite FK target (additive; trucks.id stays the primary key).
alter table trucks
  add constraint trucks_id_owner_unique unique (id, owner_id);

-- Replace the single-column truck reference from 00013 with the owner-aware one.
alter table operational_documents
  drop constraint if exists operational_documents_truck_id_fkey;

alter table operational_documents
  add constraint operational_documents_truck_same_owner_fkey
  foreign key (truck_id, owner_id) references trucks (id, owner_id)
  on delete set null (truck_id);

-- MATCH SIMPLE (default): a NULL truck_id disables the check, so documents
-- without a truck are unaffected; a non-null truck_id must match a truck row
-- with the same owner_id. Truck deletion nulls truck_id only.

-- ---------------------------------------------------------------------------
-- H5 — fixed sensitivity for known-sensitive kinds
-- ---------------------------------------------------------------------------

alter table operational_documents
  add constraint operational_documents_sensitivity_for_kind_check check (
    case document_kind
      when 'CDL' then sensitivity = 'PERSONAL_SENSITIVE'
      when 'MEDICAL_DOCUMENT' then sensitivity = 'PERSONAL_SENSITIVE'
      when 'TWIC' then sensitivity = 'PERSONAL_SENSITIVE'
      when 'W9' then sensitivity = 'FINANCIAL_SENSITIVE'
      when 'FACTORING_NOA' then sensitivity = 'FINANCIAL_SENSITIVE'
      when 'BANKING_DOCUMENT' then sensitivity = 'FINANCIAL_SENSITIVE'
      when 'LEASE_AGREEMENT' then sensitivity = 'FINANCIAL_SENSITIVE'
      else true
    end
  );

-- ===========================================================================
-- DOWN (manual rollback)
--   alter table operational_documents drop constraint if exists
--     operational_documents_sensitivity_for_kind_check;
--   alter table operational_documents drop constraint if exists
--     operational_documents_truck_same_owner_fkey;
--   alter table operational_documents add constraint operational_documents_truck_id_fkey
--     foreign key (truck_id) references trucks (id) on delete set null;
--   alter table trucks drop constraint if exists trucks_id_owner_unique;
--   drop policy if exists "update own documents" on operational_documents;
--   drop policy if exists "insert own documents" on operational_documents;
--   drop policy if exists "select own documents" on operational_documents;
--   create policy "own rows" on operational_documents for all to authenticated
--     using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
-- ===========================================================================
