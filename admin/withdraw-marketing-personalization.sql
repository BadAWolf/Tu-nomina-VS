-- Solo ante una solicitud verificada de retirada del perfil; nunca un alta.
-- Sustituir el correo por el de la solicitud. El trigger borra edad y zona.
insert into public.marketing_consent_events(user_id,own_news,partner_offers,personalize,version,source)
select u.id,m.own_news,m.partner_offers,false,'2026-09-15-marketing-v2','admin_request'
from auth.users u join public.marketing_preferences m on m.user_id=u.id
where lower(u.email)=lower('correo-de-la-solicitud@example.test')
 and m.email_at_consent=lower(u.email) and u.email_confirmed_at is not null and u.deleted_at is null;
