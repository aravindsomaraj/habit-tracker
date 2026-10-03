-- Read-only deployment verification. Run as postgres in the Supabase SQL Editor.
-- Every row must return passed = true before deploying the frontend.
select 'handle may be NULL during onboarding' as check_name,
  exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='handle' and is_nullable='YES') as passed
union all
select 'existing lowercase format and unique constraints remain',
  (select count(*) = 2 from pg_constraint where conrelid='public.profiles'::regclass and conname in ('profiles_handle_check','profiles_handle_key') and convalidated)
union all
select 'UUID FK to auth.users remains',
  exists (select 1 from pg_constraint where conrelid='public.profiles'::regclass and confrelid='auth.users'::regclass and contype='f')
union all
select 'profiles and friendships RLS enabled',
  (select count(*) = 2 from pg_class where oid in ('public.profiles'::regclass,'public.friendships'::regclass) and relrowsecurity)
union all
select 'own-profile write policies remain',
  (select count(*) = 2 from pg_policies where schemaname='public' and tablename='profiles' and policyname in ('users create their profile','users update their profile') and with_check like '%auth.uid()%')
union all
select 'authenticated reads limited to public directory columns',
  not has_table_privilege('authenticated','public.profiles','SELECT')
  and has_column_privilege('authenticated','public.profiles','id','SELECT')
  and has_column_privilege('authenticated','public.profiles','handle','SELECT')
  and has_column_privilege('authenticated','public.profiles','display_name','SELECT')
  and not exists (
    select 1 from information_schema.columns c where c.table_schema='public' and c.table_name='profiles'
      and c.column_name not in ('id','handle','display_name')
      and has_column_privilege('authenticated','public.profiles',c.column_name,'SELECT')
  )
union all
select 'anonymous directory access denied',
  not has_any_column_privilege('anon','public.profiles','SELECT')
union all
select 'handle validation trigger enabled',
  exists (select 1 from pg_trigger where tgrelid='public.profiles'::regclass and tgname='profiles_validate_handle' and tgenabled='O')
union all
select 'claim uses caller RLS; boolean checks are narrow definers with fixed paths',
  (select count(*) = 3 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('claim_handle','handle_available','can_request_friend')
      and p.prosecdef = (p.proname <> 'claim_handle')
      and p.proconfig @> array['search_path=""'])
union all
select 'RPCs restricted to authenticated callers',
  (select count(*) = 3 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('claim_handle','handle_available','can_request_friend')
      and has_function_privilege('authenticated',p.oid,'EXECUTE') and not has_function_privilege('anon',p.oid,'EXECUTE'))
union all
select 'friend requests require identity',
  exists (select 1 from pg_policies where schemaname='public' and tablename='friendships'
    and policyname='users request friendships' and with_check like '%can_request_friend%')
union all
select 'profile discovery still excludes blocked users',
  exists (select 1 from pg_policies where schemaname='public' and tablename='profiles'
    and policyname='profiles visible to their circle' and cmd='SELECT'
    and qual like '%blocked%' and qual like '%pending%' and qual like '%handle IS NOT NULL%')
union all
select 'no invalid or case-insensitive duplicate handles',
  not exists (select 1 from public.profiles where handle is not null and handle !~ '^[a-z0-9_]{3,24}$')
  and not exists (select lower(handle) from public.profiles where handle is not null group by lower(handle) having count(*) > 1);
