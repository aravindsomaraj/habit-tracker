# Password recovery deployment and verification

The frontend uses Supabase Auth's `resetPasswordForEmail` and `updateUser` APIs.
Supabase generates and consumes recovery credentials and uses its configured email
provider. No database migration, custom token service, Admin API, Resend browser
API call, or new secret is involved.

## Flow and routing

1. Select **Forgot password?** on Login and submit an email address.
2. The form shows **If an account exists for that email, we've sent a password reset link.**
   Account-dependent errors (including per-address email throttling) use that same
   response. Operational errors use safe connection/rate-limit guidance.
3. Supabase sends its recovery verification link using the existing email provider.
4. The link returns to the current app origin/path with `?recovery=1`:
   `https://habittrackerapp.online/?recovery=1` or
   `http://localhost:8000/?recovery=1`.
5. The existing central auth subscription receives `PASSWORD_RECOVERY`. The reset
   form takes precedence over the tracker; the hash router mounts only after auth
   and recovery have finished. This leaves the URL fragment available for the
   existing Supabase implicit-flow parser. GitHub Pages serves `/` directly; no
   `/reset-password` route, server rewrite, or hash-route callback is needed.
6. Enter and confirm a password. The six-character minimum matches the tracked
   `supabase/config.toml` and is shared with signup. Hosted password policy remains
   authoritative; verify it in the dashboard. Existing login accepts old passwords
   without imposing new client-side restrictions.
7. The app verifies the current user with Supabase, then calls `updateUser`.
8. After the password update succeeds, the app calls `signOut({ scope: 'local' })`.
   Login then shows **Password updated successfully. Sign in with your new password.**
   The message is set after sign-out completes so `SIGNED_OUT` cannot erase it.
   The app never explicitly signs out other devices. If local sign-out fails,
   the tracker stays blocked and the user can retry sign-out without updating
   the password again. This completion phase also survives a refresh.

A tab-scoped, one-hour continuation marker permits refresh while entering the new
password. It stores only the user ID, session ID, expiry, and completion phase, never credentials or
passwords. Restoration requires a matching session and a successful server user
check. The marker is a UI guard, not an authorization credential. Supabase remains
responsible for authorization. If session storage is blocked, the initial reset
works, but a refresh requires a new email link. Success, expiry, logout, and session
changes invalidate the context. A manual reset URL or failed/reused callback never
becomes a reset form merely because an ordinary login session exists. Failed
callbacks are rejected from Supabase's initialization result, not a timeout or a
cached session returned by `getSession()`. Successful callbacks wait for
`PASSWORD_RECOVERY`; no timer decides when the tracker may render.

## Recovery routing fix

The deployed bundle inspected during this fix (`index-CED6t2yf.js`) contained the
SDK's recovery support but no application reset screen or recovery-state guard.
The tracked auth provider ignored the event name and applied every returned
session as `signedIn`; the tracked app gate rendered the tracker for any session.
The local recovery files existed separately. A regression test reproduced the
result: a recovery callback with a restored session rendered `Tracker for person`.
Deploy the complete source change, including the recovery files and their wiring.

The central subscription now dispatches recovery events before ordinary session
handling. Recovery intent is captured before SDK initialization, from the redirect
marker, query/hash callback parameters, or a persisted same-session continuation.
The gate remains in recovery through `INITIAL_SESSION`, `SIGNED_IN`, and token
refresh events. Only `PASSWORD_RECOVERY` opens a fresh reset form. The provider
also reads `initialize()` errors, because failed callbacks may leave an earlier
valid session intact; `getSession()` alone cannot establish callback success.
The existing single subscription is cleaned up on unmount and Strict Mode replay.
Completed-session notifications cannot reopen recovery or sign that session back
in after local sign-out.

The UI locks concurrent submissions, removes the send button after success, and
uses a one-minute in-page cooldown across form navigation. Supabase's server rate
limits remain authoritative; this is accidental-repeat protection, not a security
rate limiter. Password fields follow the existing masked-field convention.

## Required hosted Supabase settings

These are dashboard settings; changing repository files does **not** apply them.

In **Authentication → URL Configuration**:

- **Site URL:** `https://habittrackerapp.online`
- Keep existing confirmation redirects:
  - `http://localhost:8000/`
  - `https://habittrackerapp.online/`
- Add these exact **Redirect URLs**:
  - `http://localhost:8000/?recovery=1`
  - `https://habittrackerapp.online/?recovery=1`
- If you explicitly use `/index.html`, also allow:
  - `http://localhost:8000/index.html?recovery=1`
  - `https://habittrackerapp.online/index.html?recovery=1`
  - Keep the corresponding `/index.html` confirmation URLs.

Use `localhost:8000` as documented. Other origins/ports (including `127.0.0.1`)
need their own exact URLs. The redirect derives from the running app's origin and
pathname; no new frontend environment variable is required. Leave the existing
`public/config.js`, `public/CNAME`, Vite base, and deployment workflow unchanged.
The tracked CLI config has starter local URLs and commented-out SMTP examples;
it does not establish the hosted project's current configuration.

In **Authentication → Email → Templates → Reset password** (the dashboard may
label this section **Email Templates**), set the subject to
**Reset your Habit Tracker password**. Keep any existing compatible branding, or
use this scoped template:

