# Nómina Vigilante

Calculadora gratuita de nómina, cuadrante, finiquito e incapacidad temporal, con tablas de 2026 del convenio estatal de empresas de seguridad. Los resultados son estimaciones: hay que contrastar bases, contrato, complementos y retenciones reales.

La nómina básica permite cálculos sin cuenta. Supabase gestiona cuentas verificadas, acceso con Google, recuperación de contraseña y preferencias opcionales de publicidad. Los cálculos, el cuadrante y los PDF permanecen en el dispositivo. Analytics solo se activa con consentimiento y recibe eventos sin correos ni importes.

## Desarrollo

Node.js 22. Instalar dependencias con `npm ci`; ejecutar `npm test`. `npm run build:auth` reconstruye el cliente de Supabase. Servir la raíz con un servidor HTTP local. Las claves publicables están en `auth-config.js`; los secretos SMTP, OAuth y CAPTCHA pertenecen a los paneles de los proveedores y nunca al repositorio.

Los esquemas SQL y las consultas administrativas están versionados para revisión; no se ejecutan automáticamente al publicar. `_config.yml` excluye código de desarrollo, consultas y plantillas del sitio servido por GitHub Pages. Las cabeceras de `_headers` solo se aplican en alojamientos compatibles; Pages usa las políticas CSP incluidas en el HTML y protección de interfaz contra marcos.

Después de los esquemas de autenticación y marketing, `marketing-profile-schema.sql` añade el perfil publicitario opcional (franja de edad, provincia y ciudad) y `save_marketing_choices`, una transacción con permisos del usuario y RLS. El historial registra el consentimiento de personalización sin guardar copias antiguas de edad o ciudad. Retirar ese permiso borra el perfil; los clientes de marketing v1 siguen siendo compatibles y no conceden personalización. Los scripts `tests/marketing-rls.sql` y `tests/marketing-profile-rls.sql` verifican permisos y borrado con usuarios ficticios en una transacción que se revierte. Las migraciones de esta actualización se aplicaron mediante Supabase MCP, con los nombres `optional_consented_marketing_profile` y `allow_admin_personalization_withdrawal`.

## Validación

Pruebas de nómina, tramos de IT, antigüedad y contratos, pagas abonadas, jornadas parciales, calendario con cruces de mes y cambios de hora, PDF de una o varias páginas, autenticación y persistencia con el SDK real, consentimiento, privacidad, entradas inválidas e instalación móvil.

Fuentes: [Convenio BOE-A-2026-8569](https://www.boe.es/eli/es/res/2026/04/08/(5)), [Estatuto de los Trabajadores](https://www.boe.es/buscar/act.php?id=BOE-A-2015-11430). No se garantiza la cobertura de todos los regímenes o circunstancias laborales.
