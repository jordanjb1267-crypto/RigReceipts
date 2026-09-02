# RigReceipts Refinement Candidate (Passes 0–3) — implementation record

Branch: `cursor/rigreceipts-pass0-3-v0.1-fc77` off `main` @ `1da93f5a`.
Draft PR #8. Not authorized for merge or owner acceptance until independent
clean-bootstrap migration validation and two-user RLS validation are complete.

This file records what the candidate actually does so internal documentation
matches behaviour (handoff §12). It makes no legal or compliance assurances.

## Pass 0 — entitlement & capability control plane (commit `d6bd18f`)

See `docs/FREIGHT_INTELLIGENCE.md` › "Refinement Pass 0" for the effective
matrix. Summary: one ladder, prices and free caps unchanged; Road Wallet /
Quick Present free with **no document-count gate**; Driver Pro monetizes cloud
document backup, expiry alerts, saved presentation sets, share/export;
Owner-Operator adds Carrier Profile + Carrier Packet Builder; Fleet Lite adds
multi-truck document capabilities; Lifetime inherits Owner-Operator, not Fleet
Lite. `basic_external_intelligence` joins the data-entitlement enum; licensed /
high-volume data is granted to no tier. Seven new flags default `off`.

## C1 — cloud-sync authorization + local-only semantics

### Rule

`authenticated != cloud_backup_entitled`. Every remote effect must pass the
single boundary in `src/data/cloudSyncAuth.ts`
(`assertRemoteEffectAuthorized(capability, contentOwnerId)`), which evaluates
the pure rule in `src/domain/cloudSync.ts` against live state:

1. Supabase configured (`isSupabaseConfigured()`), else `not_configured`;
2. a user is signed in (`useAuthStore.userId`), else `signed_out`;
3. the current tier (`useSubscriptionStore.tier`) includes the capability
   (`canUseFeature`), else `not_entitled`;
4. the content has an owner binding, else `unowned_content`;
5. the owner is the signed-in user, else `owner_mismatch`.

Capabilities are distinct feature keys: the receipt/capture queue uses
`cloudBackup`; Road Wallet (later pass) will use `cloudDocumentBackup`. Both
start at Driver Pro today but are never conflated in code.

### Where the boundary is enforced

`src/data/captureSync.ts` re-checks immediately before **each** remote effect,
not once per sync: (1) before the storage upload, (2) before the
`document_scans` insert, (3) before the `expenses` insert. The backfill loop
(`syncPendingCaptures`) additionally re-evaluates authorization per capture, so
a sign-out or downgrade while a run is in progress stops later uploads. UI
gating is advisory only; the Scan screen never decides eligibility.

### Capture sync state

`Capture.status` is now `local_only | pending_sync | synced` and every capture
carries `accountOwnerId: string | null`.

| Situation                                            | Result                                                                                                                                                              |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Created signed out                                   | `accountOwnerId: null`, `local_only`                                                                                                                                |
| Created signed in, tier without `cloudBackup` (Free) | bound to the user, `local_only`                                                                                                                                     |
| Created signed in, entitled tier                     | bound to the user, `pending_sync`, immediate best-effort upload                                                                                                     |
| Upload + row writes succeed                          | `synced` + `remoteScanId` (terminal; never re-uploaded)                                                                                                             |
| Entitlement granted later (same user signed in)      | owned `local_only` → `pending_sync` on the next reconcile, then synced                                                                                              |
| Entitlement lost / sign-out before upload            | `pending_sync` → `local_only`                                                                                                                                       |
| Another user signs in                                | User A's unsynced content is `local_only` for that session; it is never uploaded under User B and returns to `pending_sync` when User A signs back in (if entitled) |
| Legacy content with no owner binding                 | `local_only` forever in this candidate — never claimed for whoever signs in (explicit adoption is future UX)                                                        |
| Upload fails                                         | stays `pending_sync` with all fields intact; retried by the next backfill                                                                                           |

No state transition deletes local or remote data. Reconciliation
(`useCapturesStore.reconcileSyncStates`) runs after the persisted queue
hydrates, on every auth change and on every tier change
(`initCaptureSync` → `subscribeCloudSyncContext`). It also runs in device-only
mode (no Supabase): everything reconciles to `local_only` and no remote call is
made.

### Persisted-state normalization

`rigreceipts.captures` moves to persist **version 1** with a zustand `migrate`
hook (`migrateCapturesState` → `normalizeLegacyCapture`):

- `status: 'synced'` → stays `synced`, keeps `remoteScanId`;
- any other/missing status → `local_only`;
- missing `accountOwnerId` → `null` (unowned);
- every other field is preserved verbatim; nothing is dropped.

