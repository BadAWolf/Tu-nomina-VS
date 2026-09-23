-- Applied to Calculadora Vigilante on 2026-09-23. Do not re-run on that project.
-- Apply once, as the database owner, after marketing-profile-schema.sql.
-- Dedicated Brevo account required before enabling a worker. No network calls.
begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Deliberately no FK to auth.users: revisions, mappings and tombstones survive
-- account deletion. No age, location, payroll, JWT or provider secrets here.
create table private.brevo_user_revisions (
  user_id uuid primary key,
  consent_revision bigint not null check (consent_revision >= 0)
);
create table private.brevo_contacts (
  email text primary key check (email = lower(btrim(email)) and length(email) between 3 and 320),
  user_id uuid not null,
  provider_contact_id bigint unique check (provider_contact_id > 0),
  suppressed boolean not null default false,
  suppression_reason text check (suppression_reason in ('unsubscribe','complaint','hard_bounce','blocked','deleted')),
  suppressed_at timestamptz,
  deleted_at timestamptz,
  updated_at timestamptz not null default clock_timestamp()
);
create index brevo_contacts_user on private.brevo_contacts(user_id);
create table private.brevo_outbox (
  email text primary key references private.brevo_contacts(email),
  generation bigint not null default 1 check (generation > 0),
  applied_generation bigint not null default 0 check (applied_generation >= 0 and applied_generation <= generation),
  desired jsonb not null check (jsonb_typeof(desired) = 'object'),
  available_at timestamptz not null default clock_timestamp(),
  lease_token uuid,
  lease_generation bigint,
  lease_until timestamptz,
  attempts integer not null default 0,
  last_error_code text,
  updated_at timestamptz not null default clock_timestamp(),
  check ((lease_token is null and lease_generation is null and lease_until is null)
    or (lease_token is not null and lease_generation is not null and lease_until is not null)),
  check (lease_generation is null or lease_generation <= generation)
);
create index brevo_outbox_ready on private.brevo_outbox(available_at, email)
  where generation > applied_generation and lease_token is null;
create table private.brevo_provider_events (
  event_key text primary key check (length(event_key) between 1 and 200),
  email text not null references private.brevo_contacts(email),
  reason text not null check (reason in ('unsubscribe','complaint','hard_bounce','blocked','deleted')),
  received_at timestamptz not null default clock_timestamp()
);

alter table private.brevo_user_revisions enable row level security;
alter table private.brevo_contacts enable row level security;
alter table private.brevo_outbox enable row level security;
alter table private.brevo_provider_events enable row level security;
revoke all on private.brevo_user_revisions, private.brevo_contacts,
  private.brevo_outbox, private.brevo_provider_events from public, anon, authenticated, service_role;
-- No policies: client roles cannot access rows. Only owner-run private code does.

-- The old identity is allocated BEFORE a BEFORE INSERT trigger waits for its
-- advisory lock. It therefore cannot reliably order concurrent choices.
lock table public.marketing_consent_events in share row exclusive mode;
alter table public.marketing_consent_events add column consent_revision bigint;
with historical as (
  select id, row_number() over (partition by user_id order by id) as revision
  from public.marketing_consent_events
)
update public.marketing_consent_events e set consent_revision = h.revision
from historical h where h.id = e.id;
alter table public.marketing_consent_events alter column consent_revision set not null;
create unique index marketing_consent_serial_revision
  on public.marketing_consent_events(user_id, consent_revision desc);
insert into private.brevo_user_revisions(user_id, consent_revision)
select user_id, max(consent_revision) from public.marketing_consent_events group by user_id;
alter table public.marketing_consent_events drop constraint marketing_consent_events_source_check;
alter table public.marketing_consent_events add constraint marketing_consent_events_source_check
  check (source in ('account_activation','account_preferences','admin_request','brevo_opt_out'));

create or replace function private.stamp_marketing_consent() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  account_row auth.users%rowtype;
  previous public.marketing_consent_events%rowtype;
  provider_withdrawal boolean;
  owner_admin boolean;
