# RigReceipts V2 — Locked Decisions

This file canonicalizes the choices made after reviewing the three V2 spec
documents (`rigreceipts_v2_master_build_prompt.md`, `rigreceipts_v2_agent_build_roadmap.md`,
`rigreceipts_v2_product_loops.md`), which disagreed with each other in a few
places. Where a decision matters to code, a canon test in
`src/domain/__tests__/canon.test.ts` locks it against accidental drift.

## 1. Expense categories — the Master Build Prompt's 23

The three docs listed 23, 22, and 20 categories. **Canon: the Master's 23**
(the superset), seeded in `supabase/seed.sql` and mirrored in
`src/domain/categories.ts`:

fuel, def, repairs, maintenance, tires, parts, tolls, parking, scales,
truck_wash, trailer_washout, meals, showers, laundry, lodging, phone_internet,
eld_software, insurance, permits_registration, truck_supplies,
trailer_expenses, lumper, misc.

## 2. Money-owed status enum

The docs varied between `reimbursed`, `paid`, and `paid/reimbursed` as the
terminal state. **Canon:** one Postgres enum `claim_status`, shared by lumper
reimbursements and detention claims:

`pending → submitted → approved → reimbursed | denied`

## 3. Scan types — 15, hotel/lodging included

The Master's 15 scan types are canon (`src/domain/scanTypes.ts`); the other two
docs dropped "hotel" even though lodging is a first-class expense category:

receipt, fuel, repair_invoice, lumper, bol, pod, scale_ticket, toll, parking,
meal, shower, hotel, permit, inspection, other.

## 4. RPM cost model (closes the spec's formula gap)

The spec's revenue formula referenced an undefined "variable cost per mile"
that overlapped "total weekly expenses". **Canon decomposition:**

- **Fixed weekly costs** (time-based): truck/trailer payments, insurance,
  permits/registration amortized, ELD/software, phone/internet.
- **Variable cost per mile**: fuel, DEF, maintenance/tire reserves,
  repairs rolling average, tolls/scales averaged per mile.

Formulas (implemented + unit-tested in `src/domain/rpm.ts`):

```
breakEvenAllMileRPM = (fixedWeekly + variableCPM × totalMiles) ÷ totalMiles
weeklyRevenueNeeded = fixedWeekly + variableCPM × projectedTotalMiles + driverPay + profitReserve
targetLoadedRPM     = weeklyRevenueNeeded ÷ expectedLoadedMiles
trueCostPerMile     = period expenses ÷ period miles   (actuals metric only)
```

`trueCostPerMile` is never fed back into the target formula, so fixed costs
are not double-counted. Load Rate Check verdicts: `above_target | on_target |
below_target | below_break_even` (break-even evaluated on ALL miles, target on
loaded miles, ±2% default tolerance).

Detention (`src/domain/detention.ts`): `max(0, departure − arrival − free time)
× hourly rate`, **prorated to the minute**, rounded to cents; the spec-required
manual override always wins. Estimates always carry the disclaimer copy.

## 5. Free-tier caps

Numbers stated anywhere in the spec docs are canon; the rest are **proposals**
(flagged in `src/domain/entitlements.ts`) that can be tuned without schema
changes:

| Cap                 | Value | Source                    |
| ------------------- | ----- | ------------------------- |
| GPS trips / month   | 30    | Roadmap Phase 10 (stated) |
| Scans / month       | 25    | PROPOSED                  |
| Active load folders | 5     | PROPOSED                  |

Feature gates from the Master's upgrade moments: unlimited scans, load-packet
export, detention/lumper history → **Driver Pro**; RPM Coach, grades, closeout,
monthly report export → **Owner-Operator**; multi-truck → **Fleet Lite**
(2 trucks included, extras $4/mo or $39/yr).

## 6. Data model

- **No `users` table.** Supabase manages `auth.users`; `profiles` (PK = auth
  user id) is the app-side record.
- **`document_scans` is the capture record** (image path, OCR text, scan type,
  review status). `receipts` link a scan to an expense; `load_documents` link a
  scan to a load. Storage paths live on the scan.
- **`expense_categories` is global read-only** reference data (RLS: select for
  authenticated, no client writes).
- Storage buckets `receipts`/`documents`/`reports` are private, with per-user
  folder policies (`{auth.uid()}/...`).

## 7. Visual authority

The Master doc's Industrial Atlas token table governs; the HTML mockup
(`rigreceipts_industrial_atlas_mockup.html`) is **reference only**. Adopted
mockup extras: paper `#FBF8EF`, paper-2 `#E8E3D6`, alert red `#A94A3B`,
slate-2 `#53616A`, 28/18/12 radius scale, Inter with tabular numerals, subtle
topo-line SVG background. Tokens live in `src/theme/`.

---

# Feasibility notes (from the spec review)

- **OCR under Expo is the biggest technical risk.** VisionKit (iOS) and ML Kit
  (Android) require config plugins + a custom dev client — no Expo Go. Plan a
  spike (community module such as `@react-native-ml-kit/text-recognition` vs
  custom native module vs server-side Cloud Vision fallback) before Phase 6.
- **Google Maps scope trimmed.** Only Places autocomplete has a clear V1 use;
  Routes/Geocoding deferred until a concrete need appears.
- **External accounts required before launch phases:** Apple Developer,
  Google Play Console, EAS, Supabase project, RevenueCat, Sentry, PostHog.
  None are wired yet; migrations in `supabase/migrations/` have not been
  applied to a live project.
