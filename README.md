# Nómina Vigilante

Calculadora gratuita de nómina, cuadrante, finiquito e incapacidad temporal, con tablas de 2026 del convenio estatal de empresas de seguridad. Los resultados son estimaciones: hay que contrastar bases, contrato, complementos y retenciones reales.

La nómina básica permite cálculos sin cuenta. Supabase gestiona cuentas verificadas, acceso con Google, recuperación de contraseña y preferencias opcionales de publicidad. Los cálculos, el cuadrante y los PDF permanecen en el dispositivo. Analytics solo se activa con consentimiento y recibe eventos sin correos ni importes.

## Organización del repositorio

| Ubicación | Contenido |
| --- | --- |
| `*.html` | Calculadora, guías, colaboradores y páginas legales con sus URL públicas estables. |
| `*.js` | Funcionalidad de la aplicación. `calculator-engine.js` y `calculation-rules.js` contienen todos los cálculos, sin acceso a la página. |
| `brand.css` | Identidad común: colores, letra y una sola escala de tamaños para todas las páginas. |
| `calculator.css`, `pages.css` | Estructura de la calculadora y de las páginas de contenido. Las páginas no llevan estilos incrustados. |
| `legal.css`, `legal-navigation.css`, `auth.css`, `install.css`, `ad-layout.css` | Páginas legales, cuenta, instalación y espacios publicitarios. |
| `brand.svg`, `favicon*`, `icon-*`, `apple-touch-icon.png` | La identidad verde actual, en los formatos que necesita cada navegador. |
| `manifest.json`, `robots.txt`, `sitemap.xml`, `CNAME` | Instalación, indexación y dominio. |
| `admin/` | Consultas del propietario y herramientas de construcción; excluidas de la web publicada. |
| `tests/` | Pruebas automáticas y verificaciones de permisos; excluidas de la publicación. |
| `.github/workflows/` | Ejecuta todas las pruebas y comprueba las huellas SRI en cada cambio. |
| `email-templates/` | Plantillas de los correos; excluidas de la publicación. |
| `vendor/` | Bibliotecas distribuidas con la web y sus licencias. |
| `*-schema.sql` | Esquemas versionados para mantenimiento; excluidos de la publicación. |

La rama de trabajo y publicación es `main`. No se mantienen ramas ni carpetas de copia de la aplicación antigua. Git conserva el historial normal de cambios, que no forma parte de la web servida. `.gitignore` evita incorporar dependencias, secretos y archivos de copia.

## Desarrollo local

Node.js 22. Instalar dependencias con `npm ci`; ejecutar `npm test`. Después de modificar cualquier script, ejecutar `node admin/build-ad-csp.cjs` para actualizar sus huellas SRI y la CSP, y subir el número `?v=` de los archivos cambiados para que los navegadores no usen la copia antigua. `npm run build:auth` reconstruye el cliente de Supabase. Servir la raíz con un servidor HTTP local. Las claves publicables están en `auth-config.js`; los secretos SMTP, OAuth y CAPTCHA pertenecen a los paneles de los proveedores y nunca al repositorio.

Los esquemas SQL y las consultas administrativas están versionados para revisión; no se ejecutan automáticamente al publicar. `_config.yml` excluye código de desarrollo, consultas y plantillas del sitio servido por GitHub Pages. Las cabeceras de `_headers` solo se aplican en alojamientos compatibles; Pages usa las políticas CSP incluidas en el HTML y protección de interfaz contra marcos.

Después de los esquemas de autenticación y marketing, `marketing-profile-schema.sql` añade el perfil publicitario opcional (franja de edad, provincia y ciudad) y `save_marketing_choices`, una transacción con permisos del usuario y RLS. El historial registra el consentimiento de personalización sin guardar copias antiguas de edad o ciudad. Retirar ese permiso borra el perfil; los clientes de marketing v1 siguen siendo compatibles y no conceden personalización. Los scripts `tests/marketing-rls.sql` y `tests/marketing-profile-rls.sql` verifican permisos y borrado con usuarios ficticios en una transacción que se revierte. Las migraciones de esta actualización se aplicaron mediante Supabase MCP, con los nombres `optional_consented_marketing_profile` y `allow_admin_personalization_withdrawal`.

## Cálculos

Los formularios son cortos a propósito: se piden solo los datos que una persona conoce sin mirar varias nóminas. El motor está en `calculator-engine.js`, sin acceso al DOM, y usa las tablas de 2026 y las reglas de `calculation-rules.js`.

