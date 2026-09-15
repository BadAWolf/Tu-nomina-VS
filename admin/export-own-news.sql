-- Ejecutar como propietario en Supabase SQL Editor, justo antes de cada campaña propia.
-- Exportar el resultado en CSV. No reutilizar una exportación anterior a una baja.
select email, consent_at as fecha_consentimiento, version
from private.marketing_audience where own_news order by email;
