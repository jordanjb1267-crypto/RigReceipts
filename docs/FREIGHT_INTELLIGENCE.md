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

## Phase D — Community Rate Board, read side (shipped)

Gated by `community_rate_board_enabled`, on mock data:

- **Feed** (`app/rate-board.tsx`): header + the permanent "Historical rate
  information only. These are not available loads." clarification, the four tabs
  (For You / Recent / Watched / Completed), a filter sheet (equipment, completed-
  only), and community cards. Ordering is recency/verification only — never
  engagement (Section 13).
- **Client safety controls** on every card: Report (the Section-22 categories +
  "Thanks. We'll review this rate card."), Hide, and Block Contributor ("you
  will no longer see rate cards from this contributor"), persisted locally.
- **Lane detail** (`app/lane-detail.tsx`): the Section-17 community snapshot via
  `computeLaneAggregate`, with the Section-18 threshold → "Limited Community
  Data" fallback and confidence labels. Never called an official/guaranteed rate.
- **Compare to My Costs** (`app/compare.tsx`, Section 16): uses the viewer's
  saved cost profile or a Quick Estimate; shows community rate vs the viewer's
  break-even and target, with the "Make this rate personal" prompt when no
  profile exists.
- Pure `filterCommunityPosts` + `laneKey` in the domain (unit-tested); a
  persisted board store (hidden / blocked / watched lanes) and a `costProfile`
  store. Wired from the dashboard FI widget and the Reports tab.

## Phase D-2 — posting + moderation (shipped)

Gated by `community_rate_posting_enabled`, on top of the read side:

- **Publication checks** (`src/domain/rateBoardModeration.ts`, Section 21):
  `validateRateBoardPost` runs verification-eligibility, abnormal-rate,
  duplicate, and sensitive/future-date checks and returns every blocker.
  `moderationStatusFromReports` is the report→flag state machine (auto-flag at
  3 reports; removed/under-review stay human-decided). Unit-tested (10 tests).
- **First-public-post flow** in the rate-card modal: "Post to Community" →
  consent screen (Section 20, "Share historical rates — not active freight" +
  required "I understand and agree" checkbox, terms version persisted) →
  automated checks → **"This card needs review"** blocker screen (Section 21)
  listing the reasons, or a posted confirmation. A `community` store keeps the
  acknowledged terms version and the user's own posts (for duplicate detection).
- Analytics: `rate_board_post_started/completed/blocked`.
- The authoritative queue/admin stays server-side (`rate_board_moderation_cases`,
  service-role only); these are the shared rules the client and Edge Functions
  both use. Posting stays flag-off until that backend + auth are live.

## Phase E — monetization (shipped, sandbox purchases)

- **Usage metering** (`src/domain/usage.ts`, tested): monthly allowances for
  rate checks (3), broker checks (5), and Compare to My Costs on the free tier;
  unlimited per the entitlement gates. Persisted counters + month rollover in
  `src/store/subscription.ts`.
- **Purchases boundary** (`src/payments/purchases.ts`): the app talks to a
  `PurchasesAdapter`; a sandbox adapter fulfils purchases locally (labeled in
  the UI) until RevenueCat's API keys + a native build exist. One subscription
  system (Section 39).
- **Contextual paywall** (`app/paywall.tsx`, Sections 45–46): trigger-specific
  headlines (free limit / compare / lane history), the Section-45 value
  hierarchy, Owner-Operator primary + Driver Pro + $149 Founder Lifetime, and
  "Maybe Later". Never shown before first value; wired from Compare-to-My-Costs
  metering. Analytics: paywall_viewed, subscription_plan_selected/started.

## Observability + backend status

- **Sentry: LIVE.** Project `rigreceipts-app` created in the `rigreceipts` org
  via the Sentry connector; DSN in `.env.example`; `@sentry/react-native` +
  Expo plugin wired, env-guarded (no PII, no document contents).
- **Supabase: LIVE.** Org `RigReceipts`, project `kfyzglmphwohbhigvdyy`
  (ca-central-1, Postgres 17). All 6 migrations applied via the connector
  (schema, RLS, storage buckets, freight schema, freight RLS, advisor
  hardening), 23 categories seeded, and the `get_advisors` **security audit is
  clean** — the single INFO (`rate_board_moderation_cases` has RLS with no
  client policies) is by design: that table is service-role only (Section 51).
  URL + publishable key are in `.env.example`; `.mcp.json` points local
  sessions at the same project. Remote migration names differ from the repo
  filenames (the connector timestamps its own history); contents are identical.

## Phase 3 — auth + profile bootstrap (shipped)

- RN-correct Supabase client (`src/lib/supabase.ts`): AsyncStorage session
  persistence, auto token refresh, no URL detection. `isSupabaseConfigured()`
  keeps device-only mode working with no `.env` (offline-first).
- Auth store (`src/store/auth.ts`): mirrors the persisted session +
  `onAuthStateChange`; initialized once from the root layout; `signOut()`.
- Account screen: real **email OTP** flow (email → 6-digit code → session) with
  errors inline and every path falling back to "Keep Using This Device" —
  accounts are never forced. On sign-in: `bootstrapProfile` upserts the
  `profiles` row (with the onboarding role) and ensures a free `subscriptions`
  row (both owner-scoped by RLS). `account_created` analytics.
- **One-time dashboard step:** for codes (not links) to arrive, add
  `{{ .Token }}` to the Magic Link email template (Auth → Email Templates) —
  auth email templates aren't editable via the connector.

## Next (Phase F)

RevenueCat SDK (needs API keys) → replace mock board/captures with live
Supabase reads/writes → PostHog adapter for the analytics facade → Apple/Google
sign-in for store builds → community terms page, store metadata, device QA.
