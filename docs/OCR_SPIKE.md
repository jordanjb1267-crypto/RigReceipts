# Scan / OCR Spike (Phase 6)

The spec review flagged **on-device OCR under Expo as the biggest technical
risk**. This spike de-risks it: it picks an approach, builds the full
capture → OCR → review → save flow, and lands the parts that can be verified
without a device (a tested pure-TS parser and a graceful-degradation engine).

## Decision

**On-device recognition via `@react-native-ml-kit/text-recognition`** (Google
ML Kit Text Recognition v2 on both iOS and Android), captured with
`expo-camera`, with `expo-image-picker` for choosing an existing photo.

Why this over the alternatives:

| Option                                          | Verdict                                                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `@react-native-ml-kit/text-recognition`         | **Chosen.** One API, both platforms, on-device (private, offline, free). Native module → needs prebuild, not Expo Go.    |
| Custom native module (VisionKit + ML Kit)       | Best quality ceiling but far more work; revisit only if the community module underperforms.                              |
| `react-native-vision-camera` + frame processors | Powerful but heavier; overkill for still-document capture.                                                               |
| Server-side Google Cloud Vision                 | Kept as a **fallback** for hard documents (see below); adds latency, cost, and a network dependency, so not the default. |

This matches the Master Build Prompt's API guidance (iOS Vision / Android ML
Kit, optional Cloud Vision fallback).

## What was built

- `src/ocr/parseReceipt.ts` — pure, Hermes-safe heuristic parser: grand total
  (prefers "amount due"/"total", excludes subtotal/tax, ignores per-gallon
  price), vendor, date (numeric, ISO, and month-name formats; 2-digit years),
  and fuel gallons. Never throws; unknown fields return null.
- `src/ocr/engine.ts` — `recognizeDocument(uri, opts)` tries ML Kit and, if the
  native module is absent or errors (Expo Go, web, CI, this sandbox), falls back
  to a **stub** that returns fixture text. Every result carries `engine`
  (`mlkit` | `stub`) so the UI can flag sample OCR.
- `src/ocr/fixtures.ts` — realistic sample OCR text per document type, shared by
  the tests and the stub.
- `src/store/captures.ts` — persisted **offline-first** capture queue
  (`pending_sync` → `synced`), so scans survive an app close (spec §7).
- `src/app/(tabs)/scan.tsx` — capture state machine: type picker →
  camera / choose photo / use sample → OCR → **editable review sheet** → save.
  Camera permission is requested only when the camera opens.
- 17 fixture-based parser tests (`src/ocr/__tests__/parseReceipt.test.ts`).

## OCR is never trusted silently

Recognition only pre-fills the review sheet. The user confirms or edits every
field before a record is created (Master Build Prompt Loop 3). Wrong guesses are
corrected, not saved.

## What still needs a real device

On-device ML Kit recognition **cannot be exercised in this environment** — no
simulator, and iOS pods / Android ML Kit only link in a prebuilt dev client.
Verified here: typecheck, lint, the parser test suite, a both-platform Metro
bundle, and `expo prebuild` (native config generates with the camera permission
and ML Kit autolinked). Still to verify on hardware:

- ML Kit recognition accuracy on real fuel/BOL/lumper photos.
- iOS pod install — **known risk:** ML Kit may require
  `use_frameworks! :linkage => :static`, which can conflict with other pods;
  budget time for the first EAS iOS build.
- Android minSdk / build-size impact from the ML Kit dependency.

## Build & test on a device

```bash
npx expo prebuild                 # generate native projects
npx expo run:android              # or run:ios (needs a Mac + CocoaPods)
# In app: Scan tab → Open Camera → shoot a receipt → review → save
npm test -- src/ocr               # parser unit tests
```

## Fallback plan (later)

For low-confidence results, add a `cloudVisionEngine` behind the same
`recognizeDocument` interface: upload the image to a Supabase Edge Function that
calls Google Cloud Vision, then run the identical `parseReceipt` on the returned
text. The interface already isolates this — only `engine.ts` changes.
