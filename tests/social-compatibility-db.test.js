// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
const sql = (name) => readFileSync(new URL(`../database/${name}`, import.meta.url), 'utf8');
const ids = Array.from({ length: 6 }, (_, i) => `10000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`);

describe.each([false, true])('Social compatibility with historical social_profiles installed: %s', (historical) => {
  let db, habit, otherHabit;
  const user = async (i) => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [i === null ? '' : ids[i]]);
    await db.exec('set role authenticated');
  };
  const board = () => db.query("select * from public.social_leaderboard_week('2026-09-21')");
  const save = (name = 'renamed', discoverable = false, enabled = true) => db.query('select * from public.save_profile_settings($1,$2,$3,$4,$5)', ['New display', name, 'Friends bio', discoverable, enabled]);
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to authenticated,anon;
      grant execute on function auth.uid() to authenticated,anon;
      create publication supabase_realtime;`);
    for (const name of ['20260921_habit_tracker','20260922_add_social','20260922_add_friend_controls','20260922_add_direct_chat']) await db.exec(sql(`migrations/${name}.sql`));
    if (historical) await db.exec(sql('migrations/20261003_social_profiles.sql'));
    await db.exec(sql('migrations/20261003_handle_onboarding.sql'));
    // Existing data must survive the forward migration.
    for (const id of ids) await db.query('insert into auth.users(id,email) values ($1,$2)', [id, 'private@example.com']);
    for (let i = 0; i < 5; i++) await db.query('insert into public.profiles(id,handle,display_name,discoverable) values ($1,$2,$2,$3)', [ids[i], `person_${i}`, i !== 3]);
    await db.query("insert into public.friendships(requester_id,addressee_id,status,accepted_at) values ($1,$2,'accepted',now()),($1,$3,'accepted',now()),($2,$4,'accepted',now())", [ids[0],ids[1],ids[2],ids[3]]);
    habit = (await db.query("insert into public.habits(user_id,name,target) values ($1,'Shared book',1) returning id",[ids[1]])).rows[0].id;
    otherHabit = (await db.query("insert into public.habits(user_id,name,target) values ($1,'Secret book',1) returning id",[ids[1]])).rows[0].id;
    await db.query('insert into public.habit_shares(habit_id,owner_id,viewer_id) values ($1,$2,$3),($4,$2,$5)',[habit,ids[1],ids[0],otherHabit,ids[3]]);
    await db.query("insert into public.habit_entries(habit_id,entry_date,done,value,photo_path) values ($1,'2026-09-21',true,999,'secret/photo'),($2,'2026-09-22',true,123,'other/photo')",[habit,otherHabit]);
    await db.query('insert into public.direct_conversations(user_one,user_two) values ($1,$2)',[ids[0],ids[1]]);
    await db.query("insert into public.chat_messages(conversation_id,sender_id,body) select id,$1,'Existing message' from public.direct_conversations",[ids[0]]);
    if (historical) await db.query("insert into public.chat_reads select $1,id,'2026-09-01'::timestamptz from public.direct_conversations",[ids[1]]);
    await db.exec(sql('migrations/20261003_handle_social_compatibility.sql'));
    await db.query('update public.profiles set leaderboard_enabled=true,bio=$1 where id=any($2::uuid[])',['Friends bio',[ids[0],ids[1],ids[3],ids[4]]]);
    await db.exec('alter table public.profiles add column private_email text;');
  }, 30000);
  beforeEach(async () => { await db.exec('reset role; begin;'); });
  afterEach(async () => { await db.exec('rollback; reset role;'); });
  afterAll(async () => { await db?.close(); });

  it('preserves existing UUIDs, handles, friendships and private habit data', async () => {
    expect((await db.query('select count(*)::int n from public.profiles')).rows[0].n).toBe(5);
    expect((await db.query('select count(*)::int n from public.friendships')).rows[0].n).toBe(3);
    expect((await db.query('select body from public.chat_messages')).rows).toEqual([{body:'Existing message'}]);
    expect((await db.query('select count(*)::int n from public.chat_reads')).rows[0].n).toBe(historical ? 1 : 0);
    expect((await db.query('select value,photo_path from public.habit_entries where habit_id=$1',[habit])).rows[0]).toEqual({value:'999',photo_path:'secret/photo'});
  });
  it('retains all original handle deployment checks', async () => {
    const rows = (await db.query(sql('checks/20261003_handle_onboarding.sql'))).rows;
    expect(rows).toHaveLength(13); expect(rows.filter(row => !row.passed)).toEqual([]);
  });
  it('restricts definers to fixed paths and authenticated callers', async () => {
    const rows=(await db.query(`select p.proname,p.prosecdef,p.proconfig,
      has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,
      has_function_privilege('anon',p.oid,'EXECUTE') anonymous
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in ('own_profile_settings','save_profile_settings','friend_social_profiles','social_leaderboard_week')`)).rows;
    expect(rows).toHaveLength(4);
    for (const row of rows) expect(row).toMatchObject({prosecdef:true,proconfig:['search_path=""'],authenticated:true,anonymous:false});
  });
  it('reads directory identity and hides undiscoverable strangers without RLS recursion', async () => {
    await user(0);
    expect((await db.query("select id,handle,display_name from public.profiles where handle='person_1'")).rows[0].id).toBe(ids[1]);
    expect((await db.query('select id from public.profiles where id=$1',[ids[3]])).rows).toEqual([]);
  });
  it('reads only own settings, never arbitrary owner IDs', async () => {
    await user(0);
    const rows=(await db.query('select * from public.own_profile_settings()')).rows;
    expect(rows).toHaveLength(1); expect(rows[0].id).toBe(ids[0]); expect(rows[0].discoverable).toBe(true);
    expect(Object.keys(rows[0])).toEqual(['id','handle','display_name','bio','discoverable','leaderboard_enabled']);
  });
  it.each(['bio','discoverable','leaderboard_enabled','private_email','*'])('denies direct SELECT of %s even to the owner', async field => {
    await user(0); await expect(db.query(`select ${field} from public.profiles where id=auth.uid()`)).rejects.toMatchObject({code:'42501'});
  });
  it('saves only the caller and preserves UUID, with normalized handles', async () => {
    await user(0); const rows=(await save('  RENAMED  ')).rows;
    expect(rows[0]).toMatchObject({id:ids[0],handle:'renamed',discoverable:false,leaderboard_enabled:true});
    await db.exec('reset role');
    expect((await db.query('select handle from public.profiles where id=$1',[ids[1]])).rows[0].handle).toBe('person_1');
  });
  it('rejects arbitrary settings writes and auth metadata access', async () => {
    await user(0);
    // A savepoint lets us verify several expected SQL errors in one transaction.
    await db.exec('savepoint denied');
    await expect(db.query('update public.profiles set discoverable=false where id=$1',[ids[1]])).rejects.toMatchObject({code:'42501'});
    await db.exec('rollback to denied');
    await expect(db.query('select email,raw_user_meta_data from auth.users')).rejects.toMatchObject({code:'42501'});
  });
  it('reveals bios only to accepted friends, not pending requests or discoverable strangers', async () => {
    await user(0);
    await db.query('insert into public.friendships(requester_id,addressee_id) values (auth.uid(),$1)',[ids[4]]);
    const rows=(await db.query('select * from public.friend_social_profiles($1)',[ids])).rows;
    expect(rows.map(row=>row.id).sort()).toEqual(ids.slice(0,3));
    expect(Object.keys(rows[0])).toEqual(['id','handle','display_name','bio']);
  });
  it('filters leaderboard opt-ins, accepted circle and viewer-specific shares', async () => {
    await user(0); const rows=(await board()).rows;
    expect(rows.map(row=>row.user_id).sort()).toEqual([ids[0],ids[1]]);
    expect(rows.find(row=>row.user_id===ids[1])).toMatchObject({completion_count:1,active_days:1});
    expect(Object.keys(rows[0])).toEqual(['user_id','display_name','handle','completion_count','active_days','rank']);
  });
  it('immediately stops counting unshared completions', async () => {
    await user(1); await db.query('delete from public.habit_shares where habit_id=$1 and viewer_id=$2',[habit,ids[0]]);
    await user(0); expect((await board()).rows.find(row=>row.user_id===ids[1]).completion_count).toBe(0);
  });
  it('rejects invalid leaderboard weeks', async () => {
    await user(0); await expect(db.query("select * from public.social_leaderboard_week('2026-09-22')")).rejects.toThrow('Monday');
  });
  it('keeps availability, claiming, stale-claim protection and uniqueness working', async () => {
    await user(5);
    expect((await db.query("select public.handle_available('new_person') ok")).rows[0].ok).toBe(true);
    expect((await db.query("select * from public.claim_handle('NEW_PERSON')")).rows[0].id).toBe(ids[5]);
    expect((await db.query("select * from public.claim_handle('ignored_name')")).rows[0].handle).toBe('new_person');
    await expect(save('PERSON_1')).rejects.toMatchObject({code:'23505'});
  });
  it('maps handles to UUID friend requests and restricts acceptance to the recipient', async () => {
    await user(0);
    const request=(await db.query("insert into public.friendships(requester_id,addressee_id) select auth.uid(),id from public.profiles where handle='person_4' returning id")).rows[0].id;
    await db.exec('savepoint denied'); await expect(db.query('select public.accept_friendship($1)',[request])).rejects.toThrow('unavailable'); await db.exec('rollback to denied');
    await user(4); await db.query('select public.accept_friendship($1)',[request]);
    expect((await db.query('select status from public.friendships where id=$1',[request])).rows[0].status).toBe('accepted');
  });
  it('denies requests without a chosen handle, to hidden users and to self', async () => {
    for (const [actor,target,code] of [[5,0,'42501'],[0,3,'42501'],[0,0,'23514']]) {
      await user(actor); await db.exec('savepoint denied');
      await expect(db.query('insert into public.friendships(requester_id,addressee_id) values (auth.uid(),$1)',[ids[target]])).rejects.toMatchObject({code});
      await db.exec('rollback to denied');
    }
  });
  it('preserves direct chat, persistent unread positions, and outsider denial', async () => {
    await user(0); const conversation=(await db.query('select public.start_direct_conversation($1) id',[ids[1]])).rows[0].id;
    await db.query("insert into public.chat_messages(conversation_id,sender_id,body) values ($1,auth.uid(),'Hello')",[conversation]);
    await user(1); expect((await db.query('select * from public.social_unread_chats()')).rows).toHaveLength(1);
    await db.query('select public.mark_social_chat_read($1,now())',[conversation]);
    expect((await db.query('select * from public.social_unread_chats()')).rows).toEqual([]);
    await user(4); expect((await db.query('select body from public.chat_messages')).rows).toEqual([]);
    await expect(db.query("insert into public.chat_messages(conversation_id,sender_id,body) values ($1,auth.uid(),'intrusion')",[conversation])).rejects.toMatchObject({code:'42501'});
  });
  it('blocking removes chat/shares and excludes profiles, bios and leaderboard', async () => {
    await user(0); await db.query('select public.start_direct_conversation($1)',[ids[1]]);
    const id=(await db.query('select id from public.friendships where requester_id=$1 and addressee_id=$2',[ids[0],ids[1]])).rows[0].id;
    await db.query('select public.block_friendship($1)',[id]);
    expect((await db.query('select id from public.profiles where id=$1',[ids[1]])).rows).toEqual([]);
    expect((await db.query('select * from public.friend_social_profiles($1)',[[ids[1]]])).rows).toEqual([]);
    expect((await board()).rows.map(row=>row.user_id)).not.toContain(ids[1]);
    await db.exec('reset role'); expect((await db.query('select * from public.direct_conversations')).rows).toEqual([]);
    expect((await db.query('select * from public.habit_shares where viewer_id=$1',[ids[0]])).rows).toEqual([]);
  });
  it('denies anon every protected RPC and directory access', async () => {
    await db.exec('set local role anon');
    for (const query of ['select id from public.profiles','select * from public.own_profile_settings()',"select * from public.save_profile_settings('x','abc','',true,true)","select * from public.friend_social_profiles('{}')","select * from public.social_leaderboard_week('2026-09-21')","select public.handle_available('abc')","select * from public.claim_handle('abc')"]) {
      await db.exec('savepoint denied'); await expect(db.query(query)).rejects.toMatchObject({code:'42501'}); await db.exec('rollback to denied');
    }
  });
  it('passes the complete rollback-only deployment verification script', async () => {
    await db.exec('rollback; reset role;');
    const results = await db.exec(sql('checks/20261003_handle_social_compatibility.sql'));
    const rows = results.find(result => result.rows?.[0]?.check_name)?.rows;
    expect(rows.length).toBeGreaterThanOrEqual(16);
    expect(rows.filter(row => !row.passed)).toEqual([]);
    expect((await db.query('select count(*)::int n from auth.users')).rows[0].n).toBe(6);
  });
  it('does not trust an authenticated role without auth.uid()', async () => {
    await user(null); expect((await db.query('select * from public.own_profile_settings()')).rows).toEqual([]);
    expect((await db.query('select * from public.friend_social_profiles($1)',[ids])).rows).toEqual([]);
    await expect(board()).rejects.toMatchObject({code:'42501'});
  });
});
