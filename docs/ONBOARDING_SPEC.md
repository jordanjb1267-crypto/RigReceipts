# Onboarding — Screen-by-Screen Specification

Revised onboarding around the primary value proposition **"Know what the load
really pays."** This is an **additive refinement** of the shipped Phase B
onboarding, not a rebuild. It reuses the existing Industrial Atlas design system,
component library, navigation, and stores. Nothing already working is replaced.

**Activation loop:** Check a Load → See Real Profit → Save the Load → (optional)
Create a Rate Card → Reveal the Road Board.

## Audit — what already exists

| #   | Screen                     | File                                                                    | Status                                         |
| --- | -------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------- |
| 1   | Splash                     | `(onboarding)/splash.tsx`                                               | exists                                         |
| 2   | Primary Value Hook         | `(onboarding)/value.tsx`                                                | refine (add "what else" sheet)                 |
| 3   | Driver Role Selection      | `(onboarding)/role.tsx`                                                 | exists                                         |
| 4   | First-Job Picker           | `(onboarding)/first-job.tsx`                                            | exists                                         |
| 5   | Quick Rate Check           | `(onboarding)/first-action.tsx` · `RateCheckBranch`                     | refine (validation + trip details)             |
| 6   | Rate Check Loading         | `first-action.tsx` · `RateCheckLoading`                                 | **add**                                        |
| 7   | First Profitability Result | `first-action.tsx` · `ProfitResult`                                     | exists                                         |
| 8   | Rate Sharing Card Intro    | `app/rate-card.tsx` (intro step)                                        | exists                                         |
| 9   | Rate Card Preview          | `app/rate-card.tsx` (preview step)                                      | exists                                         |
| 10  | Rate Card Visibility       | `app/rate-card.tsx` (share step)                                        | exists                                         |
| 11  | Community Board Intro      | `first-action.tsx` · `CommunityBranch`; full board `app/rate-board.tsx` | exists                                         |
| 12  | Community Rate Comparison  | `app/compare.tsx`                                                       | exists                                         |
| 13  | Scan Rate Confirmation     | `first-action.tsx` · `RateConBranch`; live `(tabs)/scan.tsx`            | exists                                         |
| 14  | Receipt Branch Success     | `first-action.tsx` · `SuccessBranch kind="receipt"`                     | exists                                         |
| 15  | Mileage Branch Success     | `first-action.tsx` · `SuccessBranch kind="miles"`                       | exists                                         |
| 16  | Road Board Reveal          | `(onboarding)/reveal.tsx`                                               | exists                                         |
| 17  | Contextual Account         | `(onboarding)/account.tsx`                                              | exists (Apple/Google deferred to store builds) |

Reusable components already in place: `OnboardingShell` (topo backdrop, step dots,
pinned footer), `ChoiceRow` (selectable card with marker + badge), `Card`, `Button`
(with `loading`), `Pill`, `RouteBand`, `RateCardView`. Stores: `useOnboardingStore`
(role, firstJob, firstActionDone, accountMode, completion + gate), `useRateCardStore`,
`useRateBoardStore`, `useCostProfileStore`, `useCommunityStore`, `useAuthStore`.
Flags: `revised_onboarding_enabled`, `freight_intelligence_enabled`,
`rate_sharing_cards_enabled`, `community_rate_board_enabled`,
`community_rate_posting_enabled`.

---

## Screen 1 — Splash

1. **Purpose** Establish product + primary value; zero friction.
2. **Reuse** `TopoBackground`, theme tokens.
3. **Layout** Centered wordmark "R" mark → RigReceipts → subtitle → tagline; "Tap to start" pinned bottom.
4. **Copy** RIGRECEIPTS · "Know what the load really pays." · "Rates, receipts, miles, and real profit — built for the driver."
5. **Primary CTA** Tap anywhere → value.
6. **Secondary CTA** none.
7. **Interaction** Full-screen `Pressable`; no account/permission/pricing.
8. **Loading** Root layout holds the splash until fonts + hydration ready.
9. **Empty** n/a.
10. **Error** n/a.
11. **Validation** n/a.
12. **Analytics** `onboarding_started`.
13. **Accessibility** Large tap target = whole screen; wordmark is a heading; strong contrast on Asphalt Charcoal.
14. **Responsive** Flex-centered; safe-area insets top/bottom.
15. **Navigation** → `(onboarding)/value`.
16. **Flag** Gated by the onboarding routing gate (device state), not a feature flag.

