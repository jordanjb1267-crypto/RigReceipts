# Whole-product pre-promotion QA plan and scope registry

Reconciliation of accepted candidate `b5f97358d4eb2a0aa4e18ad8226902d16b842669`.
This is a registry and test map, not implementation authorization.
Not FreightOS / InterBraid / Pass20J.

If no product defect is reproduced, product code must not change.

## B1. Pass0–3 regression matrix

| Surface                  | Canonical owners                               | Proof                                                             |
| ------------------------ | ---------------------------------------------- | ----------------------------------------------------------------- |
| Tiers / `canUseFeature`  | `src/domain/entitlements.ts`                   | `entitlements.roadWallet.test.ts`, `entitlements.freight.test.ts` |
| Flags default OFF        | `src/config/flags.ts`                          | `flags.test.ts`                                                   |
| Road Wallet identity     | `operationalDocuments.ts`                      | `operationalDocuments.test.ts`, `roadWallet.test.ts`              |
| Quick Present            | `presentationSets.ts`                          | `presentationSets.test.ts` (domain + data)                        |
| Carrier Profile / Packet | `carrierPackets.ts`                            | `carrierPackets.test.ts` (domain + data + store + remote + sync)  |
| Cloud backup vs software | `cloudSync.ts`                                 | `cloudSync.test.ts`, `cloudSyncAuth.test.ts`                      |
| Account export / delete  | `account.ts`, migrations 00008/00021/00022     | `account.test.ts`, IR-R2 / IR-R3 tests                            |
| Privacy / sensitivity    | `operationalDocuments.ts`, presentation/packet | operational + presentation + surface tests                        |
| Offline readiness        | `documentFiles.ts`, fileCache                  | `documentFiles.test.ts`, `roadWallet.test.ts` H2                  |

## B2. Current UX regression matrix

| #   | Scenario                                                              | Proof                                                  |
| --- | --------------------------------------------------------------------- | ------------------------------------------------------ |
| 1–8 | Saved / Active / Needs Action / Closed / packet / scan / Live Mileage | `productQaHarness.test.ts`                             |
| 9   | Clock freshness                                                       | `productNow.test.ts` A–F                               |
| 10  | >30-day receivable urgency, no mutation                               | `productNow.test.ts` G, `actionItems.test.ts`          |
| —   | Grouping / packet view-models                                         | `loadGroups.test.ts`, `productSurfaceEvidence.test.ts` |

## B3. Entitlement test matrix

| Distinction                           | Unauthorized case                                  | Proof                                                |
| ------------------------------------- | -------------------------------------------------- | ---------------------------------------------------- |
| software ≠ data                       | Lifetime ≠ licensed market data                    | `entitlements.roadWallet.test.ts`                    |
| authenticated ≠ entitled              | Signed-in Free → `not_entitled`, `local_only`      | `cloudSync.test.ts`, `cloudSyncAuth.test.ts`         |
| visible ≠ authorized                  | Share/present UI vs `NOT_ENTITLED` / `NOT_VISIBLE` | `roadWallet.test.ts`, `presentationSets.test.ts`     |
| `cloudBackup` ≠ `cloudDocumentBackup` | Capture vs Road Wallet capabilities                | `cloudSyncAuth.test.ts`, capture/document sync tests |
| Packet gated                          | Free / Driver Pro denied mutations                 | `carrierPackets.test.ts` domain + data               |
| Flags frozen OFF                      | Internal/beta still false                          | `flags.test.ts`                                      |

## B4. Offline / readiness test matrix

| Case                          | Expected                                | Proof                                                       |
| ----------------------------- | --------------------------------------- | ----------------------------------------------------------- |
| Persisted READY after restart | Rehydrates `NOT_CACHED`                 | `store/roadWallet.test.ts` H2                               |
| Missing / hash mismatch       | ERROR, not READY                        | `roadWallet.test.ts`, `documentFiles.test.ts`               |
| Unreadable bytes              | `UNREADABLE`                            | `data/documentFiles.test.ts`                                |
| QP READY                      | IMAGE + cache READY after reverify      | `presentationSets.test.ts`                                  |
| QP missing file               | `MISSING_FILE` / no session             | domain preflight + `NO_READY_IMAGES`                        |
| Restore                       | Owner-only; Free may recover, not write | `roadWalletRecovery.test.ts`, `presentationSetSync.test.ts` |

