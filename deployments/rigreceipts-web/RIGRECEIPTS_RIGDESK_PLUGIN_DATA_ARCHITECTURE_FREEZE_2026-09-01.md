# RigReceipts / RigDesk Plugin + Data Architecture Freeze

**Effective:** 2026-09-01  
**Status:** CANONICAL ADDITIVE DESIGN FREEZE on the reconciliation branch only.  
**Repository effect:** documentation/evidence only; no `main` mutation, no public capability expansion, no authority expansion.  
**Current review state:** RigReceipts Freight Economics v1.0.0 has been resubmitted to OpenAI with the corrected v32 privacy policy and is awaiting review.

This freeze is subordinate to all existing RigReceipts, RigDesk, FreightOS, InterBraid, WorkforceOS, security, privacy, authority, evidence, Work Kernel, HostProjection, entitlement, and product-boundary freezes. It refines plugin distribution and data-capture semantics; it does not reorder the existing build sequence or authorize a new runtime.

## 1. RIGRECEIPTS_V1_REVIEW_HOLD

The currently resubmitted **RigReceipts Freight Economics v1.0.0** remains frozen while OpenAI review is pending.

- public tool surface remains `evaluate_load_offer` only;
- anonymous;
- deterministic;
- read-only;
- no RigReceipts account access;
- no device location;
- no document access;
- no Roadside capability;
- no load-board/live-load search;
- no negotiation, booking, acceptance, rejection, dispatch, payment, HOS/safety/legal-feasibility determination, or other external effect;
- no unrelated deployment or submission-surface changes solely to add future capabilities during review.

Acceptance of v1.0.0 is the promotion gate for the next public RigReceipts plugin capability release.

## 2. APPROVED_NARROW_PLUGIN_TO_STAGED_EXPANSION

Use the launch pattern:

`narrow approved capability -> stage next capability behind it -> validate privacy/data/authority/runtime semantics -> promote -> repeat`.

The approved RigReceipts plugin becomes the first reusable distribution/conformance template for later RigReceipts, RigDesk, FreightOS, and InterBraid host projections.

## 3. PLUGIN_AS_HOST_PROJECTION

A ChatGPT, Claude, or other host integration is a **HostProjection over canonical product capabilities**.

A plugin/tool is not:

- the canonical product database;
- a WorkObject;
- a WorkAttempt;
- an Employee;
- an authority grant;
- an organizational responsibility transfer;
- a business commitment;
- the source of truth merely because the host invoked it.

Canonical shape:

`AI host -> plugin/HostProjection -> provider-neutral capability contract -> canonical product domain service -> tenant-owned operational state -> observation/decision/WorkAttempt/effect/evidence/outcome -> permissioned derived intelligence`.

## 4. PRODUCT_SOVEREIGNTY

Preserve the existing domain boundary:

- **RigReceipts = understand + organize + prepare**;
- **RigDesk = maintain + recover equipment**;
- **FreightOS = plan + coordinate + execute freight**;
- **InterBraid = coordinate accountable work across organizations**.

Plugin expansion may expose a product's bounded capability but may not silently absorb another product's authoritative responsibilities.

Examples:

- RigReceipts economic/document intelligence must not become freight booking/dispatch authority;
- RigDesk Roadside/service recovery must not become RigReceipts Freight Economics authority;
- FreightOS execution capabilities must not be smuggled into a RigReceipts document/economics tool merely because the host can invoke multiple tools.

## 5. DATA_MOAT_DEFINITION

The strategic data asset is not indiscriminate trucking-data accumulation.

The target moat is a permissioned, provenance-rich corpus connecting:

`what was known -> what was assessed/decided -> what action occurred -> what evidence proves it -> what actually happened -> what it cost/earned -> expected-vs-actual variance -> governed learning`.

This causal operating history is more strategically valuable than isolated market observations because it can connect economic decisions, operational execution, service exceptions, settlement, and realized outcomes.

## 6. DATA_CAPTURE_FROM_ORDINARY_USE

Each relevant RigReceipts and RigDesk workflow should preserve strategically useful observations and decision-to-outcome relationships from normal valuable customer use, **without adding unnecessary user friction**.

Capture is subordinate to:

- user value;
- privacy;
- consent/rights;
- tenant sovereignty;
- purpose limitation;
- security;
- provenance;
- data minimization;
- retention;
- product authority boundaries.

The data thesis is a horizontal architectural refinement, not a roadmap reset.

## 7. FOUR_DATA_CLASS_SEPARATION

Keep at least these classes distinct:

### A. Private operational data
Examples: customer cost profiles, receipts, documents, private load history, Roadside cases, repair evidence.

Rule: tenant/customer-owned and purpose-limited. Ordinary product access does not imply pooling, resale, model training, or network intelligence permission.

