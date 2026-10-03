-- Behavioral deployment verification, run as postgres AFTER the compatibility
-- migration. Creates synthetic fixtures inside one transaction and ROLLS BACK.
-- This is not read-only: review before running; no fixture rows are committed.
-- Every returned row must have passed=true. Any uncaught error: ROLLBACK.
begin;
create temporary table compatibility_results(check_name text, passed boolean) on commit drop;
grant insert,select on compatibility_results to authenticated,anon;
create function pg_temp.verify(ok boolean, label text) returns void language plpgsql as $$
begin insert into compatibility_results values (label,coalesce(ok,false)); end $$;
create function pg_temp.denied(statement text, expected_state text default '42501') returns boolean language plpgsql as $$
begin
  execute statement;
  return false;
exception when others then return sqlstate = expected_state;
end $$;

do $$
declare
  test_owner uuid := gen_random_uuid(); friend_id uuid := gen_random_uuid(); stranger_id uuid := gen_random_uuid();
  newcomer_id uuid := gen_random_uuid(); hidden_id uuid := gen_random_uuid();
  owner_handle text := 'v_' || substr(replace(test_owner::text,'-',''),1,20);
  friend_handle text := 'v_' || substr(replace(friend_id::text,'-',''),1,20);
  new_handle text := 'v_' || substr(replace(newcomer_id::text,'-',''),1,20);
  request_id uuid; test_conversation uuid; shared_habit uuid; private_habit uuid;
  week date := date_trunc('week',now() at time zone 'UTC')::date - 7;
  settings record; score record; identity_row record;
