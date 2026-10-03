-- Apply after 20261004_fix_social_relationship_profiles.sql. No historical
-- completions are published. All community publishing starts explicitly disabled.
begin;
alter table public.profiles
  add column community_enabled boolean not null default false,
  add column community_suspended boolean not null default false;
create table public.community_habits (
  habit_id uuid primary key references public.habits(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  enabled_at timestamptz not null default now()
);
create table public.community_activities (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id) on delete cascade,
  habit_id uuid not null references public.habits(id) on delete cascade,
  habit_label text not null check (char_length(habit_label) between 1 and 100),
  occurred_on date not null,
  created_at timestamptz not null default now(),
  unique(habit_id,occurred_on)
);
create index community_feed_cursor_idx on public.community_activities(created_at desc,id desc);
create table public.community_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  activity_id uuid references public.community_activities(id) on delete set null,
  reason text not null check (reason in ('spam','harassment','inappropriate')),
  created_at timestamptz not null default now()
);
create index community_reports_actor_idx on public.community_reports(reporter_id,actor_id);
alter table public.community_habits enable row level security;
alter table public.community_activities enable row level security;
alter table public.community_reports enable row level security;
revoke all on public.community_habits,public.community_activities,public.community_reports from public,anon,authenticated;
grant select on public.community_habits to authenticated;
create policy "owners read community habit choices" on public.community_habits for select to authenticated using (owner_id=auth.uid());