### B. Provider/source observations
Examples: TruckDown results, FMCSA facts, EIA diesel observations, licensed/public freight signals.

Rule: preserve source/provider identity, source record/reference where available, observation time, freshness, provider rights/data entitlement, normalization/version, and limitations.

### C. Derived customer intelligence
Examples: break-even RPM, target RPM, load verdict, service recommendation, expected-vs-actual variance.

Rule: preserve formula/model/version, source inputs/references, calculation time, assumptions, and confidence/limitations where applicable.

### D. Permissioned network intelligence
Examples: privacy-safe lane economics, service-market outcomes, aggregate provider reliability, derived operational benchmarks.

Rule: requires a distinct lawful/product basis and applicable consent/rights. Private-use permission is not automatically network-learning permission.

## 8. PURPOSE_BOUNDED_PROJECTION

Host integrations should receive the minimum projection required to satisfy the user job instead of unrestricted tenant records whenever possible.

Preferred examples:

- send an effective `CostProfileProjection` rather than every underlying receipt;
- send document readiness/status rather than raw insurance/W-9/banking document contents;
- send provenance-bearing aggregate lane history rather than unnecessary private load records;
- send selected RoadsideHandoff context rather than broad vehicle/customer state.

Raw sensitive artifacts remain behind explicit scoped access and product-specific controls.

## 9. PROVENANCE_FIRST

Every consequential external or derived datum used by a plugin should carry, as applicable:

- source/provider;
- source operation/record reference;
- observed/effective time;
- freshness/expiry;
- tenant/legal scope;
- rights/data entitlement;
- normalization/schema version;
- calculation/model/formula version;
- confidence/limitations;
- evidence references.

No model or host may convert an unverified provider assertion into canonical organizational fact simply because it appears in tool output.

## 10. PRIVATE_USE_NOT_NETWORK_LEARNING_PERMISSION

`permission_to_use_for_this_customer_workflow != permission_to_pool_or_train_or_publish`.

Installing a plugin, authenticating, querying private data, storing a document, evaluating a load, or creating a service case does not by itself authorize:

- public/community publication;
- cross-tenant aggregation;
- resale;
- external model training;
- unrelated marketing use;
- disclosure to counterparties;
- durable network-learning contribution.

Any such use must be separately admitted by the applicable product/privacy/rights contract.

## 11. OUTCOME_LINKAGE

Where useful and lawful, preserve stable relationships between earlier decisions/assessments and later outcome evidence.

Examples:

### RigReceipts
`LoadOffer -> EconomicAssessment -> user/carrier decision -> actual miles/fuel/expenses -> settlement/payment -> EconomicActualResult -> ExpectedVsActualVariance`.

### RigDesk
`ServiceNeed -> CandidateSet -> provider selection -> ServiceCase -> quote/approval -> dispatch/effect -> diagnosis/repair evidence -> actual cost/downtime -> ServiceAcceptance -> readiness outcome -> repeat-failure/outcome evidence`.

These relationships should be append-only/provenance-preserving where they become durable records; later evidence may correct or supersede earlier assertions without erasing history.

## 12. PLUGIN_TOOL_NOT_BUSINESS_EFFECT

A plugin tool call does not itself create organizational authority.

Consequential effects must continue through canonical domain semantics including, as applicable:

- authenticated identity;
- company/tenant scope;
- role/authority evaluation;
- workflow state;
- policy/approval;
- WorkObject;
- WorkAttempt;
- idempotency;
- EffectRecord/effect evidence;
- reconciliation;
- acceptance.

No plugin may bypass these layers by directly mutating canonical tables or treating host confirmation text as sufficient authority.

## 13. RIGRECEIPTS_PLUGIN_PROMOTION_ROADMAP

The planned public progression after v1.0 acceptance is:

### v1.0 — current review
- `evaluate_load_offer`

### v1.1 — anonymous deterministic Economics Toolkit
Candidate bounded jobs:
- `evaluate_load_offer`;
- `compare_load_offers`;
- `analyze_cost_sensitivity`.

Keep v1.1 anonymous/read-only/non-persistent where possible. Do not create many formula micro-tools when one user job can be represented coherently.

### v1.2 — authenticated My RigReceipts
Candidate purpose-bounded capabilities after auth/privacy/tenant gates:
- `get_my_cost_profile`;
- `evaluate_load_offer_with_my_costs`;
- `summarize_my_operating_economics`;
- `compare_to_my_history`;
- `get_lane_economic_history`.

Prefer projections/aggregates over raw private-record export.

### v1.3 — document/evidence readiness
Only after Pass 0-3 implementation is independently accepted:
- `get_road_wallet_status`;
- `get_document_readiness`;
- `get_carrier_packet_readiness`;
- later bounded `prepare_carrier_packet_draft`.

