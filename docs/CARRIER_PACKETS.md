# Carrier Profile + Carrier Packets (Pass 3)

Foundation only. **Do not merge.** Flags stay OFF. No FMCSA, email, portal
submit, signatures, or combined PDF/ZIP.

See also `docs/ROAD_WALLET.md` and `docs/REFINEMENT_CANDIDATE.md`.

## Authority

RigReceipts may prepare, review, and let the user explicitly Share/Export
individual exact document versions, then attest that this snapshot was shared.

```
PACKET PREPARED  !=  PACKET SHARED
PACKET SHARED    !=  PACKET DELIVERED
PACKET DELIVERED !=  PACKET ACCEPTED
PACKET ACCEPTED  !=  CARRIER AGREEMENT SIGNED
```

`SHARED` means only: the user attests this exact packet snapshot was shared.
It does **not** prove delivery, receipt, acceptance, onboarding, or agreement.

## Models

- **CarrierProfile** — reusable `USER_ENTERED` business identity. Legal name
  required. Opaque 128-bit id. One active profile per account. No EIN, SSN,
  or bank scalars. USDOT/MC are identifiers you typed, not “verified.”
  Copy: “These are the carrier details you entered.” / “Entered by you.”
- **STANDARD_BROKER_PACKET** — in-code product default (not a universal broker
  claim). Required: profile + W-9 + COI + operating authority. Optional:
  factoring NOA, banking document.
  Copy: “Broker and customer requirements vary. Review the exact documents
  requested before sharing.”
- **Custom templates** — Owner-Operator+ (`carrierPacketTemplates`). Versioned
  `CarrierPacketTemplateDefinition` (`schemaVersion: 1`). No duplicate
  `documentKind`. ≤ 30 requirements. Archive, never delete. Financial kinds
  are allowed (Quick Present’s FINANCIAL prohibition does **not** apply).
- **CarrierPacket** — DRAFT / READY / SHARED / SUPERSEDED. Stores immutable
  `templateSnapshot` and `profileSnapshot`. No delivery proof, broker
  acceptance, or agreement status.
- **CarrierPacketItem** — exact `DocumentVersion` pointer plus review
  snapshots (kind, sensitivity, expiry, title). No hash, path, bucket, or
  bytes. Those stay on `DocumentVersion`.

`LoadDocument != OperationalDocument != CarrierPacket`.
`PresentationSetItem` is a **logical** document pointer; packet items freeze
an **exact** current version at selection time.

## Snapshots

On DRAFT assembly: capture the current Carrier Profile and the exact template
definition used. Selecting a Road Wallet document freezes its **current**
version id. A later template edit does not mutate existing packets. A later
Road Wallet v2 does not silently replace the packet’s v1.

Before READY: re-read live profile / documents / current versions. Refresh the
profile snapshot on the explicit READY path. After SHARED: historical
snapshots are immutable.

## Lifecycle

- DRAFT → READY (zero blockers, live re-read, `markCarrierPacketReady()`)
- READY → DRAFT (explicit `returnCarrierPacketToDraft()`)
- READY → SHARED (explicit `markCarrierPacketShared({ confirmed })`)
- SHARED → SUPERSEDED (when a successor packet is SHARED)
- No DRAFT → SHARED, SHARED → DRAFT, or SUPERSEDED → READY

READY means: this snapshot passed RigReceipts’ bounded packet checks. It does
**not** mean a broker will accept it.

A newer Road Wallet version after READY reports `STALE_VERSION`. Share and
Mark Shared stay blocked until return-to-draft → refresh → READY.

A Carrier Profile change after READY reports `PROFILE_CHANGED`. Same return
path. Historical SHARED packets stay unchanged.

## Review

Pure `reviewCarrierPacket()`. Blockers include missing profile, missing
required document, no current version, stale version, archived document,
expired required document, integrity mismatch, file unavailable without
recovery, and profile changed after READY. Warnings include optional missing,
expiring soon, personal/financial sensitivity, restore required, and missing
USDOT/MC. Copy uses Expired / Expiring soon / Missing — never non-compliant
or out of service.

## Share / Export and Mark Shared

Individual document share reuses:

`shareOperationalDocumentVersion({ documentId, versionId: packetItem.documentVersionId, sensitiveConfirmation })`

Additional packet proofs: current owner, `carrierPacketBuilder`, packet is
READY, item belongs to packet, exact version still review-valid, document
visible and ACTIVE, no live stale/profile blocker. Sensitivity:

- STANDARD → `NONE`
- PERSONAL_SENSITIVE → `PERSONAL_ACKNOWLEDGED`
- FINANCIAL_SENSITIVE → `FINANCIAL_ACKNOWLEDGED`

Packet-review acknowledgement is **not** file-share acknowledgement.

Per-document Share/Export **never** marks the packet SHARED. Mark Shared is a
separate attestation with optional recipient label and `OS_SHARE_SHEET` /
`OTHER`. The OS share sheet return is not delivery proof.

