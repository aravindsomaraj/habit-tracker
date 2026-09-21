-- Private one-to-one chat. Apply after the social and friend-controls migrations.
create table public.direct_conversations (
  id uuid primary key default gen_random_uuid(),
  user_one uuid not null references auth.users(id) on delete cascade,
  user_two uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (user_one < user_two)
);
create unique index direct_conversations_pair_unique on public.direct_conversations(user_one, user_two);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.direct_conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index chat_messages_conversation_created_idx on public.chat_messages(conversation_id, created_at);

alter table public.direct_conversations enable row level security;
alter table public.chat_messages enable row level security;
revoke all on public.direct_conversations, public.chat_messages from anon, authenticated;
grant select on public.direct_conversations to authenticated;
grant select, insert on public.chat_messages to authenticated;

create policy "active friends read their conversation" on public.direct_conversations for select to authenticated using (
  (select auth.uid()) in (user_one, user_two) and exists (
    select 1 from public.friendships f where f.status = 'accepted'
      and ((f.requester_id = user_one and f.addressee_id = user_two) or (f.requester_id = user_two and f.addressee_id = user_one))
  )
);
create policy "active friends read chat messages" on public.chat_messages for select to authenticated using (
  exists (select 1 from public.direct_conversations c where c.id = chat_messages.conversation_id)
);
create policy "active friends send their own chat messages" on public.chat_messages for insert to authenticated with check (
  sender_id = (select auth.uid()) and exists (select 1 from public.direct_conversations c where c.id = chat_messages.conversation_id)
);

create or replace function public.start_direct_conversation(friend_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid()); conversation_id uuid;
begin
  if actor is null or actor = friend_id then raise exception 'A different signed-in friend is required'; end if;
  if not exists (
    select 1 from public.friendships f where f.status = 'accepted'
      and ((f.requester_id = actor and f.addressee_id = friend_id) or (f.addressee_id = actor and f.requester_id = friend_id))
  ) then raise exception 'Only accepted friends can chat'; end if;
  insert into public.direct_conversations(user_one, user_two)
  values (least(actor, friend_id), greatest(actor, friend_id))
  on conflict (user_one, user_two) do update set user_one = excluded.user_one
  returning id into conversation_id;
  return conversation_id;
end;
$$;

-- Removing or blocking a person also permanently removes the shared conversation.
create or replace function public.remove_friendship(friendship_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare requester uuid; addressee uuid;
begin
  select f.requester_id, f.addressee_id into requester, addressee from public.friendships f
  where f.id = friendship_id and (select auth.uid()) in (f.requester_id, f.addressee_id);
  if not found then raise exception 'Friendship is unavailable'; end if;
  delete from public.habit_shares hs where (hs.owner_id = requester and hs.viewer_id = addressee) or (hs.owner_id = addressee and hs.viewer_id = requester);
  delete from public.direct_conversations c where c.user_one = least(requester, addressee) and c.user_two = greatest(requester, addressee);
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
  delete from public.direct_conversations c where c.user_one = least(requester, addressee) and c.user_two = greatest(requester, addressee);
end;
$$;

revoke all on function public.start_direct_conversation(uuid) from public, anon;
grant execute on function public.start_direct_conversation(uuid), public.remove_friendship(uuid), public.block_friendship(uuid) to authenticated;
alter publication supabase_realtime add table public.chat_messages;
