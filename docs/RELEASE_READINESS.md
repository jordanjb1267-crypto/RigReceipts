# RigReceipts — Release Readiness

A single place that answers two questions: **what is built and verified**, and
**what still needs a human** (a device, an external account, a decision, or
legal review) before this can ship to the App Store and Google Play.

Everything in "Built & verified" runs through the standard gate on every
commit: `prettier` → `expo lint` → `tsc --noEmit` → `jest` → `expo export`
(iOS + Android). At the time of writing that is **232 unit tests** across 26
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
  - **Road Grade** (flag-gated `road_grade_enabled`) — the full five-category
    operating grade (rate, fuel, deadhead, paperwork, money owed). Each
    category returns a letter + operational reason or a precise "what to add";
    missing data is never a failing grade (proven by tests) and the overall
    letter is withheld below three gradable categories. Reuses the Rate
    Check / RPM Coach math — no competing rate engine. Fed by load revenue,
    the trip ledger, fuel captures, load-attached documents, a
    `load_receivables` model, and a truck MPG profile.
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
      Broker Check, Road Grade, revised onboarding are all currently `off`).
- [ ] Pricing confirmation for the paywall tiers.

### D. Needs legal / compliance review

- [ ] Privacy Policy + Terms of Service are **drafts for counsel review** —
      subprocessor list, data-retention, and dispute clauses need sign-off.
- [ ] Hosting for the three `web/*.html` pages (privacy, terms, account
      deletion) at public URLs the store listings can point to.
- [ ] App Store 5.1.1(v) + Play data-safety form answers, matched to the
      final privacy posture.

---

## 3. Next up — mostly polish, some needs a human

The Road Grade data model is now built (load revenue/mileage, a
`load_receivables` child model, load-attached documents with a workflow
status, and a truck MPG profile). Remaining items:

- **Migration `20260719000009_grades.sql` — applied ✓** to the live project
  (`kfyzglmphwohbhigvdyy`). All nine migrations are now in the remote history;
  `load_receivables` has RLS + its owner policy, and the security advisor
  flagged nothing new (the two standing notices are the intentional
  service-role moderation table and the guarded account-deletion RPC).
- **Promote `road_grade_enabled`** from `off` once validated on a device
  (§2C — which flags ship on).

Both prior headless polish items are now **done**: captured scans can be filed
under a load (a BOL/POD then counts toward its paperwork automatically), and
Road Grade has a **This month / Last 7 days** toggle. What's left there is a
device-gated on-ramp — attaching a scan to a load _from the Scan/review flow_
at capture time (rather than pulling it in from the load detail screen).

The only genuinely decision-free leftover is a README refresh documenting the
now-live tabs and the Road Grade.

---

_Last updated after auto-linking scans to loads + the weekly/monthly Road
Grade toggle (239 tests / 27 suites). Keep the "Needs a human" section honest
— move items to section 1 only once they're actually built **and** pass the
gate._
