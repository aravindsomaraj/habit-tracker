-- Public avatars. Run as postgres AFTER handle_social_compatibility.
-- Forward-only: existing profiles keep NULL avatars; proof storage is untouched.
begin;
alter table public.profiles add column avatar_path text;
alter table public.profiles add constraint profiles_avatar_path_check check (
  avatar_path is null or (
    split_part(avatar_path,'/',1) = id::text
    and avatar_path ~ '^[0-9a-f-]{36}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
  )
);
grant select (avatar_path) on public.profiles to authenticated;
-- No direct avatar INSERT/UPDATE grant. Existing block-aware RLS is unchanged.

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('avatars','avatars',true,5242880,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Public downloads use the public bucket endpoint, not an anonymous metadata
-- SELECT policy. Only the owner can list metadata or remove objects. Replacements
-- INSERT a unique name: no UPDATE/upsert policy is needed or granted.
create policy "Owners upload avatars" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~ '^[0-9a-f-]{36}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$');
create policy "Owners view avatar objects" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Owners delete avatars" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- PostgreSQL requires drop/recreate when extending TABLE return types. No CASCADE:
-- unexpected dependencies abort this transaction rather than being removed.
-- Audience predicates, settings inputs and ranking rules are preserved verbatim.
drop function public.save_profile_settings(text,text,text,boolean,boolean);
drop function public.own_profile_settings();
drop function public.friend_social_profiles(uuid[]);
drop function public.social_leaderboard_week(date);

create or replace function public.own_profile_settings()
returns table(id uuid, handle text, display_name text, bio text, discoverable boolean, leaderboard_enabled boolean, avatar_path text)
language sql stable security definer set search_path = '' as $$
  select p.id,p.handle,p.display_name,p.bio,p.discoverable,p.leaderboard_enabled,p.avatar_path
  from public.profiles p where p.id = auth.uid();
$$;

create or replace function public.save_profile_settings(
  new_display_name text, new_handle text, new_bio text,
  new_discoverable boolean, new_leaderboard_enabled boolean)
returns table(id uuid, handle text, display_name text, bio text, discoverable boolean, leaderboard_enabled boolean, avatar_path text)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in to edit your profile' using errcode = '42501'; end if;
  update public.profiles p set display_name = btrim(new_display_name), handle = lower(btrim(new_handle)),
    bio = btrim(new_bio), discoverable = new_discoverable,
    leaderboard_enabled = new_leaderboard_enabled, updated_at = now()
  where p.id = auth.uid() and p.handle is not null;
  if not found then raise exception 'Choose your handle first' using errcode = '42501'; end if;
  return query select * from public.own_profile_settings();
end $$;

-- ProfileView promises bios to accepted friends, not directory strangers or
-- pending requesters. A supplied UUID is a filter, never an authorization grant.
create or replace function public.friend_social_profiles(profile_ids uuid[])
returns table(id uuid, handle text, display_name text, bio text, avatar_path text)
language sql stable security definer set search_path = '' as $$
  select p.id,p.handle,p.display_name,p.bio,p.avatar_path from public.profiles p
  where auth.uid() is not null and p.id = any(profile_ids)
    and (p.id = auth.uid() or exists (
      select 1 from public.friendships f where f.status = 'accepted'
        and auth.uid() in (f.requester_id,f.addressee_id)
        and p.id in (f.requester_id,f.addressee_id)));
$$;

-- Definer rights let us evaluate the private opt-in flag. Explicit viewer,
-- friendship and sharing predicates replace the invoker's RLS filtering.
create or replace function public.social_leaderboard_week(week_start date)
returns table(user_id uuid, display_name text, handle text, completion_count bigint, active_days bigint, rank bigint, avatar_path text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in to view the leaderboard' using errcode = '42501'; end if;
  if week_start is null or extract(isodow from week_start) <> 1 then
    raise exception 'Choose a Monday for the start of the week';
  end if;
  return query
  with circle as (
    select p.id,p.display_name,p.handle,p.avatar_path from public.profiles p
    where p.handle is not null and p.leaderboard_enabled and (p.id = auth.uid() or exists (
      select 1 from public.friendships f where f.status = 'accepted'
        and auth.uid() in (f.requester_id,f.addressee_id) and p.id in (f.requester_id,f.addressee_id)))
  ), scores as (
    select c.id,c.display_name,c.handle,c.avatar_path,count(a.id) as completions,count(distinct a.occurred_on) as days
    from circle c left join public.social_activities a on a.actor_id = c.id
      and a.occurred_on >= week_start and a.occurred_on < week_start + 7
      and a.occurred_on <= (now() at time zone 'Pacific/Kiritimati')::date
      -- Historical invalid activity is not deleted, but cannot inflate ranks.
      and exists (select 1 from public.habit_entries e join public.habits h on h.id = e.habit_id
        where e.habit_id = a.habit_id and h.user_id = a.actor_id and e.entry_date = a.occurred_on and e.done and not e.rest)
      and exists (select 1 from public.habit_shares hs join public.friendships f
        on f.status = 'accepted' and hs.owner_id in (f.requester_id,f.addressee_id)
          and hs.viewer_id in (f.requester_id,f.addressee_id)
        where hs.habit_id = a.habit_id and hs.owner_id = a.actor_id
          and (a.actor_id = auth.uid() or hs.viewer_id = auth.uid()))
    group by c.id,c.display_name,c.handle,c.avatar_path
  )
  select s.id,s.display_name,s.handle,s.completions,s.days,rank() over (order by s.completions desc,s.days desc),s.avatar_path
  from scores s order by s.completions desc,s.days desc,s.handle;
end $$;

revoke all on function public.own_profile_settings(), public.save_profile_settings(text,text,text,boolean,boolean),
  public.friend_social_profiles(uuid[]), public.social_leaderboard_week(date) from public, anon;
grant execute on function public.own_profile_settings(), public.save_profile_settings(text,text,text,boolean,boolean),
  public.friend_social_profiles(uuid[]), public.social_leaderboard_week(date) to authenticated;

-- Compare-and-set prevents a stale tab from replacing newer metadata. A caller
-- supplies paths, never a user UUID. The new object must already exist and belong
-- to this UUID. Clearing metadata also works when the previous object is missing.
create function public.set_profile_avatar(new_avatar_path text, expected_avatar_path text)
returns table(id uuid, handle text, display_name text, bio text, discoverable boolean, leaderboard_enabled boolean, avatar_path text)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in to change your photo' using errcode = '42501'; end if;
  if new_avatar_path is not null and (
    split_part(new_avatar_path,'/',1) <> auth.uid()::text
    or new_avatar_path !~ '^[0-9a-f-]{36}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
    or not exists (select 1 from storage.objects o where o.bucket_id = 'avatars' and o.name = new_avatar_path)
  ) then raise exception 'Avatar unavailable' using errcode = '42501'; end if;
  update public.profiles p set avatar_path = new_avatar_path, updated_at = now()
    where p.id = auth.uid() and p.handle is not null
      and p.avatar_path is not distinct from expected_avatar_path;
  if not found then raise exception 'Your photo changed. Reload your profile and try again.' using errcode = '40001'; end if;
  return query select * from public.own_profile_settings();
end $$;
revoke all on function public.set_profile_avatar(text,text) from public, anon;
grant execute on function public.set_profile_avatar(text,text) to authenticated;
-- claim_handle remains the unchanged invoker/onboarding API (three identity
-- fields). New accounts need no avatar; subsequent settings reads include NULL.
notify pgrst, 'reload schema';
commit;
