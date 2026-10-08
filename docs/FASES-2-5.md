# Fases 2 a 5 + Admin: reporte

> Fecha: 2026-10-08. Incluye Gastos, Meta (Pixel + Conversions API), Logística e integraciones, Analítica y Panel de administración.

## 1. Qué se implementó

### Gastos (`/dashboard/gastos`)

- **Registro manual** con fecha, categoría (las 12 de tu documento), descripción, monto en PEN, campaña opcional (ID y nombre) y producto opcional. Se puede editar y eliminar.
- **Importación del reporte de Meta Ads (CSV)** del Administrador de anuncios.
  - Lee encabezados en español e inglés, con desglose por día y campaña.
  - Vista previa antes de importar.
  - **Reimportar no duplica**, gracias a la clave `import_key`.
  - Se puede asignar el gasto importado a un producto.
- **Utilidad sin doble conteo:** el costo de producto y de envío se toma de cada pedido. Las categorías Producto, Courier y Envíos quedan como "referencia de caja" y no se restan otra vez.
- **El Inicio** ahora usa el gasto real: CPA pedido, confirmado y entregado; ROAS de pedidos y ROAS real; utilidad y margen.

### Meta (`/dashboard/marketing`)

- **Configuración por tienda:** Pixel ID, token de Conversions API y código de prueba.
  - El token se **cifra con AES-256-GCM** usando `APP_ENCRYPTION_KEY`.
  - La base de datos permite **escribirlo pero no leerlo** desde el cliente (privilegios por columna).
- **Pixel en la landing:**
  - **PageView** al cargar.
  - **ViewContent** al hacer scroll o a los 4 segundos.
  - **InitiateCheckout** al abrir el formulario.
  - **Lead** al enviar el pedido, con `eventID = lead_<pedido>`.
- **Conversions API (servidor), Graph API v26.0:**
  - **Lead** con el mismo `event_id` que el Pixel, para que Meta lo deduplique.
  - **Purchase solo cuando el pedido llega al estado de venta real** (por defecto Entregado), con `event_time` igual al momento de la entrega (Meta acepta hasta 7 días) y el valor real.
  - El Purchase se dispara desde el panel, desde los cambios en lote y desde los webhooks.
  - `user_data` va hasheado con SHA-256 según las reglas de Meta: teléfono 51…, nombre, apellido, ciudad, región, país `pe` y external_id. fbc, fbp, IP y user agent se envían sin hash.
- **Bandeja `marketing_events`:**
  - `event_id` único por tienda: **un mismo Purchase nunca se envía dos veces**.
  - Reintentos: botón en Marketing y tarea diaria en Vercel (`/api/cron/daily`).
- **Registro de los últimos 50 eventos**, botón de "evento de prueba" y plantilla de URL para anuncios, con `{{campaign.id}}`, `{{adset.id}}` y `{{ad.id}}`.

### Logística (`/dashboard/logistica`)

- **Por confirmar:**
  - Botón de WhatsApp con mensaje prellenado. Al usarlo, el pedido pasa a "Por confirmar".
  - Confirmar o Cancelar con un clic.
  - Acciones en lote.
- **Por despachar:** marcar Preparando o Enviado en lote, y **Excel/CSV para el courier**.
  - Columnas: pedido, cliente, celular, DNI, departamento, provincia, distrito, ubigeo, dirección, referencia, producto, cantidad, monto a cobrar, total y observaciones.
  - Protección contra fórmulas de Excel.
- **En camino:** En reparto, Entregado o No entregado, en lote.
- **En el detalle del pedido:** courier y código de seguimiento.

### Integraciones (`/dashboard/integraciones`)

- **Registro de proveedores con capacidades declaradas:**
  - Webhook genérico ✅.
  - Exportación CSV ✅.
  - Releasit, Shalom y Olva: **no disponibles**, con el motivo verificado. No se inventan APIs.
