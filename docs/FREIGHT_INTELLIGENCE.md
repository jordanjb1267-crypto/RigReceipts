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

## Phase F — live Community Rate Board (shipped)

The board now runs against the live backend (`src/data/rateBoardApi.ts`):

- **Reads:** signed-in users get the real `rate_board_posts` feed (published
  posts, newest first; RLS filters removed posts and blocked contributors
  server-side). Signed-out / device-only users see the sample board, now
  labeled **"Sample data"** on the feed. Lane detail computes its snapshot from
  the same source as the feed.
- **Contributor privacy (Section 22):** the feed never selects `user_id` — a
  locked test asserts it. Posts carry a pseudonymous alias
  (`contributorAliasFor`) that is **stable per user per lane** (so the
  ≥3-contributor threshold and de-domination stay correct) but different across
  lanes, so a contributor can't be followed lane to lane, and one-way (FNV-1a
  over a 122-bit uuid).
- **Posting:** after the Section-21 checks pass, the card is re-sanitized with
  `isPublic` and published as `rate_share_cards` (private, owner-scoped) +
  `rate_board_posts` (denormalized privacy-safe snapshot). The DB check
  constraint independently rejects self-entered publishes. Posting requires an
  account ("community posts need moderation"); a server failure shows an honest
  "Couldn't reach the community board" state — never a fake success.
- **Safety writes:** Report files a `rate_post_reports` row (slugs match the
  `rate_report_category` enum; repeat reports no-op) and Block writes
  `rate_board_blocks` (immediate local hide + durable RLS exclusion). Hide
  stays local-only by design.
- Pre-launch hardening noted for the controlled beta: `user_id` is still a
  selectable column on published rows at the API layer (row-level RLS only);
  move the feed behind a column-hiding view or RPC before public launch
  (Section 51 gate).

## Analytics — PostHog (shipped)

The `track()` facade now has a real sink (`src/analytics/posthog.ts`):

- **HTTP batch capture, no native module** — posts to PostHog's `/batch/`
  endpoint via `fetch`, so it stays Hermes-safe, prebuild-free, and unit-tested
  (pure `buildBatchPayload` + a queue/flush factory with injectable fetch/clock).
  Events queue and flush in batches; a failed flush requeues (capped) so a brief
  outage doesn't drop events. Same swap-a-provider pattern as the purchases
  adapter — moving to `posthog-react-native` later only touches this file.
- **Env-gated** — `initAnalytics()` (called from the root layout) wires the sink
  only when `EXPO_PUBLIC_POSTHOG_KEY` is set; with no key the facade keeps its
  dev logger and nothing leaves the device. Host defaults to US cloud;
  `EXPO_PUBLIC_POSTHOG_HOST` switches to EU.
- **Distinct id** — Supabase user id when signed in, else a persisted anonymous
  device id; on sign-in it emits `$identify` aliasing the anon id to the user so
  pre-account events stay attached. Never a name/email/document content — the
  facade's existing allow-list rules still apply.

## Purchases — RevenueCat (shipped, Test Store)

The purchases boundary now resolves to a real RevenueCat adapter
(`src/payments/purchases.ts`), replacing the sandbox-only path:

- **`react-native-purchases` 10.4.3**, required **lazily** inside the adapter's
  methods so tests and the Metro bundle never touch the native module.
  Autolinked under prebuild — no config plugin, but it needs a native build
  (not Expo Go), which the app already required (camera, ML Kit, Sentry native).
- **Env-gated key selection** (pure, tested): platform keys win
  (`EXPO_PUBLIC_REVENUECAT_IOS_KEY` `appl_…`, `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`
  `goog_…`), else a shared `EXPO_PUBLIC_REVENUECAT_KEY`. A `test_…` key drives
  RevenueCat's **Test Store** — a simulated purchase modal, no App Store / Play
  setup — and the paywall labels the mode honestly (Test Store vs live vs the
  local sandbox fallback when no key is set).
