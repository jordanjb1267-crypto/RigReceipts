# Privacy Policy — Location Addendum (merge when Live Mileage GPS ships)

**Do not publish this yet.** Today's Privacy Policy correctly states we do **not**
collect location, because `live_mileage_core_enabled` is off in production. The
moment you flip that flag on (and the GPS distance adapter is live), the policy
must change in the **same release**, and the App Store privacy label + Google Play
Data Safety form must be updated to declare precise location. This file is the
exact, pre-written text to swap in — reviewed against what
`src/location/mileageTracker.ts` + `src/domain/geo.ts` actually do.

The behavior these words describe:

- Location is used **only while a mileage session is actively running** — the app
  requests permission at that moment, not at launch.
- It is used to **measure trip distance** (turned into miles); the app does not
  build a location history, does not reverse-geocode to places, and does not use
  location for advertising or cross-app tracking.
- **Background** collection happens only if the driver enables background tracking
  (a separate opt-in that requires the OS "Always" / background-location grant and
  shows a persistent notification on Android).
- GPS never asserts freight status — it only accumulates distance into a segment
  the driver has already confirmed.

---

## 1. Replace the "What we do not collect" section

**Remove** `location` from the do-not-collect list. Replace that section with:

> ## What we do not collect
>
> We do **not** collect your **contacts**, **browsing history**, **health** data,
> or **advertising identifiers**, and we do not build advertising profiles. We
> collect **location only while you are running a mileage session**, only to
> measure your trip distance — see "Location for mileage" below. We do not track
> your location in the background unless you turn on background mileage tracking,
> and we never use location for advertising or to track you across other apps.

## 2. Add this subsection under "What we collect and why"

> **Location for mileage (only during a session).** If you start a Live Mileage
> session, the app uses your device's **precise location** to measure how far you
> drive, so your loaded, deadhead, and business miles are accurate for your profit
> and tax records. We use location **only while a session is running**, and we ask
> for permission at that moment — not when you open the app. We convert your
> movement into **distance (miles)**; we do not keep a map of where you went, look
> up the names of places you visit, or use your location for advertising or
> cross-app tracking. The miles are attached to the trip segment you confirm — the
> app never decides on its own that a load is "loaded" or "delivered."
>
> **Background tracking (optional, off by default).** So a session can keep
> counting miles when your screen is off, you can turn on **background mileage
> tracking**. This requires the "Always"/background-location permission and, on
> Android, shows a persistent notification while it runs. It is off unless you
> enable it, and it stops when you stop the session. You can revoke location
> permission at any time in your device settings; mileage then falls back to
> manual entry.

## 3. Update the CCPA and GDPR sections

- **California (CCPA/CPRA):** add **geolocation data** to the categories collected,
  collected for the business purpose of providing the mileage feature. Precise
  geolocation is "sensitive personal information" under CPRA — state that it is
  used **only** to provide the requested mileage feature and is **not** used to
  infer characteristics, **not** sold, and **not** shared for cross-context
  behavioral advertising, so no "limit the use of my sensitive personal
  information" right is triggered beyond honoring the request.
- **EU/UK (GDPR):** legal basis for location is **performance of a contract**
  (delivering the mileage feature you asked for) and/or **consent** (the OS
  permission prompt). Location is processed only for the duration of a session.

## 4. Update the store forms in the same release (see LEGAL_LAUNCH_CHECKLIST.md)

- **App Store privacy label:** Location → **Precise Location**, linked to the user,
  used for **App Functionality** (and **Analytics** only if you ever send it there
  — today you do not). **Not** "Used to Track You."
- **Google Play Data Safety:** Location → **Precise location**, Collected (not
  shared), purpose **App functionality**, processed **ephemerally** where true, not
  sold; declare the foreground-service location use for background tracking.

---

_Keep this addendum in lockstep with `src/location/mileageTracker.ts`. If the
adapter ever starts persisting coordinates, sending location to analytics, or
reverse-geocoding, this text must be revised before that ships._
