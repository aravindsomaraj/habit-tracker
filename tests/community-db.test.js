// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
const migration = name => readFileSync(new URL(`../database/migrations/${name}.sql`, import.meta.url), 'utf8');
const ids = ['10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000003'];
describe('authenticated opt-in community', () => {
  let db, habit, today;
  const user = async i => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [i === null ? '' : ids[i]]);
    await db.exec('set role authenticated');
  };
  const feed = () => db.query('select * from public.community_feed()');
  const publish = async () => {
    await user(0);
    await db.query('select public.set_community_enabled(true)');
    await db.query('select public.set_community_habit($1,true)', [habit]);
    await db.query('insert into public.habit_entries(habit_id,entry_date,done,value,photo_path) values ($1,$2,true,999,$3)', [habit,today,'private/photo']);
  };
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create role authenticated; create role anon; create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to authenticated,anon;
      grant execute on function auth.uid() to authenticated,anon;
      create publication supabase_realtime;`);
    for (const name of ['20260921_habit_tracker','20260922_add_social','20260922_add_friend_controls','20260922_add_direct_chat','20261003_handle_onboarding','20261003_handle_social_compatibility','20261004_fix_social_relationship_profiles','20261004_community_feed']) await db.exec(migration(name));
    for (let i=0;i<3;i++) {
      await db.query('insert into auth.users values($1)',[ids[i]]);
      await db.query('insert into public.profiles(id,handle,display_name,bio) values ($1,$2,$2,$3)',[ids[i],`person_${i}`,'Public bio']);
    }
    habit=(await db.query("insert into public.habits(user_id,name,target) values ($1,'Read',1) returning id",[ids[0]])).rows[0].id;
    today=(await db.query("select to_char(now() at time zone 'UTC','YYYY-MM-DD') as date_key")).rows[0].date_key;
  },30000);
  beforeEach(async () => { await db.exec('reset role; begin'); });
  afterEach(async () => { await db.exec('rollback; reset role'); });
  afterAll(async () => { await db?.close(); });
  it('keeps existing identities and habits private by default',async () => {
    await user(0); expect((await db.query('select public.community_preferences() enabled')).rows[0].enabled).toBe(false);
    expect((await feed()).rows).toEqual([]);
    await expect(db.query('select public.set_community_habit($1,true)',[habit])).rejects.toThrow('participation');
  });
  it('publishes only safe completion fields without requiring friendship',async () => {
    await publish(); await user(1);
    const rows=(await feed()).rows; expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0])).toEqual(['id','actor_id','habit_label','occurred_on','created_at','display_name','handle']);
    expect(rows[0]).toMatchObject({actor_id:ids[0],habit_label:'Read'});
    expect(rows[0].occurred_on.toISOString().slice(0,10)).toBe(today);
    expect((await db.query('select * from public.community_profile($1)',[ids[0]])).rows[0].bio).toBe('Public bio');
    expect((await db.query('select * from public.habit_entries')).rows).toEqual([]);
  });
  it('does not backfill old completions or publish them through value edits',async () => {
    await user(0);
    await db.query("insert into public.habit_entries(habit_id,entry_date,done) values ($1,$2,true),($1,'2020-01-01',true)",[habit,today]);
    await db.query('select public.set_community_enabled(true)'); await db.query('select public.set_community_habit($1,true)',[habit]);
    await db.query('update public.habit_entries set value=123 where habit_id=$1',[habit]);
    expect((await feed()).rows).toEqual([]);
    await db.query("update public.habit_entries set done=false where habit_id=$1 and entry_date='2020-01-01'",[habit]);
    await db.query("update public.habit_entries set done=true where habit_id=$1 and entry_date='2020-01-01'",[habit]);
    expect((await feed()).rows).toEqual([]);
  });
  it.each(['undo','rest','delete','habit opt out','profile opt out'])('removes published updates on %s',async action => {
    await publish();
    if(action==='undo') await db.query('update public.habit_entries set done=false where habit_id=$1',[habit]);
    if(action==='rest') await db.query('update public.habit_entries set rest=true where habit_id=$1',[habit]);
    if(action==='delete') await db.query('delete from public.habit_entries where habit_id=$1',[habit]);
    if(action==='habit opt out') await db.query('select public.set_community_habit($1,false)',[habit]);
    if(action==='profile opt out') await db.query('select public.set_community_enabled(false)');
    await user(1); expect((await feed()).rows).toEqual([]);
  });
  it('blocks strangers in both directions and prevents new requests',async () => {
    await publish(); await user(1); await db.query('select public.block_community_user($1)',[ids[0]]);
    expect((await feed()).rows).toEqual([]); expect((await db.query('select * from public.community_profile($1)',[ids[0]])).rows).toEqual([]);
    await user(0); expect((await db.query('select * from public.community_profile($1)',[ids[1]])).rows).toEqual([]);
    await user(2); expect((await feed()).rows).toHaveLength(1);
  });
  it('reports hide the author only for the reporter and preserve an operator record',async () => {
    await publish(); await user(1); const activity=(await feed()).rows[0].id;
    await db.query("select public.report_community_activity($1,'spam')",[activity]);
    expect((await feed()).rows).toEqual([]);
    await user(2); expect((await feed()).rows).toHaveLength(1);
    await db.exec('reset role'); expect((await db.query('select reason from public.community_reports')).rows).toEqual([{reason:'spam'}]);
  });
  it('enforces operator suspension even when the author tries to opt in again',async () => {
    await publish(); await db.exec('reset role');
    await db.query('update public.profiles set community_suspended=true where id=$1',[ids[0]]);
    await user(1); expect((await feed()).rows).toEqual([]);
    expect((await db.query('select * from public.community_profile($1)',[ids[0]])).rows).toEqual([]);
    await user(0); await expect(db.query('select public.set_community_enabled(true)')).rejects.toThrow('suspended');
  });
  it('limits reports even for concurrent callers through a per-user lock',async () => {
    await publish(); await db.exec('reset role');
    for (let i=0;i<10;i++) await db.query("insert into public.community_reports(reporter_id,actor_id,reason) values ($1,$2,'spam')",[ids[1],ids[2]]);
    await user(1); const activity=(await feed()).rows[0].id;
    await expect(db.query("select public.report_community_activity($1,'spam')",[activity])).rejects.toThrow('limit reached');
  });
  it('paginates timestamp ties without duplicates and scopes actor filters',async () => {
    await publish(); await db.exec('reset role');
    const second=(await db.query("insert into public.habits(user_id,name,target) values ($1,'Walk',1) returning id",[ids[0]])).rows[0].id;
    await user(0); await db.query('select public.set_community_habit($1,true)',[second]);
    await db.query('insert into public.habit_entries(habit_id,entry_date,done) values ($1,$2,true)',[second,today]);
    await user(1);
    const first=(await db.query('select * from public.community_feed(null,null,1)')).rows[0];
    const next=(await db.query('select * from public.community_feed($1,$2,1)',[first.created_at,first.id])).rows[0];
    expect(next.id).not.toBe(first.id);
    expect((await db.query('select * from public.community_feed(null,null,20,$1)',[ids[2]])).rows).toEqual([]);
  });
  it('denies raw reads/writes, other habit mutation, anonymous RPCs and missing identity',async () => {
    await user(1);
    for(const query of ['select * from public.community_activities','select * from public.community_reports',`select public.set_community_habit('${habit}',true)`]) {
      await db.exec('savepoint denied'); await expect(db.query(query)).rejects.toThrow(); await db.exec('rollback to denied');
    }
    await user(null); expect((await feed()).rows).toEqual([]);
    await db.exec('reset role; set role anon');
    await expect(feed()).rejects.toMatchObject({code:'42501'});
  });
});
