# Habit Tracker

Track habits. Author: Madhav Dih Nair.

## Structure

```text
index.html                 Page markup and script entry points
CNAME                      Existing custom-domain configuration
assets/
  css/styles.css           Styling
  js/app.js                State, calculations, views, and event handlers
  js/storage.js            Supabase habit/entry loading and writes
  js/supabase-client.js    Supabase browser client using window.APP_CONFIG
  js/auth.js               Signup, login, logout, and session-based UI
  images/                  Cat mood illustrations
server/                    Future authenticated API (see README)
database/
  README.md                Data model and integration plan
  migrations/              Future versioned schema changes
```

The frontend remains framework-free. Keeping `index.html` at the root preserves
its static hosting layout. Classic scripts load storage functions before the
application; existing inline event handlers require global application functions.

## Run locally

From this directory, run `python3 -m http.server 8000` and open
http://localhost:8000. This serves the static frontend only.

## Supabase authentication

The official Supabase JS v2 browser client loads from the
[documented CDN](https://supabase.com/docs/reference/javascript/installing).
`config.local.js` must define `window.APP_CONFIG.SUPABASE_URL` and
`window.APP_CONFIG.SUPABASE_PUBLISHABLE_KEY`. Only `sb_publishable_...` keys are
accepted. Never put a secret or service-role key in browser configuration.
The existing config file stays gitignored and its values are not in tracked code.

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

For GitHub Pages, supply `config.local.js` separately in the deployed artifact
(for example, through a deployment step). A branch-only deployment will not
include the ignored local file. Do not commit it or remove its ignore rule.
This file is public when served; the publishable key is intended for browser use.
No deployment workflow is added in this task.

## Database persistence

The existing tracker reset hook loads the signed-in user's `habits`, then their
`habit_entries`, through `assets/js/storage.js`. Reads are paginated; there is
no Realtime subscription. Reload to see changes made in another browser/tab.
Auth implementation, configuration, database schema, and RLS remain unchanged.

Habit inserts include the authenticated `user_id` and omit `id` so PostgreSQL
generates it. Entry upserts also omit `id` and use the existing unique constraint
on `(habit_id, entry_date)`. Deletion targets only the habit row, relying on the
existing `ON DELETE CASCADE` for entries. These database defaults/constraints
must already exist; the app does not create or change them.

The adapter maps `start` to `start_date`, daily keys to `entry_date`, `createdAt`
to/from `created_at`, and entry `ts` to/from `updated_at`. Dates retain their
`YYYY-MM-DD` calendar representation. Numeric values and nulls are preserved.
Only supported schema fields are sent; photos and notes are not persisted.
`photo_path` is neither loaded nor written, leaving existing values untouched.
Photo upload controls display an unavailable message; Supabase Storage is unused.

Writes temporarily lock habit controls and update in-memory state only after
server confirmation. Failures appear in the page banner and any open modal;
numeric controls revert to confirmed values and modal input is retained.
If a network response is lost, reload before retrying to check whether the server
committed the write. Pending results are ignored after logout/account changes,
and user-specific memory is cleared. A failed initial load requires a reload.

The older `server/` and `database/` planning documents
are historical scaffolding, not instructions to create a server or change schema.

## Manual verification

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
