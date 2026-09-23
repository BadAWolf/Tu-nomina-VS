-- Apply as owner after database.sql and after creating Vault brevo_worker_token.
-- Starts paused. Enable only after the privacy notice and live checks pass.
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create table private.brevo_schedule_state (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  refresh_after uuid,
  next_refresh_at timestamptz not null default now(),
  last_request_id bigint,
  last_http_status integer,
  last_result jsonb,
  last_run_at timestamptz
);
alter table private.brevo_schedule_state enable row level security;
revoke all on private.brevo_schedule_state from public, anon, authenticated, service_role;
insert into private.brevo_schedule_state(singleton) values(true);
-- pg_net's transient request queue contains the Authorization header.
revoke all on net.http_request_queue, net._http_response from public, anon, authenticated;

create function private.brevo_tick() returns void
language plpgsql security invoker set search_path = '' as $$
declare
  state private.brevo_schedule_state%rowtype;
  target uuid; last_id uuid; refreshed integer := 0;
  token text; response_row net._http_response%rowtype;
begin
  select * into state from private.brevo_schedule_state where singleton for update;
  if not state.enabled then return; end if;
  if state.last_request_id is not null then
    select * into response_row from net._http_response where id=state.last_request_id;
    if found then
      update private.brevo_schedule_state set last_http_status=response_row.status_code,
        last_result=case when response_row.content is json object then response_row.content::jsonb
          else jsonb_build_object('ok',false,'code','HTTP_RESPONSE_UNAVAILABLE') end
        where singleton;
    end if;
  end if;
  if state.next_refresh_at <= clock_timestamp() then
    for target in select u.id from auth.users u
      where (state.refresh_after is null or u.id>state.refresh_after)
        and (exists(select 1 from public.marketing_consent_events c where c.user_id=u.id)
          or exists(select 1 from private.brevo_contacts c where c.user_id=u.id))
      order by u.id limit 100
    loop
      perform private.brevo_enqueue_user(target,null,false,true);
      refreshed:=refreshed+1; last_id:=target;
    end loop;
    update private.brevo_schedule_state
      set refresh_after=case when refreshed=100 then last_id else null end,
        next_refresh_at=clock_timestamp()+case when refreshed=100 then interval '1 minute' else interval '1 day' end
      where singleton;
  end if;
  if exists(select 1 from private.brevo_outbox
      where generation>applied_generation and lease_token is null and available_at<=clock_timestamp()) then
    select decrypted_secret into token from vault.decrypted_secrets where name='brevo_worker_token';
    if token is null or length(token)<32 then raise exception 'Brevo scheduler secret missing'; end if;
    update private.brevo_schedule_state set last_request_id=net.http_post(
      url:='https://qhqbrtxzbfokqdlhstuo.supabase.co/functions/v1/brevo-marketing/sync',
      headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||token),
      body:='{"limit":5}'::jsonb,timeout_milliseconds:=120000),last_run_at=clock_timestamp()
      where singleton;
  end if;
end;
$$;
revoke all on function private.brevo_tick() from public, anon, authenticated, service_role;
select cron.schedule('brevo-preferences-sync','* * * * *','select private.brevo_tick();');
commit;