## Screen 2 — Primary Value Hook

1. **Purpose** Show the problem (loaded RPM ≠ real pay) before any setup.
2. **Reuse** `OnboardingShell`, `Pill`, `Button`; new inline bottom sheet (Modal) for "what else".
3. **Layout** Pill → headline → body → RPM waterfall (Loaded → All-Mile → Above Target) with `↓` connectors; footer 2 CTAs.
4. **Copy** "A good loaded rate can still be a bad load." · "RigReceipts calculates what is left after deadhead, fuel, and your operating costs." · Waterfall $2.95 Loaded RPM ↓ $2.38 All-Mile RPM ↓ $0.46 Above Your Target.
5. **Primary CTA** Check a Load → role.
6. **Secondary CTA** See What Else RigReceipts Does → **bottom sheet** (Rate Checks / Receipts / Miles / Loads / Community Rates), not a separate tour.
7. **Interaction** Sheet is dismissible; a "Check a Load" inside the sheet also advances.
8. **Loading** none.
9. **Empty** n/a.
10. **Error** n/a.
11. **Validation** n/a.
12. **Analytics** (none required; value-view is implicit after `onboarding_started`).
13. **Accessibility** Waterfall values use tabular figures; each step labeled; sheet has a titled heading + close.
14. **Responsive** Waterfall stacks vertically; scrolls within shell.
15. **Navigation** → role (both CTAs); sheet overlays.
16. **Flag** none (core onboarding).

## Screen 3 — Driver Role Selection

1. **Purpose** Personalize without friction.
2. **Reuse** `OnboardingShell`, `ChoiceRow`, `Button`.
3. **Layout** Title → subtitle → 6 `ChoiceRow` cards → Continue.
4. **Copy** "How do you run?" · Owner-Operator / Leased-On Owner-Operator / Company Driver / Small Fleet Owner / Dispatcher or Operations / Just Getting Started (each with a one-line subtitle).
5. **Primary CTA** Continue (disabled until a role is picked) → first-job.
6. **Secondary CTA** none.
7. **Interaction** One tap selects; selection is visually clear (marker + border).
   8–11. **Loading/Empty/Error** n/a.
8. **Validation** Continue disabled until selection.
9. **Analytics** `role_selected {role}`.
10. **Accessibility** Cards are buttons with selected state exposed; not color-only (marker + ring).
11. **Responsive** Vertical list; scrolls.
12. **Navigation** → first-job.
13. **Flag** none. **No MC/DOT/authority/VIN/address requested.**

## Screen 4 — First-Job Picker

1. **Purpose** Start with the problem that brought them in.
2. **Reuse** `OnboardingShell`, `ChoiceRow` (badge), `Button`, `isFeatureEnabled`.
3. **Layout** Title → subtitle → up to 6 job cards → Continue.
4. **Copy** "What do you need right now?" · Check My Rate (badge **Best Place to Start**) / Scan a Rate Confirmation / Scan a Receipt / Track My Miles / Organize a Load / See Community Rates.
5. **Primary CTA** Continue → first-action.
6. **Secondary CTA** none.
7. **Interaction** Check My Rate is visually recommended, never forced. Freight jobs are flag-gated (`freight_intelligence_enabled`, `community_rate_board_enabled`).
   8–11. **Loading/Empty/Error** n/a.
8. **Validation** Continue disabled until a job is chosen.
9. **Analytics** `first_job_selected {first_job}`.
10. **Accessibility** Recommended badge is text, not color-only.
11. **Responsive** Vertical list.
12. **Navigation** → first-action (branches on chosen job).
13. **Flag** Rows gated by their `requiresFlag`.

## Screen 5 — Quick Rate Check