begin
  provider_withdrawal := new.source = 'brevo_opt_out'
    and current_setting('role', true) = 'service_role';
  owner_admin := session_user in ('postgres','supabase_admin')
    and current_setting('role', true) in ('none','postgres');
  new.personalize := new.personalize and new.version = '2026-09-15-marketing-v2'
    and (new.own_news or new.partner_offers);
  if provider_withdrawal then
    if new.own_news or new.partner_offers or new.personalize then
      raise exception 'Provider events can only withdraw consent' using errcode = '42501';
    end if;
  elsif auth.uid() is not null then
    if new.user_id is distinct from auth.uid()
      or new.source not in ('account_activation','account_preferences') then
      raise exception 'Only your own preferences may be recorded' using errcode = '42501';
    end if;
  elsif owner_admin then
    if new.source <> 'admin_request' or new.personalize then
      raise exception 'Administrative requests may only withdraw consent' using errcode = '42501';
    end if;
  else
    raise exception 'A verified account is required' using errcode = '42501';
  end if;

  -- Acquire the Auth FK lock before the advisory lock to avoid the common
  -- consent-insert versus auth-delete lock inversion.
  select u.* into account_row from auth.users u where u.id = new.user_id for key share;
  if not found or account_row.email is null then
    raise exception 'Account required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));
  select u.* into account_row from auth.users u where u.id = new.user_id;
  if not provider_withdrawal and (account_row.email_confirmed_at is null
    or coalesce(account_row.is_anonymous, false) or account_row.deleted_at is not null
    or (account_row.banned_until is not null and account_row.banned_until >= now())) then
    raise exception 'A verified account is required' using errcode = '42501';
  end if;
  select * into previous from public.marketing_consent_events
    where user_id = new.user_id order by consent_revision desc limit 1;
  if owner_admin and not provider_withdrawal and (
    (new.own_news and not coalesce(previous.own_news, false))
    or (new.partner_offers and not coalesce(previous.partner_offers, false))
    or ((new.own_news or new.partner_offers)
      and previous.email_at_consent is distinct from lower(account_row.email))) then
    raise exception 'Administrative requests may only withdraw existing consent' using errcode = '42501';
  end if;
  if previous.id is not null and previous.email_at_consent = lower(account_row.email)
    and previous.own_news = new.own_news and previous.partner_offers = new.partner_offers
    and previous.personalize = new.personalize and previous.version = new.version then
    return null;
  end if;
  insert into private.brevo_user_revisions(user_id, consent_revision) values(new.user_id, 1)
    on conflict (user_id) do update
    set consent_revision = private.brevo_user_revisions.consent_revision + 1
    returning consent_revision into new.consent_revision;
  new.email_at_consent := lower(account_row.email);
  new.recorded_at := clock_timestamp();
  new.own_text := 'Quiero recibir por correo novedades de la calculadora, consejos y ofertas propias de Nómina Vigilante relacionadas con la seguridad privada.';
  new.partner_text := 'Quiero recibir por correo promociones de formación, productos y servicios de colaboradores del sector de la seguridad privada, enviadas por Nómina Vigilante, sin ceder mi correo a esos colaboradores.';
  new.personalization_text := 'Soy mayor de edad y autorizo a Nómina Vigilante a usar la franja de edad y la ciudad o provincia que indique para adaptar los correos publicitarios que haya aceptado. Puedo retirar este permiso y borrar estos datos sin perder mi cuenta.';
  return new;
end;
$$;
revoke all on function private.stamp_marketing_consent() from public, anon, authenticated, service_role;

-- Identical public columns and invoker security: no frontend changes required.
create or replace view public.marketing_preferences with (security_invoker = true) as
select distinct on (user_id) user_id, email_at_consent, own_news, partner_offers,
  version, recorded_at, personalize
from public.marketing_consent_events order by user_id, consent_revision desc;