If the exact version is backed up but not local: Restore to this device via
`restoreDocumentVersionToDevice(operationalDocumentId, documentVersionId)`.
Restore does not switch the packet to a newer version.

## Deferred artifacts

`COMBINED_PACKET_PDF = DEFERRED`  
`COMBINED_PACKET_ZIP = DEFERRED`  
`PROFILE_COVER_ARTIFACT = DEFERRED`

Pass 3 does not offer “Download full packet” or a generated profile cover PDF.
Sharing an individual document does not transmit the Carrier Profile snapshot.

## Account scope and persistence

`CarrierProfile`, templates, packets, and items carry `accountOwnerId`.
User A never sees B. Signed out sees only unowned local records. Unowned
records are never auto-claimed. Account switch and tier downgrade never
delete data.

Zustand + AsyncStorage:

- `rigreceipts.carrierProfile` (v1)
- `rigreceipts.carrierPackets` (v2; includes local-only READY→DRAFT proofs)

Hydration never mints replacement ids, never invents ownership, drops
malformed/orphan rows, and refuses ordinary SHARED mutation.

## Entitlements and flags

Existing keys: `carrierProfile`, `carrierPacketBuilder`,
`carrierPacketTemplates`, `carrierPacketHistory`, `documentShareExport`,
`cloudDocumentBackup`.

Free / Driver Pro: no profile or packet builder. Owner-Operator, Lifetime,
Fleet Lite: yes. File Share/Export remains an independent Driver Pro+ gate.

Flags (all OFF): `carrier_profile_enabled`, `carrier_packet_builder_enabled`,
`carrier_packet_history_enabled`. Routes also require `road_wallet_enabled`.
No sixth tab. No working deep link when the flag is off.

## Cloud

New writes: feature entitlement + `cloudDocumentBackup` + live authorization
immediately before each remote effect.

Recovery of already-backed-up owner metadata: authenticated owner + configured
Supabase + owner RLS. Tier-independent. A former Owner now Free may recover
existing cloud rows but cannot mutate or use the premium product until
re-entitled.

Cycle order: Road Wallet recovery → `writeSafe` → presentation-set recovery →
`setWriteSafe` → carrier recovery → `carrierWriteSafe`. Then independent
writes:

- Road Wallet: `writeSafe`
- Presentation sets: `writeSafe && setWriteSafe`
- Carrier: `writeSafe && carrierWriteSafe`

Presentation-set failure does not block carrier writes. Carrier failure does
not block Road Wallet or presentation-set writes.

SHARED first sync stages truthful lifecycle projections — DRAFT (no
ready/shared metadata), then items, then READY (`readyAt` only), then
SHARED (`readyAt` + `sharedAt` + `shareMethod`). A crash after DRAFT or
READY recovers that truthful remote row. Retry of an exact remote SHARED
snapshot is idempotent. Remote READY may promote to SHARED only when
`readySnapshotMatchesSharedTransition` and exact items match. Mismatch is
an integrity conflict (never overwrite). SHARED → SUPERSEDED is only the
narrow status/`updated_at` transition.

## Migration

`supabase/migrations/20260902000016_carrier_packets.sql`

Owner-only RLS (SELECT/INSERT/UPDATE). No public policies. No ordinary client
DELETE. Same-owner FKs for profile, custom template, packet items, Road Wallet
document, and exact DocumentVersion. INVOKER triggers (no SECURITY DEFINER)
enforce SHARED immutability, SUPERSEDED terminal, and historical item
mutation rejection.

`CLEAN_BOOTSTRAP` and `TWO_USER_RLS` remain evidence gaps. Independent DB
review is required before merge.

## Account export / deletion

`EXPORT_TABLES` includes `carrier_profiles`, `carrier_packet_templates`,
`carrier_packets`, `carrier_packet_items` (JSON metadata only). Not included:
Road Wallet binary bytes, combined PDF/ZIP, delivery proof, recipient
acceptance.

New tables cascade from `auth.users`. The existing `delete_current_account`
storage sweep remains authoritative for private document bytes.

## Privacy

Do not log legal name, DBA, USDOT, MC, address, contact, recipient label,
packet membership, W-9/factoring/banking selection, version ids, or document
titles. No Carrier Packet analytics in Pass 3.

## Pass 3.1 — integrity closure

- DRAFT requirement membership keeps a **stable item id** when the selected
  document or current version changes.
- Optional DRAFT items may be removed (`removeOptionalCarrierPacketItem`).
  Required / READY / SHARED / SUPERSEDED removals are denied.
- Additive migration `20260902000017_carrier_packet_integrity_hardening.sql`:
  DRAFT-only authenticated DELETE of `carrier_packet_items`; old+new parent
  item guard; DB lifecycle matrix; immutable `id` / `owner_id` / `created_at`;
  no self-supersession. Account-deletion cascade is preserved via a
  transaction-local GUC set on `carrier_packets` BEFORE DELETE.
- Remote writes stage through DRAFT membership, then READY / SHARED /
  SUPERSEDED. Historical rows never receive item mutations.
