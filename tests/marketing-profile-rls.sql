begin;
do $$
declare
 a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); unverified uuid:=gen_random_uuid();
 n integer; before_count integer; profile public.marketing_profiles%rowtype;
begin
 insert into auth.users(id,email,email_confirmed_at,is_anonymous) values
 (a,'profile-a-'||a||'@example.test',now(),false),(b,'profile-b-'||b||'@example.test',now(),false),
 (unverified,'profile-c-'||unverified||'@example.test',null,false);
 perform set_config('request.jwt.claims',json_build_object('sub',a,'role','authenticated','is_anonymous',false)::text,true);
 execute 'set local role authenticated';
 -- No profile can be inserted without its separate consent.
 begin
  insert into public.marketing_profiles(user_id,age_band,province_code,city) values(a,'25-34','12','Burriana');
  raise exception 'Profile stored without permission';
 exception when insufficient_privilege then null; end;
 perform * from public.save_marketing_choices(a,true,true,true,'25-34','12','  Burriana  ','account_activation');
 select * into profile from public.marketing_profiles where user_id=a;
 if profile.city<>'Burriana' or profile.age_band<>'25-34' or profile.email_at_consent<>'profile-a-'||a||'@example.test' then raise exception 'Profile not stored correctly'; end if;
 select count(*) into before_count from public.marketing_consent_events;
 -- Editing profile fields does not invent another advertising opt-in.
 select count(*) into n from public.save_marketing_choices(a,true,true,true,'35-44','08','L''Hospitalet de Llobregat','account_preferences');
 if n<>0 then raise exception 'Profile-only edit emitted advertising event'; end if;
 select count(*) into n from public.marketing_consent_events;
 if n<>before_count then raise exception 'Duplicate choice created extra evidence'; end if;
 begin
  perform * from public.save_marketing_choices(a,false,true,true,'200','12','Burriana','account_preferences');
  raise exception 'Invalid age accepted';
 exception when check_violation then null; end;
 if not (select own_news from public.marketing_preferences where user_id=a) then raise exception 'Failed transaction changed advertising choice'; end if;
 begin
  perform * from public.save_marketing_choices(a,true,true,true,null,null,'Burriana','account_preferences');
  raise exception 'City accepted without province';
 exception when check_violation then null; end;
 begin
  perform * from public.save_marketing_choices(a,true,true,true,'25-34','12','=IMPORTDATA("bad")','account_preferences');
  raise exception 'Spreadsheet formula accepted as a city';
 exception when check_violation then null; end;
 begin
  perform * from public.save_marketing_choices(a,true,true,true,'25-34','88','Burriana','account_preferences');
  raise exception 'Invalid province accepted';
 exception when check_violation then null; end;
 begin
  update public.marketing_profiles set email_at_consent='forged@example.test' where user_id=a;
  raise exception 'Profile email forgery allowed';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claims',json_build_object('sub',b,'role','authenticated','is_anonymous',false)::text,true);
 select count(*) into n from public.marketing_profiles;
 if n<>0 then raise exception 'Cross-account profile leak'; end if;
 update public.marketing_profiles set city='Madrid' where user_id=a;
 get diagnostics n=row_count;
 if n<>0 then raise exception 'Cross-account profile edit allowed'; end if;
 begin
  perform * from public.save_marketing_choices(a,true,true,true,'25-34','12','Burriana','account_preferences');
  raise exception 'Account switch was not rejected';
 exception when invalid_parameter_value then null; end;
 begin
  perform * from private.marketing_audience;
  raise exception 'Private contact list leaked';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claims',json_build_object('sub',unverified,'role','authenticated','is_anonymous',false)::text,true);
 begin
  perform * from public.save_marketing_choices(unverified,true,true,true,'25-34','12','Burriana','account_preferences');
  raise exception 'Unverified profile accepted';
 exception when insufficient_privilege then null; end;
 execute 'reset role';
 select count(*) into n from private.marketing_audience where user_id=a and city='L''Hospitalet de Llobregat' and province_code='08';
 if n<>1 then raise exception 'Authorized profile missing from owner list'; end if;
 perform set_config('request.jwt.claims',json_build_object('sub',a,'role','authenticated','is_anonymous',false)::text,true);
 execute 'set local role authenticated';
 perform * from public.save_marketing_choices(a,true,true,false,'25-34','12','Ignored without consent','account_preferences');
 select count(*) into n from public.marketing_profiles;
 if n<>0 then raise exception 'Withdrawal failed to erase profile'; end if;
 if not (select partner_offers from public.marketing_preferences where user_id=a) then raise exception 'Personalization opt-out removed unrelated advertising permission'; end if;
 perform * from public.save_marketing_choices(a,true,true,true,'25-34','12','Burriana','account_preferences');
 -- A legacy client must still be able to withdraw all advertising.
 insert into public.marketing_consent_events(own_news,partner_offers,version,source)
 values(false,false,'2026-09-15-marketing-v1','account_preferences');
 select count(*) into n from public.marketing_profiles;
 if n<>0 then raise exception 'Legacy opt-out did not erase profile'; end if;
 perform * from public.save_marketing_choices(a,true,true,true,'25-34','12','Burriana','account_preferences');
 execute 'reset role';
 perform set_config('request.jwt.claims','{}',true);
 insert into public.marketing_consent_events(user_id,own_news,partner_offers,personalize,version,source)
 values(a,true,true,false,'2026-09-15-marketing-v2','admin_request');
 if exists(select 1 from public.marketing_profiles where user_id=a) then raise exception 'Admin profile-only withdrawal retained data'; end if;
 if not (select own_news and partner_offers and not personalize from public.marketing_preferences where user_id=a) then raise exception 'Admin profile-only withdrawal changed category permissions'; end if;
 begin
  insert into public.marketing_consent_events(user_id,own_news,partner_offers,personalize,version,source)
  values(a,true,true,true,'2026-09-15-marketing-v2','admin_request');
  raise exception 'Admin invented personalization';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claims',json_build_object('sub',a,'role','authenticated','is_anonymous',false)::text,true);
 execute 'set local role authenticated';
 perform * from public.save_marketing_choices(a,true,true,true,'25-34','12','Burriana','account_preferences');
 execute 'reset role';
 update auth.users set email='changed-'||a||'@example.test' where id=a;
 select count(*) into n from private.marketing_audience where user_id=a;
 if n<>0 then raise exception 'Changed email inherited old consent/profile'; end if;
 perform set_config('request.jwt.claims','{}',true);
 insert into public.marketing_consent_events(user_id,own_news,partner_offers,version,source)
 values(a,false,false,'2026-09-15-marketing-v1','admin_request');
 select count(*) into n from public.marketing_profiles where user_id=a;
 if n<>0 then raise exception 'Admin withdrawal did not erase profile'; end if;
 execute 'set local role anon';
 begin
  perform * from public.marketing_profiles;
  raise exception 'Anonymous profile access';
 exception when insufficient_privilege then null; end;
 begin
  perform * from public.save_marketing_choices(a,true,true,true,'25-34','12','Burriana','account_preferences');
  raise exception 'Anonymous RPC allowed';
 exception when insufficient_privilege then null; end;
 execute 'reset role';
 perform set_config('request.jwt.claims',json_build_object('sub',b,'role','authenticated','is_anonymous',false)::text,true);
 execute 'set local role authenticated';
 perform * from public.save_marketing_choices(b,true,true,true,'25-34','12','Burriana','account_preferences');
 execute 'reset role';
 delete from auth.users where id=b;
 if exists(select 1 from public.marketing_profiles where user_id=b) then raise exception 'Deleting account did not erase profile'; end if;
 delete from auth.users where id in(a,b,unverified);
end;
$$;
select 'Optional profile consent, atomic save, validation, erasure and isolation passed; rolled back' as result;
rollback;