- **Nómina.** Categoría, jornada (completa: mes entero; parcial: con sus horas, en proporción), responsable de equipo (10 % del salario base), plus de servicio, antigüedad, horas (a mano o con el cuadrante), vacaciones, pagas prorrateadas e IRPF. En parcial, menos horas se pagan en proporción; las horas por encima son extra en jornada completa y complementarias en jornada parcial, con el mismo valor de hora del convenio. Las vacaciones cuentan como horas de jornada (horas de contrato ÷ 31 por día) y, si se indica, se añade la media de pluses habituales ÷ 31 por día.
- **Finiquito.** Vacaciones pendientes (salario mensual ÷ 30 por día, con cotización), parte pendiente de cada paga extra no prorrateada (se suponen cobradas el día 15 de marzo, julio y diciembre) e indemnización: fin de contrato temporal 12 días por año (tributa en IRPF), despido objetivo 20 días (máx. 12 meses) e improcedente 33 días (45 antes del 12/02/2012, con sus topes), exentas. No incluye el sueldo de los días del último mes.
- **Baja (IT).** La base del mes anterior es opcional; sin ella se usa la base mínima del convenio con la prorrata de pagas. Tramos del art. 51: 1.ª baja del año 50 % días 1–3; 1.ª y 2.ª 80 % días 4–20 (desde la 3.ª, 60 %); después 100 % hasta el día 40, 90 % hasta el 60, 80 % hasta el 90 (hasta el 100 en la 1.ª baja) y 75 % en adelante. Hospitalización: 100 % los primeros 40 días. Accidente laboral: el primer día va en nómina y después el mayor entre el 75 % de la base y el salario de tablas.

`tests/calculator-engine.test.cjs` y `tests/rules.test.cjs` se ejecutan con Node sin dependencias. El resto de pruebas usa `jsdom` y `jspdf` (`npm ci`).

## Cuentas, guías y publicidad

El registro (correo o Google) incluye en el mismo paso las casillas opcionales de publicidad y la provincia. Con correo, la elección viaja en los metadatos de la cuenta (`nv_signup`) y se aplica, junto con la aceptación de las condiciones, al confirmar la dirección; después se borra. Con Google, se elige en el último paso de activación. Las cuentas antiguas sin elección ven una única ventana opcional. El marcado de los diálogos está en `auth-ui.js`, compartido por todas las páginas con cuenta.

Las guías del sector (convenio, derechos, cómo leer la nómina y preguntas frecuentes) muestran el principio a todo el mundo y el resto a las personas registradas (`guide-gate.js`). El texto completo sigue en el HTML y está marcado como contenido de acceso restringido en los datos estructurados (`isAccessibleForFree: false` sobre `.guide-locked`), como indica Google para no perder posicionamiento. No es una barrera de seguridad.

## Iconos y actualizaciones

`brand.svg` es el dibujo maestro del escudo verde. Las imágenes PNG de 32, 180, 192 y 512 píxeles son versiones de ese mismo dibujo; las versiones para iOS y Android adaptable tienen fondo opaco. No son copias del logotipo anterior.

- Google dispone de `/favicon.png` (192 × 192), con una URL estable y enlazada desde todas las páginas.
- `/favicon.ico` contiene el mismo logo en 32 y 192 píxeles para navegadores que buscan la ruta convencional. Se reconstruye con `npm run build:favicon`, sin instalar herramientas adicionales.
- El manifiesto enlaza las imágenes Android de 192 y 512 píxeles y la variante adaptable. iOS utiliza `apple-touch-icon.png` (180 × 180).
- Se mantienen `manifest.json`, `id`, `start_url` y las rutas de imágenes existentes. Cambiarlas o borrarlas puede perjudicar la actualización de accesos instalados. Esas rutas sirven el logo nuevo, también sin parámetros de versión.

La web no puede sustituir directamente la imagen guardada por el sistema de un visitante. Google vuelve a rastrear y procesar el favicon a su ritmo; una solicitud en Search Console no garantiza una fecha. Chrome en Android puede actualizar una instalación WebAPK al detectar cambios en el manifiesto; un acceso directo o una instalación de otro navegador puede comportarse de otra manera. No se deben borrar datos o desinstalar para forzar una actualización desde el código.

Referencias: [Favicon en Google Search](https://developers.google.com/search/docs/appearance/favicon-in-search), [actualización de manifiestos en Chrome](https://web.dev/articles/manifest-updates).