Owned-but-unsynced legacy rows (none exist before this candidate, but the
normalizer handles them) also land on `local_only` and are promoted by the next
reconcile if the session may upload them.

### User-visible copy

- Scan › Saved card reflects the real state: "Backing up" for
  `pending_sync`/`synced`; "On this device" for `local_only`, with the
  Driver Pro note when the user is signed in but not entitled.
- CSV exports (Reports, Monthly Closeout) "Synced" column: `yes` / `pending` /
  `local`.

### Known partial-write edge

If entitlement lapses between the object upload and the `document_scans`
insert, the upload has already happened; the capture is relabelled `local_only`
and no rows are written. The orphaned object sits in the user's own private
folder and is overwritten (`upsert: true`) if the capture later syncs. This is
accepted for the candidate and covered by a test.

## C2 — storage classification

`src/domain/storageClass.ts` (provider-neutral):

| Storage class          | Bucket      |
| ---------------------- | ----------- |
| `EXPENSE_RECEIPT`      | `receipts`  |
| `LOAD_DOCUMENT`        | `documents` |
| `ROAD_WALLET_DOCUMENT` | `documents` |
| `GENERATED_ARTIFACT`   | `reports`   |

Explicit scan-type classification for the existing Scan path
(`SCAN_TYPE_STORAGE_CLASS`), independent of accounting:

| Scan types                                                                | Class → bucket                                      | Expense row?                   |
| ------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------ |
| receipt, fuel, repair_invoice, lumper, toll, parking, meal, shower, hotel | `EXPENSE_RECEIPT` → `receipts`                      | yes, when an amount is present |
| bol, pod, inspection                                                      | `LOAD_DOCUMENT` → `documents`                       | never                          |
| permit, scale_ticket                                                      | `LOAD_DOCUMENT` → `documents`                       | yes, when an amount is present |
| other (ambiguous)                                                         | `EXPENSE_RECEIPT` → `receipts` (historical default) | yes, when an amount is present |

Migration `supabase/migrations/20260902000012_storage_classification.sql` adds
`document_scans.storage_bucket text not null default 'receipts'` with a check
constraint over the three buckets. New rows persist the bucket actually used.

Historical rule: no storage objects are moved and no historical row is
re-bucketed from `scan_type`; the `'receipts'` default is accurate because the
client only ever wrote to `receipts` before this change. Account deletion
(`delete_current_account`) already sweeps `receipts`, `documents` and `reports`
for the caller's folder and is unchanged.

## C3 — onboarding load persistence

### Defect closed

The onboarding "Save this load" (Rate Check) and "Analyze this load" (Rate
Confirmation) actions completed onboarding, emitted `first_load_saved` and
navigated to Reveal **without creating a `LoadRecord`**. Both now persist
exactly one local load first.

### `evaluated` load status

`LoadStatus` gains `evaluated` ahead of `booked` (`src/domain/loads.ts`):

| Status       | Meaning                                                       | Open? | Completed? | `nextLoadStatus`                       |
| ------------ | ------------------------------------------------------------- | ----- | ---------- | -------------------------------------- |
| `evaluated`  | offer the user evaluated and saved; no evidence it was booked | yes   | no         | `booked`                               |
| `booked`     | actually booked/accepted                                      | yes   | no         | `in_transit`                           |
| `in_transit` |                                                               | yes   | no         | `delivered`                            |
| `delivered`  |                                                               | yes   | yes        | `paid`                                 |
| `paid`       |                                                               | no    | yes        | `booked` (intentional wrap, unchanged) |

Transitions are an explicit switch, so `paid` never wraps to `evaluated`. The
DB `loads.status` column is `text`; no migration is needed or added.

### Rate Check → one `evaluated` load

`rateCheckLoadDraft()` receives the **raw validated inputs** (offer, loaded
miles, deadhead miles — not reconstructed from `RateCheckResult.totalMiles`)
plus the optional user-typed trip:

| LoadRecord field                              | Value                                                                                                                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `loadNumber`                                  | `RR-DRAFT-YYYYMMDD-HHMMSS` (UTC, app-generated)                                                                                                                          |
| `broker` / `fuelSurcharge`                    | `null` — never invented                                                                                                                                                  |
| `origin` / `destination`                      | `City, ST` from user-entered trip details only; `null` otherwise                                                                                                         |
| `grossRate` / `loadedMiles` / `deadheadMiles` | exact inputs                                                                                                                                                             |
| `status`                                      | `evaluated`                                                                                                                                                              |
| `bolRequired`                                 | store default (`true`)                                                                                                                                                   |
| `note`                                        | states it came from the onboarding Rate Check, that no broker load number was supplied, that the number is RigReceipts-generated, and that it is not evidence of booking |