- **Pure, tested mapping:** `entitlementToTier` resolves the highest active RC
  entitlement to a `Tier`; `findPurchasePackage` picks `${tier}_${term}` then
  the standard package type. The dashboard must use entitlement identifiers
  `driver_pro` / `owner_operator` / `fleet_lite` / `lifetime`.
- **Adapter behavior:** `purchase` configures once, reads the current offering,
  buys the package, and grants the tier from the resulting entitlements;
  cancellation or a store error keeps the caller on their tier. `restore` maps
  restored entitlements the same way. All owner-scoped by the store account.

Runtime verification (the Test Store modal, real entitlement grants) needs a
native dev build with the key set — it can't run in this headless environment.

## Captures sync — Supabase (shipped)

The offline capture queue now backs up to the live backend
(`src/data/captureSync.ts`):

- **Storage + rows:** each capture uploads its image to the private `receipts`
  bucket under `{userId}/…` (RN-safe `fetch(uri).arrayBuffer()` upload), records
  a `document_scans` row (`review_status: 'confirmed'` — the review sheet already
  required a confirm), and, when the scan type maps to a category and an amount
  exists, an `expenses` row linked to the scan. Verified live: `document_scans`
  and `expenses` are RLS-enabled with owner-scoped policies and the `receipts`
  bucket enforces the per-user folder, so every write is authorized as the
  caller.
- **Scan-type → category** is a pure, canon-tested domain map
  (`scanTypeToExpenseCategory`): fuel→fuel, hotel→lodging, scale_ticket→scales,
  permit→permits_registration, receipt/other→misc, …; document-only scans
  (BOL/POD/inspection) map to `null` and never create an expense.
- **Offline-first:** captures still save locally first. A save triggers an
  immediate best-effort sync when signed in; anything that fails stays
  `pending_sync` and a startup/sign-in **backfill** (`initCaptureSync`, guarded
  against concurrent runs) retries the queue. The scan confirmation copy now
  reflects account backup vs device-only.

Runtime verification (real image upload, row creation) needs a native build with
a signed-in session — it can't run in this headless environment; the pure
mapping/path/content-type helpers are unit-tested.

## Lane aggregates — server job (shipped, LIVE)

`lane_rate_aggregates` is now recomputed server-side
(`supabase/migrations/20260718000007_lane_aggregate_job.sql`), moving the lane
snapshot off the client's view of the feed:

- **`recompute_lane_rate_aggregates(window_days)`** replicates
  `computeLaneAggregate` exactly — eligible = published, not removed,
  verification `<> self_entered`, both RPMs present, within the window;
  `>= 7` posts AND `>= 3` contributors; **per-contributor de-domination**
  (each contributor reduced to the `floor(n/2)` post after sorting by
  verification weight desc then all-mile RPM asc); medians via
  `percentile_cont(0.5)` (= the JS median); the same confidence bands. Verified
  against the client algorithm on synthetic data — identical representatives,
  medians, range, and threshold behavior (including the mixed-verification pick
  and below-threshold exclusion).
- **Security:** `SECURITY DEFINER` (bypasses RLS to read every contributor's
  posts and rewrite the cache) with a pinned empty `search_path` and `EXECUTE`
  revoked from `public`/`anon`/`authenticated`, so only the cron job / service
  role can run it. The security advisor is clean.
- **Scheduled** via `pg_cron`, hourly at `:17`, over the trailing 30 days.
  Applied to the live project; the function runs clean (0 rows today — no real
  published posts yet) and the job is registered and active.

Follow-up: point lane-detail at `lane_rate_aggregates` (public, PII-free read)
instead of computing from the feed, once the window label is reconciled.

## Next

RevenueCat dashboard products/entitlements/offering + App Store Connect / Play
Console setup for production keys → Apple/Google sign-in for store builds →
community terms page, store metadata, device QA.
