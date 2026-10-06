-- Run as database owner. Invitations are configured privately, never in Git.
-- La comunidad es abierta: cualquiera puede leer la invitación activa, sin cuenta.
-- Solo el propietario de la base de datos crea, cambia o desactiva la invitación.
begin;
create table public.community_links (
  slug text primary key check (slug = 'whatsapp'),
  invite_url text not null check (invite_url ~ '^https://chat[.]whatsapp[.]com/[A-Za-z0-9]{10,64}$'),
  active boolean not null default true
);
alter table public.community_links enable row level security;
revoke all on public.community_links from public, anon, authenticated;
grant select (slug, invite_url) on public.community_links to anon, authenticated;
create policy "Anyone reads active invitation" on public.community_links
for select to anon, authenticated using (active);
commit;