### Rate Confirmation → one `booked` load

`rateConLoadDraft()` uses only the reviewed, document-derived fields shown on
the review card: `loadNumber` (or `RR-DRAFT-*` when absent — never a fabricated
broker number), `broker`, route from parsed city/state, `grossRate =
offerUsd`, `loadedMiles`, `deadheadMiles = null` (the document does not supply
it), `fuelSurcharge = null` (not part of the reviewed card), `status = booked`
(the user-reviewed rate confirmation is the evidence in this bounded flow).

### Draft identifier

`draftLoadNumber(now)` → `RR-DRAFT-YYYYMMDD-HHMMSS` in UTC; deterministic under
an injected clock; `isDraftLoadNumber()` recognises it. It is visibly
app-generated and never implies a broker reference. Second-level granularity is
sufficient locally because the saver below prevents repeat saves.

### Idempotency and ordering

`createFirstLoadSaver(deps)` returns a function that, on first call, runs
`addLoad` → `completeFirstAction` → `track('first_load_saved')` →
`router.push('/(onboarding)/reveal')` in that order and remembers the id. Any
later call returns the same id and performs no side effect. A throwing
`addLoad` emits no analytics and does not navigate. Each onboarding screen holds
one saver in a ref (`useFirstLoadSaver`), so double taps, repeated callbacks
and slow navigation cannot create duplicates.

Analytics props are limited to `verdict`, `source` (`rate_check` |
`rate_con`) and `load_number_generated` (boolean). No rates, routes, brokers or
document numbers are sent.

### C2 documentation correction

The `document_scans.storage_path` column comment in
`20260902000012_storage_classification.sql` wrongly described the key as
`{owner_id}/{scan_id}.{ext}`; the client keys objects by its local capture id
(`{owner_id}/{capture_id}.{ext}`, `storagePathFor` in
`src/data/captureSync.ts`). Comment corrected; storage behaviour unchanged.

## C4 — durable document-file substrate

### Dependencies (resolved by `npx expo install`, SDK 57)

| Package                | Version    | Purpose                                                              |
| ---------------------- | ---------- | -------------------------------------------------------------------- |
| `expo-file-system`     | `~57.0.6`  | app-private durable storage (`Paths.document`, `File`, `Directory`)  |
| `expo-document-picker` | `~57.0.1`  | file/PDF import (used in Pass 1 UI)                                  |
| `expo-sharing`         | `~57.0.17` | explicit Share/Export sheet (config plugin auto-added to `app.json`) |
| `expo-crypto`          | `~57.0.2`  | native SHA-256 (`digest(SHA256, bytes)`)                             |

`npx expo install --check` for these four reports "Dependencies are up to
date". The same check also lists pre-existing baseline drift (e.g.
`expo-router 57.0.6` vs expected `~57.0.18`, `react-native 0.86.0` vs
`0.86.3`); those are untouched — outside this candidate's scope.

### Storage API (validated against the installed package, not legacy docs)

SDK 57 `expo-file-system` exposes the class API: `Paths.document` (persistent,
app-private, not shared), `new Directory(Paths.document, 'road-wallet', id)`
with `create({ intermediates: true, idempotent: true })`, `new File(dir,
name)`, `file.exists` / `file.size` / `file.type` / `await file.bytes()` /
`await src.copy(dest, { overwrite: true })` / `file.delete()`. The legacy
`expo-file-system/legacy` API is not used.

### Contract — `DocumentFileStore` (`src/data/documentFiles.ts`)

`importFile(source, target) → StoredDocumentFile` · `exists` · `byteSize` ·
`verify(path, { expectedKind?, expectedSha256? }) → FileVerification` ·
`sha256` · `remove` · `uriFor` · `shareCapability()` · `share(path, {
mimeType, dialogTitle? })`. Two implementations with identical contract:
`ExpoDocumentFileStore` (native modules lazily required, repo convention) and
`MemoryDocumentFileStore` (deterministic, Jest). No dependency on the future
`OperationalDocument` domain.

### Private path scheme

`road-wallet/{logicalDocumentId}/{versionId}.{ext}` relative to
`Paths.document`. Ids must match `^[A-Za-z0-9_-]{8,64}$` (`isOpaqueId`) —
anything with whitespace/punctuation (names, CDL/EIN/VIN/policy numbers) is
rejected at path construction. Extension is an allowlisted lowercase token
(`jpg`, `png`, `heic`, `webp`, `pdf`; unknown → `bin`, never coerced to an
image). Original filenames are used only to derive an extension and are never
stored. Identifiers are 128-bit random base64url ids (see C4.1 below).

