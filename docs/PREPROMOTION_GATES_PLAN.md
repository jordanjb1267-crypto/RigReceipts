# Pre-promotion gates plan

Bounded successor of accepted candidate `fd19cafa8fa1ecc8ddf88a95c3cec8949fd4ef77`.
Not a product-feature pass. Not FreightOS / InterBraid / Pass20J.

## B1. Clock-freshness hardening

Keep the accepted clock contract: explicit finite `nowMs`, real init, no epoch-0
fallback, derived urgency only, no financial or LoadStatus writes.

Today `subscribeProductNow` arms one `setTimeout(0)` per hook and then freezes.
A long foreground session can therefore miss a day-scale aging flip.

Smallest repository-native change, in `src/data/productNow.ts` only:

1. Keep module-init `Date.now()` as the real initial value.
2. While any `useSyncExternalStore` subscriber is attached, hold **one** shared
   `AppState.addEventListener('change')` (same API already used by Quick Present)
   and refresh on `'active'`.
3. While any subscriber is attached, hold **one** shared chained `setTimeout`
   at `PRODUCT_NOW_FOREGROUND_CADENCE_MS = 3_600_000` (1 hour).
4. Tear both down when the last subscriber unsubscribes.
5. Refresh only calls `captureProductNowMs(Date.now())` and notifies listeners.

Cadence rationale: receivable age is `floor((now − due) / 86_400_000)` with a
30-day grace. This is not a visible clock. One hourly timeout is cheap, is not
a display-rate timer, and bounds foreground lag after a calendar-day crossing
to less than one hour. Resume refresh covers background → foreground immediately.

No new scheduler framework. No persistence. No network.

## B2. Non-production product QA harness

The repo has no Playwright, Maestro, Detox, Storybook, or RN render harness.
Expo web exists but tabs are gated on onboarding hydration; exercising them
would require inventing session/onboarding state. Device QA therefore uses the
existing headless pattern: real domain + real local stores + source contracts
for the screens that render those view-models.

Add local representative fixtures (not production accounts) and a harness that
drives the same functions the UI already calls:

- `groupLoadsForList` / `loadListGroupFor`
- `deriveActionItems` / `launchAction`
- `buildLoadEconomicsPacket`
- `attachConfirmedCaptureToLoad`
- `loadMileage` vs planned miles

Scenarios 1–8 are asserted there. Screenshots from a real device/simulator are
not claimed unless an Expo session is actually established.

## B3. Tests required

Clock (`src/data/__tests__/productNow.test.ts`):

- A init finite / not epoch 0
- B explicit capture rejects NaN / Infinity
- C simulated foreground/resume advances the clock
- D bounded timer refresh advances the clock
- E multiple subscribers share one AppState listener and one cadence timer
- F last unsubscribe tears scheduling down
- G pending receivable crossing `>30` days flips derived urgency without
  mutating stored status

Harness: Saved / Active / Needs Action / delivered / Closed / packet /
contextual scan / Live Mileage, plus source contracts for section titles,
confirm-before-save, and no background-location start on the Live Mileage screen.

## B4. Exact files expected to change

- `docs/PREPROMOTION_GATES_PLAN.md` (this plan)
- `src/data/productNow.ts`
- `src/data/__tests__/productNow.test.ts`
- `src/data/productQaFixtures.ts`
- `src/domain/__tests__/productQaHarness.test.ts`

## B5. Explicit untouched / protected areas

- `supabase/migrations/**`
- `src/config/flags.ts` (all defaults remain `off`)
- Carrier Packet lifecycle, snapshots, RLS, DocumentVersion identity
- Road Wallet document identity
- Canonical 15 scan types
- FreightOS / InterBraid / Responsibility
- `evaluated != booked` grouping rules (already accepted)
- `externallyDelivered` / `recipientAccepted` (remain false)
- planned miles ≠ Live Mileage ≠ paid miles
- No production network capability
- No new global scheduling framework
