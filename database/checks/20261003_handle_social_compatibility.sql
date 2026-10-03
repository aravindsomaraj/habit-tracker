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
  owner_id uuid := gen_random_uuid(); friend_id uuid := gen_random_uuid(); stranger_id uuid := gen_random_uuid();
  newcomer_id uuid := gen_random_uuid(); hidden_id uuid := gen_random_uuid();
  owner_handle text := 'v_' || substr(replace(owner_id::text,'-',''),1,20);
  friend_handle text := 'v_' || substr(replace(friend_id::text,'-',''),1,20);
  new_handle text := 'v_' || substr(replace(newcomer_id::text,'-',''),1,20);
  request_id uuid; test_conversation uuid; shared_habit uuid; private_habit uuid;
  week date := date_trunc('week',now() at time zone 'UTC')::date - 7;
  settings record; score record;
begin
  insert into auth.users(id) values(owner_id),(friend_id),(stranger_id),(newcomer_id),(hidden_id);
  insert into public.profiles(id,handle,display_name,bio,discoverable,leaderboard_enabled) values
    (owner_id,owner_handle,'Verification owner','Owner bio',true,true),
    (friend_id,friend_handle,'Verification friend','Friend bio',true,true),
    (stranger_id,'v_'||substr(replace(stranger_id::text,'-',''),1,20),'Verification stranger','Stranger bio',true,true),
    (hidden_id,'v_'||substr(replace(hidden_id::text,'-',''),1,20),'Verification hidden','Hidden bio',false,false);
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  set local role authenticated;
  perform pg_temp.verify((select id=friend_id from public.profiles where handle=friend_handle),'public identity and handle-to-UUID lookup');
  select * into settings from public.own_profile_settings();
  perform pg_temp.verify(settings.id=owner_id and settings.discoverable and settings.leaderboard_enabled,'owner can read own settings');
  perform pg_temp.verify(pg_temp.denied('select discoverable,leaderboard_enabled from public.profiles')
    and not exists(select 1 from public.own_profile_settings() where id<>owner_id),'other users private settings inaccessible');
  perform pg_temp.verify(pg_temp.denied('select * from auth.users')
    and pg_temp.denied('select * from public.profiles'),'email/auth/provider metadata inaccessible');
  perform pg_temp.verify(not exists(select 1 from public.profiles where id=hidden_id),'discoverable=false hides strangers');
  perform pg_temp.verify(pg_temp.denied(format('update public.profiles set discoverable=false where id=%L',friend_id)), 'direct settings writes denied');
  perform pg_temp.verify(pg_temp.denied(format('insert into public.friendships(requester_id,addressee_id) values(%L,%L)',owner_id,owner_id),'23514'),'self-friend requests denied');
  select * into settings from public.save_profile_settings('Verification updated',owner_handle,'New bio',false,true);
  perform pg_temp.verify(settings.id=owner_id and not settings.discoverable and settings.bio='New bio','owner can update permitted settings');
  perform pg_temp.verify(not exists(select 1 from public.friend_social_profiles(array[friend_id,stranger_id,hidden_id])),'bios hidden from nonfriends');
  perform pg_temp.verify(pg_temp.denied(format('insert into public.friendships(requester_id,addressee_id) values(%L,%L)',owner_id,hidden_id)),'requests to hidden accounts denied');
  insert into public.friendships(requester_id,addressee_id) values(owner_id,friend_id) returning id into request_id;
  perform pg_temp.verify(pg_temp.denied(format('select public.accept_friendship(%L)',request_id),'P0001'),'only recipient accepts requests');
  reset role;
  perform set_config('request.jwt.claim.sub',friend_id::text,true);
  set local role authenticated;
  perform public.accept_friendship(request_id);
  perform pg_temp.verify((select count(*)=1 from public.friend_social_profiles(array[owner_id])),'accepted friends can read bios despite disabled discovery');
  select * into settings from public.own_profile_settings();
  perform pg_temp.verify(settings.discoverable and settings.bio='Friend bio','owner settings write did not change another user');
  insert into public.habits(user_id,name,target) values(friend_id,'Verification shared',1) returning id into shared_habit;
  insert into public.habits(user_id,name,target) values(friend_id,'Verification private',1) returning id into private_habit;
  insert into public.habit_shares(habit_id,owner_id,viewer_id) values(shared_habit,friend_id,owner_id);
  insert into public.habit_entries(habit_id,entry_date,done,value,photo_path) values
    (shared_habit,week,true,123,'private/proof'),(private_habit,week,true,456,'private/proof2');
  reset role;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  set local role authenticated;
  select * into score from public.social_leaderboard_week(week) where user_id=friend_id;
  perform pg_temp.verify(score.completion_count=1 and score.active_days=1,'leaderboard counts only shared completions');
  perform pg_temp.verify(not exists(select 1 from public.social_leaderboard_week(week) where user_id in (stranger_id,hidden_id)), 'leaderboard excludes strangers and hidden nonfriends');
  perform pg_temp.verify((select array_agg(k order by k)=array['active_days','completion_count','display_name','handle','rank','user_id'] from jsonb_object_keys(to_jsonb(score)) k),'leaderboard exposes only intended fields');
  test_conversation := public.start_direct_conversation(friend_id);
  insert into public.chat_messages(conversation_id,sender_id,body) values(test_conversation,owner_id,'Verification message');
  reset role;
  perform set_config('request.jwt.claim.sub',friend_id::text,true);
  set local role authenticated;
  perform pg_temp.verify(exists(select 1 from public.chat_messages m where m.conversation_id=test_conversation),'accepted friends can read chat');
  perform public.mark_social_chat_read(test_conversation,now());
  perform pg_temp.verify(not exists(select 1 from public.social_unread_chats()),'chat read positions persist');
  perform public.save_profile_settings('Verification friend',friend_handle,'Friend bio',true,false);
  reset role;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  set local role authenticated;
  perform pg_temp.verify(not exists(select 1 from public.social_leaderboard_week(week) where user_id=friend_id),'leaderboard excludes opted-out accepted friends');
  reset role;
  perform set_config('request.jwt.claim.sub',stranger_id::text,true);
  set local role authenticated;
  perform pg_temp.verify(not exists(select 1 from public.chat_messages m where m.conversation_id=test_conversation)
    and pg_temp.denied(format('insert into public.chat_messages(conversation_id,sender_id,body) values(%L,%L,%L)',test_conversation,stranger_id,'intrusion')),'chat denies outsiders');
  reset role;
  perform set_config('request.jwt.claim.sub',newcomer_id::text,true);
  set local role authenticated;
  perform pg_temp.verify(public.handle_available(new_handle),'handle availability works');
  perform pg_temp.verify(pg_temp.denied(format('insert into public.friendships(requester_id,addressee_id) values(%L,%L)',newcomer_id,friend_id)),'friend requests require chosen identity');
  select * into settings from public.claim_handle(upper(new_handle));
  perform pg_temp.verify(settings.id=newcomer_id and settings.handle=new_handle,'claim_handle normalizes and binds UUID');
  perform pg_temp.verify(pg_temp.denied(format('select public.save_profile_settings(%L,%L,%L,true,false)','duplicate',friend_handle,''),'23505'),'handle uniqueness enforced');
  reset role;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  set local role authenticated;
  perform public.block_friendship(request_id);
  perform pg_temp.verify(not exists(select 1 from public.profiles where id=friend_id)
    and not exists(select 1 from public.friend_social_profiles(array[friend_id])),'blocked identity and bios hidden');
  perform pg_temp.verify(not exists(select 1 from public.direct_conversations c where c.id=test_conversation),'blocking removes chat access');
  reset role;
  set local role anon;
  perform pg_temp.verify(pg_temp.denied('select id,handle,display_name from public.profiles')
    and pg_temp.denied('select * from public.own_profile_settings()')
    and pg_temp.denied('select * from public.friend_social_profiles(array[]::uuid[])')
    and pg_temp.denied(format('select * from public.social_leaderboard_week(%L)',week))
    and pg_temp.denied(format('select public.handle_available(%L)',new_handle))
    and pg_temp.denied(format('select public.claim_handle(%L)',new_handle))
    and pg_temp.denied(format('select public.save_profile_settings(%L,%L,%L,true,false)','anon',new_handle,'')), 'anon cannot read or write protected profiles/RPCs');
  reset role;
  perform pg_temp.verify(true,'profile/friend/share/chat/leaderboard queries complete without RLS recursion');
end $$;

select * from compatibility_results order by check_name;
rollback;
