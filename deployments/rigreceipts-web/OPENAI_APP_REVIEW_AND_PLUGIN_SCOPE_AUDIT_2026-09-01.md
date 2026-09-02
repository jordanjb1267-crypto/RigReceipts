# RigReceipts OpenAI App Review + Plugin Scope Audit

**Date:** 2026-09-01  
**Status:** reconciliation evidence only; does not merge to `main` or expand the submitted app tool surface.  
**Supersedes only the prior statement that AppDeploy v31 is the current website truth. v31 remains historical deployment evidence.**

## 1. Executive adjudication

The OpenAI rejection of **RigReceipts Freight Economics (v1.0.0)** is a narrow compliance defect, not evidence that the product/tool concept failed review. The rejection asks for a privacy policy that clearly covers data collected, purposes, recipients, retention, user controls, and the current tool's inputs/outputs.

The remediation decision is:

1. **Fix privacy immediately without changing the submitted v1.0.0 tool surface.**
2. **Resubmit v1.0.0 with `evaluate_load_offer` unchanged.**
3. **Do not add Roadside, document access, account access, load search, booking, dispatch, broker communication, or other new capabilities to the same remediation submission.**
4. **Plan a separate post-approval capability expansion because the current RigReceipts product is now materially broader than the original single-tool projection.**

Canonical product rule remains:

`RigReceipts = understand + organize + prepare`  
`RigDesk = maintain + recover equipment`  
`FreightOS = plan + coordinate + execute freight`  
`InterBraid = coordinate across organizations`

Plugin expansion must remain inside the RigReceipts side of that boundary unless a later independently reviewed cross-product app explicitly changes scope.

## 2. AppDeploy v32 — privacy remediation

AppDeploy version:

- **v32**
- snapshot `1788319712755`
- successful deployment
- custom root domain `rigreceipts.com` remains active

The public `/privacy` policy now explicitly covers the submitted **RigReceipts Freight Economics (v1.0.0)** app.

### Submitted tool disclosed

The policy identifies the current submission as one anonymous, read-only tool:

- `evaluate_load_offer`

### Exact input classes disclosed

- offered load pay
- loaded miles
- deadhead miles
- weekly fixed operating costs
- variable operating cost per mile
- projected total miles per week
- expected loaded miles per week
- desired weekly driver pay
- desired weekly reserve / profit cushion

### Exact output classes disclosed

- loaded RPM
- all-mile RPM
- deadhead share
- weekly break-even cost
- weekly revenue needed
- all-mile break-even RPM
- all-mile target RPM
- break-even gross for the evaluated offer
- target gross for the evaluated offer
- margin over break-even
- delta to target
- weekly planning-only target loaded RPM
- `ACCEPT | COUNTER | PASS` verdict

### Purpose disclosed

The data is used to perform deterministic freight-economics calculations and return decision support for the specific offer.

### Recipients / flow disclosed

The policy distinguishes:

- OpenAI/ChatGPT processing of the conversation and tool invocation;
- the RigReceipts tool runtime receiving calculation arguments;
- ordinary hosting/network delivery and security metadata;
- Google Analytics for ordinary website analytics, while economic tool inputs/outputs are not intentionally sent as custom analytics-event parameters.

It explicitly states that the v1.0.0 economic inputs are not intentionally sent to TruckDown, load boards, brokers, shippers, advertising networks, or other freight-data providers.

### Retention disclosed

RigReceipts does not intentionally write `evaluate_load_offer` inputs or outputs to a RigReceipts application database or customer account. They are processed for the calculation and are not retained by RigReceipts as a saved freight record after the tool request completes.

The policy separately discloses that:

- hosting/security infrastructure may retain technical request metadata according to provider settings;
- OpenAI controls retention of the user's ChatGPT prompt/conversation/tool-call record under the user's OpenAI settings.

### User controls disclosed

- user chooses which values to provide;
- user can stop using the tool;
- ChatGPT/OpenAI conversation/history controls govern OpenAI-retained conversation data;
- v1.0.0 creates no separate saved RigReceipts tool record requiring deletion;
- broader RigReceipts account data remains subject to RigReceipts access/correction/export/deletion controls.

### Negative / authority boundary disclosed

The submitted app does not:

- read RigReceipts account records;
- read receipts/documents/saved loads/mileage history;
- receive device location;
- search load boards or live freight markets;
- contact brokers/shippers;
- negotiate/book/accept/reject/dispatch freight;
- establish HOS, route, safety, equipment, regulatory, insurance, or contractual feasibility;
- authorize payment or another external commitment.

## 3. Roadside separation

The current private RigDesk Roadside preview is explicitly disclosed as a **separate product surface**, not part of the submitted RigReceipts Freight Economics v1.0.0 app.

Current staging Roadside semantics remain:

