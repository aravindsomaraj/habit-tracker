-- Apply after the social, friend-controls, and direct-chat migrations.
-- Existing UUIDs, handles, display names, and social/private data are preserved.
begin;

-- Missing profiles and NULL handles both mean "not yet chosen". No email backfill.
alter table public.profiles alter column handle drop not null;

-- The existing profiles_handle_check requires lowercase ASCII and 3–24 chars.
-- Combined with profiles_handle_key UNIQUE(handle), this enforces case-insensitive
-- uniqueness. Normalize future writes before those constraints are evaluated.
create or replace function public.validate_profile_handle()
returns trigger language plpgsql set search_path = '' as $$
begin
  if TG_OP = 'UPDATE' and new.handle is not distinct from old.handle then
    return new; -- Preserve existing identities, including previously reserved names.
  end if;
  if new.handle is null then
    if TG_OP = 'UPDATE' and old.handle is not null then
      raise exception 'A chosen handle cannot be cleared' using errcode = '23514';
    end if;
    return new;
  end if;
  new.handle := lower(btrim(new.handle));
  if new.handle !~ '^[a-z0-9_]{3,24}$' or new.handle = any(array[
    'admin', 'administrator', 'support', 'system', 'root', 'moderator', 'habittracker', 'habit_tracker'
  ]) then
    raise exception 'Handle is invalid or reserved' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists profiles_validate_handle on public.profiles;
create trigger profiles_validate_handle before insert or update of handle on public.profiles
for each row execute function public.validate_profile_handle();
revoke all on function public.validate_profile_handle() from public, anon, authenticated;

-- Expose only the Friends directory fields, even if private columns are added later.
revoke select on public.profiles from public, anon, authenticated;
grant select (id, handle, display_name) on public.profiles to authenticated;

-- Both policy names exist in deployed versions. Keep the newer block exclusion:
-- a blocked user is never discoverable to the other participant. Pending requests
-- remain identifiable even if the sender later disables discoverability.
drop policy if exists "profiles are discoverable to friends" on public.profiles;
drop policy if exists "profiles visible to their circle" on public.profiles;
create policy "profiles visible to their circle" on public.profiles for select to authenticated using (
  id = (select auth.uid()) or (
    handle is not null
    and not exists (
      select 1 from public.friendships f where f.status = 'blocked'
        and ((f.requester_id = (select auth.uid()) and f.addressee_id = profiles.id)
          or (f.addressee_id = (select auth.uid()) and f.requester_id = profiles.id))
    )
    and (discoverable or exists (
      select 1 from public.friendships f where f.status in ('pending', 'accepted')
        and ((f.requester_id = (select auth.uid()) and f.addressee_id = profiles.id)
          or (f.addressee_id = (select auth.uid()) and f.requester_id = profiles.id))
    ))
  )
);

-- A boolean is necessary here: hidden handles still occupy the unique namespace.
-- No rows, emails, auth/provider metadata, or other profile fields are returned.
create or replace function public.handle_available(candidate text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and coalesce(lower(btrim(candidate)) ~ '^[a-z0-9_]{3,24}$', false)
    and lower(btrim(candidate)) <> all(array[
      'admin', 'administrator', 'support', 'system', 'root', 'moderator', 'habittracker', 'habit_tracker'
    ])
    and not exists (select 1 from public.profiles p where p.handle = lower(btrim(candidate)));
$$;

-- SECURITY INVOKER retains the existing self-only INSERT/UPDATE RLS policies.
-- There is no client-supplied UUID. A stale tab cannot overwrite a chosen handle.
create or replace function public.claim_handle(candidate text)
returns table (id uuid, handle text, display_name text)
language plpgsql security invoker set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if actor is null then raise exception 'Sign in to choose a handle' using errcode = '42501'; end if;
  if candidate is null or btrim(candidate) = '' then
    raise exception 'Handle is required' using errcode = '23514';
  end if;
  insert into public.profiles as p (id, handle, display_name)
  values (actor, lower(btrim(candidate)), lower(btrim(candidate)))
  on conflict on constraint profiles_pkey do update set handle = excluded.handle
  where p.handle is null;
  return query select p.id, p.handle, p.display_name from public.profiles p where p.id = actor;
end;
$$;

revoke all on function public.handle_available(text), public.claim_handle(text) from public, anon;
grant execute on function public.handle_available(text), public.claim_handle(text) to authenticated;

-- Keep the existing UUID pair/self checks. Require identity even for direct API calls.
-- A narrow definer avoids a profiles -> friendships -> profiles RLS cycle.
create or replace function public.can_request_friend(target_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.handle is not null)
    and exists (select 1 from public.profiles p where p.id = target_id and p.handle is not null and p.discoverable);
$$;
revoke all on function public.can_request_friend(uuid) from public, anon;
grant execute on function public.can_request_friend(uuid) to authenticated;

drop policy if exists "users request friendships" on public.friendships;
drop policy if exists "request discoverable profiles" on public.friendships;
create policy "users request friendships" on public.friendships for insert to authenticated with check (
  requester_id = (select auth.uid()) and status = 'pending'
  and public.can_request_friend(addressee_id)
);

commit;
