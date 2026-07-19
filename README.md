# RigReceipts

**RigReceipts: Truck Expenses** — a trucker-first expense, mileage, load
document, money-owed, and rate-per-mile operating app for iOS and Android.

> Track every receipt, mile, load document, and dollar owed — then know if you
> are running on target.

## Status

All five tabs hold **real, offline-first local data** (persisted, and — where
wired — synced to Supabase). Feature-flagged capabilities are `off` by default
and turn on per environment. `docs/RELEASE_READINESS.md` is the source of
truth for what's built vs. what still needs a device, an account, a decision,
or legal review.

Built and unit-tested today:

- **Scan → captures** — camera + on-device OCR (ML Kit with a stub fallback),
  a heuristic receipt/rate-con parser, review flow, and an offline queue that
  backfills to Supabase when signed in.
- **Reports** — real month-to-date spend, a category breakdown, a **Monthly
  Closeout** (month-scoped CSV export), and **RPM Coach** (cost profile →
  break-even / target RPM).
- **Miles** — manual trip entry with loaded/deadhead totals and a real
  **cost-per-mile** (captured expenses ÷ entered miles). Live GPS is out of
  scope (needs on-device background location).
- **Loads** — load folders with a booked → in-transit → delivered → paid
  lifecycle, per-load revenue/mileage, attached documents, and a
  `load_receivables` money-owed model.
- **Road Grade** (flag-gated) — the five-category operating grade (rate, fuel,
  deadhead, paperwork, money owed) with a weekly/monthly toggle. Missing data
  is never a failing grade; the overall letter is withheld below three
  gradable categories. Reuses the Rate Check / RPM Coach math.
- **Freight Intelligence** (flag-gated) — Rate Check, Rate Sharing Cards with a
  privacy sanitizer, the Community Rate Board, and pseudonymous lane
  aggregates (server pg_cron job).
- **Broker Check** (flag-gated) — a driver-private broker pay-reliability log.
- Sentry, PostHog, and RevenueCat (Test Store) wired behind env-gated adapters.

## Stack

- **App:** React Native + TypeScript, Expo SDK 57 (prebuild-ready), expo-router,
  react-native-svg, Inter via `@expo-google-fonts`
- **Backend:** Supabase (Postgres 17, Auth, RLS, Storage) — migrations in
  `supabase/migrations/`, **applied** to the live project
- **State/sync:** Zustand (persisted stores), TanStack Query,
  `@supabase/supabase-js`
- **Tests:** Jest (`jest-expo`) — 239 unit tests across 27 suites

## Getting started

```bash
npm install
cp .env.example .env   # Supabase URL + anon key, optional analytics/purchase keys
npm start              # Expo dev server (i = iOS simulator, a = Android)
```

## Scripts

| Command             | What it does                    |
| ------------------- | ------------------------------- |
| `npm start`         | Expo dev server                 |
| `npm run lint`      | ESLint (expo config + prettier) |
| `npm run typecheck` | `tsc --noEmit`                  |
| `npm test`          | Jest unit tests                 |
| `npm run format`    | Prettier write                  |

The commit gate is: prettier → `expo lint` → `tsc --noEmit` → `jest` →
`npx expo export --platform ios --platform android`.

## Project structure

```
src/
  app/            expo-router routes — (onboarding), (tabs) Dashboard/Scan/Loads/Miles/Reports,
                  plus modals: rate-card, rate-board, lane-detail, paywall, rpm-coach,
                  broker-check, monthly-closeout, add-trip, add-load, load-detail,
                  road-grade, account-settings
  components/     Industrial Atlas primitives (RouteBand, Card, MetricTile, Pill,
                  Marker, GradeBadge, TopoBackground, Screen, Button, WidgetCard, …)
  domain/         canonical constants + pure, unit-tested business logic:
                  categories, scanTypes, claimStatus, entitlements, rpm, detention,
                  freight, rateBoard(+moderation), captureMetrics, mileage, csv,
                  grades (+ gradeInputs), loads, documents, receivables, brokerCheck
  ocr/            capture OCR engine + receipt/rate-con parsers + fixtures
  data/           TanStack Query hooks + Supabase-backed reads
  store/          persisted Zustand stores: onboarding, captures, trips, loads,
                  loadDocs, receivables, truckProfile, costProfile, entitlements, auth, …
  config/         feature flags
  analytics/      typed event catalog + PostHog sink behind track()
  lib/            supabase client, sentry
  theme/          Industrial Atlas tokens
supabase/
  migrations/     schema, RLS, storage, freight, lane-aggregate job, account
                  deletion, and the grades migration (load revenue, receivables,
                  document workflow, truck MPG)
docs/
  RELEASE_READINESS.md   what's built vs. what needs a human
  DECISIONS.md           locked spec decisions
  OCR_SPIKE.md           scan/OCR approach + on-device test steps
  PRIVACY_POLICY.md · TERMS_OF_SERVICE.md · ACCOUNT_DELETION.md · STORE_METADATA.md
```

## Design system

**Industrial Atlas** — modern road atlas × operating dashboard. Palette:
Map Ivory `#F4F1E8`, Asphalt Charcoal `#1E2327`, Route Green `#2E6B57`,
Highway Blue `#3D6480`, Fuel Amber `#C8912D`, Clay Rust `#9A5C3A`. Signature
pattern: the **Route Band** status row. No truck clip art, no fake chrome.

## Builds

EAS profiles (`eas.json`): `development` (dev client), `preview` (internal),
`production`. Native OCR/camera modules require `expo prebuild` + a custom dev
client; a cloud EAS build/submit hasn't been run yet.
