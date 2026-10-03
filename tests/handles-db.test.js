// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let db;
const ids = Array.from({ length: 8 }, (_, n) => `00000000-0000-0000-0000-${String(n + 1).padStart(12, '0')}`);
const migration = (name) => readFileSync(new URL(`../database/migrations/${name}.sql`, import.meta.url), 'utf8');
async function asUser(index, connection = db) {
  await connection.exec('reset role');
  await connection.query("select set_config('request.jwt.claim.sub', $1, false)", [ids[index]]);
  await connection.exec('set role authenticated');
}
const claim = (handle) => db.query('select * from public.claim_handle($1)', [handle]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;
  `);
  await db.exec(migration('20260921_habit_tracker'));
  await db.exec(migration('20260922_add_social'));
  await db.exec(migration('20260922_add_friend_controls'));
  for (const id of ids) await db.query('insert into auth.users values ($1)', [id]);
  await db.query("insert into public.profiles(id,handle,display_name) values ($1,'admin','Original name')", [ids[0]]);
  await db.query("insert into public.habits(user_id,name,target) values ($1,'Existing private habit',10)", [ids[1]]);
  await db.exec(migration('20261003_handle_onboarding'));
}, 30000);
afterAll(async () => { await db?.close(); });

describe('handle migration on PostgreSQL with real roles and RLS', () => {
  it('preserves existing identities and habits without creating email-derived profiles', async () => {
    expect((await db.query('select count(*)::int as n from public.profiles')).rows[0].n).toBe(1);
    await asUser(0);
    expect((await db.query('select id,handle,display_name from public.profiles')).rows).toEqual([{ id: ids[0], handle: 'admin', display_name: 'Original name' }]);
    await asUser(1);
    expect((await db.query('select name from public.habits')).rows).toEqual([{ name: 'Existing private habit' }]);
  });
  it('claims a normalized handle only for auth.uid and preserves it on repeated/stale claims', async () => {
    await asUser(1);
    expect((await claim('  Alice_S  ')).rows).toEqual([{ id: ids[1], handle: 'alice_s', display_name: 'alice_s' }]);
    expect((await claim('different_handle')).rows[0].handle).toBe('alice_s');
  });
  it('enforces database uniqueness after two users saw availability', async () => {
    for (const index of [2, 3]) {
      await asUser(index);
      expect((await db.query("select public.handle_available('shared_name') as available")).rows[0].available).toBe(true);
    }
    await asUser(2); await claim('shared_name');
    await asUser(3);
    await expect(claim('SHARED_NAME')).rejects.toMatchObject({ code: '23505' });
    expect((await db.query('select id from public.profiles where id = auth.uid()')).rows).toEqual([]);
  });
  it.each(['ab', 'x'.repeat(25), 'bad space', 'bad!', '@name', 'support', 'SYSTEM', null])('rejects invalid/reserved handle %s server-side', async (handle) => {
    await asUser(3);
    await expect(claim(handle)).rejects.toMatchObject({ code: '23514' });
  });
  it('retains a legacy NULL profile display name and discoverability when claiming', async () => {
    await asUser(3);
    await db.query("insert into public.profiles(id,handle,display_name,discoverable) values (auth.uid(),null,'Chosen name',false)");
    expect((await claim('private_person')).rows[0]).toEqual({ id: ids[3], handle: 'private_person', display_name: 'Chosen name' });
    await asUser(1);
    expect((await db.query("select id,handle from public.profiles where handle='private_person'")).rows).toEqual([]);
    expect((await db.query("select public.handle_available('private_person') as available")).rows[0].available).toBe(false);
  });
  it('prevents writing another user profile and prevents clearing a chosen handle', async () => {
    await asUser(1);
    expect((await db.query('update public.profiles set handle=$1 where id=$2 returning id', ['stolen', ids[2]])).rows).toEqual([]);
    await expect(db.query('insert into public.profiles(id,handle,display_name) values ($1,$2,$2)', [ids[4], 'forged'])).rejects.toMatchObject({ code: '42501' });
    await expect(db.query('update public.profiles set id=$1 where id=auth.uid()', [ids[4]])).rejects.toMatchObject({ code: '42501' });
    await expect(db.query('update public.profiles set handle=null where id=auth.uid()')).rejects.toMatchObject({ code: '23514' });
  });
  it('limits discovery to the three public fields, including after private columns are added', async () => {
    await db.exec('reset role; alter table public.profiles add column private_email text;');
    await asUser(1);
    const result = await db.query("select id,handle,display_name from public.profiles where handle='shared_name'");
    expect(Object.keys(result.rows[0])).toEqual(['id', 'handle', 'display_name']);
    for (const field of ['*', 'private_email', 'discoverable', 'created_at']) {
      await expect(db.query(`select ${field} from public.profiles`)).rejects.toMatchObject({ code: '42501' });
    }
    await expect(db.query('select * from auth.users')).rejects.toMatchObject({ code: '42501' });
    expect((await db.query('select * from public.habits where user_id<>auth.uid()')).rows).toEqual([]);
  });
  it('maps handles to UUID requests, rejects self requests and accepts only as recipient', async () => {
    await asUser(1);
    await expect(db.query('insert into public.friendships(requester_id,addressee_id) values (auth.uid(),auth.uid())')).rejects.toMatchObject({ code: '23514' });
    const request = (await db.query("insert into public.friendships(requester_id,addressee_id) select auth.uid(),id from public.profiles where handle='shared_name' returning id")).rows[0].id;
    await expect(db.query('select public.accept_friendship($1)', [request])).rejects.toThrow('unavailable');
    await asUser(2); await db.query('select public.accept_friendship($1)', [request]);
    await db.query("update public.profiles set handle='renamed_friend' where id=auth.uid()");
    await asUser(1);
    expect((await db.query('select requester_id,addressee_id,status from public.friendships where id=$1', [request])).rows[0]).toEqual({ requester_id: ids[1], addressee_id: ids[2], status: 'accepted' });
    expect((await db.query("select id from public.profiles where handle='renamed_friend'")).rows[0].id).toBe(ids[2]);
  });
  it('requires both identities even when clients bypass the UI', async () => {
    await asUser(4);
    await expect(db.query('insert into public.friendships(requester_id,addressee_id) values (auth.uid(),$1)', [ids[1]])).rejects.toMatchObject({ code: '42501' });
    await asUser(1);
    await expect(db.query('insert into public.friendships(requester_id,addressee_id) values (auth.uid(),$1)', [ids[4]])).rejects.toMatchObject({ code: '42501' });
  });
  it('keeps a pending request visible if its sender disables discovery', async () => {
    await asUser(3);
    await db.query('insert into public.friendships(requester_id,addressee_id) values (auth.uid(),$1)', [ids[1]]);
    await asUser(1);
    expect((await db.query('select handle from public.profiles where id=$1', [ids[3]])).rows[0].handle).toBe('private_person');
  });
  it('denies anonymous access to profiles and both RPCs', async () => {
    await db.exec('reset role; set role anon;');
    await expect(db.query('select id,handle from public.profiles')).rejects.toMatchObject({ code: '42501' });
    await expect(claim('anonymous')).rejects.toMatchObject({ code: '42501' });
    await expect(db.query("select public.handle_available('anonymous')")).rejects.toMatchObject({ code: '42501' });
    await expect(db.query('select public.can_request_friend($1)', [ids[1]])).rejects.toMatchObject({ code: '42501' });
  });
  it('passes every deployment verification check', async () => {
    await db.exec('reset role');
    const sql = readFileSync(new URL('../database/checks/20261003_handle_onboarding.sql', import.meta.url), 'utf8');
    const { rows } = await db.query(sql);
    expect(rows).toHaveLength(13);
    expect(rows.filter((row) => !row.passed)).toEqual([]);
  });
});

describe('newer deployed social schema compatibility', () => {
  let latest;
  beforeAll(async () => {
    latest = new PGlite();
    await latest.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated, anon;
      grant execute on function auth.uid() to authenticated, anon;
    `);
    await latest.exec(migration('20260921_habit_tracker'));
    await latest.exec(migration('20260922_add_social'));
    await latest.exec(migration('20260922_add_friend_controls'));
    await latest.exec(`
      alter table public.profiles add column bio text not null default '';
      alter table public.profiles add column leaderboard_enabled boolean not null default false;
      drop policy "profiles are discoverable to friends" on public.profiles;
      create policy "profiles visible to their circle" on public.profiles for select to authenticated using (
        id = auth.uid() or (not exists (select 1 from public.friendships f where f.status = 'blocked'
          and auth.uid() in (f.requester_id, f.addressee_id) and profiles.id in (f.requester_id, f.addressee_id))
          and (discoverable or exists (select 1 from public.friendships f where f.status in ('pending','accepted')
            and auth.uid() in (f.requester_id, f.addressee_id) and profiles.id in (f.requester_id, f.addressee_id)))));
      drop policy "users request friendships" on public.friendships;
      create policy "request discoverable profiles" on public.friendships for insert to authenticated with check (
        requester_id = auth.uid() and status = 'pending' and exists (
          select 1 from public.profiles p where p.id = addressee_id and p.discoverable));
    `);
    for (const id of ids.slice(0, 3)) await latest.query('insert into auth.users values ($1)', [id]);
    await latest.query("insert into public.profiles(id,handle,display_name,bio) values ($1,'first_user','First','Private bio'),($2,'second_user','Second','Another bio')", [ids[0], ids[1]]);
    await latest.exec(migration('20261003_handle_onboarding'));
  }, 30000);
  afterAll(async () => { await latest?.close(); });

  it('applies with current policy names and keeps extra profile columns private', async () => {
    const sql = readFileSync(new URL('../database/checks/20261003_handle_onboarding.sql', import.meta.url), 'utf8');
    const { rows } = await latest.query(sql);
    expect(rows).toHaveLength(13);
    expect(rows.filter((row) => !row.passed)).toEqual([]);
    await asUser(0, latest);
    expect((await latest.query("select id from public.profiles where handle='second_user'")).rows[0].id).toBe(ids[1]);
    for (const field of ['bio', 'leaderboard_enabled', '*']) {
      await expect(latest.query(`select ${field} from public.profiles`)).rejects.toMatchObject({ code: '42501' });
    }
    await asUser(2, latest);
    expect((await latest.query("select * from public.claim_handle('newcomer')")).rows[0].handle).toBe('newcomer');
  });

  it('preserves blocked-profile hiding and the friend request UUID rules', async () => {
    await latest.exec('reset role');
    await latest.query("insert into public.friendships(requester_id,addressee_id,status,blocked_by) values ($1,$2,'blocked',$1)", [ids[0], ids[1]]);
    await asUser(0, latest);
    expect((await latest.query("select id from public.profiles where handle='second_user'")).rows).toEqual([]);
    await asUser(1, latest);
    expect((await latest.query("select id from public.profiles where handle='first_user'")).rows).toEqual([]);
    await asUser(2, latest);
    const request = await latest.query("insert into public.friendships(requester_id,addressee_id) select auth.uid(),id from public.profiles where handle='first_user' returning addressee_id");
    expect(request.rows[0].addressee_id).toBe(ids[0]);
  });

  it('can be retried without changing existing handles or duplicating policies', async () => {
    await latest.exec('reset role');
    await latest.exec(migration('20261003_handle_onboarding'));
    const result = await latest.query("select policyname from pg_policies where schemaname='public' and tablename='profiles' and cmd='SELECT'");
    expect(result.rows).toEqual([{ policyname: 'profiles visible to their circle' }]);
    expect((await latest.query('select handle from public.profiles where id=$1', [ids[0]])).rows[0].handle).toBe('first_user');
  });
});
