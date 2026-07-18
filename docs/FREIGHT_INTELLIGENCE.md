# Freight Intelligence — Additive Integration

Additive integration of the Master Additive Integration Prompt (Rate Sharing
Card, Community Rate Board, revised onboarding, monetization). Built to extend
RigReceipts, not replace it: same Industrial Atlas design system, same 5-tab
navigation (**no 6th tab** — Freight Intelligence lives inside Dashboard/Reports),
same Supabase/entitlement patterns. Everything ships behind feature flags.

RigReceipts is **not** a load board, broker, dispatch service, or freight
marketplace. The Rate Board is a **historical rate-transparency feed** only.

## Foundation slice (this PR)

Pure-TS + SQL groundwork that everything else builds on — fully unit-tested.

### Feature flags — `src/config/flags.ts`

The 7 flags from Section 50 (`freight_intelligence_enabled`,
`rate_sharing_cards_enabled`, `community_rate_board_enabled`,
`community_rate_posting_enabled`, `lane_aggregates_enabled`,
`broker_check_enabled`, `revised_onboarding_enabled`) with off / internal /
beta (deterministic % rollout) / production states and `EXPO_PUBLIC_FF_*`
overrides. All default **off**; public posting stays a controlled beta.

### Freight domain — `src/domain/freight.ts`, `equipment.ts`

- `analyzeRateCheck` — **all-mile-basis** verdict (deadhead is the point: a
  strong loaded rate can still miss target). Returns loaded/all-mile RPM,
  verdict (`above/on/below_target`, `below_break_even`), and contribution.
- `sanitizeRateShareCard` — the privacy core (Section 6/7). **Allow-lists**
  approved fields so shipment/customer/contact/document data can never leak,
  honors the visibility toggles, and buckets the exact date (`Mid July 2026`).
- `detectSensitiveText` — pre-publish checks (phone/email/address/future-date/
  active-load language) for Section 21.
- Verification eligibility (`self_entered` can't publish), lane aggregate
  thresholds (**≥7 posts, ≥3 contributors**), per-contributor de-domination,
  and confidence labels (Section 18).

### Entitlements — `src/domain/entitlements.ts`

Adds **Lifetime ($149 one-time)**, freight free caps (3 rate checks/mo,
5 broker checks/mo, 3 watched lanes), and freight feature gates (rate-con scan +
broker watchlist → Driver Pro; full FI + unlimited rate checks + lane history →
Owner-Operator; card creation/sharing + board viewing + safety controls → free).
Keeps existing `fleet_lite`. One subscription system. Adds the
**provider-agnostic data-entitlement layer** (Section 44) so future licensed
commercial data is gated separately — lifetime includes only
`basic_community_intelligence`, never unlimited licensed data.

### Analytics — `src/analytics/`

Typed catalog of the Section 47 events + a `track()` facade (no-op/dev logger
now; PostHog adapter later). Never logs document contents.

### Rate-confirmation OCR — `src/ocr/parseRateCon.ts`

Extends the existing OCR module: broker (not carrier), load number, origin/
destination, offer (prefers Total/Agreed Rate over Line Haul, excludes FSC),
fuel surcharge, loaded miles, pickup/delivery dates. Pure + fixture-tested.

### Schema — `supabase/migrations/2026071600000{4,5}_freight_*.sql`

6 new tables + `data_entitlements`, all with RLS: `rate_share_cards` (private),
`rate_board_posts` (owner-manage + public read of eligible published posts,
excluding blocked contributors, via a denormalized privacy-safe snapshot),
`rate_post_reports`, `rate_board_blocks`, `rate_board_moderation_cases`
(service-role only), `lane_rate_aggregates` (public read, PII-free). Widens
`subscriptions.tier` to include `lifetime`. Additive and reversible (DOWN block
included); **not applied to a live project**.

## Verification

lint · typecheck · **100 unit tests** (freight metrics, privacy sanitizer,
sensitive detection, aggregate thresholds, entitlements, rate-con parser,
flags, analytics) · both-platform Metro bundle. No device/backend needed for
this slice.

## Phase B — revised onboarding (shipped)

"Check a load → see real profit → save → reveal Road Board" (Sections 24–36):
splash/value ("Know what the load really pays" + RPM waterfall), 6 roles, the
new first-job picker (freight jobs flag-gated), the **Check My Rate branch →
all-mile first-profit result** (`analyzeRateCheck` + `estimateAllMileTargets`),
rate-con scan + community-rates preview branches, the Road Board reveal, and the
Section-36 dashboard reorder with a flag-gated Freight Intelligence widget.
Analytics events wired through `track()`.

## Phase C — Rate Sharing Card UI (shipped)

The card flow (Sections 4–9), gated by `rate_sharing_cards_enabled`:
`RateCardView` renders a `SafeRateCard` (Section 5, verification badge, "not an
available load" footer). The modal (`app/rate-card.tsx`) runs intro → preview +
**privacy toggles** (live over `sanitizeRateShareCard`) + the Section-7 removal
notice → **share options** (Keep Private / Share Outside via the native sheet /
Post to Community). Default is never public; posting is disabled unless
`community_rate_posting_enabled` **and** the rate is verification-eligible. A
`rateCard` draft store feeds the modal; opened from the onboarding result.

## Next (in order)

Community Rate Board feed + filters + Compare-to-My-Costs + reporting/blocking +
moderation queue (Phase D) → RevenueCat wiring + contextual paywalls (Phase E) →
hardening, PostHog/Sentry, store metadata, community terms (Phase F). Public
posting stays flagged off until the moderation infrastructure (Section 51) is
live.