begin
  insert into auth.users(id) values(test_owner),(friend_id),(stranger_id),(newcomer_id),(hidden_id);
  insert into public.profiles(id,handle,display_name,bio,discoverable,leaderboard_enabled) values
    (test_owner,owner_handle,'Verification owner','Owner bio',true,true),
    (friend_id,friend_handle,'Verification friend','Friend bio',true,true),
    (stranger_id,'v_'||substr(replace(stranger_id::text,'-',''),1,20),'Verification stranger','Stranger bio',true,true),
    (hidden_id,'v_'||substr(replace(hidden_id::text,'-',''),1,20),'Verification hidden','Hidden bio',false,false);
  perform set_config('request.jwt.claim.sub',test_owner::text,true);
  set local role authenticated;
  select id,handle,display_name into identity_row from public.profiles where handle=friend_handle;
  perform pg_temp.verify(identity_row.id=friend_id and
    (select array_agg(k order by k)=array['display_name','handle','id'] from jsonb_object_keys(to_jsonb(identity_row)) k),
    '01 directory exposes only intended identity and maps handle to UUID');
  perform pg_temp.verify(pg_temp.denied('select bio from public.profiles'),'02 direct bio SELECT denied');
  perform pg_temp.verify(pg_temp.denied('select discoverable from public.profiles'),'03 direct discoverable SELECT denied');
  perform pg_temp.verify(pg_temp.denied('select leaderboard_enabled from public.profiles'),'04 direct leaderboard_enabled SELECT denied');
  perform pg_temp.verify(pg_temp.denied('select * from public.profiles'),'05 profiles wildcard SELECT denied');
  select * into settings from public.own_profile_settings();
  perform pg_temp.verify(settings.id=test_owner and settings.discoverable and settings.leaderboard_enabled
    and (select count(*)=1 from public.own_profile_settings()),'06 owner settings RPC returns only caller');
  perform pg_temp.verify(not exists(select 1 from public.own_profile_settings() where id<>test_owner)
    and (select array_agg(k order by k)=array['bio','discoverable','display_name','handle','id','leaderboard_enabled'] from jsonb_object_keys(to_jsonb(settings)) k),
    '07 owner RPC fixed output cannot retrieve another users settings');
  perform pg_temp.verify(not exists(select 1 from public.friend_social_profiles(array[stranger_id])), '10 strangers cannot retrieve bio');
  insert into public.friendships(requester_id,addressee_id) values(test_owner,stranger_id);
  perform pg_temp.verify(not exists(select 1 from public.friend_social_profiles(array[stranger_id])), '09 pending friends cannot retrieve bio');
  perform pg_temp.verify(pg_temp.denied('select * from auth.users'),'33 email auth provider metadata inaccessible');
  perform pg_temp.verify(not exists(select 1 from public.profiles where id=hidden_id),'34 discoverable=false hides strangers');
  perform pg_temp.verify(pg_temp.denied(format('update public.profiles set discoverable=false where id=%L',friend_id)), '35 direct settings writes denied');
  perform pg_temp.verify(pg_temp.denied(format('insert into public.friendships(requester_id,addressee_id) values(%L,%L)',test_owner,test_owner),'23514'),'22 self-friend requests denied');
  select * into settings from public.save_profile_settings('Verification updated',owner_handle,'New bio',false,true);
  perform pg_temp.verify(settings.id=test_owner and not settings.discoverable and settings.bio='New bio','36 owner can update permitted settings');
  perform pg_temp.verify(pg_temp.denied(format('insert into public.friendships(requester_id,addressee_id) values(%L,%L)',test_owner,hidden_id)),'23 requests to hidden accounts denied');
  insert into public.friendships(requester_id,addressee_id) values(test_owner,friend_id) returning id into request_id;
  perform pg_temp.verify(pg_temp.denied(format('select public.accept_friendship(%L)',request_id),'P0001'),'24 only recipient accepts requests');
  reset role;
  perform set_config('request.jwt.claim.sub',friend_id::text,true);
  set local role authenticated;
  perform pg_temp.verify(exists(select 1 from public.profiles where id=test_owner),'37 hidden pending participant remains identifiable');
  perform public.accept_friendship(request_id);
  select * into identity_row from public.friend_social_profiles(array[test_owner]);
  perform pg_temp.verify(identity_row.id=test_owner and identity_row.bio='New bio'
    and (select array_agg(k order by k)=array['bio','display_name','handle','id'] from jsonb_object_keys(to_jsonb(identity_row)) k),
    '08 accepted friends can retrieve only permitted bio and identity');
  select * into settings from public.own_profile_settings();
  perform pg_temp.verify(settings.discoverable and settings.bio='Friend bio','38 owner settings write did not change another user');
  insert into public.habits(user_id,name,target) values(friend_id,'Verification shared',1) returning id into shared_habit;
  insert into public.habits(user_id,name,target) values(friend_id,'Verification private',1) returning id into private_habit;
  insert into public.habit_shares(habit_id,owner_id,viewer_id) values(shared_habit,friend_id,test_owner);
  insert into public.habit_entries(habit_id,entry_date,done,rest,value,photo_path) values
    (shared_habit,week,true,false,123,'private/proof'),(private_habit,week,true,false,456,'private/proof2'),
    (shared_habit,week+1,false,false,null,null),(shared_habit,week+2,true,true,null,null);
  perform pg_temp.verify(pg_temp.denied(format('insert into public.social_activities(actor_id,habit_id,habit_label,kind,occurred_on) values(%L,%L,%L,%L,%L)',friend_id,shared_habit,'Forged','completed',week+4)), '16 direct activity INSERT denied');
  perform pg_temp.verify(pg_temp.denied(format('update public.social_activities set habit_label=%L where actor_id=%L','Forged',friend_id)), '17 direct activity UPDATE denied');
  perform pg_temp.verify(pg_temp.denied(format('delete from public.social_activities where actor_id=%L',friend_id)), '18 direct activity DELETE denied');
  reset role;
  -- Simulate legacy forged/stale activity as postgres; ordinary clients cannot
  -- create these rows. Private, incomplete, rest and missing entries must not count.
  insert into public.social_activities(actor_id,habit_id,habit_label,kind,occurred_on) values
    (friend_id,private_habit,'Private','completed',week),
    (friend_id,shared_habit,'Incomplete','completed',week+1),
    (friend_id,shared_habit,'Rest','completed',week+2),
    (friend_id,shared_habit,'Missing entry','completed',week+3);
  perform set_config('request.jwt.claim.sub',test_owner::text,true);
  set local role authenticated;
  select * into score from public.social_leaderboard_week(week) where user_id=friend_id;
  perform pg_temp.verify(score.completion_count=1 and score.active_days=1,'26 leaderboard counts only viewer-shared qualifying activity including historical validation');
  perform pg_temp.verify(not exists(select 1 from public.social_leaderboard_week(week) where user_id in (stranger_id,hidden_id)), '39 leaderboard excludes pending strangers and hidden nonfriends');
  perform pg_temp.verify((select array_agg(k order by k)=array['active_days','completion_count','display_name','handle','rank','user_id'] from jsonb_object_keys(to_jsonb(score)) k),'27 leaderboard exposes only intended fields');
  test_conversation := public.start_direct_conversation(friend_id);
  insert into public.chat_messages(conversation_id,sender_id,body) values(test_conversation,test_owner,'Verification message');
  reset role;
  perform set_config('request.jwt.claim.sub',friend_id::text,true);
  set local role authenticated;
  perform pg_temp.verify(exists(select 1 from public.chat_messages m where m.conversation_id=test_conversation),'29 accepted friends can read chat');
  perform public.mark_social_chat_read(test_conversation,now());
  perform pg_temp.verify(not exists(select 1 from public.social_unread_chats()) and exists(select 1 from public.chat_reads r where r.conversation_id=test_conversation),'30 chat read positions persist');
  perform public.save_profile_settings('Verification friend',friend_handle,'Friend bio',true,false);
  reset role;
  perform set_config('request.jwt.claim.sub',test_owner::text,true);
  set local role authenticated;
  perform pg_temp.verify(not exists(select 1 from public.social_leaderboard_week(week) where user_id=friend_id),'25 leaderboard excludes opted-out accepted friends');
  reset role;
  perform set_config('request.jwt.claim.sub',stranger_id::text,true);
  set local role authenticated;
  perform pg_temp.verify(not exists(select 1 from public.chat_messages m where m.conversation_id=test_conversation)
    and pg_temp.denied(format('insert into public.chat_messages(conversation_id,sender_id,body) values(%L,%L,%L)',test_conversation,stranger_id,'intrusion')),'28 chat denies outsiders');
  perform pg_temp.verify(pg_temp.denied(format('select public.remove_friendship(%L)',request_id),'P0001')
    and pg_temp.denied(format('select public.block_friendship(%L)',request_id),'P0001'),'40 unrelated user cannot control another friendship');
  reset role;
  perform set_config('request.jwt.claim.sub',newcomer_id::text,true);
  set local role authenticated;
  perform pg_temp.verify(public.handle_available(new_handle),'19 handle availability works');
  perform pg_temp.verify(pg_temp.denied(format('insert into public.friendships(requester_id,addressee_id) values(%L,%L)',newcomer_id,friend_id)),'41 friend requests require chosen identity');
  select * into settings from public.claim_handle(upper(new_handle));
  perform pg_temp.verify(settings.id=newcomer_id and settings.handle=new_handle,'20 claim_handle normalizes and binds UUID');
  perform pg_temp.verify(pg_temp.denied(format('select public.save_profile_settings(%L,%L,%L,true,false)','duplicate',friend_handle,''),'23505'),'21 handle uniqueness enforced');
  reset role;
  perform set_config('request.jwt.claim.sub',test_owner::text,true);
  set local role authenticated;
  -- Both profiles are discoverable before blocking: the reverse-direction test
  -- must exercise the block predicate, not merely discoverable=false.
  perform public.save_profile_settings('Verification owner',owner_handle,'New bio',true,true);
  perform public.block_friendship(request_id);
  perform pg_temp.verify(not exists(select 1 from public.profiles where id=friend_id),'11 block A to B hides B from A');
  perform pg_temp.verify(not exists(select 1 from public.friend_social_profiles(array[friend_id])),'42 block hides B bio from A');
  perform pg_temp.verify(not exists(select 1 from public.direct_conversations c where c.id=test_conversation),'31 blocking removes chat access');
  reset role;
  perform set_config('request.jwt.claim.sub',friend_id::text,true);
  set local role authenticated;
  perform pg_temp.verify(not exists(select 1 from public.profiles where id=test_owner),'12 block A to B hides A from B');
  perform pg_temp.verify(not exists(select 1 from public.friend_social_profiles(array[test_owner])),'43 block hides A bio from B');
  perform pg_temp.verify(exists(select 1 from public.profiles where id=newcomer_id),'13 unrelated discoverable user remains visible');
  perform pg_temp.verify(exists(select 1 from public.profiles where id=auth.uid()),'44 block does not hide own identity');
  reset role;
  perform pg_temp.verify(not exists(select 1 from public.chat_messages m where m.conversation_id=test_conversation)
    and not exists(select 1 from public.chat_reads r where r.conversation_id=test_conversation)
    and not exists(select 1 from public.habit_shares hs where hs.habit_id=shared_habit and hs.viewer_id=test_owner), '45 block permanently cascades messages read positions and sharing');
  perform pg_temp.verify((select count(*)=2 from public.habits where id in (shared_habit,private_habit))
    and (select count(*)=4 from public.habit_entries where habit_id in (shared_habit,private_habit)), '46 block retains habits entries and proof references');
  perform set_config('request.jwt.claim.sub','',true);
  set local role anon;
  perform pg_temp.verify(pg_temp.denied('select id,handle,display_name from public.profiles')
    and pg_temp.denied('select * from public.own_profile_settings()')
    and pg_temp.denied('select * from public.friend_social_profiles(array[]::uuid[])')
    and pg_temp.denied(format('select * from public.social_leaderboard_week(%L)',week))
    and pg_temp.denied(format('select public.handle_available(%L)',new_handle))
    and pg_temp.denied(format('select public.claim_handle(%L)',new_handle))
    and pg_temp.denied(format('select public.save_profile_settings(%L,%L,%L,true,false)','anon',new_handle,'')), '14 anon cannot read or write protected profiles and RPCs');
  perform pg_temp.verify(pg_temp.denied(format('select public.remove_friendship(%L)',request_id))
    and pg_temp.denied(format('select public.block_friendship(%L)',request_id)),'15 anon cannot execute friendship controls with NULL uid');
  reset role;
  set local role authenticated;
  perform pg_temp.verify(not exists(select 1 from public.own_profile_settings())
    and not exists(select 1 from public.friend_social_profiles(array[test_owner]))
    and pg_temp.denied(format('select * from public.social_leaderboard_week(%L)',week)),'47 authenticated role still requires valid uid');
  reset role;
  perform pg_temp.verify(true,'32 profile friend share chat leaderboard queries complete without RLS recursion');
