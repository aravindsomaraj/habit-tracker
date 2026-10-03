# Public profile avatars

Local implementation for review. No migration has been applied remotely by this
change. Deploy the database before this frontend, which now selects avatar_path.

## Migration order and eventual deployment

For the existing project, as postgres in the Supabase SQL Editor:

1. `20261003_handle_onboarding.sql` — already applied; do not rerun.
2. Apply `20261003_handle_social_compatibility.sql` **if not already applied**.
   Run its 51 rollback-only behavioral checks and the handle read-only checks
   at this stage. Those scripts assert the pre-avatar column/RPC contracts.
3. Review and apply `migrations/20261003_profile_avatar.sql` once. It is a single
   transaction. It creates/configures the `avatars` bucket and policies; no
   separate dashboard bucket creation or service-role key is needed.
4. Run `checks/20261003_profile_avatar.sql` as postgres. All nine rows must pass.
   Review the actual `storage.objects` policy set too: permissive policies combine
   with OR, so unrelated pre-existing broad policies must not allow avatar writes.
   The repository's previous policies are scoped only to `proof-photos`.
5. Perform the HTTP smoke tests below on a staging Supabase project, then deploy
   the frontend. The project-wide Storage upload limit must permit 5 MiB.

Do not apply the historical `social_profiles` migration after handle onboarding.
The two reviewed migrations and all historical Storage policies are unchanged.
The avatar migration drops/recreates four RPCs within its transaction because
Postgres cannot change their TABLE return shape in place. It uses no CASCADE;
unknown dependent database objects abort the transaction for review. It notifies
PostgREST to refresh its schema cache at commit.

## Storage and public visibility

Bucket `avatars` is intentionally **public**, limited to 5,242,880 bytes per file,
with `image/jpeg`, `image/png`, and `image/webp` MIME types. Client validation
rejects empty, oversized, and other types before any request. The shared validator
also serves existing proof uploads; their storage and signing behavior is unchanged.
There is no image-processing dependency, metadata stripping, or content scanning.

Path: `<auth.users UUID>/<crypto.randomUUID()>.<jpg|png|webp>`. The immutable UUID,
not a handle/email, determines ownership. Uploaded names never overwrite existing
objects (`upsert: false`). Each replacement has a different URL, independent of
browser/CDN caches for the previous URL.

Exactly three policies are added on `storage.objects`, all to `authenticated`:

| Policy | Operation | Predicate |
| --- | --- | --- |
| `Owners upload avatars` | INSERT / WITH CHECK | `bucket_id = 'avatars'`, first folder equals `auth.uid()::text`, and canonical UUID filename plus jpg/png/webp extension |
| `Owners view avatar objects` | SELECT / USING | `bucket_id = 'avatars'` and first folder equals `auth.uid()::text` |
| `Owners delete avatars` | DELETE / USING | `bucket_id = 'avatars'` and first folder equals `auth.uid()::text` |