### Readiness semantics (`src/domain/documentFiles.ts`)

`NOT_CACHED → CACHING → READY | ERROR`. `READY` is produced only by
`markReady(entry, verification)` from a **successful** `FileVerification`,
which requires: file exists, byte size > 0, bytes readable, content sniff
matches the declared kind (JPEG/PNG/WebP/HEIC magic bytes for images,
`%PDF-` for PDFs), SHA-256 computed (and equal to the expected hash when one
is given). A URI string alone never yields READY. `ERROR` keeps the entry's
known path/MIME/size/hash so it can be diagnosed and retried;
`reverifyDocumentFile` drops a READY entry to ERROR (`MISSING`,
`HASH_MISMATCH`, …) if the file disappears or changes — nothing is deleted.

### SHA-256

`ExpoDocumentFileStore` hashes the actual bytes with `expo-crypto`
`digest(CryptoDigestAlgorithm.SHA256, bytes)` → lowercase hex; falls back to
the pure-JS `sha256Hex` (`src/domain/sha256.ts`, FIPS 180-4) if the native
module is unavailable. The pure implementation is verified in tests against
the standard vectors and against Node's `crypto` on padding-boundary and
multi-block inputs, so both paths produce identical digests.

### Sharing

Only **Share/Export** via the platform share sheet (`expo-sharing`
`isAvailableAsync` → `shareAsync(uri, { mimeType, UTI, dialogTitle })`) is
exposed, and only after `shareCapability()` reports availability. There is
deliberately no "Open in system viewer" action: a genuine iOS + Android
external-open behaviour has not been validated (see C5).

## C4.1 — file-substrate hardening (pre-Pass 1)

### H1 — opaque identifiers: 128-bit random, base64url, fail-closed

`newOpaqueId(source)` (`src/domain/documentFiles.ts`) takes **exactly 16
cryptographically secure random bytes** from an injected source and encodes
them as RFC 4648 §5 base64url **without `=` padding** → a 22-character id in
`[A-Za-z0-9_-]`. The random input is used directly (no modulo mapping into a
smaller alphabet); the identifier therefore carries 128 bits of randomness.
The function has no default source and no fallback: a missing source, a source
that throws, or a wrong-length buffer throws. Deterministic byte sources
remain injectable for pure unit tests (`opaqueIdFromBytes` / `newOpaqueId`).

Runtime source — `secureRandomBytes` / `newSecureOpaqueId`
(`src/data/documentFiles.ts`), in order:

1. `expo-crypto` **`getRandomValues(typedArray)`** — the SDK 57 implementation
   calls the native module directly (`ExpoCrypto.getRandomValues`) with no JS
   fallback and throws when the native module is absent.
   `getRandomBytes()` is **deliberately not used**: its SDK 57 source falls back
   to `Math.random` under `__DEV__` when remote debugging is active.
2. `globalThis.crypto.getRandomValues` — only when genuinely present as a
   function.
3. Otherwise **`SecureRandomUnavailableError`** is thrown. Never `Math.random`,
   never `Date.now` entropy, never counters.

A static test asserts the substrate source contains no `Math.random` or
`getRandomBytes(` call; runtime tests spy on `Math.random` / `Date.now` around
id generation.

### H2 — bounded HEIC/HEIF content sniffing

`sniffFileKind` no longer treats a generic ISO-BMFF `ftyp` box as an image.
`isHeifImage(bytes)` parses `[size:4]['ftyp'][major:4][minor:4][compatible…]`
and accepts only when:

- the box is well-formed and complete (`size ≥ 16`, `size % 4 === 0`,
  `size ≤ bytes.length`; extended-size `1` / unsized `0` / truncated boxes are
  malformed → `UNKNOWN`);
- the major brand **or** a compatible brand is an HEVC still-image brand
  (`heic`, `heix`, `hevc`, `hevx`, `heim`, `heis`, `hevm`, `hevs`);
- **no** AVIF brand (`avif`, `avis`) appears anywhere in the brand list.

Structural brands (`mif1`, `msf1`) alone are not sufficient. Generic
containers (`isom`, `mp41`, `mp42`, `iso2`, `qt  `, `M4A `, `M4V `) are
`UNKNOWN` and fail `contentMatchesKind('IMAGE', …)`, so an MP4 renamed
`.heic` and declared `image/heic` fails import verification
(`CONTENT_MISMATCH`). AVIF is not a supported type and is never treated as
HEIC. JPEG (`FF D8 FF`), PNG (`89 50 4E 47`), WebP (`RIFF…WEBP`) and PDF
(`%PDF-`) detection is unchanged; the extension allowlist is unchanged.

