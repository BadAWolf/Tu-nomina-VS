-- SOLO después de recibir una solicitud de baja. Sustituir la dirección de ejemplo.
-- El servidor permite al administrador retirar permisos, nunca inventar un alta.
insert into public.marketing_consent_events(user_id,own_news,partner_offers,version,source)
select id,false,false,'2026-09-15-marketing-v1','admin_request'
from auth.users where lower(email)=lower('SUSTITUIR_POR_CORREO_DE_LA_SOLICITUD');