end $$;

-- Check the complete effective ACLs, including PUBLIC inheritance. Trigger-only
-- functions must be unavailable even to authenticated clients.
insert into compatibility_results
select '48 definer paths and EXECUTE privileges are explicit',
  count(*) = 9 and bool_and(p.prosecdef and p.proconfig @> array['search_path=""']
    and not has_function_privilege('anon',p.oid,'EXECUTE')
    and has_function_privilege('authenticated',p.oid,'EXECUTE') = (p.proname not in ('sync_social_completion','cleanup_social_relationship'))
    and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE'))
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('sync_social_completion','cleanup_social_relationship',
  'remove_friendship','block_friendship','mark_social_chat_read','own_profile_settings',
  'save_profile_settings','friend_social_profiles','social_leaderboard_week');
insert into compatibility_results
select '49 only live chat is published among Social tables',
  not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public'
    and tablename in ('profiles','friendships','habit_shares','social_activities','chat_reads'))
  and exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='chat_messages')
  and (select relreplident='d' from pg_class where oid='public.chat_messages'::regclass);
insert into compatibility_results
select '50 complete profile SELECT policy set retains block exclusion',
  count(*)=1 and bool_and(policyname='profiles visible to their circle' and qual like '%blocked%' and qual like '%pending%')
from pg_policies where schemaname='public' and tablename='profiles' and cmd in ('SELECT','ALL');
insert into compatibility_results
select '51 authenticated has no direct activity write privilege',
  not has_table_privilege('authenticated','public.social_activities','INSERT,UPDATE,DELETE')
  and not has_any_column_privilege('authenticated','public.social_activities','INSERT,UPDATE');

select * from compatibility_results order by check_name;
rollback;
