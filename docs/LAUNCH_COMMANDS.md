# RigReceipts — Launch Commands (EAS build/submit + env)

Copy-paste runbook for cutting the first production build. Run everything from
your own machine — this repo's CI environment can't reach `api.expo.dev` or the
app stores. Assumes Node 20+ and this repo checked out.

Recommended V1 flag set is baked into §3. The mileage + community flags stay
**off** for the first submission and flip on as fast-follows (§6).

---

## 0. Account prerequisites (do these first, in the browsers)

- **Apple Developer Program** enrolled ($99/yr). In **App Store Connect**:
  create the app, bundle ID `com.rigreceipts.app`, and an **App Store Connect
  API key** (Users and Access → Integrations) — download the `.p8`, note the
  Key ID + Issuer ID for `eas submit`.
- **Google Play Console** account ($25 once). Create the app, package
  `com.rigreceipts.app`, and a **service-account JSON** with the Play Developer
  API enabled (for `eas submit`).
- **RevenueCat**: create products/entitlements, link App Store + Play products,
  copy the **platform SDK keys** (`appl_…`, `goog_…`).
- **Supabase**: set the auth **email OTP template** to include `{{ .Token }}`.
  (Migrations are already applied to `kfyzglmphwohbhigvdyy`.)

---

## 1. EAS CLI + project link

```bash
npm i -g eas-cli
eas login
eas whoami                 # confirm the account
eas init                   # writes extra.eas.projectId into app.json — commit it
```

## 2. Signing credentials (EAS manages them)

```bash
# iOS: EAS creates the distribution cert + provisioning profile
# (prompts for your Apple login on the first iOS build).
# Android: EAS generates and stores the upload keystore.
eas credentials            # optional: inspect/manage before building
```

## 3. Production environment variables (the recommended V1 flag set)

Create them once on EAS for the `production` environment. All of these are
client-safe (publishable) keys — none is a secret service-role key.

```bash
# --- Backend / integrations ---
eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_URL --value "https://kfyzglmphwohbhigvdyy.supabase.co"
eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "sb_publishable_BGl53113tsDTG8BDUObMUQ_rZ-gxgdH"
eas env:create --environment production --name EXPO_PUBLIC_SENTRY_DSN --value "https://38f8e662f24f22d54640ff2155d83cb9@o4511757316915200.ingest.us.sentry.io/4511757327990784"
eas env:create --environment production --name EXPO_PUBLIC_POSTHOG_KEY --value "phc_tD7hzBPySxnqhDXSu3jFukZWB9SsJR5Z2BxpNkfejWvY"
eas env:create --environment production --name EXPO_PUBLIC_POSTHOG_HOST --value "https://us.i.posthog.com"

# --- RevenueCat: real platform keys (NOT the test_ key) ---
eas env:create --environment production --name EXPO_PUBLIC_REVENUECAT_IOS_KEY --value "appl_REPLACE_ME"
eas env:create --environment production --name EXPO_PUBLIC_REVENUECAT_ANDROID_KEY --value "goog_REPLACE_ME"

# --- Feature flags: ON for V1 (single-user, headless-verified) ---
eas env:create --environment production --name EXPO_PUBLIC_FF_FREIGHT_INTELLIGENCE_ENABLED --value "production"
eas env:create --environment production --name EXPO_PUBLIC_FF_RATE_SHARING_CARDS_ENABLED --value "production"
eas env:create --environment production --name EXPO_PUBLIC_FF_BROKER_CHECK_ENABLED --value "production"
eas env:create --environment production --name EXPO_PUBLIC_FF_ROAD_GRADE_ENABLED --value "production"
eas env:create --environment production --name EXPO_PUBLIC_FF_REVISED_ONBOARDING_ENABLED --value "production"
```

Everything not listed stays **off** by default (repo default) — that's the
correct V1 state for the mileage flags (need device QA) and the community flags
(need real content + live moderation):

```
live_mileage_core_enabled, background_mileage_tracking_enabled,
automatic_trip_detection_enabled, mileage_geofence_suggestions_enabled,
odometer_reconciliation_enabled,           ← flip on after §6 device QA
community_rate_board_enabled, community_rate_posting_enabled,
lane_aggregates_enabled                    ← flip on after moderation is staffed
```

> Prefer a file? The same values as a `.env.production` are fine too — Expo
> inlines `EXPO_PUBLIC_*` at build time. EAS env vars keep them off your disk.

## 4. Validate native config locally (optional but recommended)

```bash
npx expo-doctor                         # config sanity
npx expo prebuild --clean --no-install  # generates ios/ + android/ from app.json
```

EAS runs prebuild in the cloud, so this is only to eyeball the generated native
config (the `expo-location` permission strings, iOS background mode, Android
foreground service).

## 5. Build + submit

```bash
# Build both platforms (production profile → channel "production")
eas build --platform all --profile production

# Submit (after the App Store Connect app + Play app exist)
eas submit --platform ios --profile production      # uses your ASC API key
eas submit --platform android --profile production  # uses the service-account JSON
```

Then: TestFlight / Play internal testing → beta cohort → store review → release.

## 6. Fast-follow: turn Live Mileage on (after §18 device QA)

Once the GPS adapter is validated on real devices and the App Store privacy
label + Play Data Safety form declare **precise location** (collected · app
functionality · not tracking · not sold):

```bash
eas env:update --environment production --name EXPO_PUBLIC_FF_LIVE_MILEAGE_CORE_ENABLED --value "production"
# background only after the custom-dev-client background QA passes:
eas env:update --environment production --name EXPO_PUBLIC_FF_BACKGROUND_MILEAGE_TRACKING_ENABLED --value "production"
```

Ship it as its own store release (the location-permission strings + background
mode change the native binary, so it isn't an OTA-only change).

---

_Bundle/package: `com.rigreceipts.app`. `eas.json` profiles: development /
preview / production (`appVersionSource: remote`, so EAS owns versioning)._
