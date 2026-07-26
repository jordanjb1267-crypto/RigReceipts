# RigReceipts — Final Production Launch Audit

The single source of truth for **what is built and verified** vs. **what still
stands between us and a public App Store / Google Play launch**. Everything in
§1 passes the standard gate on every commit — `prettier` → `expo lint` →
`tsc --noEmit` → `jest` → `expo export` (iOS + Android). As of this writing:
**270 unit tests across 31 suites**, both platform bundles exporting clean.

The honest headline: **the app is code-complete and green for a V1 feature set.
Nothing left is a coding problem you can watch me finish here — everything
remaining needs a device, an paid account, a credential, a human decision, or a
lawyer.** The rest of this doc is that list, ordered so you can execute it.

---

## 1. Built & verified (headless-complete — done)

### App shell, design system, navigation

- Expo SDK 57 / RN 0.86 / React 19 / expo-router, prebuild-ready.
- **"Night Atlas" dark theme** (design handoff) — Fuel Amber `#D9852B` primary
  action on a `#12171A` canvas; Inter + JetBrains Mono; the road-stem `BrandMark`
  SVG; shared components (Marker, Pill, Card, MetricTile, RouteBand, GradeBadge,
  WidgetCard, TopoBackground, Screen, Button, BrandMark, SetupChecklist) all on
  one dark token path.
- Five-tab shell (Dashboard, Scan, Loads, Miles, Reports; Scan is a normal tab,
  no elevated button) + full onboarding (splash → role → value → first-job →
  first-action → reveal → account) with the driver-confirmed rate-check flow,
  the "finish setting up" activation checklist, and the four-up Road Board.

### Domain core (pure TS, unit-tested)

- Canon locked against drift: 23 expense categories, 15 scan types,
  `claim_status` enum.
- RPM cost model, detention math, entitlements/tiers, usage caps, feature flags
  (FNV-1a percentage bucketing).
- Freight Intelligence: rate-check metrics, share-card sanitizer, lane
  aggregates, verification levels, sensitive-text detection, board moderation.
- Reports: RPM Coach, the five-category **Road Grade** (honest missing-data —
  never an F, overall withheld under 3 gradable categories), CSV export
  (RFC-4180), Broker Check, live capture metrics + Monthly Closeout.

### Live Mileage (V1 core — built, flag-gated, device-QA pending)

- Driver-confirmed session/segment state machine (Start → Going to Pickup →
  Deadhead → I'm Loaded → Loaded → Mark Delivered → What's Next) with five
  mutually-exclusive accounting categories; manual entry uses the same model.
- Screens: `live-mileage` (control flow), `mileage-review` (timeline +
  corrections + unclassified review), Miles-tab report (§16), Road Board widget.
- Profitability integrations: load detail actual loaded/deadhead/total miles +
  actual all-mile RPM; Road Grade prefers segment-derived business miles (one
  source, never double-counted).
- **GPS distance adapter** — `domain/geo.ts` (haversine + anti-fabrication
  accumulator: gap re-anchoring, jitter/accuracy/spike rejection) and
  `location/mileageTracker.ts` (lazy-required `expo-location` /
  `expo-task-manager`; foreground start/stop wired into the screen; background
  task path behind its own flag). GPS never asserts freight status.

### Real-data tabs (all five hold live local data, offline-first)

- Scan→captures queue (syncs to Supabase when signed in), Miles (manual trips +
  real cost-per-mile), Loads (booked→in_transit→delivered→paid), Reports /
  Dashboard (real month-to-date spend + breakdown + "Your Receipts").

### Capture pipeline

- Camera + OCR abstraction (ML Kit, lazy-required with a stub fallback), receipt
  + rate-con parsers with fixtures, capture→review flow, offline backfill queue.

### Backend (Supabase — project `kfyzglmphwohbhigvdyy`, ca-central-1)

- Migrations authored **and applied** for: core schema, RLS, storage buckets,
  freight intelligence + RLS, RLS auto-enable hardening, pg_cron lane-aggregate
  job, account-deletion RPC, grades, and live-mileage sessions/segments.
- Owner-scoped RLS everywhere; SECURITY DEFINER RPCs pinned to `search_path=''`;
  feed never selects `user_id` (locked by a test). Advisors clean except two
  intentional standing notices (service-role moderation table; guarded
  account-deletion RPC).
- Live board reads/writes, lane-aggregate reads, captures/expenses sync wired
  through the RN Supabase client + auth store (email OTP).

### Integrations (env-gated / lazy — bundle & test headless)

- Sentry (live DSN), PostHog (`/batch/` HTTP sink), RevenueCat (**Test Store**
  key) behind a purchases boundary + paywall.

### Legal & store assets (drafts)

- Privacy Policy, Terms of Service, account-deletion doc — `docs/*.md` +
  brand-styled `web/*.html`.
- App Store + Play listing copy (`docs/STORE_METADATA.md` + fastlane tree, char
  caps verified). Interactive HTML preview (Artifact).

---

## 2. The launch-blocking path (needs a human)