```html
<div style="font-family:Arial,sans-serif;color:#24332c;max-width:480px;margin:auto;padding:24px">
  <h1 style="font-size:24px">Habit Tracker</h1>
  <h2 style="font-size:20px">Set a new password</h2>
  <p>Follow this link to choose a new password and return to your habits.</p>
  <p><a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#315845;color:white;padding:12px 20px;text-decoration:none">Reset password</a></p>
  <p>If you didn’t request this, you can ignore this email.</p>
</div>
```

The button must use `{{ .ConfirmationURL }}`, which includes Supabase's hosted
verification endpoint and the requested redirect. Do not substitute a bare
`{{ .SiteURL }}`, `{{ .RedirectTo }}`, frontend hash route, or hand-built token.
See [Supabase email templates](https://supabase.com/docs/guides/auth/auth-email-templates)
and [password recovery API](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail).

## Resend / SMTP

No Resend integration code or credentials were changed. The repository contains
no active Resend integration, SMTP secret, or branded auth template; hosted
configuration cannot be confirmed from this checkout. Preserve the working
Supabase → Resend integration and verify recovery delivery in its logs.

In **Authentication → Email → SMTP Settings**, verify **Enable Custom SMTP** and
the existing Resend credentials (the native Resend integration may manage these):

- Host: `smtp.resend.com`
- Port: `465`
- Username: `resend`
- Password: the existing Resend API key, **dashboard only**
- Sender email: the existing address on your verified Resend domain; the exact
  address is not represented in this repository.
- Sender name: `Habit Tracker` (or preserve the existing branded sender).

Verify the sending domain in Resend, preserve its working DNS records, and disable
email click tracking for auth links. In **Authentication → Rate Limits**, verify
email limits suit your deployment; custom SMTP still has Supabase rate limits.
Keep existing expiry/password settings unless deliberately changing policy.
See [Resend SMTP setup](https://resend.com/docs/send-with-supabase-smtp) and
[Supabase rate limits](https://supabase.com/docs/guides/auth/rate-limits).

## Real email and regression checklist

Automated tests mock Supabase. They cannot certify hosted SMTP, email delivery,
actual token consumption, dashboard settings, or production layout/routing.

- [ ] On localhost, log out → Forgot password → enter a registered email → send.
      Confirm the neutral response; rapid submits must produce one request.
- [ ] Confirm the email arrives through Resend (check inbox, spam, and delivery
      logs), uses Habit Tracker branding, and links through Supabase verification.
- [ ] Open the link in the same browser and a fresh browser, while logged out and
      while logged into another test account. The new-password form must appear
      first; neither account's tracker should render during recovery.
- [ ] Refresh the new-password form before submitting: the verified same-session
      continuation should restore. No credential should remain in the URL.
- [ ] Try a short password and mismatching confirmation: no update request.
      Check any stricter hosted password rules and same-password rejection.
- [ ] Set a new password → local sign-out → Login displays the success message.
      Confirm the old password fails and the new password signs into the correct
      account. Refresh: the recovery screen must not reopen.
- [ ] Simulate a sign-out network failure after the password update. The app must
      remain blocked, show that the password changed, and offer sign-out retry.
      Refresh during that state: it must not offer another password update.
- [ ] Request for a nonexistent email: same neutral response. Repeat requests and
      trigger throttling: no account details or raw service errors in the UI.
- [ ] Try expired and already-used email links, malformed callbacks, and manually
      open `/?recovery=1` with and without an ordinary signed-in session. Expect
      friendly recovery failure and Request another password reset link.
- [ ] Disconnect during link verification, sending, and password update. Verify
      useful error/retry behavior. If an update response is lost, confirm which
      password works before requesting another reset.
- [ ] Log out or switch accounts in another tab during verification/update;
      pending results must not reopen recovery or show another user's data.
- [ ] Repeat the entire email flow on `https://habittrackerapp.online`, opening
      links directly and refreshing. Confirm no GitHub Pages 404 and unchanged
      custom domain, HTTPS, config loading, assets, and normal `/#/today` routing.
- [ ] Check desktop and mobile widths, keyboard submission, focus on screen
      changes, field labels, disabled controls, and announced status/error text.
- [ ] Regression: signup → Resend confirmation email → confirmation link → login;
      logout, normal refresh/session restoration, expired sessions, token refresh,
      habit/data loading, and bookmarked authenticated/unauthenticated hash routes.

## Automated verification for this implementation

- `npm test`: **68 tests passed across 6 files**, including the existing suite.
  New coverage includes request navigation/validation, safe messages, request and
  update locks, recovery-event ordering, same-session refresh, invalid/expired
  contexts, password policy errors, successful update and cleanup, auth races,
  normal signed-in/confirmation events, logout, and Strict Mode listener cleanup.
  Eleven tests use the actual installed Supabase SDK with mocked HTTP responses:
  query/hash recovery callbacks, an existing different account, malformed and
  expired callbacks, manual reset access, legitimate recovery refresh, ordinary
  session restoration, and email confirmation. They assert that the tracker was
  never rendered during recovery and verify password update before local sign-out.
  Mocked-event tests also cover late events after completion, sign-out failure and
  retry/refresh, and preservation of the Login success message.
- `npm run build`: **passed**. Vite reports a non-fatal JavaScript chunk-size
  warning (approximately 554 kB before gzip).
- `git diff --check`: **passed**.
- `npm run lint`: **not available**; this repository defines no lint script or
  linter configuration. Build/test success is not a substitute for linting.
- No manifest/lockfile change was needed for this fix. No automated real-browser
  tool was available; the SDK integration checks run in jsdom. Live Supabase/Resend
  email and browser checks above remain manual. The deployed old bundle must be
  replaced by a deployment containing all recovery source files and their imports.
