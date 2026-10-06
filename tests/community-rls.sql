-- Comprobaciones de permisos de la comunidad abierta; no deja cambios persistentes.
begin;
do $$
declare a uuid:=gen_random_uuid(); n integer;
begin
 insert into auth.users(id,email,email_confirmed_at,is_anonymous) values
 (a,'community-'||a||'@example.test',now(),false);
 -- Invitado sin cuenta: lee la invitación activa y no puede modificarla.
 perform set_config('request.jwt.claims','{}',true);
 execute 'set local role anon';
 select count(invite_url) into n from public.community_links;
 if n<>1 then raise exception 'Guest cannot read the active invitation'; end if;
 begin
  update public.community_links set active=false;
  raise exception 'Guest can edit invitation';
 exception when insufficient_privilege then null; end;
 begin
  insert into public.community_links(slug,invite_url) values('whatsapp','https://chat.whatsapp.com/SyntheticTestOnly1234');
  raise exception 'Guest can create invitation';
 exception when insufficient_privilege then null; end;
 execute 'reset role';
 -- Cuenta registrada: misma lectura, sin escritura.
 perform set_config('request.jwt.claims',json_build_object('sub',a,'role','authenticated','is_anonymous',false)::text,true);
 execute 'set local role authenticated';
 select count(invite_url) into n from public.community_links;
 if n<>1 then raise exception 'Member cannot read the active invitation'; end if;
 begin
  update public.community_links set active=false;
  raise exception 'Member can edit invitation';
 exception when insufficient_privilege then null; end;
 begin
  delete from public.community_links;
  raise exception 'Member can delete invitation';
 exception when insufficient_privilege then null; end;
 execute 'reset role';
 -- Invitación desactivada: nadie la ve.
 update public.community_links set active=false;
 perform set_config('request.jwt.claims','{}',true);
 execute 'set local role anon';
 select count(invite_url) into n from public.community_links;
 if n<>0 then raise exception 'Disabled invitation still visible to guests'; end if;
 execute 'reset role';
end;
$$;
select 'Community authorization checks passed; all synthetic changes rolled back' as result;
rollback;