create function private.brevo_enqueue_user(p_user_id uuid, p_email_hint text default null,
  p_deleted boolean default false, p_force boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare
  account_row auth.users%rowtype;
  consent_row public.marketing_consent_events%rowtype;
  contact_row private.brevo_contacts%rowtype;
  current_email text;
  is_deleted boolean;
  is_eligible boolean;
  payload jsonb;
begin
  select u.* into account_row from auth.users u where u.id = p_user_id for key share;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  select u.* into account_row from auth.users u where u.id = p_user_id;
  is_deleted := p_deleted or account_row.id is null or account_row.deleted_at is not null;
  current_email := nullif(lower(btrim(coalesce(account_row.email, p_email_hint))), '');
  select * into consent_row from public.marketing_consent_events
    where user_id = p_user_id order by consent_revision desc limit 1;

  -- Accounts with no marketing history never enter the contact queue.
  if current_email is not null and (consent_row.id is not null or exists (
    select 1 from private.brevo_contacts where user_id = p_user_id)) then
    insert into private.brevo_contacts(email, user_id) values(current_email, p_user_id)
      on conflict (email) do update set user_id = excluded.user_id,
        updated_at = clock_timestamp();
  end if;
  for contact_row in select * from private.brevo_contacts
    where user_id = p_user_id order by email for update
  loop
    if is_deleted then
      update private.brevo_contacts set deleted_at = coalesce(deleted_at, clock_timestamp()),
        suppressed = true, suppression_reason = coalesce(suppression_reason, 'deleted'),
        suppressed_at = coalesce(suppressed_at, clock_timestamp()), updated_at = clock_timestamp()
        where email = contact_row.email returning * into contact_row;
    end if;
    is_eligible := not is_deleted and contact_row.deleted_at is null
      and not contact_row.suppressed and contact_row.email = current_email
      and account_row.email_confirmed_at is not null and not coalesce(account_row.is_anonymous, false)
      and (account_row.banned_until is null or account_row.banned_until < now())
      and consent_row.id is not null and consent_row.email_at_consent = current_email;
    payload := jsonb_build_object(
      'user_id', p_user_id, 'email', contact_row.email,
      'eligible', coalesce(is_eligible, false),
      'own_news', coalesce(is_eligible and consent_row.own_news, false),
      'partner_offers', coalesce(is_eligible and consent_row.partner_offers, false),
      'personalize', coalesce(is_eligible and consent_row.personalize, false),
      'consent_version', case when consent_row.email_at_consent = contact_row.email then consent_row.version end,
      'consent_at', case when consent_row.email_at_consent = contact_row.email then consent_row.recorded_at end,
      'consent_revision', case when consent_row.email_at_consent = contact_row.email then consent_row.consent_revision end,
      'suppress_all', contact_row.suppressed,
      'deleted', contact_row.deleted_at is not null
    );
    insert into private.brevo_outbox(email, desired) values(contact_row.email, payload)
      on conflict (email) do update set generation = private.brevo_outbox.generation + 1,
        desired = excluded.desired, available_at = clock_timestamp(), updated_at = clock_timestamp()
      where p_force or private.brevo_outbox.desired is distinct from excluded.desired;
    -- An existing lease is deliberately kept, so a newer revision cannot start
    -- a second concurrent remote write to this email.
  end loop;
end;
$$;
revoke all on function private.brevo_enqueue_user(uuid,text,boolean,boolean) from public, anon, authenticated, service_role;

create function private.brevo_marketing_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    perform private.brevo_enqueue_user(old.user_id, null, false, true);
    return old;
  end if;
  perform private.brevo_enqueue_user(new.user_id, null, false, true);
  return new;
end;
$$;
revoke all on function private.brevo_marketing_changed() from public, anon, authenticated, service_role;
create trigger z_brevo_consent_changed after insert on public.marketing_consent_events
  for each row execute function private.brevo_marketing_changed();
create trigger z_brevo_profile_changed after insert or update or delete on public.marketing_profiles
  for each row execute function private.brevo_marketing_changed();

create function private.brevo_auth_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    perform private.brevo_enqueue_user(old.id, old.email, true, true);
    return old;
  end if;
  perform private.brevo_enqueue_user(new.id, new.email, false, false);
  return new;
end;
$$;
revoke all on function private.brevo_auth_changed() from public, anon, authenticated, service_role;
create trigger brevo_auth_changed after update of email, email_confirmed_at, is_anonymous, deleted_at, banned_until
  on auth.users for each row execute function private.brevo_auth_changed();
create trigger brevo_auth_deleting before delete on auth.users
  for each row execute function private.brevo_auth_changed();

-- Only a service-role caller may use the public wrappers below. The private
-- implementations are not exposed and include a role check as defense in depth.
create function private.brevo_require_service() returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
end;
$$;
revoke all on function private.brevo_require_service() from public, anon, authenticated, service_role;

create function private.brevo_claim(p_limit integer, p_lease_seconds integer) returns setof jsonb
language plpgsql security definer set search_path = '' as $$
declare job private.brevo_outbox%rowtype; provider_id bigint;
begin
  perform private.brevo_require_service();
  if p_limit is null or p_limit not between 1 and 100
    or p_lease_seconds is null or p_lease_seconds not between 30 and 300 then
    raise exception 'Invalid claim bounds' using errcode = '22023';
  end if;
  for job in select * from private.brevo_outbox
    where generation > applied_generation and lease_token is null and available_at <= clock_timestamp()
    order by available_at, email limit p_limit for update skip locked
  loop
    update private.brevo_outbox set lease_token = gen_random_uuid(), lease_generation = generation,
      lease_until = clock_timestamp() + make_interval(secs => p_lease_seconds),
      attempts = attempts + 1, updated_at = clock_timestamp()
      where email = job.email returning * into job;
    select provider_contact_id into provider_id from private.brevo_contacts where email = job.email;
    return next job.desired || jsonb_build_object('generation', job.lease_generation,
      'lease_token', job.lease_token, 'lease_until', job.lease_until, 'provider_contact_id', provider_id);
  end loop;
end;
$$;
create function public.brevo_claim(p_limit integer default 20, p_lease_seconds integer default 120)
returns setof jsonb language sql security definer set search_path = '' as $$
  select * from private.brevo_claim(p_limit, p_lease_seconds);
$$;

create function private.brevo_check_lease(p_email text, p_generation bigint, p_lease_token uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform private.brevo_require_service();
  return exists(select 1 from private.brevo_outbox where email = lower(btrim(p_email))
    and generation = p_generation and lease_generation = p_generation
    and lease_token = p_lease_token and lease_until > clock_timestamp());
end;
$$;
create function public.brevo_check_lease(p_email text, p_generation bigint, p_lease_token uuid) returns boolean
language sql security definer set search_path = '' as $$
  select private.brevo_check_lease(p_email, p_generation, p_lease_token);
$$;

create function private.brevo_ack(p_email text, p_generation bigint, p_lease_token uuid,
  p_provider_contact_id bigint) returns boolean
language plpgsql security definer set search_path = '' as $$
declare job private.brevo_outbox%rowtype; contact_row private.brevo_contacts%rowtype;
begin
  perform private.brevo_require_service();
  -- All writers lock contact before queue; claim locks only the queue.
  select * into contact_row from private.brevo_contacts where email = lower(btrim(p_email)) for update;
  select * into job from private.brevo_outbox where email = contact_row.email for update;
  if job.lease_token is distinct from p_lease_token or p_lease_token is null
    or job.lease_generation is distinct from p_generation then return false; end if;
  if p_provider_contact_id is not null and p_provider_contact_id <= 0 then
    raise exception 'Invalid provider contact ID' using errcode = '22023';
  end if;
  if contact_row.provider_contact_id is not null and p_provider_contact_id is not null
    and contact_row.provider_contact_id <> p_provider_contact_id then
    raise exception 'Provider identity changed; review mapping' using errcode = '22023';
  end if;
  update private.brevo_contacts set provider_contact_id = coalesce(p_provider_contact_id, provider_contact_id),
    updated_at = clock_timestamp() where email = contact_row.email;
  update private.brevo_outbox set applied_generation = greatest(applied_generation, p_generation),
    lease_token = null, lease_generation = null, lease_until = null, last_error_code = null,
    attempts = 0, available_at = clock_timestamp(), updated_at = clock_timestamp()
    where email = contact_row.email;
  -- Newer generations stay pending even if the older external write succeeded.
  return true;
end;
$$;
create function public.brevo_ack(p_email text, p_generation bigint, p_lease_token uuid,
  p_provider_contact_id bigint default null) returns boolean
language sql security definer set search_path = '' as $$
  select private.brevo_ack(p_email, p_generation, p_lease_token, p_provider_contact_id);
$$;

create function private.brevo_fail(p_email text, p_generation bigint, p_lease_token uuid,
  p_error_code text, p_retry_seconds integer) returns boolean
language plpgsql security definer set search_path = '' as $$
declare touched integer;
begin
  perform private.brevo_require_service();
  if p_error_code is null or p_error_code !~ '^[A-Za-z0-9_:-]{1,80}$'
    or p_retry_seconds is null or p_retry_seconds not between 0 and 86400 then
    raise exception 'Use a bounded safe error code and retry delay' using errcode = '22023';
  end if;
  update private.brevo_outbox set lease_token = null, lease_generation = null, lease_until = null,
    last_error_code = p_error_code, available_at = clock_timestamp() + make_interval(secs => p_retry_seconds),
    updated_at = clock_timestamp()
    where email = lower(btrim(p_email)) and lease_generation = p_generation and lease_token = p_lease_token;
  get diagnostics touched = row_count;
  return touched = 1;
end;
$$;
create function public.brevo_fail(p_email text, p_generation bigint, p_lease_token uuid,
  p_error_code text, p_retry_seconds integer default 60) returns boolean
language sql security definer set search_path = '' as $$
  select private.brevo_fail(p_email, p_generation, p_lease_token, p_error_code, p_retry_seconds);
$$;

create function private.brevo_apply_opt_out(p_event_key text, p_email text,
  p_provider_contact_id bigint, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare contact_row private.brevo_contacts%rowtype; account_row auth.users%rowtype; inserted_rows integer;
begin
  perform private.brevo_require_service();
  if p_reason is null or p_reason not in ('unsubscribe','complaint','hard_bounce','blocked','deleted')
    or p_event_key is null or length(p_event_key) not between 1 and 200
    or (p_provider_contact_id is not null and p_provider_contact_id <= 0) then
    raise exception 'Invalid provider event' using errcode = '22023';
  end if;
  select * into contact_row from private.brevo_contacts where email = lower(btrim(p_email));
  if not found then return jsonb_build_object('applied', false, 'reason', 'unknown_contact'); end if;
  select u.* into account_row from auth.users u where u.id = contact_row.user_id for key share;
  perform pg_advisory_xact_lock(hashtextextended(contact_row.user_id::text, 0));
  select * into contact_row from private.brevo_contacts where email = lower(btrim(p_email)) for update;
  if p_provider_contact_id is not null and contact_row.provider_contact_id is not null
    and p_provider_contact_id <> contact_row.provider_contact_id then
    raise exception 'Provider event identity mismatch' using errcode = '22023';
  end if;
  insert into private.brevo_provider_events(event_key, email, reason)
    values(p_event_key, contact_row.email, p_reason) on conflict(event_key) do nothing;
  get diagnostics inserted_rows = row_count;
  if inserted_rows = 0 then return jsonb_build_object('applied', false, 'reason', 'duplicate_event'); end if;
  update private.brevo_contacts set suppressed = true, suppression_reason = p_reason,
    provider_contact_id = coalesce(provider_contact_id, p_provider_contact_id),
    suppressed_at = coalesce(suppressed_at, clock_timestamp()), updated_at = clock_timestamp()
    where email = contact_row.email;
  select u.* into account_row from auth.users u where u.id = contact_row.user_id;
  if p_reason in ('unsubscribe','complaint') and account_row.id is not null
    and lower(account_row.email) = contact_row.email then
    -- Source and role checks in stamp_marketing_consent allow only false here.
    -- Works even for a now-banned/unverified account; never opt in from Brevo.
    insert into public.marketing_consent_events(user_id, own_news, partner_offers, personalize, version, source)
      values(contact_row.user_id, false, false, false, '2026-09-15-marketing-v2', 'brevo_opt_out');
    -- Also covers an already-false choice for which the stamp deduplicates.
    delete from public.marketing_profiles where user_id = contact_row.user_id;
  end if;
  -- Delivery failure, an observed block of unknown cause, and remote contact
  -- deletion are technical suppression only. They are not evidence that the
  -- user withdrew consent, so preserve the consent ledger and optional profile.
  perform private.brevo_enqueue_user(contact_row.user_id, contact_row.email, false, true);
  return jsonb_build_object('applied', true, 'reason', p_reason);
end;
$$;
create function public.brevo_apply_opt_out(p_event_key text, p_email text,
  p_provider_contact_id bigint default null, p_reason text default 'unsubscribe') returns jsonb
language sql security definer set search_path = '' as $$
  select private.brevo_apply_opt_out(p_event_key, p_email, p_provider_contact_id, p_reason);
$$;

-- Explicit paged backfill/reconciliation, also needed when banned_until expires
-- without an UPDATE. It produces queue work only, never provider requests.
create function private.brevo_refresh(p_after_user_id uuid, p_limit integer) returns setof uuid
language plpgsql security definer set search_path = '' as $$
declare target_id uuid;
begin
  perform private.brevo_require_service();
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception 'Invalid page size' using errcode = '22023';
  end if;
  for target_id in select u.id from auth.users u
    where (p_after_user_id is null or u.id > p_after_user_id)
      and (exists(select 1 from public.marketing_consent_events c where c.user_id = u.id)
        or exists(select 1 from private.brevo_contacts c where c.user_id = u.id))
    order by u.id limit p_limit
  loop
    -- Force a new read/reconciliation even when local choices are unchanged,
    -- so a missed provider suppression event can still be discovered.
    perform private.brevo_enqueue_user(target_id, null, false, true);
    return next target_id;
  end loop;
end;
$$;
create function public.brevo_refresh(p_after_user_id uuid default null, p_limit integer default 100)
returns setof uuid language sql security definer set search_path = '' as $$
  select * from private.brevo_refresh(p_after_user_id, p_limit);
$$;

-- Revoke defaults in the same transaction as creation: no exposure window.
revoke all on function private.brevo_claim(integer,integer),
  private.brevo_check_lease(text,bigint,uuid), private.brevo_ack(text,bigint,uuid,bigint),
  private.brevo_fail(text,bigint,uuid,text,integer), private.brevo_apply_opt_out(text,text,bigint,text),
  private.brevo_refresh(uuid,integer) from public, anon, authenticated, service_role;
revoke all on function public.brevo_claim(integer,integer),
  public.brevo_check_lease(text,bigint,uuid), public.brevo_ack(text,bigint,uuid,bigint),
  public.brevo_fail(text,bigint,uuid,text,integer), public.brevo_apply_opt_out(text,text,bigint,text),
  public.brevo_refresh(uuid,integer) from public, anon, authenticated, service_role;
grant execute on function public.brevo_claim(integer,integer),
  public.brevo_check_lease(text,bigint,uuid), public.brevo_ack(text,bigint,uuid,bigint),
  public.brevo_fail(text,bigint,uuid,text,integer), public.brevo_apply_opt_out(text,text,bigint,text),
  public.brevo_refresh(uuid,integer) to service_role;

comment on table private.brevo_contacts is 'Durable email identity/suppression map; survives auth deletion. No demographics. Retention/purge requires completed cleanup and a reviewed suppression policy.';
comment on table private.brevo_outbox is 'Coalescing address queue. Expired leases are not auto-reclaimed: terminate the previous worker before explicit operational recovery.';
comment on column public.marketing_consent_events.consent_revision is 'Per-user order assigned under advisory lock; identity ID remains audit identity, not concurrent preference ordering.';
commit;
