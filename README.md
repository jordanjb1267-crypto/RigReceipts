# RigReceipts

**RigReceipts: Truck Expenses** — a trucker-first expense, mileage, load
document, money-owed, and rate-per-mile operating app for iOS and Android.

> Track every receipt, mile, load document, and dollar owed — then know if you
> are running on target.

This repo currently contains the **V2 foundation** (roadmap Phases 0–2):
project scaffold, the Industrial Atlas design system with the 5-tab shell,
the canonical domain core with unit-tested formulas, and the full database
schema as SQL migrations. Product loops (scan/OCR, expenses, loads, money
owed, mileage, RPM Coach, calendar, grades, closeout, subscriptions) land in
later phases — see `docs/DECISIONS.md` for locked decisions and
`supabase/migrations/` for the schema.

## Stack

- **App:** React Native + TypeScript, Expo SDK 57 (prebuild-ready, not Expo
  Go-only), expo-router, react-native-svg, Inter via `@expo-google-fonts`
- **Backend:** Supabase (Postgres, Auth, RLS, Storage) — migrations in
  `supabase/`, not yet applied to a live project
- **State/sync (installed, wired in later phases):** Zustand, TanStack Query,
  `@supabase/supabase-js`
- **Tests:** Jest (`jest-expo`)

## Getting started

```bash
npm install
cp .env.example .env   # fill in Supabase keys when a project exists
npm start              # Expo dev server (i = iOS simulator, a = Android)
```

## Scripts

| Command             | What it does                                  |
| ------------------- | --------------------------------------------- |
| `npm start`         | Expo dev server                               |
| `npm run lint`      | ESLint (expo config + prettier)               |
| `npm run typecheck` | `tsc --noEmit`                                |
| `npm test`          | Jest unit tests (RPM, detention, canon lists) |
| `npm run format`    | Prettier write                                |

## Project structure

```
src/
  app/            expo-router routes — (tabs): Dashboard, Scan, Loads, Miles, Reports
  components/     Industrial Atlas primitives: RouteBand, Card, MetricTile,
                  Pill, Marker, GradeBadge, TopoBackground, Screen
  domain/         canonical constants + pure business logic (unit-tested):
                  categories, scanTypes, claimStatus, entitlements, rpm, detention
  lib/            supabase client factory
  theme/          Industrial Atlas tokens: colors, typography, spacing/radii
supabase/
  migrations/     schema (21 tables), RLS policies, storage buckets
  seed.sql        23 canonical expense categories
docs/
  DECISIONS.md    locked spec decisions + feasibility notes
```

## Design system

**Industrial Atlas** — modern road atlas × operating dashboard. Palette:
Map Ivory `#F4F1E8`, Asphalt Charcoal `#1E2327`, Route Green `#2E6B57`,
Highway Blue `#3D6480`, Fuel Amber `#C8912D`, Clay Rust `#9A5C3A`. Signature
pattern: the **Route Band** status row. No truck clip art, no fake chrome.

## Builds

EAS profiles (`eas.json`): `development` (dev client), `preview` (internal),
`production`. Native OCR/camera/location modules will require
`expo prebuild` + a custom dev client from Phase 6 on.
