-- Preview schema. Permissions are separate from acceptance of service terms.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.marketing_consent_events (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  email_at_consent text not null,
  own_news boolean not null,
  partner_offers boolean not null,
  version text not null check (version = '2026-09-15-marketing-v1'),
  source text not null check (source in ('account_activation','account_preferences','admin_request')),
  recorded_at timestamptz not null default clock_timestamp(),
  own_text text not null,
  partner_text text not null
);
create index marketing_consent_user_latest on public.marketing_consent_events(user_id, id desc);
alter table public.marketing_consent_events enable row level security;
revoke all on public.marketing_consent_events from public, anon, authenticated;
grant select on public.marketing_consent_events to authenticated;
grant insert (own_news, partner_offers, version, source) on public.marketing_consent_events to authenticated;
grant usage on sequence public.marketing_consent_events_id_seq to authenticated;
create policy "Read own marketing choices" on public.marketing_consent_events
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Record own marketing choice" on public.marketing_consent_events
  for insert to authenticated with check ((select auth.uid()) = user_id and (select (auth.jwt()->>'is_anonymous')::boolean) is false);

-- A private trigger needs elevated access ONLY to verify the canonical Auth
-- account/email and stamp immutable evidence. It is not a public RPC.
create function private.stamp_marketing_consent() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  account_email text;
  previous public.marketing_consent_events%rowtype;
begin
  if auth.uid() is not null then
    if new.user_id is distinct from auth.uid() or new.source = 'admin_request' then
      raise exception 'Only your own preferences may be recorded' using errcode='42501';
    end if;
  elsif session_user in ('postgres','supabase_admin') and current_setting('role',true) in ('none','postgres') then
    -- An administrator can honour an emailed opt-out; never manufacture opt-in.
    if new.source <> 'admin_request' or new.own_news or new.partner_offers then
      raise exception 'Administrative requests may only withdraw consent' using errcode='42501';
    end if;
  else
    raise exception 'A verified account is required' using errcode='42501';
  end if;
  select lower(u.email) into account_email from auth.users u
  where u.id = new.user_id and u.email_confirmed_at is not null
    and not coalesce(u.is_anonymous,false) and u.deleted_at is null
    and (u.banned_until is null or u.banned_until < now());
  if account_email is null then
    raise exception 'A verified account is required' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text,0));
  select * into previous from public.marketing_consent_events
    where user_id = new.user_id order by id desc limit 1;
  if previous.id is not null and previous.email_at_consent = account_email
     and previous.own_news = new.own_news and previous.partner_offers = new.partner_offers
     and previous.version = new.version then return null; end if;
  new.email_at_consent := account_email;
  new.recorded_at := clock_timestamp();
  new.own_text := 'Quiero recibir por correo novedades de la calculadora, consejos y ofertas propias de Nómina Vigilante relacionadas con la seguridad privada.';
  new.partner_text := 'Quiero recibir por correo promociones de formación, productos y servicios de colaboradores del sector de la seguridad privada, enviadas por Nómina Vigilante, sin ceder mi correo a esos colaboradores.';
  return new;
end;
$$;
revoke all on function private.stamp_marketing_consent() from public, anon, authenticated;
create trigger stamp_marketing_consent before insert on public.marketing_consent_events
  for each row execute function private.stamp_marketing_consent();

create view public.marketing_preferences with (security_invoker = true) as
select distinct on (user_id) user_id, email_at_consent, own_news, partner_offers, version, recorded_at
from public.marketing_consent_events order by user_id, id desc;
revoke all on public.marketing_preferences from public, anon, authenticated;
grant select on public.marketing_preferences to authenticated;

-- Owner-only export. The public API cannot access this schema or auth.users.
create view private.marketing_audience with (security_invoker = true) as
select u.id as user_id, u.email, m.own_news, m.partner_offers,
       m.version, m.recorded_at as consent_at
from public.marketing_preferences m join auth.users u on u.id=m.user_id
where (m.own_news or m.partner_offers) and lower(u.email)=m.email_at_consent
  and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false)
  and u.deleted_at is null and (u.banned_until is null or u.banned_until < now());
revoke all on private.marketing_audience from public, anon, authenticated;
comment on view private.marketing_audience is 'Export fresh before each campaign. Filter own_news or partner_offers; never use the entire Auth users list for advertising.';
