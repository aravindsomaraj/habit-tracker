-- Apply after 20261003_handle_social_compatibility.sql.
-- Pending requests and accepted friends need directory identity without widening
-- direct SELECT access to private profile settings.
begin;

create or replace function public.social_relationship_profiles(profile_ids uuid[])
returns table(id uuid, handle text, display_name text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.handle, p.display_name
  from public.profiles p
  where auth.uid() is not null
    and p.handle is not null
    and p.id = any(coalesce(profile_ids, '{}'::uuid[]))
    and exists (
      select 1 from public.friendships f
      where f.status in ('pending', 'accepted')
        and ((f.requester_id = auth.uid() and f.addressee_id = p.id)
          or (f.addressee_id = auth.uid() and f.requester_id = p.id))
    );
$$;

revoke all on function public.social_relationship_profiles(uuid[]) from public, anon;
grant execute on function public.social_relationship_profiles(uuid[]) to authenticated;

commit;
