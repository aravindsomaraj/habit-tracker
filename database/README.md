# Supabase database

The application uses Supabase Auth UUIDs for all data ownership and RLS. SQL
migrations live here, rather than in `supabase/migrations`. Apply them in this
order to a new project:

1. `20260921_habit_tracker.sql`
2. `20260921_photos_store.sql`
3. `20260922_add_social.sql`
4. `20260922_add_friend_controls.sql`
5. `20260922_add_direct_chat.sql`
6. `20261003_handle_onboarding.sql`

For an existing project, apply only unapplied migrations. The new handle migration
retains the existing profiles table, handles, UUIDs and private/social data.
Read [the handle deployment guide](../HANDLES.md) for the exact SQL Editor/psql
process, schema and RLS verification, deployment status, and manual acceptance
checklist. Its read-only verification SQL is in
`checks/20261003_handle_onboarding.sql`.

Do not commit credentials, database dumps, or user data. A plain `supabase db push`
does not discover this directory; do not use it as a substitute for applying the
explicit migration files.
