# Habit Tracker

Track habits. Author: Madhav Dih Nair & his Dihlettes

## Structure

```text
index.html                 Vite/React entry document
public/config.js           Public production Supabase configuration
public/CNAME               Custom-domain configuration copied into the build
assets/css/styles.css      Existing visual system and responsive rules
assets/images/             Cat mood illustrations
src/
  app/                     Authenticated application shell and view coordination
  auth/                    Session provider and signup/login UI
  components/              Reusable modals, banners, photos, and feedback UI
  data/                    Supabase database, Storage, social, and client adapters
  hooks/                   Habit and social state/lifecycle hooks
  lib/                     Habit calculations, dates, streaks, points, and templates
  views/                   Today, Progress, Calendar, Graph, Proof, Friends, Habits
tests/                     Vitest/jsdom regression checks with mocked services
server/                    Future authenticated API (see README)
database/
  README.md                Data model and integration plan
  migrations/              Versioned schema changes, including social features
```

The frontend uses React functional components and hooks, bundled by Vite. It is
still a client-only single-page application: no client-side router or server is
required, and the custom domain serves it from `/`.

## Run locally

Install Node.js 24 LTS, then run `npm install` and `npm run dev`. Open
http://localhost:8000. Use `npm run build` to create the production `dist/`.

## Supabase authentication

The official Supabase JS v2 browser client is installed from npm and bundled by
Vite. `public/config.js` defines `window.APP_CONFIG.SUPABASE_URL` and
`window.APP_CONFIG.SUPABASE_PUBLISHABLE_KEY`. Only `sb_publishable_...` keys are
accepted. Never put a secret or service-role key in browser configuration.
The tracked config contains exactly those two browser-public values, copied from
the existing local configuration. `config.local.js` remains ignored and is not
loaded. Both local development and GitHub Pages use `config.js`.
Malformed configuration or a missing CDN client leaves the app hidden and shows
an actionable error.

Email/password signup and login share an auth form. Confirmation-required signup
shows a check-your-email message. Existing sessions restore on reload; auth
events update the UI, including logout in another tab. Logout signs out this
browser session. Habits are cleared on logout or account changes, but retained
on token refresh. The tracker stays hidden until a session is available.

In Supabase Auth URL Configuration, verify the Site URL is
`https://habittrackerapp.online` and allow these confirmation redirects:

- `http://localhost:8000/`
- `https://habittrackerapp.online/`

