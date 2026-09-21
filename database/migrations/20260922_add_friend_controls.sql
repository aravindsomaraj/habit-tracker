-- Friend lifecycle controls. Apply after 20260922_add_social.sql.
alter table public.friendships
  add column blocked_by uuid references auth.users(id) on delete set null,
  drop constraint friendships_status_check,
  add constraint friendships_status_check check (status in ('pending', 'accepted', 'blocked')),
  add constraint friendships_blocked_by_check check ((status = 'blocked') = (blocked_by is not null));

create or replace function public.remove_friendship(friendship_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare requester uuid; addressee uuid;
begin
  select f.requester_id, f.addressee_id into requester, addressee
  from public.friendships f
  where f.id = friendship_id and (select auth.uid()) in (f.requester_id, f.addressee_id);
  if not found then raise exception 'Friendship is unavailable'; end if;
  delete from public.habit_shares hs where (hs.owner_id = requester and hs.viewer_id = addressee) or (hs.owner_id = addressee and hs.viewer_id = requester);
  delete from public.friendships f where f.id = friendship_id;
end;
$$;

create or replace function public.block_friendship(friendship_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare requester uuid; addressee uuid;
begin
  update public.friendships f set status = 'blocked', blocked_by = (select auth.uid()), accepted_at = null
  where f.id = friendship_id and (select auth.uid()) in (f.requester_id, f.addressee_id)
  returning f.requester_id, f.addressee_id into requester, addressee;
  if not found then raise exception 'Friendship is unavailable'; end if;
  delete from public.habit_shares hs where (hs.owner_id = requester and hs.viewer_id = addressee) or (hs.owner_id = addressee and hs.viewer_id = requester);
end;
$$;

revoke all on function public.remove_friendship(uuid), public.block_friendship(uuid) from public, anon;
grant execute on function public.remove_friendship(uuid), public.block_friendship(uuid) to authenticated;
