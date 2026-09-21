# Nómina Vigilante

Calculadora gratuita de nómina, cuadrante, finiquito e incapacidad temporal, con tablas de 2026 del convenio estatal de empresas de seguridad. Los resultados son estimaciones: hay que contrastar bases, contrato, complementos y retenciones reales.

La nómina básica permite cálculos sin cuenta. Supabase gestiona cuentas verificadas, acceso con Google, recuperación de contraseña y preferencias opcionales de publicidad. Los cálculos, el cuadrante y los PDF permanecen en el dispositivo. Analytics solo se activa con consentimiento y recibe eventos sin correos ni importes.

## Organización del repositorio

| Ubicación | Contenido |
| --- | --- |
| `*.html` | Calculadora, guías, colaboradores y páginas legales con sus URL públicas estables. |
| `*.js`, `*.css` | Funcionalidad y estilos de la aplicación. |
| `brand.svg`, `favicon*`, `icon-*`, `apple-touch-icon.png` | La identidad verde actual, en los formatos que necesita cada navegador. |
| `manifest.json`, `robots.txt`, `sitemap.xml`, `CNAME` | Instalación, indexación y dominio. |
| `admin/` | Consultas del propietario y herramientas de construcción; excluidas de la web publicada. |
| `tests/` | Pruebas automáticas y verificaciones de permisos; excluidas de la publicación. |
| `email-templates/` | Plantillas de los correos; excluidas de la publicación. |
| `vendor/` | Bibliotecas distribuidas con la web y sus licencias. |
| `*-schema.sql` | Esquemas versionados para mantenimiento; excluidos de la publicación. |

La rama de trabajo y publicación es `main`. No se mantienen ramas ni carpetas de copia de la aplicación antigua. Git conserva el historial normal de cambios, que no forma parte de la web servida. `.gitignore` evita incorporar dependencias, secretos y archivos de copia.

## Desarrollo local

Node.js 22. Instalar dependencias con `npm ci`; ejecutar `npm test`. `npm run build:auth` reconstruye el cliente de Supabase. Servir la raíz con un servidor HTTP local. Las claves publicables están en `auth-config.js`; los secretos SMTP, OAuth y CAPTCHA pertenecen a los paneles de los proveedores y nunca al repositorio.

Los esquemas SQL y las consultas administrativas están versionados para revisión; no se ejecutan automáticamente al publicar. `_config.yml` excluye código de desarrollo, consultas y plantillas del sitio servido por GitHub Pages. Las cabeceras de `_headers` solo se aplican en alojamientos compatibles; Pages usa las políticas CSP incluidas en el HTML y protección de interfaz contra marcos.

Después de los esquemas de autenticación y marketing, `marketing-profile-schema.sql` añade el perfil publicitario opcional (franja de edad, provincia y ciudad) y `save_marketing_choices`, una transacción con permisos del usuario y RLS. El historial registra el consentimiento de personalización sin guardar copias antiguas de edad o ciudad. Retirar ese permiso borra el perfil; los clientes de marketing v1 siguen siendo compatibles y no conceden personalización. Los scripts `tests/marketing-rls.sql` y `tests/marketing-profile-rls.sql` verifican permisos y borrado con usuarios ficticios en una transacción que se revierte. Las migraciones de esta actualización se aplicaron mediante Supabase MCP, con los nombres `optional_consented_marketing_profile` y `allow_admin_personalization_withdrawal`.

## Validación

Pruebas de nómina, tramos de IT, antigüedad y contratos, pagas abonadas, jornadas parciales, calendario con cruces de mes y cambios de hora, PDF de una o varias páginas, autenticación y persistencia con el SDK real, consentimiento, privacidad, entradas inválidas e instalación móvil.

El complemento de vacaciones se gestiona en `vacation-pluses.js`: por defecto estima con horas medias y las tarifas de la categoría de 2026. También admite importes de 1 a 12 nóminas de referencia o una media mensual ya conocida. Los métodos son excluyentes, los meses sin pluses cuentan en el divisor y se rechaza un historial parcialmente vacío. La media conserva sus decimales hasta prorratearla por días / 31; no se reduce de nuevo por jornada parcial. Los datos permanecen en el formulario del dispositivo. La estimación por horas, los meses incompletos de alta y los complementos con reglas específicas tienen las limitaciones indicadas en la interfaz. El PDF conserva el método, la media y el importe; el cuadrante mantiene calendario, desglose y neto en la primera página y puede continuar los datos en otra hoja.

Fuentes: [Convenio BOE-A-2026-8569](https://www.boe.es/eli/es/res/2026/04/08/(5)), [Estatuto de los Trabajadores](https://www.boe.es/buscar/act.php?id=BOE-A-2015-11430). No se garantiza la cobertura de todos los regímenes o circunstancias laborales.

Correcciones de la auditoría del 22/09/2026: la escolta con trabajo y vacaciones pide el importe funcional real separado del promedio vacacional; un mes sin trabajo no duplica el plus. El control de tope de cotización se ajusta a los días remunerados y detiene los casos que requieren solidaridad. La segunda o posterior IT no admite la ausencia de procesos previos. La estimación de vacaciones de transporte no aplica el plus festivo de vigilancia, pero conserva importes históricos reales. El calendario y el PDF muestran las continuaciones por día natural. La indemnización conserva la precisión al formar el salario anual. Las reproducciones están en `tests/audit-september.test.cjs`.

## Iconos y actualizaciones

`brand.svg` es el dibujo maestro del escudo verde. Las imágenes PNG de 32, 180, 192 y 512 píxeles son versiones de ese mismo dibujo; las versiones para iOS y Android adaptable tienen fondo opaco. No son copias del logotipo anterior.

- Google dispone de `/favicon.png` (192 × 192), con una URL estable y enlazada desde todas las páginas.
- `/favicon.ico` contiene el mismo logo en 32 y 192 píxeles para navegadores que buscan la ruta convencional. Se reconstruye con `npm run build:favicon`, sin instalar herramientas adicionales.
- El manifiesto enlaza las imágenes Android de 192 y 512 píxeles y la variante adaptable. iOS utiliza `apple-touch-icon.png` (180 × 180).
- Se mantienen `manifest.json`, `id`, `start_url` y las rutas de imágenes existentes. Cambiarlas o borrarlas puede perjudicar la actualización de accesos instalados. Esas rutas sirven el logo nuevo, también sin parámetros de versión.

La web no puede sustituir directamente la imagen guardada por el sistema de un visitante. Google vuelve a rastrear y procesar el favicon a su ritmo; una solicitud en Search Console no garantiza una fecha. Chrome en Android puede actualizar una instalación WebAPK al detectar cambios en el manifiesto; un acceso directo o una instalación de otro navegador puede comportarse de otra manera. No se deben borrar datos o desinstalar para forzar una actualización desde el código.

Referencias: [Favicon en Google Search](https://developers.google.com/search/docs/appearance/favicon-in-search), [actualización de manifiestos en Chrome](https://web.dev/articles/manifest-updates).