### H3 — share-time integrity rule (frozen for Pass 1 / Pass 1B)

> UI/domain code must not share/export a Road Wallet file merely because the
> path exists. Before an explicit user share/export of a stored document
> version, the current physical file must be reverified against that version's
> expected SHA-256 and expected file kind.

`DocumentFileStore.share()` stays a low-level, path-based primitive in C4.1.
Pass 1 / Pass 1B enforce the rule in the higher-level document-version
workflow (`reverifyDocumentFile` with `expectedSha256` + `expectedKind` must
return READY immediately before `share()` is invoked).

## Pass 1A — Road Wallet core (domain, store, orchestration, schema, sync)

No screens, no Board/Reports entry, no Quick Present, no Carrier Packets.
`road_wallet_enabled` stays `off`. `LoadDocument != OperationalDocument`:
`src/domain/documents.ts` / `src/store/loadDocs.ts` are untouched; Road Wallet
documents never feed the Paperwork grade or `expenses`.

### Identity

`OperationalDocument.id` and `DocumentVersion.id` are the accepted C4.1 opaque
ids (`newSecureOpaqueId()` — 16 CSPRNG bytes → 22-char unpadded base64url,
128-bit random). The same id is used locally and remotely; Supabase primary
keys are `text` with the client grammar as a CHECK. No second UUID, no
`Date.now`/`Math.random`/sequential ids, no filenames or identifiers in ids.

### OperationalDocument (`src/domain/operationalDocuments.ts`)

`id, accountOwnerId, documentKind, subjectKind, truckId, trailerNumber, title,
issuer, jurisdiction, issuedAt, effectiveAt, expiresAt (YYYY-MM-DD),
maskedReference, sensitivity, lifecycle (ACTIVE | ARCHIVED), offlinePinned,
cloudStatus, createdAt, updatedAt`. No local path. No compliance field.

- Subject kinds: `DRIVER CARRIER TRUCK TRAILER GENERAL`.
- Document kinds: `CDL MEDICAL_DOCUMENT TWIC VEHICLE_REGISTRATION
TRAILER_REGISTRATION IRP_CAB_CARD ANNUAL_INSPECTION INSURANCE IFTA
OPERATING_PERMIT OPERATING_AUTHORITY CERTIFICATE_OF_INSURANCE UCR W9
FACTORING_NOA BANKING_DOCUMENT LEASE_AGREEMENT CUSTOM` — a practical
  baseline, not a universal legal requirements list.
- Sensitivity defaults: `CDL / MEDICAL_DOCUMENT / TWIC → PERSONAL_SENSITIVE`;
  `W9 / FACTORING_NOA / BANKING_DOCUMENT / LEASE_AGREEMENT →
FINANCIAL_SENSITIVE`; everything else `STANDARD`.
- `maskedReference` accepts only `****XXXX` (`maskReference()` keeps at most the
  last four alphanumerics); raw CDL/EIN/policy/account values are rejected by
  validation and by a DB CHECK.
- Validity (`deriveValidity`, calendar days in UTC, `EXPIRING_SOON_DAYS = 30`):
  no/invalid expiry → `NO_EXPIRATION`; expiry before today → `EXPIRED`; today
  … today+30 inclusive → `EXPIRING_SOON`; later → `CURRENT`. These describe the
  stored record only — never compliance, legality or enforcement validity.
- `offlinePinned` defaults `true` for STANDARD/PERSONAL_SENSITIVE and `false`
  for FINANCIAL_SENSITIVE. It is a future presentation/cache preference: it
  never deletes or evicts a file, an imported local-only document always keeps
  its durable copy, and nothing is auto-evicted after cloud upload in Pass 1A.

### DocumentVersion — immutable evidence

Immutable core (`DOCUMENT_VERSION_IMMUTABLE_FIELDS`): `id,
operationalDocumentId, accountOwnerId, versionNumber, supersedesVersionId,
fileKind, mimeType, extension, byteSize, sha256, createdAt`. Mutable:
`fileCache`, `cloudStatus`, `remoteStorageBucket`, `remoteStoragePath`.
`relativePath` (`road-wallet/{doc}/{version}.{ext}`) is the local durable
copy's location. No original filename is persisted (C4 ruling).

Replacement = new version N+1 with a new secure id, `supersedesVersionId` =
prior current version id, prior version untouched. `validateNewVersion`
enforces same-document/same-owner, unique version numbers, supersession of a
_prior_ version of the same document, valid SHA-256/byte size. Current version
= highest `versionNumber` (no circular `currentVersionId` column).

### Local store (`src/store/roadWallet.ts`)

