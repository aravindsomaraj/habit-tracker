# Google sign-in setup and verification

The frontend implementation is ready for configuration. Google Cloud and the
hosted Supabase provider have **not** been configured or live-tested by this
change. Do the dashboard steps and real-account checks below before calling
Google sign-in operational. No database migration is required.

## Authentication flow

Login and signup share the same official Google button. The central AuthProvider
calls `signInWithOAuth({ provider: 'google', options: { redirectTo } })`. Supabase
handles authorization, the Google callback, and the existing implicit browser
session flow. There is still one active auth subscription and one Supabase client.

```text
New user → Google → Supabase /auth/v1/callback → app /?oauth=google
         → validated Supabase session → existing tracker (initially empty)
Returning user → Google → Supabase callback → same Supabase user ID
               → existing habits, entries, progress, history and photos
```

The return URL uses the current document's origin and pathname, dropping its
query/hash before adding `?oauth=google`. This serves the existing HTML document
on Vite and GitHub Pages without a server rewrite. Vite's base remains `/` and
`public/CNAME` remains `habittrackerapp.online`. The HashRouter is mounted only
after authentication; OAuth credentials do not become a React route.

The marker classifies a return; it does not authenticate anyone. Auth waits for
SDK initialization and a valid session before completing that return. A failed,
cancelled, or incomplete callback stays on usable Login even if an older account
was stored. Late initial-session events cannot override that result. A new
explicit sign-in can retry. A failed return does not revoke a pre-existing valid
Supabase session: visiting the clean site again restores it normally.

Explicit recovery URLs, an existing recovery continuation, and PASSWORD_RECOVERY
retain precedence. Only the old ambiguous-token fallback excludes marked Google
returns. Recovery remains:

```text
Recovery link → PASSWORD_RECOVERY → Set New Password → updateUser()
              → local signOut() → Login with password-updated message
```

Google initiation shares the password form's synchronous duplicate-submit lock.
Failures restore controls with a safe message; successful initiation stays busy
until navigation. Browser Back through the back/forward cache restores controls.
No second auth listener, Google-login storage flag, or timing workaround is added.

## Google Cloud / Google Auth Platform

1. Select or create the Google Cloud project for Habit Tracker. Open **Google
   Auth Platform** (older navigation: APIs & Services → OAuth consent screen).
2. Under **Branding**, use the app name **Habit Tracker**, your actual support
   email and developer contact email, and homepage `https://habittrackerapp.online`.
   Add `habittrackerapp.online` as an authorized domain. Supply your real public
   privacy-policy/terms URLs if requested; this repo does not provide those pages.
   Complete domain ownership verification if Google requests it. Branding/logo
   review is Google's process; do not assume a custom displayed name is approved.
3. Under **Audience**, select **External** for a public app. Use Internal only
   if intentionally restricting the app to a Google Workspace organization.
4. Under **Data Access**, use only `openid`,
   `https://www.googleapis.com/auth/userinfo.email`, and
   `https://www.googleapis.com/auth/userinfo.profile`. No Drive, Calendar,
   offline access, or additional Google API scopes are needed.
5. Under **Clients**, create an OAuth client with application type **Web
   application**, for example **Habit Tracker Web**.
6. Add these **Authorized JavaScript origins** (origins only):

   ```text
   http://localhost:8000
   https://habittrackerapp.online
   ```

7. Add this **Authorized redirect URI**:

   ```text
   https://vzlwsarcztlszdpfzepu.supabase.co/auth/v1/callback
   ```

   This is derived from the tracked public Supabase project URL. Confirm it
   matches the callback shown in Supabase's Google provider panel exactly.
   Local Vite also uses this hosted project, so its Google callback is the same;
   do not substitute a local Supabase CLI callback or an application route.
8. Copy the Client ID and Client Secret into **Supabase's provider settings**
   below. Do not add them to this repository, `public/config.js`, or `VITE_*`.

