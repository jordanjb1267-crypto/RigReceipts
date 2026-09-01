# RigReceipts Web / RigDesk Roadside Deployment Reconciliation

Status: reconciliation branch only. Nothing in this artifact merges to `main`, publishes Roadside in navigation/sitemap, submits or dispatches a ServiceCase, approves repair spend, authorizes payment, or returns a vehicle to service.

## Repository baseline

- Repository: `jordanjb1267-crypto/RigReceipts`
- Branch base: `main` at `1da93f5a4fcbf88b863537aaffdbb18d49b72b57`
- Reconciliation branch: `reconcile/deployed-v25-v30-roadside`

The native Expo repository predates the AppDeploy Roadside work. This directory preserves deployment evidence without rewriting that history.

## AppDeploy lineage

| Snapshot | Version id | Meaning |
|---|---:|---|
| v25 | `1788145678059` | Historical self-contained Roadside implementation. Direct TruckDown credential/OpenAPI/search logic lived in AppDeploy; response normalization used heuristic object/field discovery and the UI was coordinate-only. Preserve as evidence only. |
| v30 | `1788148407043` | Architecture convergence. The website became a thin proxy to a central Supabase RigDesk Roadside capability instead of duplicating TruckDown and handoff logic. |
| v31 | `1788222383600` | Current website truth. Coordinates + text location are supported, exact TruckDown contracts are documented, the public handoff-consume proxy is removed, and Roadside remains private/noindex and absent from the sitemap. |

Preserved v25 evidence includes `v25/backend/index.ts` and `v25/pages/roadside.tsx`. Current v31 evidence includes the website gateway, Roadside page, acceptance tests, and sitemap hold.

Do not copy v25's `bestObjectArray`, `providerArrayScore`, `findValue`, alias probing, guessed phone fields, or fallback service-normalization behavior into current implementation.

## Exact TruckDown contract adjudication

TruckDown is the first `ServiceNetworkProvider` adapter, not RigDesk's canonical vocabulary.

Verified OpenAPI: `3.1.1`.

- coordinate provider search: `POST /client/search` / `SearchByGeocode`
- text location resolution: `GET /client/lookups/addresses/{term}` / `SearchCityOrAddress`
  - `term` is required
  - `region` is an optional separate query parameter; e.g. `Dallas, TX` is normalized to term `Dallas`, region `TX`
- resolved-city provider search: `POST /client/search/city` / `SearchByCity`
- exact search response root: `listings[]`
- exact result bindings:
  - identity: `listings[].id`
  - name: `listings[].name`
  - provider location/distance: `listings[].location`
  - rating: `listings[].rating.value` and `.count`
  - capability evidence: `listings[].services[].code` / `.name`
  - requestability metadata: `canRequestService`, `managedService`

Service qualification is fail-closed against the exact `services[]` response. No qualified match means no candidate; there is no fallback that relabels an unqualified provider as matching.

## Current deployed staging capability

Project ref: `tjspeaoyqwttqncapbnr` (healthy RigReceipts staging/runtime project used by the deployed website).

This is a temporary proving ground, not the eventual system of record for RigDesk ServiceCase work.

### `rigdesk-roadside`

- deployed function version: **4**
- source SHA-256: `40953357e90ddb95e6daca93c809f1c610c9a33d7a5e4b18a40c18652c644a56`
- capability contract: `rigdesk-roadside-capability-v0.3`
- health version: `0.3.2`
- exact TruckDown normalization as described above
- device coordinates are the fastest path
- city/state/ZIP/address/highway-or-exit text is sent to TruckDown `SearchCityOrAddress`; unresolved input fails closed and does not invent coordinates
- explicit browser geolocation consent is preserved in the v31 HostProjection
- ordinary provider search is not intentionally persisted
- RoadsideHandoff is opaque UUID, 30-minute, one-time/context-only
- handoff now stores `location_context` separately from the selected provider, so provider address cannot be confused with truck location
- handoff creation re-runs a fresh qualified provider search before minting context
- staging handoff table has RLS enabled, no client policies, and all table privileges revoked from `anon` / `authenticated`; service-role custody is intentional
- handoff grants no service/provider/repair/payment/readiness authority

### `rigdesk-mcp`

- deployed function version: **3**
- source SHA-256: `6ecdc0db7db872ac98b9088303b64f097507f7e655188299cfbb928009f8c87c`
- contract: `rigdesk-roadside-plugin-v0.3`
- staging tools remain read-only:
  - `search_roadside_providers`
  - `get_roadside_handoff`
- no public consume tool
- no `create_service_case`, `submit_service_case`, `dispatch_service_case`, repair approval, payment, or service acceptance tool is deployed here

### `rigdesk-mcp-probe`

- deployed function version: **4**
- source SHA-256: `bd3a11597cad185f73c7d27d2709474ea06330f946e115127a8c8055103faed8`
- verifies exactly the two staging read-only tools and their effect-boundary annotations
- verifies coordinate search and `Dallas, TX` text search both end in `OK` or `NO_RESULTS`
- post-region-split smoke returned HTTP 204

### TruckDown contract probe

The temporary schema-discovery probe is retired:

- function version: **13**
- source SHA-256: `fa76f8adb4ba5c580c14031e15be2fef937af6eed96c11a571a89ac519de3e5c`
- `verify_jwt=true`
- implementation returns only HTTP 410 / `CONTRACT_PROBE_DISABLED_AFTER_VERIFICATION`
- it contains no TruckDown search or credential-reading logic anymore

## Canonical RigDesk move target

Repository: `jordanjb1267-crypto/Rigdesk`

Candidate branch: `feature/roadside-service-case-v0.1`

Branch verification at head `d2a0dda251dc065e02458423f1a64782d5285ebc`:

