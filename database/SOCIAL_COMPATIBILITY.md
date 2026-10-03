# Handle and Social compatibility

The production baseline is the successfully applied `20261003_handle_onboarding.sql`
(as confirmed by the owner). This work does not connect to or modify production.
The compatibility and relationship-profile migrations are local and must be
reviewed/applied before the combined frontend is deployed.

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
- `social_relationship_profiles(uuid[])` returns only UUID, handle and display
  name for pending or accepted counterparts, so sent requests survive a refresh
  without widening direct profile access.
- `own_profile_settings()` takes no target UUID and returns only the caller's
  identity, bio, discoverability and leaderboard opt-in.
- `save_profile_settings(text,text,text,boolean,boolean)` updates only the
  authenticated caller's existing handled profile. It accepts only display name,
  handle, bio and the two settings; it cannot update UUIDs or auth metadata.
  Existing handle trigger/constraints still enforce normalization and uniqueness.
- Direct profile write grants are narrowed to the identity columns needed by
  `claim_handle`; settings use the owner RPC. Self-only profile RLS is retained.
- The profile and leaderboard RPCs are SECURITY DEFINER because otherwise the caller
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
cleanup, persistent chat read positions and live chat delivery.
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

## Predeployment security audit

No blocked-directory bypass exists in either supported migration history. The
applied handle migration drops both historical SELECT policy names and creates
one `profiles visible to their circle` policy; its block check is ANDed with the
discovery/relationship branch. The only other profile policies are self-only
INSERT and UPDATE. The compatibility migration leaves that full policy set
unchanged. Tests check the catalog, both directions with discoverable profiles,
self identity, hidden pending participants and unrelated users. Remote policy
drift has not been inspected; verification rejects unexpected SELECT/ALL policies.

The audit adds explicit `REVOKE ALL ... FROM PUBLIC, anon` and `GRANT EXECUTE ...
TO authenticated` for `remove_friendship(uuid)` and `block_friendship(uuid)`.
Their previous effective ACLs were already restricted through earlier migrations;
the new statements remove that dependency and repair overly broad inherited ACLs.
It also explicitly revokes activity INSERT, UPDATE and DELETE from PUBLIC, anon
and authenticated. Prior supported schemas did not grant UPDATE, but the migration
now removes it explicitly even if previously granted. SELECT and RLS are unchanged.

All ten SECURITY DEFINER functions were reviewed. Each uses `search_path = ''`
and schema-qualified relations; built-in functions resolve through pg_catalog.

| Function | Authorization and output | Client EXECUTE |
| --- | --- | --- |
| `sync_social_completion()` | Trigger only; derives owner from actual habit, completion from entry; returns trigger record | None: revoked from PUBLIC, anon, authenticated |
| `cleanup_social_relationship()` | Trigger only on authorized relationship mutation; deletes pair sharing/conversation; returns trigger record | None: revoked from PUBLIC, anon, authenticated |
| `remove_friendship(uuid)` | Caller must be a participant; cannot remove a block; returns void | authenticated only |
| `block_friendship(uuid)` | Caller must be a participant; records caller as blocker; returns void | authenticated only |
| `mark_social_chat_read(uuid,timestamptz)` | Requires caller in accepted conversation; writes only caller's read position, caps timestamp at now; returns void | authenticated only |
| `own_profile_settings()` | No target ID; only auth.uid() identity/bio/two settings | authenticated only |
| `save_profile_settings(text,text,text,boolean,boolean)` | No target ID; only auth.uid() handled profile; returns same fixed owner fields | authenticated only |
| `friend_social_profiles(uuid[])` | IDs filter only self/accepted friends; identity and bio only | authenticated only |
| `social_relationship_profiles(uuid[])` | IDs filter only pending/accepted counterparts; directory identity only | authenticated only |
| `social_leaderboard_week(date)` | Requires auth.uid(); opt-in accepted circle, viewer-specific sharing and actual qualifying entries; six leaderboard fields only | authenticated only |

All eight callable definers explicitly revoke PUBLIC/anon and grant authenticated.
NULL auth.uid() cannot authorize reads/mutations; controls return an unavailable
error without changing anything. Trigger authorization comes from the original
RLS-checked writes or authorized RPCs; clients cannot call the triggers directly.
`social_unread_chats()` remains SECURITY INVOKER and uses existing chat/read RLS.

### Realtime publication decisions

