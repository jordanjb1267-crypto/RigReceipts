-- RigReceipts Refinement — Pass 1A (Road Wallet core).
--
--   operational_documents — durable logical records (editable metadata)
--   document_versions     — immutable exact-file evidence for synced versions
--
-- Identity: ids are the client's 22-character opaque base64url identifiers
-- (16 CSPRNG bytes) and are IDENTICAL locally and remotely — no second server
-- UUID is minted for the same logical object. Hence TEXT primary keys with a
-- bounded opaque-id CHECK matching the client grammar.
--
-- Never stored here: local file paths/URIs, original filenames, raw OCR, raw
-- CDL / EIN / policy / banking identifiers (only a masked reference such as
-- ****1234), or any "compliance" judgement. Stored dates describe the record;
-- validity is derived client-side and is not a legal determination.
--
-- Additive only. Existing load_documents / document_scans are untouched:
-- LoadDocument != OperationalDocument.

-- ---------------------------------------------------------------------------
-- operational_documents
-- ---------------------------------------------------------------------------

create table operational_documents (
  id text primary key
    check (id ~ '^[A-Za-z0-9_-]{8,64}$'),
  owner_id uuid not null references auth.users (id) on delete cascade,
  document_kind text not null check (
    document_kind in (
      'CDL', 'MEDICAL_DOCUMENT', 'TWIC', 'VEHICLE_REGISTRATION', 'TRAILER_REGISTRATION',
      'IRP_CAB_CARD', 'ANNUAL_INSPECTION', 'INSURANCE', 'IFTA', 'OPERATING_PERMIT',
      'OPERATING_AUTHORITY', 'CERTIFICATE_OF_INSURANCE', 'UCR', 'W9', 'FACTORING_NOA',
      'BANKING_DOCUMENT', 'LEASE_AGREEMENT', 'CUSTOM'
    )
  ),
  subject_kind text not null check (
    subject_kind in ('DRIVER', 'CARRIER', 'TRUCK', 'TRAILER', 'GENERAL')
  ),
  truck_id uuid references trucks (id) on delete set null,
  trailer_number text,
  title text not null check (length(title) between 1 and 200),
  issuer text,
  jurisdiction text,
  issued_at date,
  effective_at date,
  expires_at date,
  -- Only a masked form is ever accepted: four asterisks + up to four trailing characters.
  masked_reference text check (
    masked_reference is null or masked_reference ~ '^\*{4}[A-Za-z0-9]{0,4}$'
  ),
  sensitivity text not null check (
    sensitivity in ('STANDARD', 'PERSONAL_SENSITIVE', 'FINANCIAL_SENSITIVE')
  ),
  lifecycle text not null default 'ACTIVE' check (lifecycle in ('ACTIVE', 'ARCHIVED')),
  offline_pinned boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Lets child rows FK on (id, owner_id) so a version can never point at
  -- another owner's document.
  unique (id, owner_id)
);

create index operational_documents_owner_idx
  on operational_documents (owner_id);
create index operational_documents_owner_expires_idx
  on operational_documents (owner_id, expires_at);
create index operational_documents_owner_truck_idx
  on operational_documents (owner_id, truck_id);

create trigger operational_documents_set_updated_at
  before update on operational_documents
  for each row execute function set_updated_at();

alter table operational_documents enable row level security;

-- Editable/archivable by its owner: same owner-only pattern as every other
-- owner_id table (20260716000002_rls.sql).
create policy "own rows" on operational_documents for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- document_versions — immutable evidence for versions whose file is synced
-- ---------------------------------------------------------------------------

create table document_versions (
  id text primary key
    check (id ~ '^[A-Za-z0-9_-]{8,64}$'),
  owner_id uuid not null references auth.users (id) on delete cascade,
  operational_document_id text not null,
  version_number integer not null check (version_number > 0),
  supersedes_version_id text,
  storage_bucket text not null check (storage_bucket = 'documents'),
  storage_path text not null,
  file_kind text not null check (file_kind in ('IMAGE', 'PDF', 'OTHER')),
  mime_type text not null check (length(mime_type) between 3 and 100),
  extension text not null check (extension ~ '^[a-z0-9]{1,8}$'),
  byte_size bigint not null check (byte_size > 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),

  -- Version numbers never duplicate inside a logical document.
  unique (operational_document_id, version_number),
  -- Target for the self-referencing supersession FK below.
  unique (id, operational_document_id, owner_id),
  -- Child-owner consistency at the database level: the document must exist and
  -- belong to the same owner.
  foreign key (operational_document_id, owner_id)
    references operational_documents (id, owner_id) on delete cascade,
  -- Supersession may only point at a version of the SAME document and owner.
  -- (That it is a *prior* version — lower version_number — is enforced by the
  -- client's validateNewVersion; ordering is not expressible as a plain FK.)
  foreign key (supersedes_version_id, operational_document_id, owner_id)
    references document_versions (id, operational_document_id, owner_id),
  check (supersedes_version_id is null or supersedes_version_id <> id),
  -- The object key is fully determined by owner/document/version/extension:
  -- {owner_id}/road-wallet/{document_id}/{version_id}.{ext}. No filename, no
  -- local path can appear here.
  check (
    storage_path =
      owner_id::text || '/road-wallet/' || operational_document_id || '/' || id || '.' || extension
  )
);

create index document_versions_owner_idx
  on document_versions (owner_id);
create index document_versions_document_idx
  on document_versions (operational_document_id, version_number desc);

alter table document_versions enable row level security;

-- Least privilege: the mobile client reads and appends its own immutable
-- version rows. There is deliberately NO update policy (evidence is never
-- rewritten) and NO delete policy (rows go away only through the owner
-- cascade / delete_current_account). Retries of a crashed sync compare the
-- existing row to local evidence client-side and never overwrite it.
create policy "select own versions" on document_versions for select to authenticated
  using (owner_id = (select auth.uid()));

create policy "insert own versions" on document_versions for insert to authenticated
  with check (owner_id = (select auth.uid()));

-- Storage: Road Wallet objects live in the existing private `documents`
-- bucket under the caller's folder ({auth.uid()}/road-wallet/...), which the
-- bucket policy from 20260716000003_storage.sql already scopes to the owner.
-- Account deletion (delete_current_account) already sweeps that folder.

-- ===========================================================================
-- DOWN (manual rollback)
--   drop table if exists document_versions;
--   drop table if exists operational_documents;
-- ===========================================================================