1. **Purpose** Reach the first profit answer fast.
2. **Reuse** `OnboardingShell`, `Card`, `Button`; `NumberField`; domain `analyzeRateCheck`, `estimateAllMileTargets`, `QUICK_ESTIMATE_PROFILE`.
3. **Layout** Pill → title → body → "The load" card (Offer / Loaded miles / Deadhead miles) → **Add Trip Details** (collapsible: origin/destination/equipment) → cost-mode segment (Quick Estimate / Use My Costs) + note → Calculate.
4. **Copy** "Let's see what the load pays." · "Enter the offer and miles. Deadhead is where good rates go bad." · Cost-mode notes per selection.
5. **Primary CTA** Calculate the Load (disabled until valid).
6. **Secondary CTA** none (trip details is an inline disclosure).
7. **Interaction** Numeric keypads; trip details wires the lane/equipment into the Rate Card created from the result.
8. **Loading** → Screen 6 interstitial before the result.
9. **Empty** n/a (prefilled sample values so a first-time user can calculate immediately).
10. **Error** Calculation error → "We couldn't calculate this load / Check your numbers and try again." → Review Details.
11. **Validation** Inline: "Enter the offered rate." · "Loaded miles must be greater than zero." Shown under the field, not as dialogs.
12. **Analytics** `rate_check_started {cost_mode}`.
13. **Accessibility** `keyboardType="decimal-pad"`; field labels tied to inputs; error text announced.
14. **Responsive** `keyboardShouldPersistTaps`; shell scrolls; keyboard avoidance via ScrollView.
15. **Navigation** → loading → result.
16. **Flag** none (core); Create-Rate-Card affordance downstream gated by `rate_sharing_cards_enabled`.

## Screen 6 — Rate Check Loading State _(added)_

1. **Purpose** Make the calculation feel active — a financial calc, not "AI thinking".
2. **Reuse** `OnboardingShell`, `Pill`, `ActivityIndicator`.
3. **Layout** Pill → "Running the numbers" → rotating step line → subtle spinner.
4. **Copy** "Running the numbers" · rotating: "Calculating loaded RPM." → "Adding deadhead." → "Applying operating costs." → "Checking your target."
5. **Primary CTA** none (auto-advances).
6. **Secondary CTA** none.
7. **Interaction** ~1s minimum; rotates step copy on an interval; then shows the result.
8. **Loading** This _is_ the loading state.
   9–11. **Empty/Error** On failure, transitions to the calc-error state (Screen 5 error).
9. **Validation** n/a.
10. **Analytics** none (bracketed by `rate_check_started`/`rate_check_completed`).
11. **Accessibility** `prefers-reduced-motion`: no spinner animation reliance; the step text still conveys progress; total dwell kept short.
12. **Responsive** Centered, fits all sizes.
13. **Navigation** → result (Screen 7).
14. **Flag** none.

## Screen 7 — First Profitability Result

1. **Purpose** The single most important onboarding screen — the payoff.
2. **Reuse** `OnboardingShell`, `Card` (dark), `Pill`, `Button`; verdict color mapping.
3. **Layout** Verdict pill → headline → decision summary sentence → dark metric grid (Offer / Loaded RPM / All-Mile RPM / Break-Even / Target / Contribution) → CTAs.
4. **Copy** Verdicts ABOVE TARGET / ON TARGET / BELOW TARGET / BELOW BREAK-EVEN; summary explains deadhead's effect and the dollar gap to target.
5. **Primary CTA** Save This Load → reveal.
6. **Secondary CTA** Create Rate Card (flag-gated) → `rate-card` modal; tertiary Adjust Costs → back to the form.
7. **Interaction** No paywall. Save completes the first action; unauthenticated save still works locally (device mode).
   8–10. **Loading/Empty/Error** result already loaded; error handled upstream.
8. **Validation** n/a.
9. **Analytics** `rate_check_completed {verdict}`, `first_profit_verdict_viewed {verdict}`, `first_load_saved {verdict}`, `rate_card_created {source}`.
10. **Accessibility** Semantic verdict color paired with the uppercase label (never color-only); metrics tabular.
11. **Responsive** Metric grid wraps 3-up; scrolls.
12. **Navigation** → reveal (save) or `rate-card` (create).
13. **Flag** Create Rate Card requires `rate_sharing_cards_enabled`.

## Screen 8 — Rate Sharing Card Introduction

1. **Purpose** Frame the privacy promise before showing the card.
2. **Reuse** `rate-card.tsx` intro step, `Pill`, `Button`.
3. **Layout** Pill "Privacy-safe" → headline → body → CTAs.
4. **Copy** "Share the rate — not your paperwork." · "RigReceipts creates a privacy-safe rate card without showing your name, load number, exact addresses, contacts, or documents."
5. **Primary CTA** Preview My Card → preview step.
6. **Secondary CTA** Not Now → close.
7. **Interaction** Shown only after Create Rate Card.
8. **Analytics** `rate_card_previewed` (on entering preview).
   13/14. **Accessibility/Responsive** Modal presentation; scrolls.
9. **Navigation** → preview. 17. **Flag** `rate_sharing_cards_enabled`.

## Screen 9 — Rate Card Preview