- **Webhook genérico** en `POST /api/webhooks/generic_webhook/{tienda}`:
  - Firma **HMAC-SHA256** con un secreto por tienda (cifrado, se muestra una sola vez y se puede rotar), comparada en tiempo constante.
  - **Idempotencia** por `event_id`.
  - Los estados se aceptan en español o inglés.
  - Se registra cada llamada en `integration_logs` y en `webhook_events`.
- **`apply_integration_status`** (solo servidor) busca el pedido por número o ID externo y no hace nada si ya está en ese estado.

### Analítica (`/dashboard/analitica`)

- **Funnel:**
  - Etapas: Visitas → Vieron el producto → Abrieron el formulario → Pedidos → Confirmados → Enviados → Entregados → Cobrados.
  - Muestra el % entre etapas y señala la mayor caída.
  - Las visitas son **visitantes únicos por sesión y día**, medidas por Vendia (no depende de Meta).
- **Campañas:** gasto (por campaign_id), pedidos, confirmados, entregados, tasa de entrega, revenue, CPA pedido, **CPA entregado**, ROAS real y utilidad.
- **Productos:** las mismas columnas, más visitas.
- **Geografía:** departamento → provincia → distrito, con navegación entre niveles. Muestra cancelados, no entregados, tasa de entrega, revenue y utilidad.
- **Todas las fórmulas salen de `src/modules/metrics`:** `computeRowMetrics` y `buildFunnel`.

### Panel admin (`/admin`)

- **Métricas de la plataforma:** usuarios, tiendas, landings, pedidos, revenue entregado, eventos de Meta fallidos y errores de integraciones.
- **Pestañas:**
  - Tiendas, con opción de **Bloquear o Reactivar**. Una tienda bloqueada deja de mostrar sus landings.
  - Usuarios.
  - Pedidos recientes.
  - Errores de Meta, integraciones y webhooks.
- **Acceso:** solo administradores (`platform_admins`), verificado **en la base de datos**. Se otorga con `npx tsx scripts/make-admin.ts correo`.

## 2. Tablas y funciones nuevas

- **Tablas:** `expenses`, `store_meta_settings`, `marketing_events`, `integrations`, `integration_logs`, `webhook_events`, `page_events`. Columnas nuevas en `orders`: courier, guía, ID externo, estado de integración.
- **Funciones:**
  - **Gastos:** `get_expense_totals`.
  - **Meta:** `meta_token_configured`, `get_public_landing` (ahora incluye el Pixel ID).
  - **Logística e integraciones:** `apply_integration_status`, `change_orders_status`.
  - **Analítica:** `track_landing_event`, `get_funnel`, `get_campaign_stats`, `get_product_stats`, `get_geo_stats`.
  - **Admin:** `admin_overview`, `admin_list_stores`, `admin_list_users`, `admin_recent_orders`, `admin_recent_errors`, `admin_set_store_status`.
- **Migraciones:** `0700` a `1100`. Para un proyecto existente: `supabase/actualizacion-fases-2-5.sql`.

## 3. Tests

| Suite | Resultado |
|---|---|
| Unitarios (`npm test`) | **73 / 73 ✅** |
| Integración con la base de datos (`npm run test:db`) | **34 / 34 ✅** (19 de la Fase 1 + 15 nuevos) |
| Validación SQL (`npx tsx scripts/validate-sql.ts`) | ✅ 11 migraciones + prueba de humo de todas las funciones |
| TypeScript, ESLint y build de producción | ✅ |
| Prueba manual en el navegador (versión de producción) | ✅ ver abajo |

**Tests nuevos contra la base de datos:**

- **Gastos:** totales sin doble conteo; aislamiento entre tiendas; reimportar el mismo reporte no duplica.
- **Meta:**
  - El token se puede escribir pero no leer.
  - La landing pública solo expone el Pixel ID.
  - Otra tienda no ve la configuración.
- **Conversions API** (con Meta simulado):
  - El Lead se envía una sola vez.
  - El Purchase no se envía antes de la entrega; al entregar se envía una sola vez.
  - `event_id` = `lead_<id>` / `purchase_<id>`; valor y moneda PEN; fbc sin hash y teléfono hasheado.
