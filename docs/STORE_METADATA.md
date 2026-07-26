# Store Metadata — App Store & Google Play

Listing copy and store-console fields for RigReceipts. Character limits are noted
per field (App Store / Google Play). Everything here describes the **shippable**
build; forward-looking features are phrased as roadmap, and the privacy
declarations map to what the app actually collects today.

Bundle / package id: `com.rigreceipts.app`. Category: **Business** (secondary:
**Finance**). Not a load board, broker, or dispatch service — say so in review
notes to avoid a marketplace-policy misread.

---

## App name / title

- **App Store name** (≤30): `RigReceipts: Truck Expenses`
- **Google Play title** (≤30): `RigReceipts: Truck Expenses`

## Subtitle / short description

- **App Store subtitle** (≤30): `Know what the load really pays`
- **Google Play short description** (≤80):
  `Rate checks, receipts, miles, and real profit — built for truck drivers.`

## Promotional text (App Store, ≤170, updatable without review)

`Check a load before you accept it. RigReceipts shows all-mile RPM, break-even,
and target after deadhead and fuel — plus receipts, miles, and loads in one place.`

## Keywords (App Store, ≤100 chars, comma-separated, no spaces)

`trucking,owner operator,rate per mile,rpm,deadhead,freight,truck expenses,ifta,mileage,receipts`

(95 chars, within the 100-char cap. "load" and "broker" are covered in the
description instead.)

(Play has no keyword field — weave these terms naturally into the full
description instead.)

---

## Full description (App Store & Google Play, ≤4000)

```
Know what the load really pays.

RigReceipts is built for the driver — owner-operators, leased-on, and company
drivers — to answer one question fast: does this load actually pay after
deadhead, fuel, and the real cost of running your truck?

CHECK A LOAD BEFORE YOU ACCEPT IT
- Enter the offer, loaded miles, and deadhead — get a straight answer.
- See loaded RPM vs all-mile RPM, because a strong loaded rate can still be a
  bad load once you count the empty miles.
- Compare the rate to your break-even and your profit target.
- Above target, on target, below target, or below break-even — no guessing.

SCAN, DON'T TYPE
- Scan receipts and rate confirmations. Text is read on your device, and you
  confirm every field before anything is saved.
- Fuel, tolls, repairs, lumper, scales, lodging — 23 expense categories.
- Pull a rate con's route, rate, and miles into a load automatically.

TRACK THE MILES AND MONEY
- Loaded, deadhead, and business miles so your RPM reflects reality.
- Keep the rate confirmation, receipts, and trip details together per load.
- Month and year summaries that make tax time less painful.

FREIGHT INTELLIGENCE (COMMUNITY RATE BOARD)
- See recent, driver-shared rates by lane and equipment — historical rate
  transparency, not a load board. These are not available loads.
- Compare a community rate to YOUR costs, not a stranger's.
- Share a privacy-safe Rate Card that never shows your name, load number,
  addresses, contacts, or documents. You choose exactly what appears.

PRIVATE BY DESIGN
- Use it on your device with no account required.
- Create a free account any time to back up and sync across devices.
- Receipts are read on-device. We never sell your data, and community rates are
  never presented as an official or guaranteed market rate.

PLANS
- Free: rate checks, scanning, loads, and receipts to get started.
- Driver Pro and Owner-Operator unlock unlimited rate checks, full Freight
  Intelligence, lane history, and more.
- Founder Lifetime: a one-time unlock of core RigReceipts + Phase One Freight
  Intelligence.

RigReceipts is not a load board, broker, dispatch service, or freight
marketplace. It helps you understand what a load pays and run the financial side
of your truck.

Questions or feedback? support@rigreceipts.app
```

## What's New (first release)

```
First release. Check a load before you accept it: loaded vs all-mile RPM,
break-even, and target after deadhead and fuel. Scan receipts and rate cons with
on-device text reading, track miles and loads, and see historical driver-shared
rates by lane. Private by design — no account required to start.
```

---

## Age rating / content

- **App Store age rating**: 4+ (no objectionable content). No user-to-user free
  text is published (rate posts are structured, moderated snapshots — no
  comments, DMs, or profiles), so this is not a "user-generated content" social
  rating.
- **Google Play content rating (IARC)**: Everyone. Answer the questionnaire as a
  business/finance utility; declare that shared content is limited, structured,
  and moderated with report/block controls (Section 51 moderation).

## Review notes (both stores)

```
RigReceipts is an expense, mileage, and rate-analysis tool for truck drivers. It
is NOT a load board or freight marketplace — the "Rate Board" shows only
historical, anonymized, driver-shared rate snapshots for transparency and is
labeled "not available loads" throughout.

Account is optional; core features work on-device without sign-in. Test account
and a sandbox flow for in-app purchases (RevenueCat) can be provided on request.
Camera is used only for on-device receipt/document text recognition, prompted
contextually when the user chooses to scan.
```

---

## App Store — Privacy "Nutrition" labels

Declare only what the shipped build collects. Nothing is used for cross-app
tracking, so answer **"Data Not Used to Track You."**

| Data type                                                                                       | Collected                                                                   | Linked to identity       | Purpose                            |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------ | ---------------------------------- |
| Email address                                                                                   | Yes (only if the user creates an account)                                   | Linked                   | App Functionality (account, sync)  |
| User Content — photos/docs (receipts, rate cons) and financial records (expenses, loads, miles) | Yes (stored in the user's account when signed in; on-device only otherwise) | Linked (when signed in)  | App Functionality                  |
| Product interaction / usage data (analytics events)                                             | Yes                                                                         | Linked (pseudonymous id) | Analytics, Product Personalization |
| Crash data / diagnostics                                                                        | Yes                                                                         | Not linked               | App Functionality (diagnostics)    |
| Coarse purchase info (subscription tier)                                                        | Yes                                                                         | Linked                   | App Functionality                  |

Not collected: precise/coarse location, contacts, browsing history, health,
financial account numbers, advertising identifiers. **No data is sold. No
third-party advertising.** Camera access is used on-device for text recognition;
captured images are only stored if the user saves the record.

## Google Play — Data Safety

- **Data collected/shared**: mirror the table above. Mark data as **encrypted in
  transit** (HTTPS) and note the user can **request deletion** (account deletion
  removes their rows via cascade). Data is **not shared** with third parties for
  advertising or sale.
- **Data types**: Personal info (email — optional), Photos (receipts/docs), App
  activity (analytics), App info & performance (crash logs), Financial info
  (user-entered expense/rate amounts, not payment-card data), Purchases
  (subscription status).
- **Security practices**: data encrypted in transit; users can request data
  deletion; independent security review of RLS performed (all user tables
  owner-scoped).

---

## Assets checklist (produced separately)

- **Screenshots** (6.7"/6.9" iPhone, 6.5" fallback, 12.9" iPad if submitted;
  Play phone + 7"/10" tablet): use the real Industrial Atlas screens —
  1. the profit result ("Know what the load really pays"), 2) the rate-check
     form, 3) the dashboard / Road Board, 4) the Community Rate Board with the
     "historical, not available loads" clarifier, 5) a privacy-safe Rate Card,
  2. receipts/scan. The interactive preview mirrors these framings.
- **App icon**: the Route-Green "R" mark on Map Ivory (see splash).
- **App preview video** (optional): the onboarding activation loop — check a
  load → see real profit → save.
- **Support URL / Marketing URL / Privacy Policy URL**: required before
  submission (privacy policy must reflect the data-safety declarations above).

## Localization

Ship en-US first. The copy avoids idioms that don't translate; es-US/es-MX and
fr-CA are natural follow-ups for the North American driver base.