Nothing below can be finished from this environment. Grouped by the kind of
input required.

### A. Device + on-device QA — _you, a phone, ~a few days_

- [ ] Run on a real iOS **and** Android device (no simulator here).
- [ ] Camera capture + OCR accuracy on real receipts / rate confirmations.
- [ ] **Live Mileage §18 QA matrix** — the big one. Validate the GPS adapter
      on-device: foreground distance vs. truck odometer over real drives; the
      accounting-category flow end to end; permission prompts (when-in-use, then
      Always for background); Android foreground-service notification; battery
      draw; then background tracking via a custom dev client. Only after this
      passes do the mileage flags flip on.
- [ ] Push-notification / alert opt-in (needs APNs + FCM on device).

### B. External accounts + credentials — _you, paid signups_

- [ ] **Apple Developer Program** ($99/yr) + **Google Play Console** ($25 once);
      register bundle/package `com.rigreceipts.app`.
- [ ] **EAS** cloud build + submit (profiles are written; no cloud build has run
      — the environment can't reach `api.expo.dev`). Run `eas build` +
      `eas submit` from your machine.
- [ ] **RevenueCat dashboard** — create real products/entitlements
      (`driver_pro`, `owner_operator`, `fleet_lite`, `lifetime` — identifiers
      already mapped in code), link App Store / Play products, swap the Test
      Store key for live platform keys.
- [ ] **Supabase**: re-authorize the MCP connector in an interactive session
      (OAuth can't run here), then set the **auth email OTP template** to
      include `{{ .Token }}`. Migrations are already applied.
- [ ] Store the production secrets as EAS env vars: `EXPO_PUBLIC_SUPABASE_URL`,
      `EXPO_PUBLIC_SUPABASE_ANON_KEY`, RevenueCat keys, Sentry DSN, PostHog key,
      and the `EXPO_PUBLIC_FF_*` flag promotions.

### C. Product / business decisions — _you_

- [ ] **Which flags ship on.** All new work defaults `off`. For launch decide
      each: `live_mileage_core_enabled`, `background_mileage_tracking_enabled`,
      `road_grade_enabled`, `freight_intelligence_enabled`,
      `rate_sharing_cards_enabled`, `community_rate_board_enabled`,
      `community_rate_posting_enabled`, `lane_aggregates_enabled`,
      `broker_check_enabled`, `revised_onboarding_enabled`. (My recommendation
      lives in the summary below.)
- [ ] **Pricing** confirmation for the paywall tiers.
- [ ] **Free-tier caps** beyond the locked 30 GPS trips/month (25 scans / 5 load
      folders are flagged _proposals_ in `DECISIONS.md`).

### D. Legal / compliance — _counsel + you_

- [ ] Entity name, address, and contact emails to fill the placeholders in the
      privacy policy, terms, and account-deletion doc.
- [ ] **ToS §15 governing law** is a literal `[Placeholder — set with counsel]`.
- [ ] Counsel review of Privacy Policy + ToS: subprocessor list (Supabase,
      PostHog, Sentry, RevenueCat, Apple, Google), data-retention, dispute/
      arbitration clauses; sign DPAs with each subprocessor.
- [ ] **Host the three `web/*.html` pages** (privacy, terms, delete-account) at
      public URLs the store listings point to.
- [ ] **App Store privacy label** + **Google Play Data Safety** form. Critical
      nuance: **once Live Mileage GPS ships, both forms must declare precise
      location** (collected, used for app functionality, not for tracking, not
      sold). Today's drafts deliberately omit location — flip that declaration
      in the **same** release that flips `live_mileage_core_enabled` on. If you
      launch V1 with the mileage flag off, keep location out of the forms.

---

## 3. Suggested launch runbook (order of operations)

1. **Decide the V1 flag set** (§2C) — this determines what the store forms and
   review must cover.
2. **Enroll** Apple + Google + finalize RevenueCat products (§2B).
3. **Fill legal placeholders + host the web pages** (§2D); start counsel review
   in parallel — it's usually the long pole.
4. **`expo prebuild`** locally, then an **EAS internal/preview build**.
5. **On-device QA** (§2A) against that build; iterate. Gate the mileage flags on
   passing the §18 matrix.
6. **Finalize privacy label / data-safety** to match the shipped flag set (§2D).
7. **Production EAS build + submit** to TestFlight / Play internal testing.
8. Beta cohort → fix → **submit for review** → release.

---

## 4. Post-launch / V1.1 (not blocking)

- Automatic trip detection, pickup/delivery geofence suggestions, odometer
  reconciliation, advanced GPS-gap reconstruction, battery/background hardening,
  team-driver automation (all flag-gated, off).
- Rate Sharing Card explicit "Actual all-mile RPM" estimated-vs-actual label.
- Attaching a scan to a load from the Scan/review flow at capture time.

---

_Last updated after the Live Mileage GPS distance adapter (270 tests / 31
suites). Keep §2 honest — an item moves to §1 only once it's built **and** green
through the gate._
