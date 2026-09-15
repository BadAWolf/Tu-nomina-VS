-- Add optional, consented marketing profile to the existing marketing schema.
alter table public.marketing_consent_events
  add column personalize boolean not null default false,
  add column personalization_text text not null default '';
alter table public.marketing_consent_events drop constraint marketing_consent_events_version_check;
alter table public.marketing_consent_events add constraint marketing_consent_events_version_check
  check (version in ('2026-09-15-marketing-v1','2026-09-15-marketing-v2'));
grant insert(personalize) on public.marketing_consent_events to authenticated;

create or replace function private.stamp_marketing_consent() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  account_email text;
  previous public.marketing_consent_events%rowtype;
begin
  new.personalize := new.personalize and new.version = '2026-09-15-marketing-v2' and (new.own_news or new.partner_offers);
  if auth.uid() is not null then
    if new.user_id is distinct from auth.uid() or new.source = 'admin_request' then
      raise exception 'Only your own preferences may be recorded' using errcode='42501';
    end if;
  elsif session_user in ('postgres','supabase_admin') and current_setting('role',true) in ('none','postgres') then
    -- An administrator can honour an emailed opt-out; never manufacture opt-in.
    if new.source <> 'admin_request' or new.personalize then
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
  if auth.uid() is null and (
      (new.own_news and not coalesce(previous.own_news,false))
      or (new.partner_offers and not coalesce(previous.partner_offers,false))
      or ((new.own_news or new.partner_offers) and previous.email_at_consent is distinct from account_email)) then
    raise exception 'Administrative requests may only withdraw existing consent' using errcode='42501';
  end if;
  if previous.id is not null and previous.email_at_consent = account_email
     and previous.own_news = new.own_news and previous.partner_offers = new.partner_offers
     and previous.personalize = new.personalize and previous.version = new.version then return null; end if;
  new.email_at_consent := account_email;
  new.recorded_at := clock_timestamp();
  new.own_text := 'Quiero recibir por correo novedades de la calculadora, consejos y ofertas propias de Nómina Vigilante relacionadas con la seguridad privada.';
  new.partner_text := 'Quiero recibir por correo promociones de formación, productos y servicios de colaboradores del sector de la seguridad privada, enviadas por Nómina Vigilante, sin ceder mi correo a esos colaboradores.';
  new.personalization_text := 'Soy mayor de edad y autorizo a Nómina Vigilante a usar la franja de edad y la ciudad o provincia que indique para adaptar los correos publicitarios que haya aceptado. Puedo retirar este permiso y borrar estos datos sin perder mi cuenta.';
  return new;
end;
$$;

create or replace view public.marketing_preferences with (security_invoker = true) as
select distinct on (user_id) user_id, email_at_consent, own_news, partner_offers, version, recorded_at, personalize
from public.marketing_consent_events order by user_id,id desc;

create table public.marketing_profiles (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  email_at_consent text not null,
  age_band text check(age_band in ('18-24','25-34','35-44','45-54','55-64','65+')),
  province_code text check(province_code ~ '^(0[1-9]|[1-4][0-9]|5[0-2]|99)$'),
  city text check(length(city) between 1 and 80 and city ~ '^[[:alpha:]][[:alpha:][:digit:] .''’/()-]*$'),
  updated_at timestamptz not null default clock_timestamp(),
  check(age_band is not null or province_code is not null),
  check(city is null or province_code is not null)
);
alter table public.marketing_profiles enable row level security;
revoke all on public.marketing_profiles from public,anon,authenticated;
grant select,delete on public.marketing_profiles to authenticated;
grant insert(user_id,age_band,province_code,city),update(age_band,province_code,city) on public.marketing_profiles to authenticated;
create policy "Read own optional marketing profile" on public.marketing_profiles
 for select to authenticated using ((select auth.uid())=user_id);
create policy "Create own optional marketing profile" on public.marketing_profiles
 for insert to authenticated with check ((select auth.uid())=user_id);
create policy "Update own optional marketing profile" on public.marketing_profiles
 for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy "Erase own optional marketing profile" on public.marketing_profiles
 for delete to authenticated using ((select auth.uid())=user_id);

