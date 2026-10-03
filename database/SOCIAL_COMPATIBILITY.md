# Handle and Social compatibility

The production baseline is the successfully applied `20261003_handle_onboarding.sql`
(as confirmed by the owner). This work does not connect to or modify production.
The new compatibility migration is local and must be reviewed/applied before the
combined frontend is deployed.

## Cause and access design

The incoming Social UI selected `bio`, `discoverable`, and `leaderboard_enabled`
directly from profiles. The handle migration grants authenticated SELECT only
on `id`, `handle`, and `display_name`. The old invoker leaderboard also read the
private opt-in column, so it failed under those grants. Its rejection was coupled
to Friends initialization through Promise.all.

- Directory reads remain exactly `id,handle,display_name`, governed by existing
  handle discovery RLS, including hidden profiles, pending requests and blocks.
- Bio is social content for **accepted friends**, not the general directory. The
  incoming ProfileView explicitly renders a friend's About section only after
  finding an accepted friendship, and describes profile edits as how accepted
  friends see you. `friend_social_profiles(uuid[])` preserves that audience and
  returns only UUID, handle, display name and bio. Requested UUIDs never grant access.
- `own_profile_settings()` takes no target UUID and returns only the caller's
  identity, bio, discoverability and leaderboard opt-in.
- `save_profile_settings(text,text,text,boolean,boolean)` updates only the
  authenticated caller's existing handled profile. It accepts only display name,
  handle, bio and the two settings; it cannot update UUIDs or auth metadata.
  Existing handle trigger/constraints still enforce normalization and uniqueness.
- Direct profile write grants are narrowed to the identity columns needed by
  `claim_handle`; settings use the owner RPC. Self-only profile RLS is retained.
- The four compatibility RPCs are SECURITY DEFINER because otherwise the caller
  would need raw SELECT grants on private settings. Each has `search_path = ''`,
  qualified relations, a caller-scoped audience and fixed output columns. PUBLIC
  and anon execution is revoked; only authenticated clients are granted execution.
  Missing auth.uid() yields no profile rows or a rejected write/leaderboard call.
- Leaderboard members are the caller and accepted friends who opted in and have
  handles. Scores count only actual completed, non-rest habit entries represented
  by activity, in the requested Monday-based week, not in the future, with an
  active share to the viewer (or an accepted friend for the caller's own score).
  Opt-in flags, habits, values, photos and auth metadata are never returned. A
  blocked or removed friend cannot appear. The caller cannot supply a viewer UUID.

## Preserved Social functionality

The forward migration retains/installs server-maintained activity, relationship
cleanup, persistent chat read positions and Realtime publication membership.
It supports both the handle-only baseline and an earlier installation of
`20261003_social_profiles.sql`. Existing users, IDs, handles, habits, proofs,
friendships, messages and read positions are preserved. Missing eligible activity
is backfilled without replacing rows. Historical stale activity is not deleted;
the leaderboard validates actual entries before counting it. Existing uncomplete,
remove and block actions still perform their intended cleanup through triggers.

Friends loading, owner settings, friend bios, unread counts and leaderboard
errors are separated. Settings failures disable the settings form rather than
submitting fabricated defaults. Leaderboard failures leave Friends and chat usable.
Profile saves immediately update the current account handle. The account link
opens Profile; Social remains the primary destination for Activity, Leaderboard
and Friends. The legacy `/friends` route redirects to `/social/friends`.
Completion writes remain server-owned, avoiding duplicate frontend publication.

## Application order before deployment

For the current production project:

1. Leave all applied migrations unchanged. Do not rerun the old social/profile or
   handle migration. The old social/profile script assumes pre-handle policies.
2. Review and apply **only**
   `migrations/20261003_handle_social_compatibility.sql` as postgres in SQL Editor.
   It is transactional. If it fails, stop and roll back the editor transaction.
3. Run `checks/20261003_handle_onboarding.sql`. All 13 read-only checks must pass.
4. Review and run `checks/20261003_handle_social_compatibility.sql`. Unlike the
   first check, this script creates synthetic users/data within a transaction,
   exercises real authenticated/anon behavior, reports results and rolls back.
   Every result must pass. If interrupted or errored, explicitly ROLLBACK. It must
   run as postgres and must not be split into independently committed snippets.
5. Smoke-test with ordinary accounts: owner settings, hidden discovery, friend
   request/accept/block, opt-in/out leaderboard and shared-only scores, chat/read
   badges, existing/new handle flows and recovery precedence. Local tests do not
   establish production networking, email/OAuth delivery or browser layout.
6. Only then deploy the frontend (pushing main triggers the existing Pages workflow).

A fresh project follows the order in database/README.md. The forward migration
installs the required Social additions itself, so do not apply the historical
`20261003_social_profiles.sql` after handle onboarding. The existing file remains
unchanged as migration history.

## Local verification

`npm test` includes the existing handle/auth/recovery suite and the new
`social-compatibility-db.test.js` and `social-compatibility.test.jsx` suites.
The database suite uses real PostgreSQL roles, grants, constraints and RLS in
PGlite, across both historical migration paths. It executes the exact operator
verification SQL and checks that fixtures roll back. It never loads production
credentials or calls Supabase. A focused database run uses the existing test script:

```sh
npm test -- tests/handles-db.test.js tests/social-compatibility-db.test.js
npm run build
```

No lint script is defined. Realtime transport and actual Supabase deployment still
need the operator smoke checks above.
