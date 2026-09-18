-- Disposable synthetic accounts and permission checks; no persistent changes.
begin;
do $$
declare a uuid:=gen_random_uuid(); unverified uuid:=gen_random_uuid(); n integer;
begin
 insert into auth.users(id,email,email_confirmed_at,is_anonymous) values
 (a,'community-'||a||'@example.test',now(),false),
 (unverified,'community-'||unverified||'@example.test',null,false);
 insert into public.legal_acceptances(user_id,version) values(unverified,'2026-09-15');
 perform set_config('request.jwt.claims',json_build_object('sub',a,'role','authenticated','is_anonymous',false)::text,true);
 execute 'set local role authenticated';
 select count(slug) into n from public.community_links;
 if n<>0 then raise exception 'Account without acceptance has access'; end if;
 insert into public.legal_acceptances(user_id,version) values(a,'2026-09-15');
 select count(slug) into n from public.community_links;
 if n<>1 then raise exception 'Confirmed member cannot access invitation'; end if;
 begin
  update public.community_links set active=false;
  raise exception 'Member can edit invitation';
 exception when insufficient_privilege then null; end;
 begin
  delete from public.community_links;
  raise exception 'Member can delete invitation';
 exception when insufficient_privilege then null; end;
 begin
  insert into public.community_links(slug,invite_url) values('whatsapp','https://chat.whatsapp.com/SyntheticTestOnly1234');
  raise exception 'Member can create invitation';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claims',json_build_object('sub',unverified,'role','authenticated','is_anonymous',false,'user_metadata',json_build_object('email_verified',true))::text,true);
 select count(slug) into n from public.community_links;
 if n<>0 then raise exception 'Unverified account bypassed verification'; end if;
 execute 'reset role';
 perform set_config('request.jwt.claims',json_build_object('sub',a,'role','authenticated','is_anonymous',false)::text,true);
 update auth.users set banned_until=now()+interval '1 day' where id=a;
 execute 'set local role authenticated';
 select count(slug) into n from public.community_links;
 if n<>0 then raise exception 'Banned account has access'; end if;
 execute 'reset role';
 update auth.users set banned_until=null,deleted_at=now() where id=a;
 execute 'set local role authenticated';
 select count(slug) into n from public.community_links;
 if n<>0 then raise exception 'Deleted account has access'; end if;
 execute 'reset role';
 update auth.users set deleted_at=null,is_anonymous=true where id=a;
 execute 'set local role authenticated';
 select count(slug) into n from public.community_links;
 if n<>0 then raise exception 'Anonymous account has access'; end if;
 execute 'reset role';
 update auth.users set is_anonymous=false where id=a;
 update public.community_links set active=false;
 execute 'set local role authenticated';
 select count(slug) into n from public.community_links;
 if n<>0 then raise exception 'Disabled invitation still accessible'; end if;
 execute 'reset role';
 perform set_config('request.jwt.claims','{}',true);
 execute 'set local role anon';
 begin
  perform invite_url from public.community_links;
  raise exception 'Guest can read invitation';
 exception when insufficient_privilege then null; end;
 begin
  perform private.can_access_community();
  raise exception 'Guest can call privileged helper';
 exception when insufficient_privilege then null; end;
 execute 'reset role';
end;
$$;
select 'Community authorization checks passed; all synthetic changes rolled back' as result;
rollback;
