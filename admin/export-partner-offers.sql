-- Solo promociones de colaboradores ENVIADAS POR NÓMINA VIGILANTE.
-- No entregar esta lista a los colaboradores. Exportar de nuevo antes de cada envío.
select email, consent_at as fecha_consentimiento, version
from private.marketing_audience where partner_offers order by email;