1. **Purpose** Show exactly what can be shared; live privacy control.
2. **Reuse** `RateCardView` (renders `SafeRateCard`), `Switch`, `Card`; `sanitizeRateShareCard`.
3. **Layout** Card preview → "Choose what appears" toggles → required-fields note → "What RigReceipts removes" notice → Continue.
4. **Copy** Card: metro route · equipment · status · verification badge · "Historical rate information. Not an available load." · "Shared through RigReceipts". Toggles: Gross / Loaded Miles / Deadhead / Loaded RPM / All-Mile RPM / Approx. Load Date. Required non-toggleable: metro route, equipment, rate status.
5. **Primary CTA** Continue → visibility. 6. **Secondary** Back.
6. **Interaction** Toggles re-run `sanitizeRateShareCard` live; exact date always bucketed.
7. **Validation** n/a (allow-list guarantees no private field can be exposed).
8. **Analytics** `rate_card_previewed`.
   13/14. **Accessibility/Responsive** Switches labeled; card scales.
9. **Navigation** → share step. 17. **Flag** `rate_sharing_cards_enabled`.

## Screen 10 — Rate Card Visibility

1. **Purpose** Choose destination; default private.
2. **Reuse** `rate-card.tsx` share step, `ShareOption`.
3. **Layout** Title → 3 options (Keep Private / Share Outside RigReceipts / Post to Community Rate Board) → reassurance line.
4. **Copy** "What would you like to do?" + the three option descriptions; "No card is posted publicly without your explicit action."
   5/6. **CTAs** Options are the actions; none preselected public.
5. **Interaction** Post disabled unless `community_rate_posting_enabled` **and** verification-eligible **and** signed in; else explains why.
6. **Analytics** `rate_card_external_share_started/completed`, `rate_board_post_started`.
7. **Navigation** Keep Private → close; Share → native sheet; Post → consent (Screen: consent) → checks → posted/blocked/error.
8. **Flag** Posting requires `community_rate_posting_enabled`.

## Screen 11 — Community Rate Board Introduction

1. **Purpose** Orient a first-time board visitor.
2. **Reuse** onboarding `CommunityBranch` (preview) + full `rate-board.tsx` (permanent clarifier, tabs, filters).
3. **Layout** Pill → title → body → permanent clarification → 3 value rows → CTAs.
4. **Copy** "See what drivers are actually being offered." · "Compare recent driver-shared rates by lane, equipment, and all-mile RPM." · **"Historical rate information only. These are not available loads."** · Driver-Shared Rates / Verified Data / Compare to Your Truck.
5. **Primary CTA** View Recent Rates. 6. **Secondary** Choose My Lanes / Save This Lane.
6. **Interaction** Ordering recency + verification only (never engagement).
7. **Empty** "No recent verified rates found / Try a broader date range or save this lane." → Save This Lane / Change Filters.
8. **Error** "Rate Board temporarily unavailable / Your loads, receipts, and Rate Checks are still available." → Try Again.
9. **Analytics** `community_board_viewed`, `lane_saved {source}`.
10. **Navigation** → board / lane detail. 17. **Flag** `community_rate_board_enabled`.

## Screen 12 — Community Rate Comparison

1. **Purpose** Translate a community rate into "what it means for my truck".
2. **Reuse** `app/compare.tsx`, cost profile store, `QUICK_ESTIMATE_PROFILE`, metering gate.
3. **Layout** Title → Community Rate / Your Break-Even / Your Target / Estimated Result → CTAs. No-profile variant: "Make this rate personal".
4. **Copy** "What would this rate mean for your truck?" · result "$X per total mile above break-even". No-profile: "Add your truck costs to see whether this rate would work." → Set Up My Costs / Use Quick Estimate.
5. **Interaction** Free-tier Compare is metered; exceeding it triggers the contextual paywall.
6. **Analytics** `community_rate_compared`.
7. **Navigation** → full Rate Check / Save This Lane / cost setup. 17. **Flag** `community_rate_board_enabled`.

## Screen 13 — Scan Rate Confirmation Branch

1. **Purpose** Turn a rate con into a load; review before save.
2. **Reuse** onboarding `RateConBranch` (sample) + live `(tabs)/scan.tsx` (camera + on-device OCR + `parseRateCon`).
3. **Layout** Intro (Scan Document / Upload From Phone) → OCR review (editable fields) → Analyze.
4. **Copy** "Scan the rate con. We'll build the load." · "RigReceipts extracts the route, rate, miles, and terms. You review everything before it is saved." · review headline "Check the details before we calculate the load."
5. **Primary CTA** Analyze This Load → result. 6. **Secondary** Edit Details / Upload.
6. **Interaction** Camera permission requested only on the scan action (see Permissions).
7. **Loading** OCR extraction state (preserves context, not blank).
8. **Validation** Extracted fields editable before analyze.
9. **Analytics** `rate_con_scan_started {source}`, `rate_con_scan_completed`, `first_load_saved {source}`.
10. **Navigation** → profitability result. 17. **Flag** `freight_intelligence_enabled`.

