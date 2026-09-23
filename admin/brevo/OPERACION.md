# Brevo para Calculadora Vigilante

Configuración del 23/09/2026. Cuenta gratuita dedicada exclusivamente a la calculadora.

## Uso para Carlos

En Brevo, abre **Contactos → Listas**:

- **NV · Novedades de la calculadora**: quienes aceptan novedades, consejos y ofertas propias.
- **NV · Promociones de colaboradores**: quienes aceptan promociones de academias, material y otros colaboradores.

Una persona puede estar en ambas listas. No se deben sumar sus tamaños para contar personas distintas. Los nuevos permisos y retiradas de la web se sincronizan automáticamente; no hay que exportar todos los usuarios ni volver a importar CSV.

El remitente verificado es **Calculadora Vigilante <novedades@correo.calculadoravigilante.com>**. Las respuestas llegan a **badawolfprivado@gmail.com**. Los mensajes de acceso y recuperación siguen con Resend.

Hay dos plantillas inactivas: **Boletín** y **Bienvenida al boletín**. No existe una bienvenida automática ni una campaña programada. Registrarse en la calculadora no suscribe a nadie por sí solo.

Para una campaña: preparar el contenido, elegir la lista que corresponde, verificar que la sincronización esté al día y revisar la previsualización y la baja antes de autorizar el envío. El seguimiento de aperturas y clics de Brevo está pendiente de decisión y configuración para el primer envío; no se ha activado la opción anónima. No dar por desactivado el seguimiento individual por usar estas plantillas.

La edad y localidad permanecen en Supabase. Una campaña por zona necesita una selección actualizada en Supabase, con permiso de personalización, sin exportar esos atributos a Brevo. Las listas generales no son listas por provincia.

## Actualización y controles

- Función privada `brevo-marketing`; secretos exclusivamente en Supabase.
- Listas 3 y 4; cinco atributos `NV_*` de preferencias y constancia del permiso.
- Cron `brevo-preferences-sync`: revisa la cola cada minuto y procesa hasta cinco registros por invocación; solo llama a la función si hay trabajo. Puede tardar más durante una carga inicial o incidencia.
- Reconciliación diaria paginada de 100 cuentas por bloque. Los cambios nuevos se encolan mediante disparadores al guardarse.
- Webhook 2200899: bajas, quejas, rebotes permanentes y eliminación de contactos. Autenticación separada de la del actualizador.
- Las bajas generales retiran ambas categorías. Los rebotes y otros bloqueos técnicos impiden entregar, sin inventar que el usuario retiró su consentimiento.
- Los rechazos nunca exportados se resuelven solo en Supabase, sin consultar esas direcciones en Brevo.
- Una baja general en Brevo no se revierte automáticamente. Si alguien quiere volver a suscribirse, hay que revisar su solicitud verificada y el bloqueo antes de restablecer el envío.
- No hay una función de envío de campañas en esta integración.

## Revisar antes de enviar

Ejecutar `status.sql` como propietario en Supabase. Debe estar la cola al día, sin fallos ni trabajos retenidos pendientes. No enviar mientras haya solicitudes de baja o supresión sin resolver. Para una lista local, volver a comprobar también el permiso de personalización.

Un fallo incierto retiene el trabajo para evitar duplicar una operación o restaurar un permiso antiguo. No liberar un bloqueo solo porque haya vencido: verificar que la ejecución haya terminado y comprobar el estado actual de Brevo. `last_result` del planificador y los códigos seguros del worker ayudan a diagnosticarlo, sin mostrar direcciones ni claves.

La eliminación completa en Brevo se tramita administrativamente: suprimir envíos no equivale a borrar el contacto. Tras verificar una solicitud de supresión, completar la retirada en ambos proveedores y revisar la conservación mínima necesaria para evitar reimportaciones. No conservar perfiles demográficos en Brevo.

La clave creada caduca el 23/09/2027; Brevo indica también caducidad tras 90 días sin uso. Si caduca o se revoca, reemplazar `BREVO_API_KEY` en los secretos de Supabase. Nunca pegarla en GitHub, HTML ni mensajes.

## Verificaciones y límites

53 pruebas de adaptador/worker y 65 comprobaciones locales de base de datos. Comprobados en producción: controles de acceso, función autenticada, contacto sintético en Brevo con retirada y borrado de atributos, recepción de una notificación de contacto desconocido sin modificar datos y sincronización real de los permisos vigentes.

No se ha enviado un correo de prueba ni una campaña. La sustitución final del enlace de baja en un correo entregado sigue pendiente de una prueba autorizada antes del primer envío. Tampoco se ha realizado una prueba de retirada completa con una cuenta técnica en Auth de producción: la revisión automática rechazó su creación directa. Las pruebas de retirada de consentimientos se ejecutaron en la base local desechable.

Los controles de seguridad de Supabase no detectan errores de base de datos. El aviso preexistente de protección contra contraseñas filtradas corresponde a una función de pago y no se ha contratado.
