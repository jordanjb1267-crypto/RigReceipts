-- RigReceipts Refinement — C2 (storage classification).
--
-- New `document_scans` writes record the bucket the object was actually
-- written to. The client resolves the bucket from an explicit storage class:
--   EXPENSE_RECEIPT      -> receipts
--   LOAD_DOCUMENT        -> documents
--   ROAD_WALLET_DOCUMENT -> documents
--   GENERATED_ARTIFACT   -> reports
--
-- Historical rule: every object the client has written so far went to the
-- `receipts` bucket, so the default `'receipts'` accurately describes where
-- existing rows' objects physically live. Historical objects are NOT moved and
-- historical rows are NOT re-bucketed from scan_type.
--
-- Additive only: no table renamed/dropped, no rows moved, RLS unchanged
-- (`document_scans` keeps its existing "own rows" owner policy). Account
-- deletion (`delete_current_account`) already sweeps receipts, documents and
-- reports for the caller's folder, so no change is needed there.

alter table document_scans
  add column if not exists storage_bucket text not null default 'receipts';

alter table document_scans
  drop constraint if exists document_scans_storage_bucket_check;

alter table document_scans
  add constraint document_scans_storage_bucket_check
  check (storage_bucket in ('receipts', 'documents', 'reports'));

comment on column document_scans.storage_bucket is
  'Private storage bucket the object at storage_path was written to. '
  'Defaults to receipts because every pre-C2 object was written there; '
  'new writes persist the bucket chosen by the storage class of the scan type.';

-- The client keys objects by its local capture id (see `storagePathFor` in
-- src/data/captureSync.ts), not by the document_scans row id.
comment on column document_scans.storage_path is
  'Object path inside storage_bucket (per-user folder: {owner_id}/{capture_id}.{ext}).';

-- ===========================================================================
-- DOWN (manual rollback)
--   alter table document_scans drop constraint if exists document_scans_storage_bucket_check;
--   alter table document_scans drop column if exists storage_bucket;
--   comment on column document_scans.storage_path is
--     'object path in the receipts/documents bucket';
-- ===========================================================================
