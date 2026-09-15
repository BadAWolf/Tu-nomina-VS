create table public.legal_acceptances (
  user_id uuid not null references auth.users(id) on delete cascade,
  version text not null check (version in ('2026-09-14-preview','2026-09-15')),
  accepted_at timestamptz not null default now(),
  primary key (user_id, version)
);
alter table public.legal_acceptances enable row level security;
revoke all on public.legal_acceptances from anon, authenticated;
grant select on public.legal_acceptances to authenticated;
grant insert (user_id, version) on public.legal_acceptances to authenticated;
create policy "Read own acceptance" on public.legal_acceptances
for select to authenticated using ((select auth.uid()) = user_id);
create policy "Record own acceptance" on public.legal_acceptances
for insert to authenticated with check ((select auth.uid()) = user_id and (select (auth.jwt()->>'is_anonymous')::boolean) is false);
