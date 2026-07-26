# Store metadata (fastlane-ingestible)

Machine-readable store listing metadata, structured for
[`fastlane deliver`](https://docs.fastlane.tools/actions/deliver/) (App Store)
and [`fastlane supply`](https://docs.fastlane.tools/actions/supply/)
(Google Play). The human-readable rationale, character limits, and privacy
declarations live in [`docs/STORE_METADATA.md`](../../docs/STORE_METADATA.md);
these files hold the exact text those tools upload.

Copy is un-wrapped here on purpose — the stores wrap paragraphs themselves, and
literal newlines in these files render as line breaks in the listing.

## Layout

```
fastlane/metadata/
  en-US/                         # App Store (deliver), primary locale
    name.txt                     # app name (≤30)
    subtitle.txt                 # subtitle (≤30)
    promotional_text.txt         # promo text (≤170, updatable without review)
    description.txt              # full description (≤4000)
    keywords.txt                 # comma-separated, no spaces after commas (≤100)
    release_notes.txt            # "What's New"
    support_url.txt              # PLACEHOLDER — set the real URL before submit
    marketing_url.txt            # PLACEHOLDER
    privacy_url.txt              # PLACEHOLDER — must resolve to a live policy
  review_information/
    notes.txt                    # App Review notes ("not a load board")
  android/en-US/                 # Google Play (supply), primary locale
    title.txt                    # (≤30)
    short_description.txt         # (≤80)
    full_description.txt          # (≤4000)
    changelogs/default.txt        # release notes for the current version code
```

## Before first upload

- **Fill the placeholder URLs** (`support_url`, `marketing_url`, `privacy_url`,
  and Play's equivalents in the console). The privacy URL must point at a live
  policy consistent with the data-safety declarations in `docs/STORE_METADATA.md`.
- **Add screenshots / icon / feature graphic** under
  `en-US/screenshots/` (deliver) and `android/en-US/images/` (supply). Use the
  real Industrial Atlas screens listed in the assets checklist in
  `docs/STORE_METADATA.md`.
- **Categories, age rating, pricing, and IAP** are set in App Store Connect /
  Play Console (or an `Appfile`/`Deliverfile`/`Playfile`), not in these text
  files. Category: Business (secondary Finance). See `docs/STORE_METADATA.md`.
- **Review contact + demo account:** add contact info and, if you want reviewers
  to exercise sync/purchases, demo credentials — do not commit real credentials
  to the repo; supply them in the console or a local, untracked
  `review_information/` addition.
- **Android changelog:** `changelogs/default.txt` applies to any version code
  without a `changelogs/<versionCode>.txt`; add a numbered file per release.
