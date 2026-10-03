# Public handles

## Audit and architecture

The repository and linked Supabase project were inspected on 2026-10-03 before
implementation. A later read-only check after a failed migration attempt found 36
Auth accounts and 3 profiles, all with valid handles. The live project uses newer
profile and friendship policy names than the checked-in base social migration;
its profiles also have `bio` and `leaderboard_enabled` columns. The onboarding
migration now accepts both policy versions and preserves the blocked-user rule. No user emails, provider tokens, or private
habit contents were needed for this audit.

The existing `public.profiles` table is retained. `profiles.id` is a primary key
and foreign key to `auth.users.id`; the handle is only a public identity. Habits,
entries, photos, friend requests, friendships, shares, and chats keep their UUID
ownership. No users or data are recreated or moved.

`AppGate` checks password recovery first, then the existing central AuthProvider
status. Only a normal signed-in session mounts `HandleGate`, keyed by user UUID.
It reads the profile before mounting the tracker; an in-flight read is reused
across Strict Mode effect replay, and token refresh does not re-fetch it. Friends
receives this profile instead of fetching it again. Account changes and logout
unmount the gate, so late reads/writes cannot display another account's state.
Read failures offer retry and logout; they never count as a missing profile.

The one-time post-login screen matches the user's preferred onboarding flow and
fits the existing application gate without adding another auth subscription or
changing AuthProvider. Normal private use resumes as soon as a handle is chosen.
There is no separate account/settings screen, so this change does not add handle
editing UI. Own-profile updates remain supported by the database; future editing
must use the same rules. Friendships survive handle changes because they use UUIDs.

## Creation flow

```text
Email signup → email confirmation/authentication → suggested email-prefix handle
             → user edits/confirms → database claim → application

Google signup → OAuth → Supabase callback validation → suggested handle
              → user edits/confirms → database claim → application
```

Existing accounts without a profile, or with a NULL handle, follow the same screen
on their next authenticated visit. Existing handles bypass setup unchanged,
including previously allowed reserved names. The migration never derives or
publishes a handle from an email. Auth signup itself does not write a profile.

Suggestions remove plus-address tags, replace invalid runs with underscores,
trim boundary underscores, lowercase and truncate to 24 characters. For example,
`john.smith+work@example.com` suggests `john_smith`. Unusable/reserved suggestions
leave the field empty. Manual input clearly normalizes uppercase and an optional
leading `@`; invalid interior characters are rejected. Rules are 3–24 ASCII
lowercase letters, digits, or underscores. No `@` is stored.

Availability is debounced by 350 ms, with stale responses ignored and network
retry available. It is advisory. The final claim handles PostgreSQL `23505`
conflicts with “That handle is already taken. Choose another.” Duplicate submits
are locked. A second tab's stale claim cannot replace an already chosen handle.

## Database and security

Migration: `database/migrations/20261003_handle_onboarding.sql`.

- Makes the existing handle nullable for safe progressive onboarding; absent
  profile rows also remain valid until the user confirms a handle.
- Retains `profiles_handle_check` (lowercase format) and `profiles_handle_key`
  (`UNIQUE(handle)`). Together they enforce case-insensitive uniqueness. A trigger
  normalizes future writes, validates reserved names, and prevents clearing a
  chosen handle. Existing rows are not rewritten; no extra unique index is needed.
- Keeps the existing self-only INSERT/UPDATE RLS policies. `claim_handle(text)` is
  SECURITY INVOKER, takes no user UUID, and uses `auth.uid()`. Existing display
  names and discoverability preferences are preserved; new profiles use the
  explicitly confirmed handle as their initial display name.
- `handle_available(text)` is a SECURITY DEFINER boolean query so a hidden
  profile's handle cannot falsely appear available. It exposes no identity fields.
- `can_request_friend(uuid)` is a SECURITY DEFINER boolean used by friendship
  INSERT RLS. It requires the caller's handle and a discoverable recipient with a
  handle, while avoiding recursion between profile and friendship policies.
- All functions use an empty, fixed search path. Callable RPCs are authenticated
  only. Anonymous access is denied.
- Restricts profile SELECT grants to `id, handle, display_name`, including for
  future private columns. RLS retains discoverability and visibility to connection
  participants; pending requests remain identifiable if their sender hides their
  profile, while blocked users stay hidden from each other. No email, Auth/Google metadata, tokens, or timestamps are discoverable.
- Friend requests still use requester/addressee UUIDs. Exact `@handle` lookup is
  normalized and selects only public directory fields. Both client and database
  reject self-friending. Acceptance, removal, blocking, chat and sharing continue
  using their existing UUID relationships and policies. Legacy NULL handles have
  a safe display fallback. No service-role key or database credentials are added
  to the frontend.

The current handle appears as a subtle link in the account footer alongside
Friends and logout, and in the Friends invite card. It uses the current design
stylesheet, remains accessible on mobile above the floating navigation, wraps long
handles, and opens Friends. The Today journal is not cluttered.

## Deployment: migration is not applied remotely

Only read-only remote inspection was performed. The migration has been tested on
embedded PostgreSQL, but **has not been applied to the linked Supabase project**.
Do not deploy the new frontend until the following database steps pass.

1. Open the linked project `vzlwsarcztlszdpfzepu` in Supabase Dashboard → SQL Editor.
2. Confirm the existing social, friend-controls and direct-chat migrations are
   present (they were present during the audit). Do not rerun those migrations.
