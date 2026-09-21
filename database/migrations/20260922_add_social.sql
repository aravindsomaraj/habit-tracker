-- Private accountability features. Apply with the Supabase SQL editor or CLI before deploying the UI.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  handle text not null unique check (handle ~ '^[a-z0-9_]{3,24}$'),
  display_name text not null check (char_length(display_name) between 1 and 40),
  discoverable boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  addressee_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  check (requester_id <> addressee_id)
);
create unique index friendships_unique_pair on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index friendships_requester_idx on public.friendships(requester_id);
create index friendships_addressee_idx on public.friendships(addressee_id);

create table public.habit_shares (
  habit_id uuid not null references public.habits(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  viewer_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (habit_id, viewer_id),
  check (owner_id <> viewer_id)
);
create index habit_shares_viewer_idx on public.habit_shares(viewer_id);

create table public.social_activities (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id) on delete cascade,
  habit_id uuid not null references public.habits(id) on delete cascade,
  habit_label text not null check (char_length(habit_label) between 1 and 100),
  kind text not null check (kind = 'completed'),
  occurred_on date not null,
  created_at timestamptz not null default now(),
  unique (actor_id, habit_id, kind, occurred_on)
);
create index social_activities_created_idx on public.social_activities(created_at desc);

alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
alter table public.habit_shares enable row level security;
alter table public.social_activities enable row level security;

revoke all on public.profiles, public.friendships, public.habit_shares, public.social_activities from anon, authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, delete on public.friendships to authenticated;
grant select, insert, delete on public.habit_shares to authenticated;
grant select, insert, delete on public.social_activities to authenticated;

create policy "profiles are discoverable to friends" on public.profiles for select to authenticated using (
  id = (select auth.uid()) or discoverable or exists (
    select 1 from public.friendships f where f.status = 'accepted'
      and ((f.requester_id = (select auth.uid()) and f.addressee_id = profiles.id)
        or (f.addressee_id = (select auth.uid()) and f.requester_id = profiles.id))
  )
);
create policy "users create their profile" on public.profiles for insert to authenticated with check (id = (select auth.uid()));
create policy "users update their profile" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "users read their friendships" on public.friendships for select to authenticated using ((select auth.uid()) in (requester_id, addressee_id));
create policy "users request friendships" on public.friendships for insert to authenticated with check (requester_id = (select auth.uid()) and status = 'pending');
create policy "users remove their friendships" on public.friendships for delete to authenticated using ((select auth.uid()) in (requester_id, addressee_id));

create policy "owners and viewers read habit shares" on public.habit_shares for select to authenticated using (owner_id = (select auth.uid()) or viewer_id = (select auth.uid()));
create policy "owners create habit shares" on public.habit_shares for insert to authenticated with check (
  owner_id = (select auth.uid()) and exists (select 1 from public.habits h where h.id = habit_id and h.user_id = (select auth.uid())) and exists (
    select 1 from public.friendships f where f.status = 'accepted' and ((f.requester_id = owner_id and f.addressee_id = viewer_id) or (f.addressee_id = owner_id and f.requester_id = viewer_id))
  )
);
create policy "owners remove habit shares" on public.habit_shares for delete to authenticated using (owner_id = (select auth.uid()));

create policy "users read eligible activity" on public.social_activities for select to authenticated using (
  actor_id = (select auth.uid()) or exists (
    select 1 from public.habit_shares hs join public.friendships f on f.status = 'accepted'
    where hs.habit_id = social_activities.habit_id and hs.owner_id = social_activities.actor_id and hs.viewer_id = (select auth.uid())
      and ((f.requester_id = social_activities.actor_id and f.addressee_id = (select auth.uid())) or (f.addressee_id = social_activities.actor_id and f.requester_id = (select auth.uid())))
  )
);
create policy "users publish their own shared completion" on public.social_activities for insert to authenticated with check (
  actor_id = (select auth.uid()) and exists (select 1 from public.habit_shares hs where hs.habit_id = social_activities.habit_id and hs.owner_id = (select auth.uid()))
);
create policy "users remove their activity" on public.social_activities for delete to authenticated using (actor_id = (select auth.uid()));

create or replace function public.accept_friendship(request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.friendships set status = 'accepted', accepted_at = now()
  where id = request_id and addressee_id = (select auth.uid()) and status = 'pending';
  if not found then raise exception 'Friend request is unavailable'; end if;
end;
$$;
revoke all on function public.accept_friendship(uuid) from public, anon;
grant execute on function public.accept_friendship(uuid) to authenticated;
