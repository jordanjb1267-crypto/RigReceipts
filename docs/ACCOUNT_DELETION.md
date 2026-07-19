# Account Deletion & Data Export

How RigReceipts lets a driver export a full copy of their data and permanently
delete their account. This satisfies **App Store Review Guideline 5.1.1(v)**
(apps that support account creation must let users initiate deletion from within
the app) and **Google Play's account/data-deletion policy** (an in-app path
**and** a web URL where deletion can be requested without the app).

## In-app path

**Reports → "Account & data" → Delete Account.** The account screen
(`src/app/account-settings.tsx`, a modal registered in the root layout) offers:

- **Export My Data** — gathers every owner-scoped table into a versioned JSON
  bundle and opens the OS share sheet so the driver can save or send it.
- **Delete Account** — a destructive action behind a confirmation dialog; on
  confirm it runs the deletion RPC and signs the user out.

Both are shown only when signed in. In device-only mode the screen explains that
no account data is stored on our servers, and links to the Privacy Policy and
Terms.

## What deletion removes

`deleteAccount()` (`src/data/account.ts`) calls the
`delete_current_account()` Postgres function, which:

1. Deletes the user's files from the private `receipts`, `documents`, and
   `reports` storage buckets (their per-user folder).
2. Deletes their `auth.users` row, which **cascades** to every owner-scoped
   table (profiles, subscriptions, loads, document_scans, expenses, receipts,
   fuel/maintenance/mileage, detention/reimbursements, rate_share_cards,
   rate_board_posts and their reports/blocks, data_entitlements, …) because all
   of those foreign-key `auth.users(id) on delete cascade`.

The client then signs out locally, returning the app to device-only mode.

**What is not affected:** `lane_rate_aggregates` holds only PII-free, aggregated
lane statistics with no user foreign key, so it contains nothing to delete. We
may retain minimal records where required by law (for example, tax or
fraud-prevention obligations), as stated in the Privacy Policy.

## Backend function

`supabase/migrations/20260719000008_account_deletion.sql`:

- `SECURITY DEFINER` so it can delete the caller's `auth.users` row and storage
  objects, with a **pinned empty `search_path`**.
- Takes **no arguments** and acts **only on `auth.uid()`** — a signed-in user can
  delete only their own account; there is no way to target another user.
- `EXECUTE` is **revoked from `anon`/`public`** and granted only to
  `authenticated`.

The security advisor flags this as
`authenticated_security_definer_function_executable` (WARN). That is
**expected and intentional**: a self-service deletion RPC has to be callable by
the signed-in user over `/rest/v1/rpc`, and it is safe because of the
`auth.uid()`-only guard. This is the standard Supabase pattern for in-app
account deletion; it cannot live in a non-exposed schema and still be reachable
by the client.

## Data export format

`exportUserData(userId)` selects `*` from each table in `EXPORT_TABLES` (RLS
returns only the caller's rows) and wraps them with `buildExportBundle` into:

```json
{
  "format": "rigreceipts.account_export",
  "version": 1,
  "exportedAt": "<ISO timestamp>",
  "userId": "<uuid>",
  "counts": { "expenses": 12, "loads": 3, ... },
  "records": { "expenses": [...], "loads": [...], ... }
}
```

`buildExportBundle` is a pure function with unit tests; the network gather and
the share sheet are exercised on device.

## Web deletion request (Google Play requirement)

Google Play also requires a URL, reachable **without installing the app**, where
a user can request account and data deletion. This page is built:
**`web/delete-account.html`**, to host at
**`https://rigreceipts.app/delete-account`**. It:

- points to the in-app path as the fastest option;
- explains what is deleted and the retention exceptions (mirroring this doc and
  the Privacy Policy); and
- provides a request form that composes an email to **privacy@rigreceipts.app**
  with the account email and a confirmation.

The email path is **operator-fulfilled**: it is a static page, so a request
emails the team, who verify ownership and run the same deletion for that user
via the service role (e.g., `select public.delete_current_account()` executed as
that user, or an admin delete of the user's `auth.users` row). Wiring an
automated verified web endpoint is an optional follow-up; the manual path meets
the policy requirement.

## Testing

The pure export shaping is unit-tested. The full flow — a real export and an
irreversible deletion — must be verified on a device with a signed-in session
against the live project; it cannot run headless. Use a disposable test account.