No UPDATE policy is added: replace means insert a new object and delete the old
one. No anonymous upload, delete, update, or metadata-listing policy is added.
Public downloads use the public bucket endpoint. Supabase bypasses read access
control for serving objects in public buckets; writes remain subject to policies.
See [Supabase bucket fundamentals](https://supabase.com/docs/guides/storage/buckets/fundamentals).

A known avatar URL remains public even when the owner disables discoverability or
blocks someone. Profile RLS still hides the identity/path from unauthorized
queries, but cannot revoke an already known URL or downloaded/cached copy. This
is the requested public-avatar design. The owner UI labels the photo public.
`proof-photos` remains private with its existing owner-only policies and signed URLs.

## Database contract

`profiles.avatar_path` is nullable text with an owner/path constraint. Existing
rows remain NULL; no onboarding image is required. Authenticated directory SELECT
is exactly `id,handle,display_name,avatar_path`, still subject to the existing
block/discoverability RLS. No table-wide SELECT or direct avatar INSERT/UPDATE
privilege is granted; anonymous directory access remains denied.

RPC changes append avatar_path to existing output fields:

- `own_profile_settings()` and `save_profile_settings(...)`: caller's settings;
  existing save inputs and writable settings remain unchanged.
- `friend_social_profiles(uuid[])`: self/accepted friends' identity and bio.
- `social_leaderboard_week(date)`: existing accepted-friend, opt-in, sharing and
  activity-validation rules; no extra private fields.
- New `set_profile_avatar(new_avatar_path text, expected_avatar_path text)`:
  derives the owner only from auth.uid(), requires a chosen handle, validates
  owner/path and existence in `avatars`, then compares the previous path before
  updating the caller's row. NULL removes metadata even if the file is missing.

All five functions are SECURITY DEFINER with an empty search_path, fully qualified
relations, PUBLIC/anon EXECUTE revoked, and authenticated EXECUTE granted.
`claim_handle` remains unchanged and SECURITY INVOKER; its three-field onboarding
return is sufficient, and the subsequent settings read supplies avatar_path.
`handle_available`, `can_request_friend`, and other social/chat functions do not
return avatar identities and are unchanged.

## UI and operation lifecycle

Shared `Avatar.jsx` supplies circular images, accessible text, matching initials
fallbacks, and broken-image fallback. It rejects malformed/cross-owner metadata
when building URLs. It is used in own/friend profiles, friends and pending request
rows, exact-handle lookup results, the leaderboard, activity, the direct-chat header,
and the existing top profile button. No new sidebar item is added.

Profile contains Upload/Change/Remove controls, allowed types/size/public notice,
busy state, feedback, and a cleanup retry when needed. The existing send-request
flow is retained; a small optional Find profile button previews exact-handle public
identity. Search results are discarded if the typed handle changes. Social polling
refreshes friends and open-chat identity without new Realtime publications.

For upload/replacement: validate, read current owner metadata, upload a new object,
compare-and-set metadata, then delete the old object. The UI changes only after
successful upload and metadata confirmation. Settings/avatars share a synchronous
write guard; duplicate clicks cannot start another operation. An avatar update
preserves unsaved settings drafts. Account and mount guards reject stale results
and stop further requests after switching accounts.

For removal: clear metadata first, then remove the file. This order preserves the
old image if metadata fails and never creates a dangling pointer by deleting first.
A missing old file is an idempotent successful deletion.

If metadata is rejected, delete only the new unused upload. If the response was
lost, re-read the owner settings before deciding: a committed upload is retained;
an unconfirmed upload is kept with an error and cleanup retry rather than risking
deletion of the current image. Cleanup checks that the target is not currently
referenced. Failed old-file deletion leaves the confirmed new image/fallback and
an explicit warning plus retry. Failed rollback cleanup also offers retry.

Storage and Postgres do not share an atomic transaction. Abrupt tab closure,
account switching during an upload, lost upload acknowledgments, or prolonged
outages can leave unused public files. Retry state is in memory for the mounted
session, not a background cleanup service. Such orphan files need owner/admin
cleanup through the Storage API after comparing current profile references. Do
not delete Storage catalog rows directly. Public URLs and embedded image metadata
should never be treated as private; this simple feature does not strip EXIF.

## Verification and limits

`tests/avatars-db.test.js` executes real PostgreSQL policies, grants, constraints,
and RPCs in PGlite with a minimal Supabase Storage catalog. It tests both supported
historical paths, owner upload/replace/remove, cross-owner and anonymous denial,
private proof policies, bucket configuration, public identity columns, NULL legacy
profiles, private-field denial, onboarding, stale writes, missing files, and all
51 predecessor behavioral checks with the new exact RPC output fields.

`tests/avatars.test.jsx` exercises rendering, public URL shape, fallback, broken
images, invalid types/size, replacement ordering/immediacy, removal, failures and
ambiguous commits, safe cleanup retry, duplicate protection, account switching,
settings drafts, and each requested identity surface. Existing auth/recovery,
proof-upload, social, routing, and database suites remain in the complete run.

PGlite does not run Supabase's HTTP Storage service or CDN. Before eventual
production deployment, verify with real staging accounts A and B:

1. A uploads each permitted type and replaces it; the new URL renders immediately.
   An oversized or unsupported upload sent directly to Storage is rejected.
2. B cannot upload/upsert/delete under A's UUID, even with a manually constructed
   request. Anonymous upload/delete/update also fail.
3. The public avatar URL loads in a signed-out browser without a signed token;
   ordinary anonymous object listing is denied. A proof URL is not public, and B
   cannot obtain A's private proof through their Storage credentials.
4. A removes the photo; the profile returns to initials. Remove a missing object
   too. Simulate an interrupted metadata write/deletion and verify feedback/retry.
5. Check friend search, pending/accepted profiles, blocks, leaderboard and chat
   using both accounts. Blocking hides directory identity without claiming to
   revoke an already known public URL.

No remote migration or HTTP smoke test is performed by the local test suite.
