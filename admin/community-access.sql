-- Run as database owner. Invitations are configured privately, never in Git.
begin;
create table public.community_links (
  slug text primary key check (slug = 'whatsapp'),
  invite_url text not null check (invite_url ~ '^https://chat[.]whatsapp[.]com/[A-Za-z0-9]{10,64}$'),
  active boolean not null default true
);
alter table public.community_links enable row level security;
revoke all on public.community_links from public, anon, authenticated;
grant select (slug, invite_url) on public.community_links to authenticated;

-- Privileged read is needed only for canonical Auth status. This private helper
-- accepts no user-supplied identity and returns no account data or invitation.
create function private.can_access_community() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users u join public.legal_acceptances a on a.user_id=u.id
    where u.id=(select auth.uid()) and u.email_confirmed_at is not null
      and not coalesce(u.is_anonymous,false) and u.deleted_at is null
      and (u.banned_until is null or u.banned_until<now())
      and a.version='2026-09-15'
  );
$$;
revoke all on function private.can_access_community() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.can_access_community() to authenticated;
create policy "Confirmed members read active invitation" on public.community_links
for select to authenticated using (active and (select private.can_access_community()));
commit;
