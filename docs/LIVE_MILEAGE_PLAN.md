# Live Mileage Core — V1 Integration Plan

The required first engineering output (build prompt §22), plus the phased scope
(§23). This is an **additive** integration: the existing mileage, load, RPM,
reporting, and Freight Intelligence systems remain the source of truth and are
extended, not replaced.

## 1. Current mileage implementation

- **Domain** `src/domain/mileage.ts` — pure `summarizeTrips` (loaded / deadhead
  / total + deadhead share), `costPerMile`, `tripsInRange`. Trip shape is flat:
  `{ loadedMiles, deadheadMiles, date, createdAt }`.
- **Store** `src/store/trips.ts` — a flat, persisted manual-trip ledger. No
  sessions, no per-mile segments, no accounting categories beyond
  loaded/deadhead, no load association.
- **Screens** `src/app/(tabs)/miles.tsx` (totals + monthly cost-per-mile + trip
  list) and `src/app/add-trip.tsx` (date, loaded, deadhead, note).

## 2. Current live/background location capabilities

**None.** No `expo-location`, `expo-task-manager`, or any geolocation code is
present. Real GPS distance and background tracking are greenfield and must be
built + validated on a physical device — they are the device-gated tail of
this feature.

## 3. Existing load-status model

`src/domain/loads.ts` — lifecycle `booked → in_transit → delivered → paid`
(`LOAD_STATUSES`, `isCompletedLoad`, `nextLoadStatus`). `src/store/loads.ts`
exposes `updateLoad` / `setStatus` and per-load `grossRate`, `loadedMiles`,
`deadheadMiles`. Live Mileage drives these transitions via the existing API
(no new load-status system).

## 4. Mileage → RPM dependencies

`src/domain/rpm.ts` (`checkLoadRate`) and `src/domain/freight.ts`
(`analyzeRateCheck`, `estimateAllMileTargets`) are the one rate/RPM engine.
`src/domain/gradeInputs.ts#deriveLoadRate` already reuses `analyzeRateCheck`.
Live Mileage feeds **actual** loaded/deadhead miles into these same functions —
it does **not** add a second RPM engine.

## 5. Mileage → report dependencies

`miles.tsx` computes month cost-per-mile from trips + fuel captures; the
Deadhead grade (`grades.ts#gradeDeadhead`, via `assembleGradeInputs`) reads
deadhead/total from the trip ledger. Both will read the new segment breakdown
through a single aggregation so nothing double-counts.

## 6. Existing manual mileage features

`add-trip.tsx` + `trips` store (loaded + deadhead only). V1 keeps manual entry
but routes it through the **same segment model** as Live Mileage (§1A), so
manual and tracked miles feed identical calculations.

## 7. Database changes required (additive, reversible, RLS)

Reuse `mileage_trips` for legacy manual trips; add two tables (build prompt
§12), owner-scoped RLS mirroring every other user table, FKs reusing
`trucks`/`loads`:

- `mileage_sessions` — id, owner_id, vehicle_id, started_at, ended_at,
  tracking_mode, source, total_tracked_miles, reconciliation_status, timestamps.
- `mileage_segments` — id, session_id, owner_id, vehicle_id, load_id,
  started_at, ended_at, start/end location, calculated_miles, adjusted_miles,
  accounting_category, business_subtype, trailer_configuration,
  classification_source, classification_confidence, user_confirmed, timestamps.

Derived values (RPM, rate status) are **not** stored — computed from miles +
targets, one source of truth.

## 8. Which V1 requirements already exist

- Load model + lifecycle, load↔mileage association fields.
- The one RPM/rate engine, the Deadhead grade, the Rate Sharing Card sanitizer.
- A Miles tab, a Road Board on the dashboard, manual mileage entry, an
  offline-first persisted-store pattern, and the feature-flag system.

## 9. Which V1 requirements need extension / new build