- GitHub Actions run `33456413578`: **SUCCESS**
- pnpm workspace install: PASS
- TypeScript syntax sweep: PASS
- `@rigdesk/*` import resolution: PASS
- duplicate-export guard: PASS
- 30 migration prefix / dollar-quote checks: PASS
- core strict typecheck: PASS
- secret scan / env / service-role web-client / function-inventory / migration / env-documentation preflight: PASS

The branch intentionally separates source inventory from historical deployment truth: the repository now contains 19 Edge-function directories, while `DEPLOY.md` continues to record the earlier 16/16 deployment as historical evidence and explicitly marks the three new Roadside functions as undeployed candidates.

### Canonical provider-neutral capability

`supabase/functions/_shared/service-network.ts`

- defines `ServiceNetworkProvider`
- implements `TruckDownServiceNetworkProvider`
- uses the exact TruckDown fields above rather than runtime heuristic schema walking
- resolves coordinates or text location
- fails closed on schema drift and unresolved location
- applies exact response-service qualification

### Canonical anonymous Roadside capability

`supabase/functions/roadside/index.ts`

- anonymous/read-only provider discovery
- context-only handoff preparation
- revalidates the selected provider from a fresh qualified search
- stores RoadsideHandoff in canonical RigDesk custody through service-role
- exposes no handoff consume route and no ServiceCase mutation

### Canonical RoadsideHandoff + ServiceCase semantics

Migrations `0029_roadside_service_case.sql` and `0030_roadside_acl_hardening.sql`:

- create `roadside_handoffs` in the same canonical RigDesk database as `service_requests`
- opaque UUID; OPEN / CONSUMED / EXPIRED; short-lived; context-only
- no direct anon/authenticated custody-table access
- preserve source operation, canonical service, truck `location_context`, selected provider, and explicit no-authority envelope
- keep existing `service_requests` as the first durable roadside WorkObject; no duplicate ServiceCase table
- add `service_case_creation_receipts` only for idempotency/provenance evidence
- replace broad ServiceRequest insertion with company-scoped demand-side role checks and `requested_by = auth.uid()`
- `create_service_case_from_handoff(...)` atomically:
  1. authenticates actor/company role
  2. checks actor + operation-key idempotency
  3. locks one OPEN, unexpired RoadsideHandoff
  4. validates truck/trailer ownership
  5. creates one **draft** `service_requests` row
  6. records idempotency/provenance receipt
  7. marks the handoff CONSUMED by that actor
- any exception rolls the entire transaction back
- creation does **not** submit the case or create any provider/external effect

### Authenticated creation capability

`supabase/functions/roadside-service-case/index.ts`

- JWT required
- validates user through Supabase Auth
- computes a SHA-256 semantic input hash
- delegates atomic creation to `create_service_case_from_handoff`
- returns created/existing draft ServiceCase semantics
- no provider contact, dispatch, repair approval, payment, or readiness effect

### Mixed-auth canonical MCP

`supabase/functions/rigdesk-mcp/index.ts`

- bearer token is verified at the HTTP/auth layer, never accepted as a tool argument
- anonymous caller tool surface:
  - `search_roadside_providers`
- authenticated caller tool surface:
  - `search_roadside_providers`
  - `get_roadside_handoff`
  - `create_service_case`
- `create_service_case` uses a deterministic operation key bound to the handoff
- held/absent:
  - `submit_service_case`
  - `dispatch_service_case`
  - work-order repair approval
  - service acceptance / return-to-readiness

## Live deployment blocker for step 6

The named canonical RigDesk Supabase project is `ubdhcoxpqbsqlepuwieu` and is currently INACTIVE.

An attempted restore was rejected by Supabase because the organization is already at its **two-active-free-project limit**. No active project was paused or deleted to bypass that account-level limit.

Therefore:

- step 6 is **repository-ready / CI-green** but **not live-validated** on the canonical RigDesk database
- migrations 0029/0030 have not been applied to the canonical project
- canonical Roadside/MCP functions have not been deployed there
- authenticated creation/idempotency/one-time-consumption smokes cannot be claimed yet
- the temporary RigReceipts staging database must not be turned into a second ServiceCase system of record simply to bypass this blocker

## Ordered gate status

1. Exact TruckDown response normalization — **DONE / DEPLOYED in staging / reconciled**
2. Address/location resolution — **DONE for coordinates + TruckDown-resolvable text; unresolved highway/exit fails closed; explicit consent preserved**
3. RoadsideHandoff — **DONE in staging; canonical same-database implementation prepared**
4. Provider-neutral RigDesk MCP / ServiceNetworkProvider — **DONE in canonical branch; read-only staging MCP deployed**
5. `search_roadside_providers` first / anonymous read-only — **DONE / DEPLOYED / smoke verified**
6. authenticated `create_service_case` — **IMPLEMENTED + CI GREEN, but LIVE DEPLOYMENT/DB VALIDATION BLOCKED by canonical project activation limit**
7. `submit_service_case` / `dispatch_service_case` — **HELD** until step 6 is live-validated; must add WorkAttempt/effect/evidence/idempotency and preserve provider independent acceptance
8. repair approval + service acceptance — **HELD** pending independent authority/acceptance hardening
9. Roadside public navigation + sitemap — **HELD**; current page remains private and `noindex, nofollow`

## Non-regression rule

Do not advance step 7 by treating repository-green step 6 as production proof. The next permitted action is to activate a canonical RigDesk validation environment, replay the full migration chain including 0029/0030, deploy the three Roadside candidate functions with the required TruckDown secret, and prove authenticated creation + retry + conflicting retry + expired handoff + double-consume + cross-company/role-denial behavior. Only then may the external-effect layer begin.