- coordinate or TruckDown-resolvable text location search;
- exact provider-service qualification;
- ordinary search not intentionally persisted as search history;
- explicit device-location consent;
- optional opaque RoadsideHandoff;
- handoff includes truck location context, service category, selected provider context, source provenance, expiry, and no-authority envelope;
- OPEN handoff is usable for 30 minutes;
- expiry/consumption prevents reuse;
- preview technical records may remain in protected service storage until cleanup and therefore the policy does **not** falsely claim physical deletion at exactly 30 minutes;
- no search/handoff creates service, provider contact, dispatch, repair approval, payment authority, or vehicle readiness.

Do not add Roadside to the RigReceipts Freight Economics resubmission merely because the website hosts the private preview.

## 4. Current RigReceipts capability audit

The original ChatGPT submission exposes only a thin projection of what RigReceipts has become.

### A. Existing economic/freight-intelligence layer

Current RigReceipts architecture/product work includes:

- all-mile rate checking and offer economics;
- loaded/all-mile RPM;
- break-even and target economics;
- deadhead impact;
- cost profiles;
- rate-confirmation extraction;
- privacy-safe rate-sharing cards;
- historical Community Rate Board;
- lane aggregates and confidence thresholds;
- Compare to My Costs;
- broker/rate intelligence seams;
- subscription + data-entitlement controls;
- authenticated/private Supabase-backed records;
- PostHog analytics and RevenueCat subscription infrastructure;
- receipt/document capture and sync seams.

This is materially broader than one stateless `evaluate_load_offer` calculation.

### B. Pass 0–3 / "v3 handoff" refinement

The latest Pass 0–3 RigReceipts handoff adds/defines:

**Pass 0 — capability/entitlement control plane**

- one subscription ladder;
- separate software capability and third-party-data entitlement;
- free/Driver Pro/Owner-Operator/Fleet Lite/Lifetime capability semantics.

**Pass 1 — Road Wallet**

- reusable OperationalDocuments distinct from load documents;
- registrations, insurance, IRP/cab cards, IFTA material, inspections, permits, driver credentials, carrier documents, custom documents;
- sensitivity classes including STANDARD, PERSONAL_SENSITIVE, FINANCIAL_SENSITIVE;
- document versioning;
- offline/local readiness;
- optional cloud backup according to entitlement;
- no claim that stored documents prove universal legal/regulatory compliance.

**Pass 2 — Quick Present**

- user-selected presentation sets;
- Roadside/Shipper system sets;
- current-version resolution at presentation time;
- offline-readiness preflight;
- no unrelated data disclosure;
- financial-sensitive documents excluded from Roadside presentation sets by default.

**Pass 3 — Carrier Profile + Carrier Packet Builder foundation**

- reusable carrier identity/profile;
- packet templates;
- immutable packet snapshots referencing exact document versions;
- review/readiness state;
- explicit user-driven export/share only;
- no broker agreement signing;
- no term acceptance;
- no autonomous broker email;
- no portal submission;
- no regulatory-validity attestation;
- no FreightOS execution authority.

Important: these Pass 0–3 artifacts are an implementation/refinement handoff and must not be represented as live production proof unless independently verified in the implementation candidate/runtime.

### C. Cross-product boundary

RigReceipts increasingly owns the economic/evidence edge of the broader system:

- private cost truth;
- expenses;
- revenue/load economics;
- rate observations;
- expected-vs-actual reconciliation;
- document-derived economic evidence;
- permissioned/derived intelligence signals.

RigDesk owns equipment/service recovery. FreightOS owns freight planning, coordination, negotiation, dispatch, execution, and durable freight operations. Therefore the plugin should not become a backdoor for collapsing these product authority boundaries.

## 5. Plugin gap analysis

### Current v1.0.0

`evaluate_load_offer` is still an excellent approval wedge because it is:

- anonymous;
- deterministic;
- read-only;
- non-persistent at the RigReceipts application layer;
- based on user-supplied values;
- transparent in its math;
- free of private account access;
- free of external freight data rights/licensing questions;
- free of third-party operational effects.

### Product-to-plugin gap

The app is now under-representing RigReceipts because it cannot yet:

- compare multiple offers against the same cost profile;
- explain cost/deadhead/fuel sensitivity systematically;
- use an authenticated user's own saved cost profile;
- summarize actual vs expected economics;
- surface private lane/load history under user authorization;
- report Road Wallet/document readiness metadata;
- prepare a bounded carrier packet draft.

That gap is strategic opportunity, but it should be closed in controlled releases rather than inside this rejection-remediation cycle.

## 6. Expansion adjudication

### Decision

**PLUGIN_CAPABILITY_EXPANSION = YES, AFTER V1.0.0 APPROVAL.**

**CURRENT_RESUBMISSION_TOOL_CHANGE = NO.**

The narrow rejection creates an unusually favorable resubmission path. Adding capabilities now would change the review surface, introduce new data flows, and force the new privacy policy to cover capabilities that are not required to cure the rejection.

## 7. Recommended plugin expansion sequence

### v1.0.0 — resubmit unchanged

Expose only:

- `evaluate_load_offer`

Purpose: obtain approval for the smallest coherent RigReceipts capability.

