# RigReceipts — Release Readiness

A single place that answers two questions: **what is built and verified**, and
**what still needs a human** (a device, an external account, a decision, or
legal review) before this can ship to the App Store and Google Play.

Everything in "Built & verified" runs through the standard gate on every
commit: `prettier` → `expo lint` → `tsc --noEmit` → `jest` → `expo export`
(iOS + Android). At the time of writing that is **196 unit tests** across 25
suites, both platform bundles exporting clean.

---

## 1. Built & verified (no human needed — done)

### App shell & design system

- Expo SDK 57 / RN 0.86 / React 19 / expo-router, prebuild-ready.
- Industrial Atlas theme tokens, shared components (Marker, Pill, Card,
  MetricTile, RouteBand, GradeBadge, TopoBackground, Screen).
- Five-tab shell (Dashboard, Scan, Loads, Miles, Reports) + onboarding flow
  (splash → role → value → first-job → first-action → reveal → account).

### Domain core (pure TS, unit-tested)

- Canon constants locked against drift: 23 expense categories, 15 scan types,
  `claim_status` enum (`canon.test.ts`).
- RPM cost model (`rpm.ts`), detention (`detention.ts`), entitlements/tiers,
  usage allowances, feature flags.
- Freight Intelligence: rate-check metrics, share-card sanitizer, lane
  aggregates, verification levels, sensitive-text detection, board moderation.
- Reports features shipped this batch — all pure + tested where there's logic:
  - **RPM Coach** — cost-profile editor → break-even / target RPM.
  - **Weekly & monthly grades** — `gradePeriod` letter grading.
  - **CSV export** — RFC-4180 `buildCsv`, shared from Reports.
  - **Broker Check** — driver-private pay-reliability log (flag-gated).
  - **Live capture metrics** (`captureMetrics.ts`) — the first real-data
    (non-mock) surface: month-to-date spend, record counts, and a category
    breakdown computed from the on-device capture queue. Feeds a real
    "This month" card + **Monthly Closeout** modal (month-scoped CSV) on
    Reports and a "Your Receipts" widget on the dashboard.

### Real-data tabs (all five tabs now hold live local data)

- **Scan → captures** — the capture queue is the source of truth for scanned
  receipts (offline-first, syncs to Supabase when signed in).
- **Miles** (`mileage.ts` + trips store) — manual trip entry with loaded /
  deadhead totals and a real **cost-per-mile** for the month (captured
  expenses ÷ entered miles). Live GPS stays out of scope (§2A).
- **Loads** (`loads.ts` + loads store) — load folders with a booked →
  in-transit → delivered → paid lifecycle. Document packets + detention link
  in later (see §3).
- **Reports / Dashboard** — real month-to-date spend, category breakdown, and
  a "Your Receipts" widget, as above.

### Capture pipeline

- Camera + OCR abstraction, receipt parser with fixtures, capture → review
  flow, offline queue that backfills to Supabase when signed in.

### Backend (Supabase — project `kfyzglmphwohbhigvdyy`, ca-central-1)

- Migrations authored for: core schema, RLS, storage buckets, freight
  intelligence + its RLS, RLS hardening/auto-enable, the pg_cron
  lane-aggregate job, and in-app account deletion RPC.
- RLS owner-scoped; SECURITY DEFINER RPCs pinned to `search_path=''`; feed
  never selects `user_id` (locked by a test).
- Live board reads/writes, lane-aggregate reads, and captures/expenses sync
  are wired through the RN Supabase client + auth store (email OTP).

### Integrations (env-gated / lazy so they bundle & test headless)

- Sentry (live DSN), PostHog (HTTP `/batch/` sink), RevenueCat (Test Store
  key) behind a purchases boundary + paywall.

### Legal & store assets (drafts)

- Privacy Policy, Terms of Service, account-deletion doc — `docs/*.md` +
  brand-styled `web/*.html`.
- App Store + Play listing copy under `docs/STORE_METADATA.md` and a
  fastlane-ingestible `fastlane/metadata/` tree (char caps verified).
- Interactive HTML app preview (Artifact) covering the full flow.

---

## 2. Needs a human

Grouped by _what kind_ of human input each item needs. Nothing here can be
finished headless from this environment.

### A. Needs a device / simulator (can't verify here)

- [ ] Run the app on a real iOS + Android device (no simulator in this env).
- [ ] Camera capture + OCR accuracy on real receipts/rate confirmations.
- [ ] **Live mileage / GPS trip tracking** — explicitly on hold. Requires
      background-location entitlements, a foreground service, and battery
      testing that only exist on-device. Nothing is built for it yet, and the
      privacy policy / store metadata deliberately do **not** declare location
      until it is.
- [ ] Push-notification / alert opt-in flows (needs APNs + FCM on device).

### B. Needs an external account or dashboard (decision + credentials)

- [ ] **Apple Developer** + **Google Play Console** enrollment; bundle ID
      `com.rigreceipts.app` registration.
- [ ] **RevenueCat dashboard** — real products/entitlements (current key is a
      Test Store key) and App Store / Play product linking.
- [ ] **EAS** build + submit credentials (dev/preview/production profiles are
      written; no cloud build has run).
- [ ] Confirm all authored **Supabase migrations are applied** to the live
      project and re-authorize the Supabase connector in a fresh session
      (OAuth can't run non-interactively here).
- [ ] Supabase auth email template (`{{ .Token }}`) for the OTP sign-in.

### C. Needs a product/business decision

- [ ] Final free-tier caps beyond the locked 30 GPS trips/month (25 scans /
      5 load folders are flagged _proposals_ in `DECISIONS.md`).
- [ ] Which flags to promote from `off` → `beta`/`production` for launch
      (Freight Intelligence, rate cards, rate board, posting, aggregates,
      Broker Check, revised onboarding are all currently `off`).
- [ ] Pricing confirmation for the paywall tiers.

### D. Needs legal / compliance review

- [ ] Privacy Policy + Terms of Service are **drafts for counsel review** —
      subprocessor list, data-retention, and dispute clauses need sign-off.
- [ ] Hosting for the three `web/*.html` pages (privacy, terms, account
      deletion) at public URLs the store listings can point to.
- [ ] App Store 5.1.1(v) + Play data-safety form answers, matched to the
      final privacy posture.

---

## 3. Next up — needs a product decision on the data model

The headless real-data work is done: all five tabs hold live local data.
What remains is mostly blocked on **how the data model should grow**, which is
a product call, not just wiring:

- **Grades** — `gradePeriod` supports partial scoring, but only **deadhead**
  has a clean signal today (from trips). The other four need model decisions
  first: _rate_ needs a per-load **revenue/rate** field; _fuel_ needs a
  fuel-specific budget split out of the variable CPM; _paperwork_ needs
  **documents linked to loads** (which scans belong to which load); _money
  owed_ needs **detention / lumper / reimbursement** tracking. A one-category
  letter would mislead, so grades stays "Soon" until at least a couple of
  these land.
- **Load packets** — attaching captured BOL/POD/scale/lumper scans to a load,
  plus detention on the load. Needs the capture↔load link decided.
- **Load revenue** — add rate/revenue to a load to unlock real RPM + the rate
  grade.

None of these is hard to build; each just needs you to confirm the shape
(fields, statuses, how captures attach to loads) before I commit to it.

Genuinely decision-free leftovers, if wanted: more domain edge-case tests, or
a README refresh documenting the now-live tabs.

---

_Last updated after the Miles + Loads slices (all five tabs now hold real
local data; 196 tests / 25 suites). Keep the "Needs a human" section honest —
move items to section 1 only once they're actually built **and** pass the
gate._
