# RigReceipts — Legal & Compliance Launch Checklist

Everything legal/compliance that stands between the current drafts and a public
launch, in one place. The drafts (`docs/PRIVACY_POLICY.md`,
`docs/TERMS_OF_SERVICE.md`, `docs/ACCOUNT_DELETION.md`, and the hosted
`web/*.html`) are written to match what the app actually does. This file is the
**counsel packet**: what to fill, who to sign with, and the exact store-form
answers derived from the code.

> Not legal advice. A qualified attorney should review the policy, terms, and the
> arbitration decision before publishing.

---

## 1. Placeholders to fill (decisions already captured)

| Token                      | Where                                        | Decision                                                                                                                                                                                       |
| -------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[Legal Entity]`           | Privacy intro + Contact; ToS intro + §12/§15 | **Not formed yet** — one token throughout; replace with the exact legal name (e.g. "RigReceipts LLC") in one pass before publishing. Until then the operator is you personally.                |
| `[Your Home State]`        | ToS §15                                      | Governs under **your home state**. Insert the state name (e.g. "Texas") in §15 governing-law + venue.                                                                                          |
| `[Mailing Address]`        | Privacy → Contact us                         | **None yet** — a contact address is expected by CCPA and both store listings. Add a business address, P.O. box, or registered-agent address before launch.                                     |
| Contact email              | Throughout                                   | **DONE — `jburwell@rigreceipts.com`** is live and used everywhere (privacy, security, support). Optional polish: add `privacy@` / `support@` role aliases forwarding to it, then swap them in. |
| Arbitration / class-waiver | ToS §15                                      | The one substantive open **counsel decision**: adopt binding individual arbitration + class-action waiver, or default to courts. Must satisfy Apple/Google requirements.                       |

After filling the markdown, **re-sync the hosted `web/*.html` pages** (see §5) —
they are the versions the store listings link to.

## 2. Subprocessor list + DPAs to sign

The Privacy Policy discloses these processors. Sign each one's Data Processing
Addendum and keep copies. (Confirm current URLs — vendors move them.)

| Processor      | Purpose                          | Data location            | DPA                                         |
| -------------- | -------------------------------- | ------------------------ | ------------------------------------------- |
| **Supabase**   | Auth, database, file storage     | Canada (ca-central-1)    | supabase.com/legal/dpa                      |
| **PostHog**    | Product analytics (pseudonymous) | United States (US cloud) | posthog.com — request/sign DPA              |
| **Sentry**     | Crash reporting / diagnostics    | United States            | sentry.io/legal/dpa                         |
| **RevenueCat** | Subscription management          | United States            | revenuecat.com — DPA on request             |
| **Apple**      | Payments + app delivery          | Per Apple                | Apple Developer Agreement / DPA             |
| **Google**     | Payments + app delivery          | Per Google               | Play Developer Distribution Agreement / DPA |

Because processing occurs in **Canada and the United States**, the GDPR section
relies on transfer safeguards (SCCs / the vendors' cross-border terms) — confirm
each vendor's SCC coverage when signing.

## 3. App Store privacy label ("nutrition label")

Answers derived from what the app collects (email, user content incl. receipt
images, pseudonymous usage, crash data, subscription status). **Nothing is "Used
to Track You"** — select **Data Not Used to Track You**.

**V1 (mileage flag OFF) — declare:**

| Data type                                                    | Linked to user                 | Purpose                      |
| ------------------------------------------------------------ | ------------------------------ | ---------------------------- |
| Contact Info → Email Address                                 | Yes                            | App Functionality            |
| User Content → Photos (receipt/rate-con images)              | Yes                            | App Functionality            |
| User Content → Other (loads, expenses, rate checks)          | Yes                            | App Functionality            |
| Financial Info → Other Financial Info (expense/rate figures) | Yes                            | App Functionality            |
| Identifiers → User ID (account) / Device ID (signed-out)     | Yes                            | App Functionality, Analytics |
| Usage Data → Product Interaction                             | Yes                            | Analytics                    |
| Diagnostics → Crash Data, Performance Data                   | No (configured to exclude PII) | App Functionality            |
| Purchases → Purchase History (subscription status)           | Yes                            | App Functionality            |

Payment card details are **not** collected (Apple processes payment) — do not
declare them.

**When Live Mileage GPS ships — ADD in the same release:**

| Data type                       | Linked to user | Purpose           |
| ------------------------------- | -------------- | ----------------- |
| Location → **Precise Location** | Yes            | App Functionality |

Still **Not Used to Track You**. See `docs/legal/PRIVACY_LOCATION_ADDENDUM.md`.

## 4. Google Play Data Safety form

For every type: **Encrypted in transit = Yes**; **Users can request deletion =
Yes** (in-app account deletion, `docs/ACCOUNT_DELETION.md`). "Shared" means
disclosed to a third party for their **own** use — our vendors are processors
under DPA, so mark them **Collected, not Shared** (confirm with counsel).

**V1 (mileage flag OFF) — declare Collected:**

- Personal info → **Email address** (App functionality; account)
- Financial info → **Purchase history** (App functionality) and **Other financial
  info** — the user's expense/rate figures (App functionality)
- Photos and videos → **Photos** (receipt/rate-con images; App functionality)
- App activity → **Product interaction** (Analytics) and **Other user-generated
  content** — loads/notes (App functionality)
- App info and performance → **Crash logs**, **Diagnostics** (App functionality)
- Device or other IDs → **Device or other IDs** (App functionality, Analytics)

**When Live Mileage GPS ships — ADD:**

- Location → **Precise location** (App functionality). Declare the
  **foreground-service** location use for background tracking; mark processed
  ephemerally where true, **not sold**.

## 5. Hosting the legal pages

**Domain secured: `rigreceipts.com`.** Nothing is hosted on it yet — that is the
remaining task. The store listings point at these URLs, and **each one must
return a real page before submission** (Apple and Google both fetch them):

| URL                                      | Serve from                | Required by                                                    |
| ---------------------------------------- | ------------------------- | -------------------------------------------------------------- |
| `https://rigreceipts.com/privacy`        | `web/privacy.html`        | Apple **and** Google (privacy-policy URL)                      |
| `https://rigreceipts.com/terms`          | `web/terms.html`          | Linked in-app + listings                                       |
| `https://rigreceipts.com/delete-account` | `web/delete-account.html` | Google Play (account-deletion URL)                             |
| `https://rigreceipts.com/support`        | `web/support.html`        | Apple (support URL, `fastlane/metadata/en-US/support_url.txt`) |
| `https://rigreceipts.com`                | `web/index.html`          | Apple marketing URL                                            |

All five `web/*.html` files now exist and are static and self-contained — no
build step, no external requests. Any static host works (Cloudflare Pages,
Netlify, Vercel, GitHub Pages, S3): serve the `web/` directory and map each file
to the path above. **Nothing is deployed yet — hosting is the remaining task.**

Before hosting, apply the §1 placeholder fills to the HTML so it matches the
markdown (`[Legal Entity]`, `[Your Home State]`, `[Mailing Address]`, and the §15
governing-law text).

## 6. Counsel review checklist

- [ ] Confirm the operator entity + fill `[Legal Entity]` (and form the entity if
      desired before signing store agreements).
- [ ] Set ToS §15 governing law/venue to your home state; **decide arbitration +
      class-action waiver**.
- [ ] Review CCPA/CPRA + GDPR sections against final data flows (and add the
      location language when mileage ships).
- [ ] Confirm the **18+** age gate (ToS §1) vs. the **under-13** privacy language
      are consistent with your intended audience and COPPA.
- [ ] Confirm data-retention specifics (analytics/crash retention windows) with
      each vendor's actual settings.
- [ ] Sign all §2 DPAs; confirm cross-border transfer coverage.
- [ ] Verify the store forms (§3, §4) match the shipped flag set before submitting.

## 7. Road Wallet release gate (feature-flagged OFF; not yet released)

Blockers before `road_wallet_enabled` may be turned on (see `docs/ROAD_WALLET.md`):

- [ ] Privacy Policy describes operational-document storage, including
      potentially personal/medical (CDL, medical, TWIC) and financial-sensitive
      (W-9, factoring, banking, lease) documents, device-local storage, and
      optional Driver Pro cloud backup.
- [ ] App Store privacy label (§3) reviewed for user-content documents and
      sensitive-info categories.
- [ ] Google Play Data Safety (§4) reviewed for files & docs.
- [ ] Retention / delete / export behaviour reviewed: archive vs delete,
      metadata-only JSON export (no binary files), account-deletion cascade.
- [ ] Real-device storage, camera/picker and share-sheet behaviour tested.
- [ ] Clean Supabase bootstrap + two-user RLS validation of migrations
      00011–00014 completed independently.

---

_Pair with `docs/RELEASE_READINESS.md` (§2D) and `docs/LAUNCH_COMMANDS.md`. The
golden rule: **location language and store-form location declarations flip on in
the exact same release that flips `live_mileage_core_enabled` on** — never before,
never after._