zustand + AsyncStorage, key `rigreceipts.roadWallet`, persist **version 1**;
`normalizeRoadWalletState` drops malformed entries and orphan versions instead
of crashing, and does not trust a persisted READY claim without its path.
Actions: `addDocument`, `updateDocumentMetadata(id, patch, ctx)`,
`archiveDocument`, `setDocumentCloudStatus`, `addVersion`,
`setVersionFileCache`, `setVersionCloudState`, `reconcileCloudStatuses(ctx)`,
`removeVersion` (rollback of a failed import only), `clear`. Every version
mutation asserts the immutable core is unchanged; there is no generic version
overwrite. Selectors: `selectVisibleDocuments(s, sessionUserId)`,
`selectActiveVisibleDocuments`, `selectVersionsForDocument`,
`selectCurrentVersion`, `selectDocumentById(s, id, sessionUserId)`.

### Account scope

Every document/version carries `accountOwnerId`. Created signed in → bound to
that user permanently; created signed out → `null`. Selectors show a user only
their own records and show unowned records only when signed out. Unowned
records are never auto-claimed or auto-synced (adoption UX is future work).
Sign-out, account switch, tier change and cloud transitions never delete or
rebind content; User A's content reappears when User A signs back in.

### Create / replace orchestration (`src/data/roadWallet.ts`)

`createOperationalDocumentFromFile(source, input, deps)`: secure document id +
version id → `DocumentFileStore.importFile` (durable copy + verification) →
`OperationalDocument` + version 1 in the store. Import/verification failure →
no records. Store failure after the copy → records rolled back, orphan file
removed best-effort, error rethrown. `replaceOperationalDocumentFile(docId,
source, deps)`: resolves current version → new id → import/verify → version
N+1 superseding it; prior version untouched. Both are local-only (no network).
`cloudStatus` on new records comes from `syncBindingFor(ctx,
'cloudDocumentBackup')`. `configureRoadWalletFileStore()` injects the file
store (tests use `MemoryDocumentFileStore`; production lazily uses
`ExpoDocumentFileStore`).

### DocumentFileStore extension

`readBytes(relativePath): Promise<Uint8Array>` added to the contract (both
implementations; throws on missing/unreadable; never logged) so sync uploads
the exact durable bytes. No second storage abstraction.

### Cloud status (`CloudSyncStatus`)

`CloudSyncStatus = 'local_only' | 'pending_sync' | 'synced'`;
`CaptureSyncStatus` is now an alias (C1 behaviour unchanged, all capture tests
green). Road Wallet syncs under **`cloudDocumentBackup`**, never `cloudBackup`.
`reconcileCloudStatus` (value-level) and `statusAfterLocalMutation` are shared
helpers: a synced immutable version stays synced; edited _document metadata_
becomes `pending_sync` when authorized, else `local_only` — synced metadata is
not terminal after an edit.

### Sync (`src/data/documentSync.ts`)

Per document, with `assertRemoteEffectAuthorized('cloudDocumentBackup',
accountOwnerId)` immediately before every remote effect:

1. upsert `operational_documents` (`onConflict: 'id'`) → mark document synced;
2. per pending version: **re-verify** the local file against the version's
   immutable `sha256` + `fileKind` (`reverifyDocumentFile`), then `readBytes`
   and hash the exact buffer again; any mismatch → cache `ERROR`, no upload, no
   row, immutable evidence untouched (`VersionIntegrityError`);
3. upload bytes to bucket **`documents`** at
   `{userId}/road-wallet/{documentId}/{versionId}.{ext}` with `upsert: true`;
4. insert `document_versions`; on unique violation (`23505`) read back the
   caller-owned row and compare immutable evidence — identical → idempotent
   success, different → `VersionIntegrityError`, never overwritten;
5. only then mark the version `synced` with bucket/path.

Eligibility: signed out / Free / other owner / unowned → `local_only`, no
remote effect; Driver Pro+ same owner → eligible; upgrade promotes owner-bound
`local_only` content; downgrade/sign-out before an effect stops remote work and
keeps local data. `syncPendingRoadWallet` re-authorizes per item, coalesces
concurrent runs, and `initDocumentSync` reacts to hydration, auth and tier
changes.

**`upsert: true` rationale.** The object key is fully determined by the
immutable version and the bytes are re-verified against the version's SHA-256
immediately before upload, so a retry can only rewrite the object with
byte-identical content. **Known edge:** an upload followed by a failed row
insert leaves an owner-scoped object at the deterministic path; the version
stays `pending_sync`, the retry re-verifies and re-uploads the identical bytes
and inserts the row (tested). Nothing local is deleted on any partial failure.