- Every remote mutation re-authorizes after awaits.
- Packet-context Share/Export requires **zero live blockers** and re-proves
  that immediately before `DocumentFileStore.share()`.

`CLEAN_BOOTSTRAP` and `TWO_USER_RLS` remain evidence gaps.

## Pass 3.2 — snapshot integrity

- Additive migration `20260902000018_carrier_packet_snapshot_integrity.sql`
  only. 00016 and 00017 are not rewritten.
- READY → SHARED may change only `status`, `shared_at`, `share_method`,
  `recipient_label`, and `updated_at`. The reviewed snapshot stays frozen.
  READY → DRAFT remains allowed.
- Lifecycle status-shape: DRAFT has no ready/shared metadata; READY has
  `ready_at` only; SHARED/SUPERSEDED have ready + shared + share method.
  Recipient label may exist before SHARED. Malformed remote rows are
  integrity conflicts — never silently repaired.
- Packet items must match `templateSnapshot` requirement key, label,
  required flag, position, and document kind. Live Road Wallet kind and
  exact-version ownership are re-checked at review and recovery.
- Remote packet/item mapping is defensive: optional scalars are string or
  null; invalid timestamps reject the row.

`CLEAN_BOOTSTRAP` and `TWO_USER_RLS` remain evidence gaps.

## Pass 3.3 — final evidence closure

- Additive migration `20260902000019_carrier_packet_final_evidence_hardening.sql`
  only. 00016–00018 are not rewritten.
- Direct INSERT must be DRAFT with DRAFT status-shape. READY / SHARED /
  SUPERSEDED cannot be inserted; they are reached only through the accepted
  transition matrix.
- Canonical persisted packet evidence (`carrierPacketPersistedEvidence`)
  excludes only `cloudStatus` and `updatedAt`. SHARED / SUPERSEDED recovery
  and idempotency use that exact comparator plus exact item evidence.
- `carrierPacketItemsExactlyMatch` compares every persisted item field.
- SHARED → SUPERSEDED compares historical evidence including `readyAt` and
  `createdAt`, ignoring only status / `updatedAt` / `cloudStatus`.
- READY idempotency includes `readyAt`.
- Timestamp serialization uses `!== null` so finite `0` is preserved.

`CLEAN_BOOTSTRAP` and `TWO_USER_RLS` remain evidence gaps.

## IR-R1 — independent review remediation

Bounded remediation of the frozen Pass 0–3.3 review (`INDEPENDENT_REVIEW_BLOCK`).
This is **not** Pass 4. Production flags stay OFF. No merge.

- **IR-01:** Drop the redundant `carrier_packet_items.owner_id → auth.users`
  FK (`carrier_packet_items_owner_id_fkey`). `owner_id` and all same-owner
  composite FKs stay. Account deletion for items is packet-mediated:
  `auth.users → carrier_packets → carrier_packet_items`, so the packet
  BEFORE DELETE GUC can govern historical item DELETE.
- **IR-02:** Recovery is per-packet and atomic. READY local/remote is exact
  evidence only. DRAFT membership is coupled to the packet merge decision.
  Status disagreement is conservative (integrity conflict, not a skip that
  later writes).
- **IR-03:** Explicit local-only `CarrierReadyReturnProof` captured inside
  `returnCarrierPacketToDraft()` before the READY row mutates. Local DRAFT
  cannot downgrade remote READY without a proof that matches that READY
  snapshot exactly. Valid proof first writes the remote base DRAFT
  projection, then local DRAFT metadata/membership. Proof is never sent to
  Supabase and clears only after successful convergence (or valid local reset).
- **IR-04:** Documents-bucket policies are path-aware. `{uid}/road-wallet/…`
  is SELECT+INSERT only for the authenticated owner. Upload uses
  `upsert: false`; existing objects are downloaded and verified, never
  overwritten. Account-deletion SECURITY DEFINER still sweeps storage.
- **IR-05:** Profile and template remote mappers are strict. No number/object
  /boolean → null coercion; timestamps must be real strings; equipment_types
  must be an all-string array; `identity_source` must be `USER_ENTERED`.
- **IR-06 = DEFERRED_DEFENSE_IN_DEPTH.** No DocumentVersion service-role trigger.
- **IR-07 = DEPLOYMENT_PREFLIGHT.** 00013/00014 are not modified. Independent
  runtime review must decide whether any target has 00013-era dirty data.

Additive migration: `20260902000020_independent_review_remediation.sql`.

`CLEAN_BOOTSTRAP` and `TWO_USER_RLS` remain evidence gaps. Live account-delete
cascade and storage-policy enforcement remain runtime-unproven.

## Not in Pass 3 / 3.1 / 3.2 / 3.3 / IR-R1

FMCSA / DAT / EIA / Parse / ImportYeti / TruckDown / TruckQuote / NWS.
Email, portal submit, signatures, contract acceptance, freight booking.
No production flag enablement. No merge.
