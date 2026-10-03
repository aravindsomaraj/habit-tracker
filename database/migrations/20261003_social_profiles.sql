-- Apply after 20260922_add_direct_chat.sql, before deploying the Social/Profile UI.
begin;

alter table public.profiles
  add column bio text not null default '' check (char_length(bio) <= 160),
  add column leaderboard_enabled boolean not null default false;
create index social_activities_actor_day_idx on public.social_activities(actor_id, occurred_on);

-- Keep pending requests readable even when a participant turns off discovery.
drop policy "profiles are discoverable to friends" on public.profiles;
create policy "profiles visible to their circle" on public.profiles for select to authenticated using (
  id = (select auth.uid()) or (
    not exists (select 1 from public.friendships f where f.status = 'blocked'
      and (select auth.uid()) in (f.requester_id, f.addressee_id)
      and profiles.id in (f.requester_id, f.addressee_id))
    and (discoverable or exists (select 1 from public.friendships f where f.status in ('pending','accepted')
      and (select auth.uid()) in (f.requester_id, f.addressee_id)
      and profiles.id in (f.requester_id, f.addressee_id)))
  )
);
drop policy "users request friendships" on public.friendships;
create policy "request discoverable profiles" on public.friendships for insert to authenticated with check (
  requester_id = (select auth.uid()) and status = 'pending'
  and exists (select 1 from public.profiles p where p.id = addressee_id and p.discoverable)
);

-- Only the database publishes completion events. Numeric values and photos never
-- enter this table. Existing events are retained only if the entry is still done.
revoke insert, delete on public.social_activities from authenticated;
delete from public.social_activities a where not exists (
  select 1 from public.habit_entries e join public.habits h on h.id = e.habit_id
  where e.habit_id = a.habit_id and h.user_id = a.actor_id
    and e.entry_date = a.occurred_on and e.done and not e.rest
);
insert into public.social_activities(actor_id,habit_id,habit_label,kind,occurred_on)
select h.user_id,h.id,left(h.name,100),'completed',e.entry_date
from public.habit_entries e join public.habits h on h.id = e.habit_id
where e.done and not e.rest and exists (select 1 from public.habit_shares hs where hs.habit_id = h.id)
on conflict do nothing;
create function public.sync_social_completion() returns trigger
language plpgsql security definer set search_path = '' as $$
declare h public.habits;
begin
  if tg_op = 'DELETE' then
    delete from public.social_activities where habit_id = old.habit_id and occurred_on = old.entry_date;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if old.habit_id <> new.habit_id or old.entry_date <> new.entry_date then
      delete from public.social_activities where habit_id = old.habit_id and occurred_on = old.entry_date;
    end if;
  end if;
  select * into h from public.habits where id = new.habit_id;
  if new.done and not new.rest and exists (select 1 from public.habit_shares where habit_id = h.id) then
    insert into public.social_activities(actor_id, habit_id, habit_label, kind, occurred_on)
      values(h.user_id, h.id, left(h.name,100), 'completed', new.entry_date) on conflict do nothing;
  else
    delete from public.social_activities where habit_id = new.habit_id and occurred_on = new.entry_date;
  end if;
  return new;
end $$;
revoke all on function public.sync_social_completion() from public, anon, authenticated;
create trigger sync_social_completion after insert or update or delete on public.habit_entries
  for each row execute function public.sync_social_completion();

-- Invoker rights preserve activity RLS, so each viewer gets only their own circle
-- and activities shared with them. The caller cannot provide another viewer ID.
create function public.social_leaderboard_week(week_start date)
returns table(user_id uuid, display_name text, handle text, completion_count bigint, active_days bigint, rank bigint)
language plpgsql stable security invoker set search_path = '' as $$
begin
  if week_start is null or extract(isodow from week_start) <> 1 then
    raise exception 'Choose a Monday for the start of the week';
  end if;
  return query
  with circle as (
    select p.id, p.display_name, p.handle from public.profiles p
    where p.leaderboard_enabled and (p.id = auth.uid() or exists (
      select 1 from public.friendships f where f.status = 'accepted'
        and auth.uid() in (f.requester_id,f.addressee_id) and p.id in (f.requester_id,f.addressee_id)
    ))
  ), scores as (
    select c.id, c.display_name, c.handle, count(a.id) as completions, count(distinct a.occurred_on) as days
    from circle c left join public.social_activities a on a.actor_id = c.id
      and a.occurred_on >= week_start and a.occurred_on < week_start + 7
      -- Ignore future entries, allowing the most advanced device timezone.
      and a.occurred_on <= (now() at time zone 'Pacific/Kiritimati')::date
      and exists (select 1 from public.habit_shares hs join public.friendships f
        on f.status = 'accepted' and hs.owner_id in (f.requester_id,f.addressee_id)
          and hs.viewer_id in (f.requester_id,f.addressee_id)
        where hs.habit_id = a.habit_id and hs.owner_id = a.actor_id
          and (a.actor_id = auth.uid() or hs.viewer_id = auth.uid()))
    group by c.id,c.display_name,c.handle
  )
  select s.id,s.display_name,s.handle,s.completions,s.days,
    rank() over (order by s.completions desc,s.days desc)
  from scores s order by s.completions desc,s.days desc,s.handle;