If opening `/index.html` explicitly, allow that exact path too. Signup returns
to the current origin and pathname. Use an email confirmation template compatible
with Supabase's hosted verification link, not a custom server callback route.
See [Supabase redirect setup](https://supabase.com/docs/guides/auth/redirect-urls).
No project settings, schema, SQL, or RLS policies were changed by this task.

## GitHub Pages deployment

Commit `public/config.js` with the application files; production does not use the
ignored local config. The tracked GitHub Actions workflow installs locked npm
dependencies, runs regression tests, builds with Vite, and deploys `dist/` to
GitHub Pages after every push to `main` (and supports manual runs from the Actions
tab). In GitHub Pages settings, set the publishing source
to **GitHub Actions** once, confirm the custom domain, and enable Enforce HTTPS
once the certificate is available. Keep `CNAME` as `habittrackerapp.online`.
See [GitHub Pages HTTPS guidance](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https).

Before deployment, verify the Supabase Site URL and allowed redirects above.
After deployment, check that `/config.js` and every referenced asset return 200,
then run the manual checks below on `https://habittrackerapp.online` in a fresh
browser session. Localhost and production have separate browser session storage.

## Repeatable mock checks

Run `npm test`. The Vitest/jsdom suite uses fake auth, database, and Storage
clients; it never loads production config or calls Supabase. It covers auth
gating, confirmation signup, duplicate requests, field mapping, narrow entry
writes, private photo ordering/rollback/signed URLs, and core rest/points logic.

The existing UI creates/deletes habit definitions and updates daily entries;
it does not offer an editor for an existing habit's name/goal/duration. This
reliability pass does not add one. Verify the existing workflows below manually;
mock checks do not establish live browser, RLS, or network correctness.

## Database persistence

The habit state hook loads the signed-in user's `habits`, then their
`habit_entries`, through `src/data/habits.js`. Reads are paginated; there is
no Realtime subscription. Reload to see changes made in another browser/tab.
Database schema and RLS remain unchanged.

Habit inserts include the authenticated `user_id` and omit `id` so PostgreSQL
generates it. Entry upserts also omit `id` and use the existing unique constraint
on `(habit_id, entry_date)`. Deletion removes the habit’s Storage objects first, then targets only the habit
row, relying on the existing `ON DELETE CASCADE` for entries. These database defaults/constraints
must already exist; the app does not create or change them.

The adapter maps `start` to `start_date`, daily keys to `entry_date`, `createdAt`
to/from `created_at`, and entry `ts` to/from `updated_at`. Dates retain their
`YYYY-MM-DD` calendar representation. Numeric values and nulls are preserved.
Only supported schema fields are sent; notes are not persisted. `photo_path` maps
to the existing in-memory `photo` field and contains only a Storage object path.
Writes send only explicitly changed fields: ordinary daily edits do not overwrite
`photo_path`, and photo changes do not overwrite newer daily values from another tab.

## Social accountability

The Friends tab is opt-in. Users create a display name and a public handle, send
and accept friend requests, then choose which friends may see a particular habit's
completion events. The feed never contains numeric values, notes, missed days,
or proof-photo paths. Unsharing a habit immediately prevents that friend from
reading its existing feed records through RLS.

Before deploying the social UI, apply
`database/migrations/20260922_add_social.sql` using the Supabase CLI or SQL
Editor. It creates the social tables, indexes, RLS policies, and the narrowly
scoped `accept_friendship` function. Do not substitute client-side checks for
these database policies, and do not expose a service-role key in the browser.
The migration assumes the existing `public.habits.id` and `auth.users.id` are
UUIDs, as required by the current tracker schema.

After the initial social migration, apply
`database/migrations/20260922_add_friend_controls.sql` to enable cancelling
requests, removing friends, and blocking. Both remove and block also delete
every sharing rule between the two accounts.

Apply `database/migrations/20260922_add_direct_chat.sql` after those migrations
to enable private one-to-one text chat and live message delivery. Only accepted
friends can create, read, or send messages; removing or blocking a friend also
permanently removes the conversation and its messages.

## Private proof photos

The existing private `proof-photos` bucket and Storage policies are required.
The app does not create or change buckets, policies, or schema.
Use the camera button on Today or in a calendar day to upload/replace an image.
The Proof gallery and day editor both offer removal. JPEG, PNG, and WebP files
are accepted, with a client-side limit of 5 MiB (5 × 1024 × 1024 bytes).

Every upload uses a fresh UUID filename under `<userId>/<habitId>/`, with
`upsert: false`. Only the path is saved in `habit_entries.photo_path`. On reload,
paths are loaded from the database and private signed URLs are generated for
visible images. URLs expire after an hour, are refreshed before expiry, and are
cached only in memory. Failed signing/downloads show an inline retry button.
Caches are cleared when the account changes.

Replacement uploads the new object, saves its path, then deletes the old object.
If the database write fails, the app attempts to remove the newly uploaded file.
If old-file cleanup fails after a successful replacement, the new photo remains
saved and the app shows a cleanup warning. Removing a photo deletes its object,
then clears `photo_path`; a failed database clear is reported and can be retried.

Habit deletion reads current photo references and lists its Storage folder
(including leftover uploads) with pagination. It deletes all gathered objects
before deleting the habit row. Entries are still deleted by database cascade.
If listing or object deletion fails, the habit row is not deleted.

Storage and database operations are not atomic. A database failure after object
removal can leave a reference to a missing image; retry the removal/deletion.
A connection or session change can also prevent cleanup; errors are reported
for the active account. Habit-folder cleanup on deletion includes orphaned files
left by a failed replacement. Concurrent edits from multiple tabs are not locked
across tabs, so reload before retrying a failed operation.

Writes temporarily lock habit controls and update in-memory state only after
server confirmation. Failures appear in the page banner and any open modal;
numeric controls revert to confirmed values and modal input is retained.
If a network response is lost, reload before retrying to check whether the server
committed the write. Pending results are ignored after logout/account changes,
and user-specific memory is cleared. A failed initial load requires a reload.

The older `server/` and `database/` planning documents
are historical scaffolding, not instructions to create a server or change schema.

## Manual production verification

1. Open the site logged out: only the auth screen should appear.
2. Sign up: check for the confirmation message, follow the email link, then log in.
3. Create a habit, complete a day, edit numeric values, and mark a rest day.
   Reload and verify the habit, entries, calendar, and statistics are preserved.
4. Try incorrect credentials and a failed network request: check for a readable
   error and enabled form controls afterward.
5. Log out, including from a second tab: the tracker and open modals should hide.
6. Log in as another user: only that account's habits should load, including when
   logging out while a load or save is still pending.
7. Delete a habit and reload: the habit and its entries should be gone.
8. Simulate a failed save: no completion toast should appear, existing data should
   remain intact, and a visible error should explain the failure.
9. Upload JPEG/PNG/WebP proofs, reload, and check both gallery and day previews.
10. Reject GIFs and files over 5 MiB. Replace a proof, then remove it; inspect the
    bucket and entry to verify object cleanup and a path-only database value.
11. Simulate upload, signing, deletion, and database-update failures. Verify visible
    errors, cleanup attempts after failed photo saves, and no premature habit delete.
12. Delete a habit with photos: its objects should disappear before the habit row.
13. Repeat rapid clicks and offline failures; confirm controls recover and no
    unhandled Promise rejection appears in the browser console. During a slow
    session restore, the tracker must stay hidden. During data loading, show
    loading text rather than an empty-habits prompt.
14. Leave a photo open past the signed URL refresh window, then test retry after
    disconnecting/reconnecting. Log out while operations are pending and verify
    that the next account sees no stale photos, habits, or notifications.
15. Create a Friends profile, send/accept/cancel a request, remove a friend, and
    block a request. Confirm each account sees only the relationship state allowed
    by RLS.
16. Share one habit with one accepted friend. Complete and uncomplete a day;
    confirm only completion metadata appears in the friend's feed and no value,
    metric, note, or photo path is exposed.
17. Open direct chat in both accounts. Confirm initial history, live delivery,
    deduplication, unread badges, and subscription cleanup after closing or logout.
18. Check the Today, Progress, Calendar, Graph, Proof, Friends, and Habits views
    at desktop and mobile widths, including dark/light theme persistence.
