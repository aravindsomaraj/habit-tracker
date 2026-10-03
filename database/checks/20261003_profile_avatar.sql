-- Read-only. Run as postgres AFTER profile_avatar; every row must pass.
-- Earlier exact-output check scripts belong to their migration stage. This
-- checks the expanded avatar contract; behavioral RLS tests live in tests/.
select 'profiles have optional, constrained avatar paths' as check_name,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='avatar_path' and is_nullable='YES')
  and exists(select 1 from pg_constraint where conrelid='public.profiles'::regclass and conname='profiles_avatar_path_check' and convalidated) as passed
union all
select 'directory reads are exactly four identity columns',
  not has_table_privilege('authenticated','public.profiles','SELECT')
  and (select count(*)=4 from information_schema.columns c where c.table_schema='public' and c.table_name='profiles'
    and c.column_name in ('id','handle','display_name','avatar_path') and has_column_privilege('authenticated','public.profiles',c.column_name,'SELECT'))
  and not exists(select 1 from information_schema.columns c where c.table_schema='public' and c.table_name='profiles'
    and c.column_name not in ('id','handle','display_name','avatar_path') and has_column_privilege('authenticated','public.profiles',c.column_name,'SELECT'))
  and not has_any_column_privilege('anon','public.profiles','SELECT')
union all
select 'avatar metadata only writable through owner RPC',
  not has_column_privilege('authenticated','public.profiles','avatar_path','INSERT,UPDATE')
  and not has_column_privilege('anon','public.profiles','avatar_path','INSERT,UPDATE')
union all
select 'all extended RPCs retain narrow execution and fixed paths',
  count(*)=5 and bool_and(p.prosecdef and p.proconfig @> array['search_path=""']
    and has_function_privilege('authenticated',p.oid,'EXECUTE')
    and not has_function_privilege('anon',p.oid,'EXECUTE')
    and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE'))
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
  and p.proname in ('own_profile_settings','save_profile_settings','friend_social_profiles','social_leaderboard_week','set_profile_avatar')
union all
select 'avatars bucket intentionally public with enforced file limits',
  exists(select 1 from storage.buckets where id='avatars' and public and file_size_limit=5242880
    and allowed_mime_types @> array['image/jpeg','image/png','image/webp'] and cardinality(allowed_mime_types)=3)
union all
select 'proof bucket remains private', exists(select 1 from storage.buckets where id='proof-photos' and not public)
union all
select 'owner Storage policy set installed with RLS',
  (select relrowsecurity from pg_class where oid='storage.objects'::regclass)
  and (select count(*)=3 from pg_policies where schemaname='storage' and tablename='objects'
    and policyname in ('Owners upload avatars','Owners view avatar objects','Owners delete avatars') and roles=array['authenticated']::name[])
union all
select 'profile discovery remains block-aware and RLS protected',
  (select relrowsecurity from pg_class where oid='public.profiles'::regclass)
  and (select count(*)=1 and bool_and(policyname='profiles visible to their circle' and qual like '%blocked%' and qual like '%pending%')
    from pg_policies where schemaname='public' and tablename='profiles' and cmd in ('SELECT','ALL'))
union all
select 'handle onboarding remains caller-authorized',
  exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='claim_handle'
    and not p.prosecdef and p.proconfig @> array['search_path=""'] and has_function_privilege('authenticated',p.oid,'EXECUTE') and not has_function_privilege('anon',p.oid,'EXECUTE'));