- **Analítica:** el registro de visitas es solo del servidor; las visitas repetidas no se duplican; funnel; campañas unidas con el gasto por campaign_id; productos; geografía; acceso denegado a otra tienda.
- **Logística:**
  - `apply_integration_status` solo lo usa el servidor y es idempotente, con guía y origen "integración".
  - Los cambios en lote respetan las reglas y la tienda.
  - Los secretos no se pueden leer.
- **Admin:** un vendedor no accede; un admin ve la plataforma y bloquea una tienda.

**Prueba manual** (`next start`, localhost):

1. Registrar un gasto de S/ 50 → el Inicio muestra CPA pedido S/ 50, ROAS 1.80x y utilidad −S/ 50.
2. Abrir la landing con `campaign_id` → el funnel cuenta 1 visita y 1 «vieron el producto».
3. Revisar Campañas, Geografía, Logística, Marketing e Integraciones.
4. Abrir `/admin` sin permiso → acceso denegado.
5. **Webhook real firmado** → 200 y el pedido #1001 pasa a Confirmado, con courier y guía.
6. El mismo webhook repetido → 200 «duplicate».
7. Firma falsa → 401.

**Bugs encontrados y corregidos:**

- Guardar la configuración de Meta con «upsert» necesitaba permiso de actualización sobre `store_id`, que se mantiene bloqueado a propósito. Ahora se hace insert o update explícito.

## 4. Decisiones técnicas

1. **Purchase = venta real.** Nunca se envía desde el navegador ni por llenar el formulario. Se dispara desde el servidor al alcanzar el estado configurado, y si el pedido termina en no entregado, devuelto o cancelado, no se envía.
2. **`action_source = website` para el Purchase de entrega**, porque el pedido nació en la landing. Meta no documenta el caso COD. Recomendación: optimizar las campañas por Lead al inicio y medir con Purchase.
3. **Deduplicación doble:**
   - Pixel y CAPI comparten el `event_id` (Meta deduplica en 48 h).
   - La base de datos impide registrar el mismo `event_id` dos veces.
4. **Secretos cifrados en la aplicación** (AES-256-GCM), con columnas que se pueden escribir pero no leer desde el cliente.
5. **Validación de SQL antes de aplicarlo:** `scripts/validate-sql.ts` ejecuta todas las migraciones en Postgres (PGlite) con una prueba de humo que llama a cada función.
6. **Cron diario** (compatible con el plan gratis de Vercel) más un botón de reintento manual.

## 5. Qué falta / siguientes pasos

- **Publicar en Vercel:** ver [DEPLOY.md](DEPLOY.md). Necesita tu cuenta de Vercel.
- **Importación automática del gasto** por la Marketing API de Meta: requiere crear una app de Meta y pasar su revisión.
- **APIs de couriers** (Shalom, Olva, 99minutos): solicitar acceso comercial. La arquitectura de adaptadores ya está lista.
- **Product page**, dominios propios, upsells y WhatsApp API: ver PLAN.md §8.

## 6. Optimización de imágenes (2026-10-08)

- **Ancho máximo 1080 px** (antes 1600) y peso objetivo de **~250 KB** por imagen normal. Las landings se ven a un máximo de 480 px de ancho, así que 1080 px alcanza para pantallas de alta densidad.
- **Corrección importante:** antes el límite se aplicaba al lado más largo, y las imágenes verticales altas (típicas de las landings COD) quedaban angostas y borrosas. Ahora se limita el **ancho** y se conserva la proporción. Las imágenes más altas reciben un peso proporcional, hasta 1 MB.
- **Verificado en el navegador:** un PNG de 1080×3240 y 5.00 MB quedó en un WebP de 341 KB, conservando la imagen vertical.
- **Efecto:** las landings cargan más rápido y el plan gratis de Supabase (10 GB al mes de transferencia) alcanza para aproximadamente el doble de visitas.
- Las imágenes que ya estaban subidas no cambian; la mejora aplica a las nuevas subidas.
