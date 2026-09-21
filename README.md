# Habit Tracker

Track habits. Author: Madhav Dih Nair.

## Structure

```text
index.html                 Page markup and script entry points
CNAME                      Existing custom-domain configuration
assets/
  css/styles.css           Styling
  js/app.js                State, calculations, views, and event handlers
  js/storage.js            Persistence functions
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

## Current persistence scope

Supabase is used for **authentication only**. No table queries or file uploads
are made. The old Claude-hosted storage startup is not called. Existing in-memory
habit actions still work after login, but data resets on reload/logout and photo
uploads remain unavailable. A banner explains this in the tracker.

The existing Supabase `habits` and `habit_entries` tables and their RLS are the
target of a later task. The older `server/` and `database/` planning documents
are historical scaffolding, not instructions to create a server or change schema.

## Manual verification

1. Open the site logged out: only the auth screen should appear.
2. Sign up: check for the confirmation message, follow the email link, then log in.
3. Reload while logged in: the tracker should return without showing its contents
   before session restoration. Habits themselves remain temporary.
4. Try incorrect credentials and a failed network request: check for a readable
   error and enabled form controls afterward.
5. Log out, including from a second tab: the tracker and open modals should hide.
6. Log in as another user: the previous account's temporary habits should be gone.