### v1.1 — anonymous deterministic Economics Toolkit

Potential tool family, kept deliberately small and non-overlapping:

1. `evaluate_load_offer` — one offered load vs one economic profile.
2. `compare_load_offers` — compare/rank a small set of user-supplied offers against one common economic profile.
3. `analyze_cost_sensitivity` — show how controlled changes in deadhead, fuel/variable cost, offered gross, or weekly assumptions change break-even/target economics.

Do not create many tiny formula tools. Each tool should represent a distinct user job.

This release can remain anonymous/read-only/non-persistent and therefore preserves much of the v1.0 review simplicity.

### v1.2 — authenticated My RigReceipts intelligence

After account-auth, privacy, scope, and tenant isolation are independently proven:

- `get_my_cost_profile`
- `evaluate_load_offer_with_my_costs`
- `summarize_my_operating_economics`
- `compare_to_my_history`
- `get_lane_economic_history`

Preferred pattern: avoid unnecessarily exporting raw private records to the host. Return purpose-bounded projections/aggregates where the user job can be satisfied without transmitting source documents or full record history.

### v1.3 — authenticated document readiness / preparation

After Pass 0–3 implementation is independently accepted:

Read-first:

- `get_road_wallet_status`
- `get_document_readiness`
- `get_carrier_packet_readiness`

Later bounded prepare action:

- `prepare_carrier_packet_draft`

The prepare action may create a DRAFT/immutable reviewed snapshot only within the existing authority contract. It must not submit, sign, accept terms, email brokers autonomously, or represent regulatory sufficiency.

Raw document images, OCR text, document numbers, financial identifiers, and personally sensitive values should not become broad model context by default.

### Later intelligence release

After provider rights, provenance, data entitlement, freshness, and usage limits are settled, RigReceipts may expose bounded intelligence such as:

- historical/community lane economics;
- public FMCSA authority/risk facts with timestamps/provenance;
- public fuel benchmark context;
- source-attributed market/economic signals;
- offer intelligence that distinguishes sourced facts from calculations and estimates.

Do not turn this into live load-board search by default. Live freight sourcing, negotiation, acceptance, booking, dispatch, and operational coordination remain FreightOS responsibilities.

## 8. Capabilities that should NOT move into this plugin

Unless a later cross-product application is deliberately reviewed:

- Roadside provider dispatch / managed service case execution — RigDesk;
- load-board discovery and licensed live load search — FreightOS/load-source plane;
- broker negotiation, acceptance, rejection, booking — FreightOS;
- driver dispatch/assignment — FreightOS;
- HOS/safety/legal feasibility certification — not established by RigReceipts economics;
- autonomous carrier-packet portal submission or agreement signing — outside current RigReceipts authority;
- raw financial-sensitive Road Wallet documents as default model context;
- unrestricted community posting/data pooling without explicit user consent and rights controls.

## 9. Repository privacy drift

`docs/PRIVACY_POLICY.md` on `main` is no longer an acceptable source of current public truth because it:

- is dated July 19, 2026;
- is explicitly marked `Draft for review`;
- contains legal-entity/address placeholders;
- predates the submitted ChatGPT tool disclosure;
- states that RigReceipts does not collect location, which conflicts with later location-dependent mobile/Roadside product behavior;
- does not reflect the current AppDeploy v32 public privacy policy.

Do not overwrite `main` from this reconciliation pass. Before the next normal repository convergence, reconcile the approved v32 policy into the canonical legal/store metadata source through the established owner-controlled process.

## 10. Resubmission checklist

Before resubmitting v1.0.0:

- [x] Public privacy URL updated.
- [x] Tool inputs enumerated.
- [x] Tool outputs enumerated.
- [x] Purpose disclosed.
- [x] Recipients/data flow disclosed.
- [x] RigReceipts retention disclosed.
- [x] OpenAI-controlled conversation retention distinguished.
- [x] User controls disclosed.
- [x] Current tool non-authority boundary disclosed.
- [x] Roadside explicitly separated from submitted app.
- [x] v1.0.0 submission already declares the tool read-only, non-open-world, and non-destructive.
- [x] Existing 5 positive / 3 negative review cases preserve the narrow contract.
- [ ] Verify the OpenAI dashboard still points to the public `/privacy` URL after the deployment.
- [ ] Resubmit the same v1.0.0 capability surface.

## 11. Freeze recommendation

Freeze the following design ruling until v1.0.0 review completes:

> **RIGRECEIPTS_CHATGPT_APP_REVIEW_V1:** Cure the privacy-policy rejection with AppDeploy v32 while preserving the submitted one-tool `evaluate_load_offer` contract. Treat the broader RigReceipts evolution as justification for a staged post-approval plugin roadmap, not as justification to widen the pending resubmission. Expansion must remain inside `understand + organize + prepare`, use purpose-bounded data projections, preserve software-vs-data entitlement, sensitivity, provenance, and authority boundaries, and may not silently absorb RigDesk recovery or FreightOS execution capabilities.