-- Only this private trigger needs privileged access to canonical Auth records.
create function private.stamp_marketing_profile() returns trigger
language plpgsql security definer set search_path='' as $$
declare verified_email text;
begin
 if auth.uid() is null or new.user_id is distinct from auth.uid() then
   raise exception 'Verified owner required' using errcode='42501';
 end if;
 select lower(u.email) into verified_email from auth.users u
 where u.id=new.user_id and u.email_confirmed_at is not null and u.deleted_at is null
 and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<now());
 if verified_email is null then raise exception 'Verified owner required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(new.user_id::text,0));
 if not exists(select 1 from public.marketing_preferences m where m.user_id=new.user_id
   and m.email_at_consent=verified_email and m.personalize and (m.own_news or m.partner_offers)) then
   raise exception 'Current personalization consent required' using errcode='42501';
 end if;
 new.email_at_consent:=verified_email;
 new.city:=nullif(regexp_replace(btrim(new.city),'[[:space:]]+',' ','g'),'');
 new.updated_at:=clock_timestamp();
 return new;
end;
$$;
revoke all on function private.stamp_marketing_profile() from public,anon,authenticated;
create trigger stamp_marketing_profile before insert or update on public.marketing_profiles
 for each row execute function private.stamp_marketing_profile();

-- Withdrawal also erases the optional fields for old clients and admin opt-outs.
create function private.erase_withdrawn_marketing_profile() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if not new.personalize then delete from public.marketing_profiles where user_id=new.user_id; end if;
 return new;
end;
$$;
revoke all on function private.erase_withdrawn_marketing_profile() from public,anon,authenticated;
create trigger erase_withdrawn_marketing_profile after insert on public.marketing_consent_events
 for each row execute function private.erase_withdrawn_marketing_profile();

-- One atomic operation: a rejected profile must not leave an unexpected subscription.
create function public.save_marketing_choices(p_user_id uuid,p_own_news boolean,p_partner_offers boolean,p_personalize boolean,
 p_age_band text,p_province_code text,p_city text,p_source text)
returns table(own_news boolean,partner_offers boolean)
language plpgsql security invoker set search_path='' as $$
declare event_id bigint;
begin
 if auth.uid() is null or auth.uid() is distinct from p_user_id or p_personalize is null or (p_personalize and not (p_own_news or p_partner_offers)) then
   raise exception 'Invalid choices' using errcode='22023';
 end if;
 if p_source not in ('account_activation','account_preferences') then raise exception 'Invalid source' using errcode='22023'; end if;
 insert into public.marketing_consent_events(own_news,partner_offers,personalize,version,source)
 values(p_own_news,p_partner_offers,p_personalize,'2026-09-15-marketing-v2',p_source) returning id into event_id;
 if p_personalize then
   insert into public.marketing_profiles(user_id,age_band,province_code,city)
   values(auth.uid(),nullif(p_age_band,''),nullif(p_province_code,''),nullif(btrim(p_city),''))
   on conflict(user_id) do update set age_band=excluded.age_band,province_code=excluded.province_code,city=excluded.city;
 else
   delete from public.marketing_profiles where user_id=auth.uid();
 end if;
 if event_id is not null then return query select p_own_news,p_partner_offers; end if;
end;
$$;
revoke all on function public.save_marketing_choices(uuid,boolean,boolean,boolean,text,text,text,text) from public,anon,authenticated;
grant execute on function public.save_marketing_choices(uuid,boolean,boolean,boolean,text,text,text,text) to authenticated;

create or replace view private.marketing_audience with (security_invoker=true) as
select u.id as user_id,u.email,m.own_news,m.partner_offers,m.version,m.recorded_at as consent_at,
 p.age_band,p.province_code,p.city,p.updated_at as profile_updated_at
from public.marketing_preferences m join auth.users u on u.id=m.user_id
left join public.marketing_profiles p on p.user_id=u.id and p.email_at_consent=lower(u.email) and m.personalize
where (m.own_news or m.partner_offers) and lower(u.email)=m.email_at_consent
 and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false)
 and u.deleted_at is null and (u.banned_until is null or u.banned_until<now());
revoke all on private.marketing_audience from public,anon,authenticated;