### Migration `supabase/migrations/20260902000013_road_wallet_core.sql`

- `operational_documents`: `id text pk CHECK ^[A-Za-z0-9_-]{8,64}$`, `owner_id
uuid → auth.users on delete cascade`, kind/subject/sensitivity/lifecycle
  CHECKs, `truck_id uuid → trucks on delete set null`, date columns,
  `masked_reference CHECK ^\*{4}[A-Za-z0-9]{0,4}$`, `offline_pinned`,
  timestamps + `set_updated_at` trigger, `UNIQUE (id, owner_id)`, indexes on
  `(owner_id)`, `(owner_id, expires_at)`, `(owner_id, truck_id)`. RLS: `"own
rows" FOR ALL` (editable/archivable).
- `document_versions`: `id text pk` (same CHECK), `owner_id`, `version_number
  > 0`, `storage_bucket CHECK = 'documents'`, `storage_path CHECK =
  > owner_id/road-wallet/document_id/id.extension`, `file_kind`, `mime_type`,
`extension`, `byte_size > 0`, `sha256 CHECK ^[0-9a-f]{64}$`, `created_at`;
`UNIQUE (operational_document_id, version_number)`; composite FK
`(operational_document_id, owner_id) → operational_documents (id, owner_id)
  > ON DELETE CASCADE`; composite self-FK `(supersedes_version_id,
  > operational_document_id, owner_id) → document_versions (id,
  > operational_document_id, owner_id)`(same document, same owner; "prior"
ordering is client-enforced);`CHECK supersedes_version_id <> id`. RLS:
**SELECT own** + **INSERT own** only — no UPDATE, no DELETE for the client
(rows leave through the owner cascade / `delete_current_account`).
- Storage: existing private `documents` bucket, owner-folder policy from
  `20260716000003_storage.sql`; `delete_current_account` already sweeps it.
- Static parse (libpg_query): 13 statements OK. **CLEAN_BOOTSTRAP = EVIDENCE
  GAP. TWO_USER_RLS = EVIDENCE GAP.**

### Deferred to Pass 1B (explicit)

- Add `operational_documents` and `document_versions` to `EXPORT_TABLES` (+
  tests). Metadata export != binary Road Wallet file export.
- Screens, Board/Reports entry points, share-time re-verification in the
  document-version workflow (C4.1 H3), OCR seam (raw OCR never persisted for
  PERSONAL/FINANCIAL_SENSITIVE).

## Pass 1A.1 — Road Wallet integrity hardening (pre-Pass 1B)

Migration `supabase/migrations/20260902000014_road_wallet_integrity_hardening.sql`
(additive; 00013 is not rewritten). Static parse: 8 statements OK.
**CLEAN_BOOTSTRAP = EVIDENCE GAP. TWO_USER_RLS = EVIDENCE GAP.**

### H1 — no client DELETE on `operational_documents`

00013's `"own rows" FOR ALL` policy is dropped and replaced by
`"select own documents" FOR SELECT`, `"insert own documents" FOR INSERT`,
`"update own documents" FOR UPDATE` (all `owner_id = auth.uid()`). There is
deliberately no `FOR DELETE` policy: a client delete would have
cascade-deleted immutable `document_versions` evidence. Ordinary product
deletion is `lifecycle = 'ARCHIVED'`. Account deletion is unchanged:
`delete_current_account()` (SECURITY DEFINER) removes the user's storage
objects and deletes the `auth.users` row, and every `owner_id` FK cascades.
`document_versions` remains SELECT own + INSERT own only.

### H2 — persisted file readiness is never authoritative

After rehydration every `DocumentVersion.fileCache` starts `NOT_CACHED` with
its expectations taken from the immutable version (`relativePath`, `sha256`,
`byteSize`, `mimeType`); `verifiedAt`/`error` are cleared. Only a fresh
`reverifyDocumentFile()` in the current process (exists, non-zero, readable,
kind matches, SHA-256 matches) can make it `READY`. This precedes any
offline-ready UI claim, Quick Present display, or Pass 1B share/export.

### H3 — deterministic persisted-version normalization

`normalizeRoadWalletState` now: sanitizes documents; drops any version whose
id is duplicated anywhere; sanitizes each remaining version against its parent
(parent exists; `accountOwnerId` equals the parent's; opaque id; positive
integer version number; lowercase 64-hex SHA-256; `byteSize > 0`; canonical
`fileKind`; bounded extension; `relativePath` exactly equals
`documentFileRelativePath(documentId, versionId, extension)`; supersession id
opaque and not self); then rebuilds each document's chain with
`rebuildVersionChain` — duplicate version numbers drop every entry sharing the
number, the base version must have no supersession, each later version must
supersede an already-retained lower-numbered sibling, and the first break
drops everything above it, so a corrupt high-numbered entry can never become
current. A `synced` claim survives only when the recorded remote location is
exactly `documents` / `{owner}/road-wallet/{doc}/{version}.{ext}` for an owned
version; otherwise the remote location is cleared and the status drops to
`local_only` for safe re-sync. Unowned versions never carry a remote path.
Malformed entries never throw.