## Screen 14 — Receipt Branch Success

1. **Purpose** Confirm the save; connect it to better Rate Checks.
2. **Reuse** `SuccessBranch kind="receipt"`.
3. **Copy** "Receipt saved." · "Better expense records make every future Rate Check more accurate."
4. **Primary CTA** Go to My Road Board. 6. **Secondary** Scan Another Receipt.
5. **Analytics** `first_load_saved` (kind receipt path) → reveal. 16. **Navigation** → reveal. 17. **Flag** none.

## Screen 15 — Mileage Branch Success

1. **Purpose** Confirm miles; connect to all-mile earning.
2. **Reuse** `SuccessBranch kind="miles"`.
3. **Copy** "Miles recorded." · "RigReceipts can now show the difference between loaded RPM and what you actually earn across every mile."
4. **Primary CTA** Go to My Road Board. 6. **Secondary** View Miles.
5. **Navigation** → reveal. 17. **Flag** none.

## Screen 16 — Road Board Reveal

1. **Purpose** Introduce the dashboard as the command center; lightweight, not a tour.
2. **Reuse** `reveal.tsx`, `RouteBand`.
3. **Layout** Pill → "This is your Road Board." → 3 `RouteBand`s → CTA.
4. **Copy** "Your loads, miles, expenses, rates, and money — all in one place." · THIS WEEK / FREIGHT INTELLIGENCE / NEXT BEST ACTION rows.
5. **Primary CTA** Go to My Road Board → account (optional). 6. **Secondary** Finish Setup Later → tabs.
6. **Analytics** `road_board_revealed`. 16. **Navigation** → account or tabs. 17. **Flag** none.

## Screen 17 — Contextual Account Creation

1. **Purpose** Offer backup/sync after value; never a gate before value.
2. **Reuse** `account.tsx`, `useAuthStore`, `bootstrapProfile`, email OTP.
3. **Layout** Pill → "Save your Road Board." → benefit bands → auth options → "Keep Using This Device".
4. **Copy** "Save your Road Board." · "Create an account to keep your loads, Rate Checks, receipts, and lane history backed up." Public-posting variant explains an account is required to post.
5. **Primary CTA** Continue with Email (OTP). Apple/Google land with store builds (documented deferral). 6. **Secondary** Keep Using This Device.
6. **Interaction** Every path falls back to device mode; auth failure never blocks onboarding.
7. **Validation** Email shape check before OTP; 6-digit code entry.
8. **Analytics** `account_created {method}`.
9. **Navigation** → tabs. 17. **Flag** none.

---

## Cross-cutting states

**Permissions (contextual only):** Camera prompted only on Scan Rate Con / Scan
Receipt ("Scan your document / Allow camera access so RigReceipts can capture your
rate confirmation or receipt."). Photo library only on Upload. Location only after
choosing automatic mileage ("Track miles automatically… Allow location access…"),
with manual mileage always available. Notifications only after a lane/broker/
money-owed/mileage opt-in.

**Loading states** for rate calc, OCR, rate-card generation, board, lane compare,
broker lookup — all preserve context (spinner + labeled step), never a blank screen.

**Empty states:** No Rate Checks ("Check your first load"), No Watched Lanes
("Watch the lanes that matter to you"), No Community Rates ("No recent verified
rates found").

**Error states:** Rate calc ("We couldn't calculate this load"), Rate Card gen
("We couldn't create this rate card. Your load is still saved."), Rate Board
("Rate Board temporarily unavailable. Your loads, receipts, and Rate Checks are
still available.").

**Accessibility / responsive / motion:** large tap targets (≥48pt), strong
contrast, no color-only meaning (verdict label text + color), numeric keypads for
money/mileage, currency + mileage formatting, keyboard-avoiding scroll, screen-
reader labels, logical focus order. Motion limited to card transitions, the
number/verdict reveal, subtle route-line motion, scan confirmation, and the board
reveal; `prefers-reduced-motion` respected. No confetti / gamified financial states.
