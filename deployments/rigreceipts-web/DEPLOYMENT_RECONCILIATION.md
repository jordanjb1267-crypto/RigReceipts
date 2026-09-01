# RigReceipts Web / RigDesk Roadside Deployment Reconciliation

Status: reconciliation branch only. This artifact does not merge to `main`, expose Roadside in public navigation/sitemap, create a RigDesk ServiceCase, or authorize provider contact, dispatch, repair, payment, or vehicle release.

## Repository baseline

- Repository: `jordanjb1267-crypto/RigReceipts`
- Branch base: `main` at `1da93f5a4fcbf88b863537aaffdbb18d49b72b57`
- Reconciliation branch: `reconcile/deployed-v25-v30-roadside`

The repository baseline predates the AppDeploy Roadside implementation. This directory preserves deployment evidence and the current provider-neutral Roadside capability without rewriting the native Expo application history.

## AppDeploy lineage

| Snapshot | Version id | Meaning |
|---|---:|---|
| v25 | `1788145678059` | Historical self-contained website implementation. Direct TruckDown credential/OpenAPI/search logic lived in AppDeploy and response normalization used heuristic object/field discovery. Preserve as evidence only. |
| v30 | `1788148407043` | Architecture convergence. Website became a thin proxy to the central Supabase RigDesk Roadside capability; RoadsideHandoff proxy added. |
| v31 | `1788222383600` | Current reconciled website truth. Text location plus coordinates supported, exact TruckDown contract set documented, public handoff-consume proxy removed, Roadside remains private/noindex and absent from sitemap. |

Do not copy v25's `bestObjectArray`, `findValue`, alias probing, or fallback service-normalization behavior into current implementation.

## Current Supabase capability

Project ref: `tjspeaoyqwttqncapbnr` (healthy staging/runtime project used by the deployed website).

### `rigdesk-roadside`

- deployed function version: 3
- source SHA-256: `f44c6f30b0a30342ed0fd1c42614e6bf5f747c72e7ce9bb916c118b105474fe9`
- capability contract: `rigdesk-roadside-capability-v0.3`
- health version: `0.3.1`
- TruckDown OpenAPI: `3.1.1`
- coordinate search: `POST /client/search` / `SearchByGeocode`
- text resolution: `GET /client/lookups/addresses/{term}` / `SearchCityOrAddress`
- resolved-city search: `POST /client/search/city` / `SearchByCity`
- exact result root: `listings[]`
- exact identity/name/location/rating/services bindings: `id`, `name`, `location`, `rating.value`, `services[].code/name`
- ordinary provider search is not persisted by this capability
- service qualification is fail-closed against exact `services[]` data
- RoadsideHandoff is opaque UUID, 30-minute, OPEN→CONSUMED, one-time/context-only
- handoff consumption requires authenticated bearer identity
- handoff never grants service/provider/repair/payment/readiness authority

### `rigdesk-mcp`

- deployed function version: 3
- source SHA-256: `6ecdc0db7db872ac98b9088303b64f097507f7e655188299cfbb928009f8c87c`
- contract: `rigdesk-roadside-plugin-v0.3`
- anonymous read-only tools exposed:
  - `search_roadside_providers`
  - `get_roadside_handoff`
- no public handoff-consume tool
- no `create_service_case`, `submit_service_case`, `dispatch_service_case`, repair approval, payment, or service acceptance tool yet

### `rigdesk-mcp-probe`

- deployed function version: 4
- source SHA-256: `bd3a11597cad185f73c7d27d2709474ea06330f946e115127a8c8055103faed8`
- verifies exactly two read-only tools and effect-boundary annotations
- verifies coordinate search and `Dallas, TX` text search both end in `OK` or `NO_RESULTS`
- latest post-region-split smoke returned HTTP 204

## Source-of-truth boundary for ServiceCase

The healthy staging project currently contains RoadsideHandoff support but not the canonical RigDesk `service_requests` / jobs model. The canonical durable service-case model remains in the separate RigDesk repository. Do not create a second ServiceCase schema in this RigReceipts staging database merely to expose an MCP write tool.

The next write-capable step must bind authenticated `create_service_case` to the canonical RigDesk WorkObject model, including server-side role/authority checks and idempotency. Only after that may RoadsideHandoff be consumed as part of that authenticated creation transaction/workflow.

## Held gates

Until independently hardened:

1. `create_service_case` — not publicly exposed yet.
2. `submit_service_case` — not exposed; requires idempotency / WorkAttempt / effect evidence.
3. `dispatch_service_case` — not exposed; must preserve provider independent acceptance and external-effect evidence.
4. repair approval — held.
5. service acceptance / return-to-readiness — held.
6. Roadside public navigation and sitemap exposure — held.

The current deployed Roadside page remains `noindex, nofollow`, a private integration preview, and `public/sitemap.xml` contains no `/roadside` entry.