## B5. Privacy / sensitivity test matrix

| Path                       | Control                      | Proof                                                   |
| -------------------------- | ---------------------------- | ------------------------------------------------------- |
| FINANCIAL in Quick Present | Blocked                      | `presentationSets.test.ts`                              |
| PERSONAL                   | Ack required                 | presentation + packet tests                             |
| Packet share               | Attestation ≠ delivery       | `authorityBoundaries.test.ts`, `carrierPackets.test.ts` |
| Logs / UI                  | No path/hash/legal-name leak | `surface.test.ts`                                       |
| Analytics                  | Kind/sensitivity only        | `operationalDocuments.test.ts` `analyticsSafe`          |
| Export                     | Metadata, no binaries        | `account.test.ts`                                       |

## B6. Account / cloud lifecycle test matrix

| Case                    | Expected                                   | Proof                                      |
| ----------------------- | ------------------------------------------ | ------------------------------------------ |
| G1 anonymous            | `local_only`, no remote                    | `cloudSync.test.ts`, capture/document sync |
| G2 authed, not entitled | Bound, still `local_only`                  | `cloudSync.test.ts`                        |
| G3 authed + entitled    | Capability-scoped writes                   | document/capture/packet sync tests         |
| G4 ownership / recovery | Wrong owner denied; no remote delete       | `roadWalletRecovery.test.ts`               |
| G5 export               | RLS-scoped metadata JSON                   | `account.test.ts`                          |
| G6 deletion             | RPC + ordered SQL; local device may remain | IR-R2 / IR-R3, `ACCOUNT_DELETION.md`       |
| G7 local vs cloud clear | Reconcile never deletes                    | store/cloudSync comments + tests           |

## B7. Device-test feasibility

No Playwright, Maestro, Detox, Storybook, or RN render harness.
No seeded Expo/auth session. Tabs are onboarding-gated.
`DEVICE_VISUAL_QA=PENDING` unless a safe native session is later established.
Do not invent production or onboarding data.

## B8. Files expected to change only if a defect is reproduced

None planned. Product code stays at `b5f97358` unless a reproduced defect requires a successor.

---

## Load-document cardinality (frozen, not solved)

Current product slot is `(loadId, docType)` plus capture artifacts.
This is not the future network model for multiple same-type artifacts,
stop-scoped artifacts, or immutable rejected/revised chains.

`LOAD_DOCUMENT_CARDINALITY_NETWORK_GATE=PENDING`

Do not add a migration to close this future gate.

---

## Future-scope registry

### ACTIVE PRODUCT INVARIANTS

- Pass0–3: entitlements, Road Wallet, Quick Present, Carrier Profile/Packet,
  cloud-backup vs software, account export/deletion, sensitivity, offline readiness.
- `LoadDocument != OperationalDocument != CarrierPacket`.
- `authenticated != cloud-backup-entitled`.
- `evaluated != booked`; Saved / Needs Action / Active / Closed.
- planned miles ≠ Live Mileage ≠ paid miles.
- local complete ≠ shared ≠ delivered ≠ recipient accepted.
- SHARED = explicit user attestation only.
- Explicit finite `nowMs`; derived urgency only.

### CURRENT PROMOTION GATES

- Whole-product QA (this document).
- Device visual QA — PENDING.
- Load-document cardinality network gate — PENDING.

### FUTURE APPROVED SEAMS

Registry only — not implementation authorization:

- provider-neutral TMS/ELD adapters;
- Relay/provider transaction ingestion;
- read-only Freight Economics plugin;
- driver logistics inbox/outbox;
- cross-company document exchange.

See also inert `src/domain/integrationSeams.ts`.

### PROHIBITED LOCAL EXPANSIONS

- FreightOS Responsibility;
- InterBraid authority;
- automatic external submission;
- fabricated delivery/acceptance;
- broker/facility organizational authority.