create function public.community_actor_visible(target uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists (select 1 from public.profiles p
    where p.id=target and p.handle is not null and p.community_enabled and not p.community_suspended)
    and not exists (select 1 from public.friendships f where f.status='blocked'
      and ((f.requester_id=auth.uid() and f.addressee_id=target)
        or (f.addressee_id=auth.uid() and f.requester_id=target)))
    and not exists (select 1 from public.community_reports r where r.reporter_id=auth.uid() and r.actor_id=target);
$$;
revoke all on function public.community_actor_visible(uuid) from public,anon,authenticated;

create function public.community_preferences() returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce((select p.community_enabled and not p.community_suspended from public.profiles p where p.id=auth.uid()),false);
$$;
create function public.set_community_enabled(enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
  if enabled and exists (select 1 from public.profiles where id=auth.uid() and community_suspended) then
    raise exception 'Community publishing is suspended for this account';
  end if;
  update public.profiles set community_enabled=enabled where id=auth.uid() and handle is not null;
  if not found then raise exception 'Choose your handle first'; end if;
  if not enabled then delete from public.community_activities where actor_id=auth.uid(); end if;
end $$;
create function public.set_community_habit(habit uuid,enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not exists (select 1 from public.habits h where h.id=habit and h.user_id=auth.uid()) then raise exception 'Habit unavailable'; end if;
  if enabled then
    if not public.community_preferences() then raise exception 'Enable community participation first'; end if;
    insert into public.community_habits(habit_id,owner_id) values(habit,auth.uid()) on conflict do nothing;
  else
    delete from public.community_habits where habit_id=habit;
    delete from public.community_activities where habit_id=habit;
  end if;
end $$;

create function public.sync_community_completion() returns trigger
language plpgsql security definer set search_path='' as $$
declare h public.habits;
begin
  if tg_op='DELETE' then
    delete from public.community_activities where habit_id=old.habit_id and occurred_on=old.entry_date;
    return old;
  end if;
  if tg_op='UPDATE' then
    if old.habit_id<>new.habit_id or old.entry_date<>new.entry_date then
      delete from public.community_activities where habit_id=old.habit_id and occurred_on=old.entry_date;
    end if;
  end if;
  if not new.done or new.rest then
    delete from public.community_activities where habit_id=new.habit_id and occurred_on=new.entry_date;
    return new;
  end if;
  -- Editing a previously completed entry never republishes historical data.
  if tg_op='UPDATE' then
    if old.done and not old.rest then return new; end if;
  end if;
  select * into h from public.habits where id=new.habit_id;
  if exists (select 1 from public.community_habits ch join public.profiles p on p.id=ch.owner_id
    where ch.habit_id=h.id and ch.owner_id=h.user_id and p.community_enabled and not p.community_suspended
      and new.entry_date >= (ch.enabled_at at time zone 'Etc/GMT+12')::date
      and new.entry_date <= (now() at time zone 'Pacific/Kiritimati')::date) then
    insert into public.community_activities(actor_id,habit_id,habit_label,occurred_on)
    values(h.user_id,h.id,left(h.name,100),new.entry_date) on conflict do nothing;
  end if;
  return new;
end $$;
revoke all on function public.sync_community_completion() from public,anon,authenticated;
create trigger sync_community_completion after insert or update or delete on public.habit_entries
for each row execute function public.sync_community_completion();

create function public.community_feed(before_time timestamptz default null,before_id uuid default null,page_size integer default 20,actor uuid default null)
returns table(id uuid,actor_id uuid,habit_label text,occurred_on date,created_at timestamptz,display_name text,handle text)
language sql stable security definer set search_path='' as $$
  select a.id,a.actor_id,a.habit_label,a.occurred_on,a.created_at,p.display_name,p.handle
  from public.community_activities a join public.profiles p on p.id=a.actor_id
  join public.community_habits ch on ch.habit_id=a.habit_id and ch.owner_id=a.actor_id
  where public.community_actor_visible(a.actor_id)
    and (actor is null or a.actor_id=actor)
    and (before_time is null or (a.created_at,a.id)<(before_time,before_id))
    and a.occurred_on <= (now() at time zone 'Pacific/Kiritimati')::date
  order by a.created_at desc,a.id desc limit greatest(1,least(coalesce(page_size,20),50));
$$;
create function public.community_profile(target uuid)
returns table(id uuid,handle text,display_name text,bio text)
language sql stable security definer set search_path='' as $$
  select p.id,p.handle,p.display_name,p.bio from public.profiles p
  where p.id=target and public.community_actor_visible(p.id);
$$;
create function public.block_community_user(target uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or target=auth.uid() or not public.community_actor_visible(target) then raise exception 'Profile unavailable'; end if;
  insert into public.friendships(requester_id,addressee_id,status,blocked_by)
  values(auth.uid(),target,'blocked',auth.uid()) on conflict do nothing;
  update public.friendships set status='blocked',blocked_by=auth.uid(),accepted_at=null
  where status<>'blocked' and ((requester_id=auth.uid() and addressee_id=target) or (addressee_id=auth.uid() and requester_id=target));
end $$;
create function public.report_community_activity(activity uuid,report_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
  select a.actor_id into target from public.community_activities a join public.community_habits ch on ch.habit_id=a.habit_id
  where a.id=activity and public.community_actor_visible(a.actor_id);
  if target is null or target=auth.uid() then raise exception 'Activity unavailable'; end if;
  -- Serialize submissions per user to enforce the limit even across tabs.
  perform 1 from public.profiles where id=auth.uid() for update;
  if (select count(*) from public.community_reports where reporter_id=auth.uid() and created_at>now()-interval '1 hour')>=10 then raise exception 'Report limit reached. Try again later.'; end if;
  insert into public.community_reports(reporter_id,actor_id,activity_id,reason) values(auth.uid(),target,activity,report_reason);
end $$;
revoke all on function public.community_preferences(),public.set_community_enabled(boolean),public.set_community_habit(uuid,boolean),
public.community_feed(timestamptz,uuid,integer,uuid),public.community_profile(uuid),public.block_community_user(uuid),public.report_community_activity(uuid,text) from public,anon;
grant execute on function public.community_preferences(),public.set_community_enabled(boolean),public.set_community_habit(uuid,boolean),
public.community_feed(timestamptz,uuid,integer,uuid),public.community_profile(uuid),public.block_community_user(uuid),public.report_community_activity(uuid,text) to authenticated;
commit;
