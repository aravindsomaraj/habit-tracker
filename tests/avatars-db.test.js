// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
const sql = (name) => readFileSync(new URL(`../database/${name}`, import.meta.url), 'utf8');
const ids = [1,2,3,4].map(n => `10000000-0000-0000-0000-00000000000${n}`);
const path = (i, n = 1) => `${ids[i]}/20000000-0000-0000-0000-00000000000${n}.png`;

// Real Postgres RLS/ACLs and project migrations, with a minimal Storage catalog.
// HTTP public downloads and MIME/size enforcement belong to the Storage service;
// these tests verify its bucket configuration, not a simulated download server.
describe.each([false, true])('Avatar migration, historical Social installed: %s', historical => {
  let db, proofPolicies, profilePolicies;
  const user = async (i, role = 'authenticated') => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [i === null ? '' : ids[i]]);
    await db.exec(`set role ${role}`);
  };
  const insert = (i, n = 1, bucket = 'avatars') => db.query('insert into storage.objects(bucket_id,name) values($1,$2)', [bucket,path(i,n)]);
  const set = (newPath, oldPath = null) => db.query('select * from public.set_profile_avatar($1,$2)', [newPath,oldPath]);
  const denied = async (run, code = '42501') => {
    await db.exec('savepoint denied');
    try { await expect(run()).rejects.toMatchObject({ code }); }
    finally { await db.exec('rollback to savepoint denied; release savepoint denied;'); }
  };
  const policies = (table) => db.query("select schemaname,tablename,policyname,cmd,roles,qual,with_check from pg_policies where tablename=$1 order by policyname", [table]);
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key, email text);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('sub',auth.uid()) $$;
      grant usage on schema auth to authenticated,anon;
      create publication supabase_realtime;
      create schema storage;
      create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text not null,unique(bucket_id,name));
      alter table storage.objects enable row level security;
      create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
      grant usage on schema storage to authenticated,anon;
      grant select,insert,update,delete on storage.objects to authenticated,anon;
      insert into storage.buckets(id,name,public) values('proof-photos','proof-photos',false);`);
    for (const name of ['20260921_habit_tracker','20260921_photos_store','20260922_add_social','20260922_add_friend_controls','20260922_add_direct_chat']) await db.exec(sql(`migrations/${name}.sql`));
    if (historical) await db.exec(sql('migrations/20261003_social_profiles.sql'));
    await db.exec(sql('migrations/20261003_handle_onboarding.sql'));
    await db.exec(sql('migrations/20261003_handle_social_compatibility.sql'));
    for (let i=0;i<ids.length;i++) {
      await db.query('insert into auth.users(id) values($1)', [ids[i]]);
      if(i<3) await db.query('insert into public.profiles(id,handle,display_name,bio,leaderboard_enabled) values($1,$2,$2,$3,true)', [ids[i],`person_${i}`,'Private bio']);
    }
    await db.query("insert into public.friendships(requester_id,addressee_id,status,accepted_at) values($1,$2,'accepted',now())", ids.slice(0,2));
    proofPolicies=(await policies('objects')).rows;
    profilePolicies=(await policies('profiles')).rows;
    await db.exec(sql('migrations/20261003_profile_avatar.sql'));
  }, 30000);
  beforeEach(async () => { await db.exec('reset role; begin;'); });
  afterEach(async () => { await db.exec('rollback; reset role;'); });
  afterAll(async () => { await db?.close(); });

  it('preserves existing users and policies with NULL avatars', async () => {
    expect((await db.query('select avatar_path from public.profiles')).rows).toEqual(Array(3).fill({avatar_path:null}));
    expect((await policies('profiles')).rows).toEqual(profilePolicies);
    const stored = (await policies('objects')).rows;
    expect(stored.filter(p=>p.policyname.includes('proof photos'))).toEqual(proofPolicies);
    expect(stored.filter(p=>p.policyname.startsWith('Owners ')).map(p=>[p.policyname,p.cmd,p.roles])).toEqual([
      ['Owners delete avatars','DELETE',['authenticated']],['Owners upload avatars','INSERT',['authenticated']],['Owners view avatar objects','SELECT',['authenticated']],
    ]);
  });
  it('configures public avatar downloads and service-side MIME/size limits without making proofs public', async () => {
    expect((await db.query("select public,file_size_limit,allowed_mime_types from storage.buckets where id='avatars'")).rows[0]).toEqual({public:true,file_size_limit:5242880,allowed_mime_types:['image/jpeg','image/png','image/webp']});
    expect((await db.query("select public from storage.buckets where id='proof-photos'")).rows[0].public).toBe(false);
  });
  it('allows owner upload, attachment, replacement and removal in order', async () => {
    await user(0); await insert(0);
    expect((await set(path(0))).rows[0]).toMatchObject({id:ids[0],avatar_path:path(0)});
    await insert(0,2);
    expect((await set(path(0,2),path(0))).rows[0].avatar_path).toBe(path(0,2));
    expect((await db.query('delete from storage.objects where name=$1 returning name',[path(0)])).rows).toHaveLength(1);
    expect((await set(null,path(0,2))).rows[0].avatar_path).toBeNull();
    expect((await db.query('delete from storage.objects where name=$1 returning name',[path(0,2)])).rows).toHaveLength(1);
  });
  it('denies cross-owner uploads, overwrites, renames and deletion', async () => {
    await user(1); await insert(1); await set(path(1));
    await user(0);
    await denied(()=>insert(1,2));
    await denied(()=>db.query("insert into storage.objects(bucket_id,name) values('avatars',$1) on conflict(bucket_id,name) do update set name=excluded.name",[path(1)]));
    expect((await db.query('update storage.objects set name=$1 where name=$2 returning name',[path(0),path(1)])).rows).toEqual([]);
    expect((await db.query('delete from storage.objects where name=$1 returning name',[path(1)])).rows).toEqual([]);
    await denied(()=>set(path(1)));
    await db.exec('reset role');
    expect((await db.query('select avatar_path from public.profiles where id=$1',[ids[1]])).rows[0].avatar_path).toBe(path(1));
    expect((await db.query('select name from storage.objects')).rows).toEqual([{name:path(1)}]);
  });
  it('uses immutable names: even the owner has no object UPDATE policy', async () => {
    await user(0); await insert(0);
    expect((await db.query('update storage.objects set name=$1 where name=$2 returning name',[path(0,2),path(0)])).rows).toEqual([]);
    await denied(()=>insert(0),'23505');
  });
  it.each(['avatars','proof-photos'])('denies anonymous writes, deletes and metadata listing in %s', async bucket => {
    await user(0); await insert(0,1,bucket);
    await user(null,'anon'); await denied(()=>insert(0,2,bucket));
    expect((await db.query('select * from storage.objects')).rows).toEqual([]);
    expect((await db.query('delete from storage.objects returning name')).rows).toEqual([]);
    expect((await db.query('update storage.objects set name=$1 returning name',[path(0,2)])).rows).toEqual([]);
  });
  it('retains owner-only proof access and bucket separation', async () => {
    await user(0); await insert(0,1,'proof-photos');
    expect((await db.query('select name from storage.objects')).rows).toEqual([{name:path(0)}]);
    // A proof object with an avatar-shaped name still cannot be attached as an avatar.
    await denied(()=>set(path(0)));
    await user(1); await denied(()=>insert(0,2,'proof-photos'));
    expect((await db.query('select * from storage.objects')).rows).toEqual([]);
    expect((await db.query('delete from storage.objects returning name')).rows).toEqual([]);
    await user(0); expect((await db.query('delete from storage.objects returning name')).rows).toHaveLength(1);
  });
  it('only exposes the four public identity columns, with no table or anonymous SELECT', async () => {
    await user(0); await insert(0); await set(path(0));
    await user(2);
    expect((await db.query('select id,handle,display_name,avatar_path from public.profiles where id=$1',[ids[0]])).rows[0]).toEqual({id:ids[0],handle:'person_0',display_name:'person_0',avatar_path:path(0)});
    for(const column of ['bio','discoverable','leaderboard_enabled','created_at','updated_at','*']) await denied(()=>db.query(`select ${column} from public.profiles`));
    await user(null,'anon'); await denied(()=>db.query('select avatar_path from public.profiles'));
  });
  it('denies direct own and cross-owner metadata writes, including INSERT', async () => {
    await user(0);
    for(const target of [ids[0],ids[1]]) await denied(()=>db.query('update public.profiles set avatar_path=$1 where id=$2',[path(0),target]));
    await user(3);
    await denied(()=>db.query("insert into public.profiles(id,handle,display_name,avatar_path) values(auth.uid(),'new_person','New',$1)",[path(3)]));
  });
  it.each([null,'anon'])('denies avatar RPC without a valid authenticated UUID (%s)', async role => {
    await user(null,role || 'authenticated'); await denied(()=>set(null));
  });
  it.each(['../escape.png','https://attacker.test/a.png','bad.svg','nested/avatar.png'])('rejects arbitrary avatar paths: %s', async suffix => {
    await user(0); await denied(()=>set(`${ids[0]}/${suffix}`));
    await denied(()=>db.query("insert into storage.objects(bucket_id,name) values('avatars',$1)",[`${ids[0]}/${suffix}`]));
  });
  it('requires an existing uploaded avatar and a current expected path', async () => {
    await user(0); await denied(()=>set(path(0)));
    await insert(0); await set(path(0)); await insert(0,2);
    await denied(()=>set(path(0,2),null),'40001');
    expect((await db.query('select avatar_path from public.own_profile_settings()')).rows[0].avatar_path).toBe(path(0));
  });
  it('can remove metadata for an already missing object', async () => {
    await user(0); await insert(0); await set(path(0));
    await db.query('delete from storage.objects where name=$1',[path(0)]);
    expect((await set(null,path(0))).rows[0].avatar_path).toBeNull();
  });
  it('returns avatars from owner, friend and leaderboard RPCs without changing audiences', async () => {
    await user(0); await insert(0); await set(path(0));
    const own=(await db.query('select * from public.own_profile_settings()')).rows;
    expect(own).toHaveLength(1); expect(own[0].avatar_path).toBe(path(0));
    expect(Object.keys(own[0]).sort()).toEqual(['avatar_path','bio','discoverable','display_name','handle','id','leaderboard_enabled']);
    const saved=(await db.query("select * from public.save_profile_settings('New name','person_0','New bio',true,true)")).rows[0];
    expect(saved.avatar_path).toBe(path(0));
    await user(1);
    const friend=(await db.query('select * from public.friend_social_profiles($1::uuid[])',[[ids[0]]])).rows[0];
    expect(friend.avatar_path).toBe(path(0));
    expect(Object.keys(friend).sort()).toEqual(['avatar_path','bio','display_name','handle','id']);
    const board=(await db.query("select * from public.social_leaderboard_week('2026-09-21')")).rows;
    expect(board.map(p=>p.user_id).sort()).toEqual(ids.slice(0,2));
    expect(board.find(p=>p.user_id===ids[0]).avatar_path).toBe(path(0));
    expect(Object.keys(board[0]).sort()).toEqual(['active_days','avatar_path','completion_count','display_name','handle','rank','user_id']);
    await user(2);
    expect((await db.query('select * from public.friend_social_profiles($1::uuid[])',[[ids[0]]])).rows).toEqual([]);
    expect((await db.query("select * from public.social_leaderboard_week('2026-09-21')")).rows.map(p=>p.user_id)).toEqual([ids[2]]);
  });
  it('keeps blocked and hidden directory identities inaccessible despite public avatar storage', async () => {
    await user(0); await insert(0); await set(path(0));
    await db.query('select public.block_friendship(id) from public.friendships');
    await user(1);
    expect((await db.query('select avatar_path from public.profiles where id=$1',[ids[0]])).rows).toEqual([]);
    expect((await db.query('select * from public.friend_social_profiles($1::uuid[])',[[ids[0]]])).rows).toEqual([]);
    await user(0); await db.query("select public.save_profile_settings('Person','person_0','Bio',false,true)");
    await user(2); expect((await db.query('select avatar_path from public.profiles where id=$1',[ids[0]])).rows).toEqual([]);
  });
  it('preserves handle onboarding for new accounts without an avatar', async () => {
    await user(3);
    expect((await db.query("select * from public.claim_handle('NEW_PERSON')")).rows[0]).toMatchObject({id:ids[3],handle:'new_person'});
    expect((await db.query('select avatar_path from public.own_profile_settings()')).rows).toEqual([{avatar_path:null}]);
  });
  it('passes the complete read-only deployment checks', async () => {
    const rows=(await db.query(sql('checks/20261003_profile_avatar.sql'))).rows;
    expect(rows.length).toBeGreaterThanOrEqual(8); expect(rows.filter(r=>!r.passed)).toEqual([]);
  });
  it('retains all 51 compatibility behaviors after extending the three RPC output shapes', async () => {
    // Keep the original stage's checks intact. Only its exact JSON key assertions
    // change here to demand the additional public field in the new contract.
    const verification=sql('checks/20261003_handle_social_compatibility.sql')
      .replace("array['bio','discoverable','display_name','handle','id','leaderboard_enabled']", "array['avatar_path','bio','discoverable','display_name','handle','id','leaderboard_enabled']")
      .replace("array['bio','display_name','handle','id']", "array['avatar_path','bio','display_name','handle','id']")
      .replace("array['active_days','completion_count','display_name','handle','rank','user_id']", "array['active_days','avatar_path','completion_count','display_name','handle','rank','user_id']");
    const results=await db.exec(verification);
    const rows=results.find(r=>r.rows?.[0]?.check_name)?.rows;
    expect(rows).toHaveLength(51); expect(rows.filter(r=>!r.passed)).toEqual([]);
  });
});