Testing/publishing: Google's general Testing limit/test-user list has an
exception for sign-in requesting **only** the basic name/email/profile scopes
above: users need not be on the test-user list, and the usual testing warning
and seven-day authorization expiry do not apply. Adding other scopes changes
that rule. Publish to **In production** when ready for public release and follow
any displayed branding/domain verification requirements. Basic sign-in does not
require sensitive/restricted-scope verification. Workspace/admin restrictions
can still prevent some accounts from signing in. See [Google's audience and
testing rules](https://support.google.com/cloud/answer/15549945?hl=en) and
[Supabase's Google configuration guide](https://supabase.com/docs/guides/auth/social-login/auth-google).

## Supabase Dashboard

1. Select project `vzlwsarcztlszdpfzepu`. Open **Authentication → Sign In /
   Providers → Google** (the panel may be labelled Providers).
2. Enable Google. Enter the web OAuth **Client ID** in Client IDs and the
   **Client Secret** in the secret field. Save. Keep normal email/nonce checks
   enabled; this integration does not need relaxed security or manual linking.
3. Open **Authentication → URL Configuration**. Set **Site URL** to:

   ```text
   https://habittrackerapp.online
   ```

4. Add these exact **application Redirect URLs**:

   ```text
   http://localhost:8000/?oauth=google
   https://habittrackerapp.online/?oauth=google
   ```

   Preserve the existing confirmation and password-recovery allowlist entries:

   ```text
   http://localhost:8000/
   https://habittrackerapp.online/
   http://localhost:8000/?recovery=1
   https://habittrackerapp.online/?recovery=1
   ```

   If you open `/index.html` explicitly, also allow
   `http://localhost:8000/index.html?oauth=google` and
   `https://habittrackerapp.online/index.html?oauth=google`, plus the existing
   confirmation/recovery equivalents for that path. Use the canonical domain;
   any additional origin/port needs its own allowlist entry.

**Google's redirect URI is the Supabase callback. Supabase's redirect URLs are
the application pages. These are different settings.** An unallowlisted
`redirectTo` can fall back to the Site URL and lose the Google return marker;
verify the query is present during real testing. Keep the existing Resend SMTP,
confirmation templates, and recovery templates unchanged.

## Identity and data audit

[Supabase documents automatic identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking)
for the same verified email. An existing verified password user signing in with
the matching Google email is expected to gain a Google identity on the existing
Supabase user, retaining its UUID. This is documented behavior, **not a live
verification of this project's hosted settings or any specific account**. No
custom merging, email-based data reassignment, or manual auth-user creation is used.

The code audit confirms that TrackerApp and the data hooks use `session.user.id`,
never a provider-specific ID. Habits belong to `user_id`; entries belong to those
habits; progress/calendar/history derive from those entries. Proof objects use
`<userId>/<habitId>/...` with existing private Storage policies and signed URLs.
Account changes reset user-specific habit/social/photo state and stale requests.
Existing RLS uses `auth.uid()` (Storage uses JWT `sub`), so the same Supabase UUID
has the same access regardless of sign-in provider. Public/discoverable profiles
and deliberately shared social records keep their existing access rules.

There is no tracked new-auth-user trigger requiring password metadata. Friends
profiles are opt-in, upserted by UUID only when the user creates one. Missing
profiles are supported, and neither Google names nor avatars are required.
First login starts empty; returning login performs no duplicate initialization.
Actual deployed triggers/policies still need the live checks below.

The frontend contains no Google secret, service-role credential, or Resend key.
Only the existing public Supabase configuration is loaded. Google tokens received
by the SDK are not used for API access and are removed by the session storage
adapter before persistence; Supabase access/refresh credentials retain their
existing storage key and restoration behavior. URL callback credentials/errors
are removed after initialization. Logout uses the existing local Supabase logout,
not Google account revocation. Schema, RLS, storage policies, and Resend are unchanged.

## Real-account acceptance checklist

After dashboard configuration, run `npm run dev` and open
`http://localhost:8000/` (use localhost, not 127.0.0.1 or the LAN address).
Repeat on `https://habittrackerapp.online/` after deploying the built application.
Use test accounts you control; don't share tokens, passwords, or callback URLs.

1. **Password baseline:** log in to a verified password account. Record its UUID
   in Supabase Authentication → Users. Create a habit, entries (including a
   numeric value/rest day), and a proof photo. Note progress/history and any
   existing Friends profile. Log out, log in again, and check all data remains.
2. **Same verified email:** log out and choose Sign in with Google using exactly
   that account's verified email. Verify the app opens, all baseline data remains,
   and Supabase Users still shows the **same UUID** with the Google identity.
   Check that no duplicate auth user or Friends profile appeared. Log out and
   verify password login still works. If the UUID differs or data is missing,
   stop and investigate provider/identity settings; do not manually merge users.
3. **New Google user:** choose a different fresh Google account. Check Google
   selection/consent → Supabase callback → app. Create a habit, complete/edit
   entries, upload/replace a proof, inspect Progress/Calendar/Proof, and refresh.
   Check persistence, then log out. Missing Friends profile should offer normal
   opt-in creation, not block the tracker.
4. **Returning Google user:** sign in again as that user. Confirm the same UUID,
   data, and profile count. Refresh a hash view and confirm restoration. Log out
   and confirm only Login remains, including in another open app tab.
5. **Isolation:** log in as the other Google account in a separate browser profile.
   Verify no private habits, entries, progress/history, or photos from the first
   account appear. Using only that account's authenticated SDK/REST session,
   attempt reads/writes of known first-account habit/entry IDs and signing or
   downloading its private Storage paths: RLS must deny access (or return no
   rows). Do not use dashboard SQL/service-role access to test RLS. Intentionally
   shared completion metadata/discoverable profiles follow existing social rules.
6. **Cancellation/failures:** cancel Google's consent and verify usable Login
   with a neutral cancellation message if redirected back. If Google stays on
   its own page, browser Back should restore usable controls. Test offline
   initiation, provider-disabled errors, rapid double clicks, and a return URL
   with `?oauth=google#error=access_denied`. Also open `/?oauth=google` without
   credentials: it must not treat the marker as proof or open an older account.
7. **Recovery:** request a real Resend recovery email. Click its link while
   signed out, then repeat while another account is signed in. Set New Password
   must appear before any tracker render. Submit matching passwords, verify
   sign-out and the success message, old password failure, and new password
   success. Check recovery refresh, expired/used links, and direct reset access
   using [PASSWORD_RECOVERY.md](PASSWORD_RECOVERY.md).
8. **Confirmation/UI:** repeat email signup and confirmation. Check both auth
   views' Google button on mobile and desktop, keyboard focus/Enter/Space, loading
   feedback, and errors. In Network verify the Google SVG returns 200, the app
   return reaches `/` with `?oauth=google`, credentials are removed afterward,
   and no Google API tokens remain in the persisted Supabase session.

Automated tests use mocks plus the installed Supabase SDK with mocked HTTP;
they cannot prove live Google consent, automatic linking, server RLS, SMTP, or
production dashboard configuration. Those checks remain manual.

## Implementation verification

- Full Vitest suite: **85 tests passed in 7 files** using
  `npm test -- --maxWorkers=1`. An initial parallel auth-test run hit timeouts;
  serial execution passed without changing timeouts or existing assertions.
- Installed-SDK callback tests cover Google returns, previous-account sessions,
  malformed/cancelled/rejected returns, password retry, Google session refresh
  and logout, and recovery precedence. React tests exercise duplicate requests,
  initiation errors, browser Back, initialization ordering and Strict Mode cleanup.
- Existing tests cover password login/signup/logout/recovery, habit/entry
  persistence contracts, proof-photo paths and cleanup, routing and views.
- `npm run lint` cannot run: the repository has no lint script/configuration.
- `npm run build` passes; Vite reports its >500 kB main-chunk warning.
- Development and production-preview HTTP checks return 200 for the callback
  document, optional `/index.html` callback, Google SVG, and CNAME. Checks used
  temporary ports 18000/18001 because 8000 was occupied; configured development
  remains localhost:8000. The built JS references the emitted hashed SVG.
- The SVG matches Google's downloadable original. Diff/credential-pattern checks
  found no unintended files or new secrets. No browser-automation runtime was
  available; rendered browser and live-provider checks remain in the checklist.