end $$;
revoke all on function public.social_leaderboard_week(date) from public, anon;
grant execute on function public.social_leaderboard_week(date) to authenticated;

-- Do not let either participant erase a block and request again. Cleanup also
-- applies to direct REST deletions, not just the friend-control RPCs.
drop policy "users remove their friendships" on public.friendships;
create policy "remove nonblocked friendships" on public.friendships for delete to authenticated
  using (auth.uid() in (requester_id,addressee_id) and status <> 'blocked');
create function public.cleanup_social_relationship() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' or (old.status = 'accepted' and new.status <> 'accepted') then
    delete from public.habit_shares where (owner_id = old.requester_id and viewer_id = old.addressee_id)
      or (owner_id = old.addressee_id and viewer_id = old.requester_id);
    delete from public.direct_conversations where user_one = least(old.requester_id,old.addressee_id)
      and user_two = greatest(old.requester_id,old.addressee_id);
  end if;
  return old;
end $$;
revoke all on function public.cleanup_social_relationship() from public, anon, authenticated;
create trigger cleanup_social_relationship after delete or update of status on public.friendships
  for each row execute function public.cleanup_social_relationship();
create or replace function public.remove_friendship(friendship_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.friendships f where f.id = friendship_id
    and auth.uid() in (f.requester_id,f.addressee_id) and f.status <> 'blocked';
  if not found then raise exception 'Friendship unavailable'; end if;
end $$;
create or replace function public.block_friendship(friendship_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.friendships f set status = 'blocked', blocked_by = auth.uid(), accepted_at = null
    where f.id = friendship_id and auth.uid() in (f.requester_id,f.addressee_id) and f.status <> 'blocked';
  if not found then raise exception 'Friendship unavailable'; end if;
end $$;

-- Read positions persist across refreshes and devices.
create table public.chat_reads (
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.direct_conversations(id) on delete cascade,
  last_read_at timestamptz not null,
  primary key(user_id,conversation_id)
);
alter table public.chat_reads enable row level security;
revoke all on public.chat_reads from anon, authenticated;
grant select on public.chat_reads to authenticated;
create policy "read own chat positions" on public.chat_reads for select to authenticated using (user_id = auth.uid());
create function public.mark_social_chat_read(conversation uuid, through_time timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.direct_conversations c join public.friendships f on f.status = 'accepted'
    and least(f.requester_id,f.addressee_id) = c.user_one and greatest(f.requester_id,f.addressee_id) = c.user_two
    where c.id = conversation and auth.uid() in (c.user_one,c.user_two)) then raise exception 'Conversation unavailable'; end if;
  if through_time is null then return; end if;
  insert into public.chat_reads values(auth.uid(),conversation,least(through_time,now()))
    on conflict(user_id,conversation_id) do update set last_read_at = greatest(chat_reads.last_read_at,excluded.last_read_at);
end $$;
create function public.social_unread_chats() returns table(conversation_id uuid, sender_id uuid)
language sql stable security invoker set search_path = '' as $$
  select distinct m.conversation_id,m.sender_id from public.chat_messages m
  left join public.chat_reads r on r.conversation_id = m.conversation_id and r.user_id = auth.uid()
  where m.sender_id <> auth.uid() and m.created_at > coalesce(r.last_read_at,'-infinity'::timestamptz);
$$;
revoke all on function public.mark_social_chat_read(uuid,timestamptz), public.social_unread_chats() from public, anon;
grant execute on function public.mark_social_chat_read(uuid,timestamptz), public.social_unread_chats() to authenticated;

do $$ declare t text; begin
  foreach t in array array['profiles','friendships','habit_shares','social_activities','chat_reads'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
commit;