Preparation does not imply signing, term acceptance, portal submission, autonomous broker email, regulatory attestation, or FreightOS execution.

### Later intelligence layer
Only after source rights, provenance, freshness, data entitlement, privacy and usage limits are proven:
- historical/community lane context;
- FMCSA/public authority facts;
- fuel benchmark context;
- source-attributed market/economic signals;
- OfferIntelligence-style evidence that distinguishes sourced facts, calculations, estimates and limitations.

Live load sourcing, negotiation, acceptance, booking and dispatch remain FreightOS responsibilities.

## 14. RIGDESK_PLUGIN_LAUNCH_GRAMMAR

RigDesk should launch using the same approval/staging grammar learned from RigReceipts.

### R0 — anonymous read-only discovery
- `search_roadside_providers`.

Preserve ServiceNeed/context, qualified CandidateSet, source/provenance and observation time without creating service authority.

### R1 — authenticated durable work
- `create_service_case`.

Creates the first durable RigDesk roadside WorkObject through canonical server-side authority/idempotency boundaries; one-time RoadsideHandoff consumption is context transfer, not authority.

### R2 — external effects
Only after R1 is live-validated:
- `submit_service_case`;
- `dispatch_service_case`.

Require WorkAttempt, authority snapshot, idempotency, external effect/evidence and reconciliation.

### R3 — repair/acceptance/readiness
Only after independent hardening:
- repair approval;
- repair evidence;
- service acceptance;
- return-to-readiness determination.

Preserve:

`provider reports repair complete != evidence accepted != carrier accepts service outcome != vehicle readiness authorized`.

## 15. CROSS_PRODUCT_CAUSAL_LOOP

Long-term ecosystem learning may connect typed, permissioned artifacts across products without collapsing ownership:

`Opportunity -> RigReceipts EconomicAssessment -> CarrierDecision -> FreightOS LoadExecution -> VehicleException -> RigDesk ServiceNeed/ServiceCase -> RepairEffect/Evidence -> FreightOS MissionImpact -> Delivery/Settlement -> RigReceipts EconomicActualResult -> ExpectedVsActualVariance -> governed learning`.

References/projections should connect records across domains while canonical ownership stays with the product responsible for that state.

## 16. SOFTWARE_ENTITLEMENT_NOT_DATA_RIGHTS_NOT_AUTHORITY

Keep three questions independent:

1. **Software entitlement:** may this customer use the capability?
2. **Data entitlement/rights:** may this capability access/use this source/data class at this volume and purpose?
3. **Runtime authority:** may this actor execute this action now?

A YES to one does not imply YES to the others.

Lifetime and other RigReceipts subscription semantics remain subordinate to the existing software-vs-third-party-data entitlement freeze.

## 17. NO_ROADMAP_RESET

This freeze does not change the established implementation/build sequence.

It requires newly implemented relevant workflows to preserve useful provenance-rich observations and decision/action/evidence/outcome links from their first implementation where practical, but it does not reorder, replace, pause or expand the roadmap merely to maximize data collection.

## 18. APPROVAL_GATE_AND_WAIT_STATE

Current state:

`RIGRECEIPTS_OPENAI_V1_0_RESUBMITTED = TRUE`  
`RIGRECEIPTS_OPENAI_V1_0_REVIEW_PENDING = TRUE`  
`RIGRECEIPTS_PUBLIC_PLUGIN_EXPANSION_DURING_REVIEW = HELD`  
`RIGRECEIPTS_V1_1_DESIGN_DIRECTION = FROZEN / NOT YET PUBLICLY PROMOTED`  
`RIGDESK_PLUGIN_SEQUENCE = FROZEN / CONTINUES ONLY THROUGH EXISTING RUNTIME GATES`.

While review is pending, preserve the accepted v32 privacy correction and existing v1.0 tool surface. Do not treat this waiting period as permission to alter the public submission merely to accelerate later roadmap work.

## 19. PROMOTION CONDITION

After OpenAI approval, the next permitted product-design pass is to stage RigReceipts v1.1 behind the approved v1.0 surface and produce a capability/data/privacy/conformance package before public promotion.

That package should then become the reference launch/conformance pattern for the RigDesk plugin sequence.

## 20. FREEZE SUMMARY

The combined strategic ruling is:

> The first RigReceipts ChatGPT app is the distribution wedge. Future RigReceipts and RigDesk plugins are bounded HostProjections over canonical product capabilities. They must strengthen the shared data moat by preserving permissioned, provenance-rich decision-to-outcome relationships from ordinary valuable workflows, while keeping private use separate from network-learning rights, keeping software entitlement separate from data rights and runtime authority, minimizing host data projections, and preserving product sovereignty, WorkObject/WorkAttempt/effect/evidence/reconciliation, and acceptance semantics. Public capability expansion waits for the current RigReceipts v1.0 approval gate.