3. Open the corrected `database/migrations/20261003_handle_onboarding.sql` locally,
   copy its entire contents into a new SQL Editor query, and run as `postgres`.
   It includes `BEGIN`/`COMMIT`; any error rolls back the change. A prior attempt
   failed because the live SELECT policy is named `profiles visible to their circle`
   rather than `profiles are discoverable to friends`. This version handles both
   names and can be rerun. If a failed editor session remains in an aborted
   transaction, run `ROLLBACK` before retrying.
4. Run the entire read-only file `database/checks/20261003_handle_onboarding.sql`
   as `postgres`. All 13 rows must say `passed = true`.
5. Inspect Database → Tables → profiles → RLS: self-only insert/update still use
   `auth.uid()`. Check that profiles and friendships both have RLS enabled.
6. Complete the two-account checks below, then deploy the built frontend through
   the existing GitHub Pages workflow. No Auth, Google, Resend, Storage, or redirect
   configuration changes are required.

Alternative for an operator with `psql`: use the Dashboard's database connection
information, configure libpq securely (for example a local pg_service entry named
`habit_tracker` plus `.pgpass`), and run from the repository root:

```sh
psql 'service=habit_tracker' -X -v ON_ERROR_STOP=1 -f database/migrations/20261003_handle_onboarding.sql
psql 'service=habit_tracker' -X -v ON_ERROR_STOP=1 -f database/checks/20261003_handle_onboarding.sql
```

Do not paste credentials into frontend config or commit them. This repository
stores its SQL in `database/migrations`, not `supabase/migrations`; a plain
`supabase db push` does not discover these files. Use the explicit SQL Editor or
`psql` process above. Migration history tooling is unchanged.

## Automated verification

Verified results on 2026-10-03:

- `npm test`: **149 passed across 10 files**, including 22 PostgreSQL/RLS tests.
- `npm run build`: passed; Vite reports a 562 kB JavaScript chunk warning.
- `git diff --check`: passed.
- Deployment SQL verification: all 13 checks passed against both supported test schemas.
- No lint script exists.

One unrestricted parallel run timed out across unrelated suites during concurrent
startup. Test workers are now capped at two; assertions and timeouts are unchanged,
and the complete suite passes with that configuration.
The new tests exercise real PostgreSQL constraints and RLS using PGlite (a dev-only
dependency), UI/adapter behavior, and existing real Supabase SDK callback tests.
The contention test deliberately lets both users check availability before one
claims and the second receives `23505`; PGlite executes statements serially, so
this is not a two-connection concurrency/load test. Database UNIQUE enforcement
is the authority for concurrent production claims.

Real Google consent, email delivery, browser layout and remote RLS checks still
need deployment smoke testing. No production users are created by the tests.

## Manual acceptance checklist

Use two ordinary test accounts in separate browser profiles after migration.

1. **Existing account without a handle:** record its Auth UUID and existing habits,
   history and proof photos. Log in, edit the suggested handle and continue. Verify
   the same UUID and data remain, with `@handle` in the account footer and Friends.
2. **New email account:** sign up; verify the confirmation message and absence of a
   premature profile write. Confirm the email, authenticate, edit/confirm a handle,
   and enter the app. Refresh and verify the handle persists.
3. **New Google account:** use Continue with Google and complete OAuth. Verify the
   suggestion is editable, nothing is published before Continue, and the confirmed
   handle survives logout/login. Cancel a Google attempt and verify login remains
   usable without showing a previous account.
4. **Existing handled account:** record its handle, log in by its usual provider,
   refresh and sign out/in. Setup must never flash; the identity must not change.
5. **Competing claims:** on two unhandled accounts, type the same available handle.
   Click Continue in both. Exactly one wins; the other gets “already taken” and can
   choose a different handle. Try mixed casing, reserved names, spaces, punctuation,
   and 2/25-character values; invalid claims must fail.
6. **Friends:** search the other account's exact `@handle`, including mixed case;
   send a request, accept as the recipient, then confirm the friendship and chat.
   Verify self-invites fail; cancel/block/remove still work. Inspect network results:
   profiles expose only UUID, handle and display name, never email or private data.
   Using an authenticated client, selecting `profiles.*` or another user's habits
   must not reveal data, and updating another user's handle must change no rows.
7. **Sessions:** refresh after selection; log out and log in as the other account.
   No prior handle may flash. Repeat with slow networking during profile fetch or
   saving, and with two tabs. A stale tab must not overwrite a confirmed identity.
   At 320/375 px width verify the handle link and navigation fit and remain usable.
8. **Password recovery:** request a reset, follow its email, verify Set New Password
   appears before any handle UI, update the password, verify sign-out then Login.
   Refresh during recovery and repeat with an account lacking a handle. Only a
   later ordinary login may show handle setup.


## Files changed

Created:

- `HANDLES.md`
- `database/migrations/20261003_handle_onboarding.sql`
- `database/checks/20261003_handle_onboarding.sql`
- `src/auth/HandleGate.jsx`
- `src/data/profiles.js`
- `src/lib/handles.js`
- `tests/handles-db.test.js`
- `tests/handles.test.jsx`
- `tests/profileFixture.js`

Updated:

- `README.md`
- `database/README.md`
- `src/design.css`
- `package.json`
- `package-lock.json`
- `vite.config.js`
- `src/app/App.jsx`
- `src/app/TrackerApp.jsx`
- `src/components/AppShell.jsx`
- `src/data/social.js`
- `src/hooks/useSocial.js`
- `src/views/SocialView.jsx`
- `tests/google.test.jsx`
- `tests/recovery-sdk.test.jsx`
- `tests/recovery.test.jsx`
- `tests/routing.test.jsx`
- `tests/setup.js`
- `tests/views.test.jsx`
