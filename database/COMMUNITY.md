# Community feed

Apply `migrations/20261004_community_feed.sql` after
`20261004_fix_social_relationship_profiles.sql` and before deploying the frontend.
Apply the complete file as postgres in Supabase SQL Editor. The migration adds
new tables/functions and a disabled-by-default profile flag; it does not publish
historical entries or alter friend-only sharing, leaderboard scores, or chats.

## Publishing

Signed-in users can browse without publishing. To publish, enable Community
participation in Profile, then select individual habits in Social → Manage
sharing. A completion transition after opt-in creates a community activity.
Existing completed entries are never backfilled, and editing their values/photos
does not publish them. Historical and future dates outside the active publishing
window are excluded, accounting for device timezones UTC−12 through UTC+14.

Cards expose only opaque activity ID, actor ID, display name, handle, habit label,
completion date and publication timestamp. A community profile additionally
exposes the bio. Email, private settings, habit values, notes, photos, private
totals and friend-only events are not returned. Public here means authenticated
app users; anonymous browsing is not enabled.

Undo, rest or deletion removes the associated activity. Disabling a habit removes
its community activities. Disabling profile participation removes all that user's
community activities. Re-enabling does not restore removed activities. Habit
choices remain saved while profile participation is disabled. Deleting the habit
or account cascades through its community records.

## Access and feed loading

Community activities and reports have RLS enabled and no direct client table
grants. Only the owner can read their own community habit choices. Writes occur
through caller-scoped functions; habit ownership is checked in the database.
The completion trigger derives the actor from the actual habit. Each callable
function revokes PUBLIC/anon execution. Definers have an empty search path and
qualified relations. No new tables are added to Realtime.

`community_feed` limits pages to 50 rows (UI pages are 20), ordered by
`created_at DESC, id DESC`. Subsequent cursors include both fields so timestamp
ties cannot skip updates. Actor filters reuse the same authorization and permit
only currently visible community data. The UI refreshes on opening the feed,
window focus, manual refresh and local community changes. It does not subscribe
every user to global database changes. Profile pages show the latest 20 updates.

## Blocks and reports

Blocking works for strangers and existing relationships. It uses the existing
friendship block row, excludes each participant from the other's community feed
and profile, and invokes existing cleanup for accepted sharing/conversations.
It cannot erase a block by the other participant. Existing block protections and
friend-request UUID uniqueness remain effective.

Reports accept spam, harassment or inappropriate content. Reporting hides the
author's community updates/profile for that reporter immediately. It records a
report for operator review; it does not automatically ban the author globally.
Submissions are serialized per reporter and capped at 10 per hour. Raw report
rows are readable only by the database operator/service role, never by users or
the reported author. A service-role key must never be exposed to the browser.

Review reports as postgres in SQL Editor:

```sql
select r.id, r.created_at, r.reason, r.actor_id, r.activity_id,
       p.handle, a.habit_label, a.occurred_on
from public.community_reports r
left join public.profiles p on p.id = r.actor_id
left join public.community_activities a on a.id = r.activity_id
order by r.created_at desc;
```

For confirmed abusive content, the operator can delete the reported activity.
To suspend community publishing, set the offending profile's community_suspended
to true. This hides its community profile/feed and prevents the user from
re-enabling publishing through client APIs. Clearing the flag restores the
previous opt-in and eligible events, unless the operator also removed them.
Reports remain as an audit record. This release uses SQL Editor for
review and has no admin dashboard, comments, reactions or stranger messaging.

## Verification

Run `npm test` and `npm run build`. `community-db.test.js` exercises the exact
migration with PostgreSQL roles, grants, RLS, triggers and security definers in
PGlite. `community.test.jsx` covers loading, request races, pagination, opt-in
failure, report submission, publishing controls and direct public-profile links.
Local tests never connect to production. After applying the migration and
deploying, smoke-test with two ordinary signed-in accounts: browse before opt-in,
publish a new completion, undo it, disable publishing, block, and report.
