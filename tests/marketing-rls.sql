begin;
do $$
declare
  first_user uuid := gen_random_uuid();
  second_user uuid := gen_random_uuid();
  unverified_user uuid := gen_random_uuid();
  total integer;
begin
  insert into auth.users(id,email,email_confirmed_at,is_anonymous)
    values(first_user,'marketing-a-'||first_user||'@example.test',now(),false),
          (second_user,'marketing-b-'||second_user||'@example.test',now(),false),
          (unverified_user,'marketing-c-'||unverified_user||'@example.test',null,false);
  perform set_config('request.jwt.claims',json_build_object('sub',first_user,'role','authenticated','is_anonymous',false)::text,true);
  execute 'set local role authenticated';
  insert into public.marketing_consent_events(own_news,partner_offers,version,source)
    values(true,false,'2026-09-15-marketing-v1','account_activation');
  select count(*) into total from public.marketing_preferences;
  if total<>1 then raise exception 'Own preference not readable'; end if;
  -- A browser cannot forge the email, timestamp, user ID or evidence text.
  begin
    insert into public.marketing_consent_events(own_news,partner_offers,version,source,email_at_consent)
      values(true,true,'2026-09-15-marketing-v1','account_preferences','forged@example.test');
    raise exception 'Forged email accepted';
  exception when insufficient_privilege then null; end;
  begin
    update public.marketing_consent_events set own_news=false;
    raise exception 'Audit history was mutable';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.marketing_consent_events;
    raise exception 'Audit history was deletable';
  exception when insufficient_privilege then null; end;
  begin
    perform * from private.marketing_audience;
    raise exception 'Private audience was exposed';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims',json_build_object('sub',second_user,'role','authenticated','is_anonymous',false)::text,true);
  select count(*) into total from public.marketing_consent_events;
  if total<>0 then raise exception 'Cross-user evidence leak'; end if;
  select count(*) into total from public.marketing_preferences;
  if total<>0 then raise exception 'Cross-user view leak'; end if;
  insert into public.marketing_consent_events(own_news,partner_offers,version,source)
    values(false,true,'2026-09-15-marketing-v1','account_activation');
  perform set_config('request.jwt.claims',json_build_object('sub',unverified_user,'role','authenticated','is_anonymous',false)::text,true);
  begin
    insert into public.marketing_consent_events(own_news,partner_offers,version,source)
      values(true,true,'2026-09-15-marketing-v1','account_activation');
    raise exception 'Unverified subscription accepted';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  select count(*) into total from private.marketing_audience where user_id in (first_user,second_user);
  if total<>2 then raise exception 'Eligible users missing from audience'; end if;
  -- Changing an email does not transfer consent to the new address.
  update auth.users set email='changed-'||second_user||'@example.test' where id=second_user;
  select count(*) into total from private.marketing_audience where user_id=second_user;
  if total<>0 then raise exception 'Consent transferred to a different email'; end if;
  perform set_config('request.jwt.claims',json_build_object('sub',first_user,'role','authenticated','is_anonymous',false)::text,true);
  execute 'set local role authenticated';
  insert into public.marketing_consent_events(own_news,partner_offers,version,source)
    values(false,false,'2026-09-15-marketing-v1','account_preferences');
  insert into public.marketing_consent_events(own_news,partner_offers,version,source)
    values(false,false,'2026-09-15-marketing-v1','account_preferences');
  select count(*) into total from public.marketing_consent_events;
  if total<>2 then raise exception 'Repeated preference created duplicate history'; end if;
  execute 'reset role';
  select count(*) into total from private.marketing_audience where user_id=first_user;
  if total<>0 then raise exception 'Withdrawal did not suppress audience'; end if;
  perform set_config('request.jwt.claims','{}',true);
  -- The owner can honour an email opt-out, but cannot opt users into campaigns.
  insert into public.marketing_consent_events(user_id,own_news,partner_offers,version,source)
    values(second_user,false,false,'2026-09-15-marketing-v1','admin_request');
  begin
    insert into public.marketing_consent_events(user_id,own_news,partner_offers,version,source)
      values(second_user,true,true,'2026-09-15-marketing-v1','admin_request');
    raise exception 'Administrative opt-in accepted';
  exception when insufficient_privilege then null; end;
  execute 'set local role anon';
  begin
    perform * from public.marketing_preferences;
    raise exception 'Anonymous read allowed';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  delete from auth.users where id=first_user;
  select count(*) into total from public.marketing_consent_events where user_id=first_user;
  if total<>0 then raise exception 'Account deletion did not cascade'; end if;
end;
$$;
select 'Marketing RLS, evidence, withdrawal and audience isolation: passed (transaction rolled back)' as result;
rollback;