[Supabase Postgres Changes documentation](https://supabase.com/docs/guides/realtime/postgres-changes#receiving-old-records)
explains that DELETE delivery cannot enforce row-level authorization. Subscription
filters are not a security boundary: another client can request different events.
The migration therefore removes the following five Social tables even if a prior
migration already published them. It neither deletes rows nor changes publication
membership/event flags for unrelated tables.

| Table | Previous frontend subscription / relevant events | Payload and RLS assessment | Final decision |
| --- | --- | --- | --- |
| `profiles` | None / none required | Contains bio and private flags; DELETE key identifies user. Directory grants must remain narrow. | Remove; owner RPC and directory reads |
| `friendships` | `*` / INSERT requests, UPDATE accept/block, DELETE remove/cancel | Relationship parties/status/blocker are private. SELECT RLS protects participants for live rows, not DELETE delivery; deletion UUID/timing need not be published. | Remove; authorized refresh |
| `habit_shares` | `*` / INSERT share, DELETE unshare/cleanup; no UPDATE needed | Owner/viewer/habit relationships; DELETE composite key includes habit and viewer IDs. SELECT RLS cannot secure deleted keys. | Remove; authorized refresh |
| `social_activities` | `*` / INSERT completion, DELETE undo; no UPDATE needed | Habit labels/dates/actor are shared only with eligible viewers. DELETE authorization is unavailable even though key is opaque. | Remove; authorized refresh |
| `chat_reads` | None / none required | Read time plus user/conversation linkage; DELETE composite key exposes both IDs. Own-row RLS cannot secure deleted keys. | Remove; unread RPC refresh |
| `chat_messages` | Inbox and open modal / INSERT only | Message body/sender/conversation are protected by accepted-conversation SELECT RLS for INSERT delivery. DELETE is not row-authorized. | Keep for instant chat; replica identity DEFAULT limits old/delete payload to opaque message UUID |

Only chat INSERT subscriptions remain in the frontend. Social refreshes after
local actions, on focus/visibility return, after already-published message INSERTs,
and every 30 seconds while visible. Polls do not overlap; cleanup cancels timers,
listeners and subscriptions, and stale responses are ignored. Remote removals or
blocks close the local chat after the next successful authorized refresh. A
background tab refreshes on becoming visible. Database denial is immediate;
previously rendered information can remain cached until refresh. Leaderboard and
unread failures remain isolated from Friends/chat.

The shared publication's event flags are deliberately unchanged. An independently
subscribing client could still receive an opaque deleted chat-message ID/timing;
replica identity DEFAULT excludes message content and participant/conversation IDs
from that old record. PGlite verifies grants, RLS, publication membership and
replica identity, not Supabase's live WAL delivery. Live chat transport should be
smoke-tested before deployment. Broader private-table changes are not published.

### Cleanup contract

Unfriend deletes the relationship row; block retains it with `status='blocked'`
and `blocked_by=auth.uid()`. Both delete share rules in both directions and the
pair's direct conversation. `chat_messages.conversation_id` and
`chat_reads.conversation_id` use ON DELETE CASCADE, so **messages and read positions
are permanently deleted**, including on direct authorized friendship DELETE.
This is intentional in the historical direct-chat migration and UI confirmation
text; it is unchanged. A pending request cancellation deletes that request and any
pair sharing/chat if present. Active blocks cannot be removed through these APIs.
Habits, entries, proof references/files and social activity records are retained;
without shares/accepted friendship, the former friend cannot read those events or
count them on their leaderboard. Applying this migration itself does not perform
any relationship/chat deletion.

The rollback verification script now returns **51 explicit boolean checks**:
the requested 32 behavior checks, 15 additional privacy/cleanup checks, and four
catalog checks for function ACLs/paths, publication, complete profile policy set
and activity write grants. Tests also cover all direct activity writes, malicious
inherited ACLs, invalid historical activity, remove/block/direct-delete cascades,
and preservation of unrelated data/publication settings on both histories.

## Application order before deployment

For the current production project:

1. Leave all applied migrations unchanged. Do not rerun the old social/profile or
   handle migration. The old social/profile script assumes pre-handle policies.
2. Review and apply `migrations/20261003_handle_social_compatibility.sql`, then
   `migrations/20261004_fix_social_relationship_profiles.sql`, as postgres in SQL
   Editor. Both are transactional. If either fails, stop and roll back the editor
   transaction.
3. Run `checks/20261003_handle_onboarding.sql`. All 13 read-only checks must pass.
4. Review and run `checks/20261003_handle_social_compatibility.sql`. Unlike the
   first check, this script creates synthetic users/data within a transaction,
   exercises real authenticated/anon behavior, reports results and rolls back.
   All 51 results must pass. If interrupted or errored, explicitly ROLLBACK. It must
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
