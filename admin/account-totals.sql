-- Totales exactos de cuentas actuales, independientes del consentimiento de Analytics.
select
  (select count(*) from auth.users where deleted_at is null and not coalesce(is_anonymous,false)) as cuentas_creadas,
  (select count(*) from auth.users where deleted_at is null and email_confirmed_at is not null and not coalesce(is_anonymous,false)) as correos_confirmados,
  (select count(distinct a.user_id) from public.legal_acceptances a join auth.users u on u.id=a.user_id where u.deleted_at is null and u.email_confirmed_at is not null) as cuentas_activadas,
  (select count(*) from private.marketing_audience where own_news) as suscritos_comunicaciones_propias,
  (select count(*) from private.marketing_audience where partner_offers) as suscritos_promociones_colaboradores,
  (select count(*) from private.marketing_audience) as suscriptores_unicos,
  (select count(*) from auth.users u where u.deleted_at is null and not coalesce(u.is_anonymous,false)
    and not exists (select 1 from private.marketing_audience m where m.user_id = u.id)) as cuentas_sin_publicidad_autorizada;
