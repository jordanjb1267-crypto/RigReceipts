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
stored. `newOpaqueId()` produces 22-char ids from `crypto.getRandomValues`.

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