### H4 — same-owner truck association

Database: `trucks` gains `UNIQUE (id, owner_id)`; the 00013 single-column FK
is dropped and replaced by `FOREIGN KEY (truck_id, owner_id) REFERENCES trucks
(id, owner_id) ON DELETE SET NULL (truck_id)` (PostgreSQL 15+ column-scoped
SET NULL; Supabase runs 15/17; parsed by the PG18 grammar). A non-null truck
must therefore belong to the document's owner; deleting a truck nulls only
`truck_id` and leaves the document and its `owner_id` intact. `trucks` RLS is
untouched. Application: `validateTruckAssociation(documentOwnerId, truck)`
fails early in `createOperationalDocumentFromFile` when the caller passes
`truck: { id, ownerId }`; this is a convenience check, not the guarantee.

### H5 — known-sensitive kinds cannot be downgraded

`REQUIRED_SENSITIVITY_FOR_KIND`: `CDL / MEDICAL_DOCUMENT / TWIC →
PERSONAL_SENSITIVE`; `W9 / FACTORING_NOA / BANKING_DOCUMENT / LEASE_AGREEMENT →
FINANCIAL_SENSITIVE`. `validateSensitivityForKind` runs inside
`validateOperationalDocument` (creation, metadata update — including a kind
change — and persisted normalization, where a downgraded persisted class is
repaired to the required one). Orchestration ignores a caller-supplied class
for known kinds. DB CHECK `operational_documents_sensitivity_for_kind_check`
mirrors the rule; other kinds (incl. `CUSTOM`) stay configurable.

### H6 — no general version deletion

`removeVersion` had no production caller and is removed from the store API.
Orchestration rollback is internal and narrow: it removes only the
document/version ids minted in the failing call and only if unsynced. `clear()`
remains a whole-store maintenance/test primitive and is not connected to
sign-out or tier changes.

## C5 — PDF feasibility (probe only; nothing added to the branch)

Probe performed in `/tmp/pdfprobe` (a copy of this candidate's manifest),
then deleted. `react-native-pdf` and its plugins are **not** in
`package.json`, `package-lock.json` or `app.json` (verified: 0 references).

| Item                           | Evidence                                                                                                                                                                                                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Packages investigated          | `react-native-pdf 7.0.5` (published 2026-08-13), `react-native-blob-util 0.24.10`, `@config-plugins/react-native-pdf 14.0.2`, `@config-plugins/react-native-blob-util 14.0.2`                                                                                                                                      |
| Expo SDK compatibility         | Config plugins declare `peerDependencies: { expo: ">=56" }` only. `react-native-pdf` is **not** in SDK 57's `bundledNativeModules.json`, so `npx expo install` resolves npm latest and `--check` cannot vouch for a tested pairing. The plugin README's compatibility table stops at Expo 56 (`7.0.4` / `14.0.0`). |
| Native rebuild required        | Yes — the package ships `ios/`, `android/`, `fabric/` native code and both config plugins modify `app.json`; it needs `npx expo prebuild` + a development build / EAS build. Not usable in Expo Go.                                                                                                                |
| Device behaviour provable here | **No.** This VM has no iOS/Android runtime or simulator; rendering, zoom, page navigation and file-URI handling cannot be exercised.                                                                                                                                                                               |

### Explicitly supported PDF behaviour (this candidate)

PDF import via picker URI → durable private copy → exact metadata (`ext`,
MIME, kind `PDF`) → byte-size verification → content sniff (`%PDF-`) →
SHA-256 → later explicit Share/Export. PDFs are never coerced to images.

### Explicitly BLOCKED / DEFERRED

Inline PDF presentation (rendering pages inside the app) and any
"Open in system viewer" action. Neither is faked. Unblocking requires a
native rebuild plus real-device validation on both platforms, which this
candidate cannot provide; owner adjudication needed.

## Evidence gaps (open)

- Clean Supabase bootstrap of all migrations and two-user RLS verification
  cannot run on the implementation VM (no Docker / psql / Supabase runtime).
  Migrations are statically parsed with libpg_query only. The candidate is not
  eligible for owner acceptance/merge until these are validated independently.