- The **session + segment state model** (new) and its transitions
  (Start → Going to Pickup → Deadhead → I'm Loaded → Loaded → Mark Delivered →
  What's Next), with the five mutually-exclusive accounting categories.
- Manual Live Mileage controls, the daily timeline + segment corrections, and
  the unclassified-review workflow.
- A single mileage aggregation feeding loads / RPM / reports / Deadhead grade /
  estimated-vs-actual / Rate Sharing Cards.
- A location-source abstraction (foreground distance accumulator now; real
  GPS + background behind flags after device validation).

## 10. Which advanced features stay feature-flagged

`background_mileage_tracking_enabled`, `automatic_trip_detection_enabled`,
`mileage_geofence_suggestions_enabled`, `odometer_reconciliation_enabled` —
all default **off**; `live_mileage_core_enabled` gates the manual core (off in
the repo default per our convention; **production sets it on**).

## 11. iOS background limitations

Background location requires the **Always** authorization + the location
background mode + a `NSLocationAlwaysAndWhenInUseUsageDescription` string;
iOS may suspend or throttle updates, and significant-location / region
monitoring behaves differently from continuous updates. Continuous background
GPS needs `expo prebuild` + a custom dev client and must be validated per
device/OS. Not a V1 blocker — manual sessions work without it.

## 12. Android background limitations

Android 10+ requires `ACCESS_BACKGROUND_LOCATION` (separate, second-step
grant), a **foreground service** with a persistent notification for reliable
background tracking, and is subject to Doze / OEM battery killers. Also needs a
custom dev client. Not a V1 blocker.

## 13. Risks that could delay V1 (and mitigations)

- **Background GPS reliability across OEMs** → keep it flag-gated; ship the
  manual core; disclose the limitation.
- **Double-counting** legacy trips vs. new segments → a single aggregation
  chooses one source (segments when the core flag is on) — never sums both.
- **Battery drain** from continuous GPS → reasonable production settings;
  optimize post-launch, don't block on perfection.
- **Physical-device QA** (§18) is genuinely required and is the user-gated
  gate before flipping the flags on — this cannot be done in this environment.

## 14. Phased scope

**V1 required (headless-buildable here):** the segment/session model + state
machine, manual controls, timeline + corrections, unclassified review, manual
entry through the segment model, and all profitability/report/grade/rate-card
integrations. `live_mileage_core_enabled` is the gate.

**V1 beta (flagged, needs device validation):** basic background GPS distance
accumulation, offline queue + resync.

**V1.1:** automatic trip detection, pickup/delivery geofence suggestions,
odometer reconciliation, advanced GPS-gap reconstruction, smarter deadhead
suggestions, battery/background hardening, team-driver automation.

**Non-negotiables (build prompt §24):** GPS never proves freight status; no
auto "loaded" without confirmation; post-delivery miles start `unclassified`,
never auto-deadhead; categories are mutually exclusive; bobtail is a trailer
attribute, not a mileage category; unclassified miles stay visible; no
fabricated gap distance; one RPM engine; one mileage model.

---

_Implementation proceeds in the §23 order. This environment can build and unit-
test everything through the integrations; real GPS/background tracking and the
§18 physical-device QA are the device-gated steps that require the user._

## Build status

- **Phase A (audit)** — this document.
- **Phase B (state model + store + migration + flags)** — done. Pure
  `mileageSession.ts` (10 tests), the `mileage` store state machine, the
  `mileage_sessions` / `mileage_segments` migration (applied to the live
  project, owner RLS, advisor-clean), and the five flags.
- **Phase C (manual controls) + D (timeline/corrections/review)** — done.
  `live-mileage.tsx` (the full driver-confirmed flow + per-segment manual
  miles), `mileage-review.tsx` (daily timeline + category/miles/load
  corrections + unclassified review), the Miles-tab entry, and the Road Board
  widget.
- **Phase E (integrations)** — done. Load detail shows actual loaded/deadhead/
  total miles + actual all-mile RPM with an estimated→actual line and a "Use
  actual miles" action (feeds the Rate grade + the completed load). Road Grade
  prefers segment-derived deadhead + business miles when present (one source,
  never summed with trips).

### Still device-gated (Phase F/G — needs the user)

- Real GPS distance + background tracking (`expo-location`, prebuild, custom
  dev client) behind `background_mileage_tracking_enabled`; the §18
  physical-device QA matrix; then flipping `live_mileage_core_enabled` (and,
  once proven, the background flag) on in production.
- Completed **Rate Sharing Card** "Actual all-mile RPM" labeling is a small
  follow-up: once a driver taps "Use actual miles," the card already uses the
  actual figure; the explicit estimated-vs-actual label on the card is V1.1.
