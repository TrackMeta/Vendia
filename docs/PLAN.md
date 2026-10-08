# Vendia — Plan de arquitectura y Fase 1

> Estado: **aprobado. Fase 1 en curso.** Fecha: 2026-10-07.
>
> **Enfoque acordado:** primero la **landing page** (imágenes + botones + botón fijo + formulario emergente) y que todo el flujo alrededor funcione perfecto: pedido, ubigeo, atribución, estados y seguridad. La **product page** queda para después (sección 8).

---

## 0. Lo que entendí

Vendia **no** es un Shopify. Es una herramienta enfocada en **un solo flujo**: el del vendedor peruano que usa Meta Ads, una landing y un formulario contraentrega (COD).

```
Meta Ads → Landing → Formulario COD → Pedido (+ atribución) → Confirmación
→ Envío → Entrega/Cobro → VENTA REAL → CPA real → Utilidad real
```

La idea central es que **un pedido no es una venta**. En COD en Perú una parte de los pedidos se cae (no contestan, cancelan, no reciben). Por eso las métricas que usan casi todos los vendedores, "CPA por formulario" y "ROAS de Meta", engañan.

Vendia tiene que responder dos preguntas:

- **¿Cuánto me cuesta en publicidad cada venta realmente cobrada?**
- **¿Qué campaña, producto y distrito me dejan plata de verdad?**

Para lograrlo tienen que estar bien desde el día 1:

1. **Captura de atribución** (UTM, fbclid, IDs de campaña, conjunto y anuncio) en cada pedido.
2. **Estados del pedido** con fecha de cada hito.
3. **Costos guardados en el pedido**: precio, costo del producto y costo de envío.
4. **Ubicaciones completas del Perú** con códigos oficiales.

Si estos datos no se guardan desde el inicio, se pierden para siempre. Por eso la atribución se **captura** en la Fase 1, aunque Meta se conecte en la Fase 2.

---

## 1. Resultados de la investigación (lo que cambia el plan)

### 1.1 Releasit: no tiene API ⚠️

Releasit vive en **releas.it**; releasit.com es otra empresa sin relación.

Lo que confirmé en sus fuentes oficiales:

- Es una **app de Shopify** ("Releasit COD Form & Upsells"). Hay una versión para Tiendanube, pero no está disponible en Perú.
- Es solo un **formulario COD con upsells**, que guarda los pedidos dentro de Shopify.
- **No** es una empresa de logística ni un courier.
- **No tiene API pública**: no hay endpoints, ni autenticación, ni forma de crear pedidos desde fuera de Shopify.
- **No tiene webhooks** documentados.
- Sus integraciones son Google Sheets (solo envía, en una dirección), Klaviyo, Omnisend, xConnector y ShippyPro. No integra couriers peruanos.

**Conclusión:** no se puede integrar Releasit con Vendia sin pasar por una tienda Shopify, y eso va contra la idea del producto. Tampoco hace falta: lo que Releasit aporta (formulario COD, upsell, verificación) **lo construye Vendia directamente**.

**Propuesta para la "Fase 3":**

- Se reemplaza por **Confirmación + Logística propias**: una bandeja de pedidos por confirmar con botón de WhatsApp y mensaje prellenado, más cambio de estados.
- Se deja lista la interfaz `OrderIntegration` con adaptadores de courier: Shalom, Olva, 99minutos, Dropi…
- Ninguno de estos couriers publica una API documentada. 99minutos aparentemente tiene una, pero no está verificada. Hay que pedírsela a cada uno.
- Mientras tanto, el primer "adaptador" será una **exportación Excel/CSV** en el formato de cada courier.

### 1.2 Meta Pixel + Conversions API (documentación oficial, Graph API v26.0)

- **Endpoint:** `POST https://graph.facebook.com/v26.0/{PIXEL_ID}/events`, con un token por tienda **solo en el servidor**.
- **Antigüedad máxima:** `event_time` puede tener como máximo **7 días**.
  - Por eso el Purchase se envía **en el momento en que el pedido pasa a Entregado**, con `event_time` = hora de la entrega, no la del pedido.
- **Datos guardados al crear el pedido:** `fbc`, `fbp`, IP, user agent, teléfono y nombre.
  - Con ellos se envía días después un Purchase con buena coincidencia.
  - El `fbc` se construye a partir del fbclid como `fb.1.<ms>.<fbclid>`.
- **Hashing SHA-256:**
  - Se hashean teléfono (formato `51XXXXXXXXX`), nombre, apellido, ciudad, departamento y país (`pe`).
  - **No** se hashean IP, user agent, fbc ni fbp.
- **Deduplicación:** mismo `event_id` + mismo `event_name` dentro de 48 h.
  - Se usa para **Lead** (navegador + servidor).
  - **Purchase** sale solo desde el servidor, con `event_id = purchase_<orderId>`, y nunca dos veces.
- **El caso COD no está documentado por Meta.** Propuesta:
  - `action_source = website` para el Purchase de entrega, porque el pedido nació en la web.
  - El evento que dispara el Purchase será **configurable** por tienda; por defecto, Entregado.
  - Lo validaremos con *Test Events*.
- **Advertencia de negocio:** Meta necesita volumen para optimizar (alrededor de 50 eventos por semana por conjunto).
  - Al inicio, lo realista es **optimizar campañas por Lead (pedido)** y **medir la rentabilidad con Purchase (entregado)**.
  - Ambos eventos se enviarán.
- **Token del vendedor:** se genera en Events Manager → Pixel → Configuración → Conversions API → "Generar token de acceso". Vendia lo guarda **cifrado**.

### 1.3 Ubicaciones del Perú

- **Fuente oficial:** el dataset del **INEI** "Ubigeos" en datosabiertos.gob.pe (licencia ODbL).
  - Trae **25 departamentos** (24 más Callao), **196 provincias** y **1,891 distritos**.
- **Distritos nuevos que no están en ese archivo:**
  - **Santa Rosa de Loreto** (Ley 32403, 2025).
  - **Sangani**, en Junín (Ley 32729, julio 2026).
  - Se agregan a mano marcados como *provisionales* hasta que el INEI publique sus códigos. Total esperado: **1,893**.
- **Código principal:** el ubigeo **INEI** de 6 dígitos (departamento + provincia + distrito).
  - El código **RENIEC**, el del DNI, es distinto y se guarda en una columna aparte.
- **Validación automática del seed:**
  - Conteos exactos.
  - Ningún código repetido.
  - Cada distrito pertenece a una provincia existente.
  - Cada provincia pertenece a un departamento existente.

---

## 1.4 Referencia de landing aprobada por el dueño

La referencia es multishop.com.pe/products/biocapilar-pro-90-capsulas, revisada en modo celular. Es el estilo típico de COD en Perú.

**Cuerpo de la página:**

- **Imágenes verticales apiladas:** casi todo el cuerpo son imágenes largas diseñadas fuera, en Canva o con IA, una debajo de otra, a todo el ancho y sin espacios.
  - El bloque más importante del constructor es **"Imagen / Sección de imágenes"**.
  - Las imágenes deben cargar muy rápido: WebP, carga diferida y tamaños por pantalla.
- **Botón "Realiza tu pedido" fijo abajo**, visible siempre mientras se hace scroll, con un subtítulo ("Envío gratis a todo el Perú").
- **Barra de anuncio animada** (marquee) que repite un texto.
- **Carrusel de imágenes** (slider).
- **Testimonios estilo comentario** con nombre, tiempo y texto, en carrusel.

**El formulario:**

- **Aparece en una ventana emergente** que se abre desde cualquier botón de la página.
- **Ofertas por cantidad dentro del formulario:**
  - Plan Esencial: 1 unidad, S/ 89.90.
  - Plan Capilar: 2 unidades, S/ 129.90, con la etiqueta "Lo más vendido".
  - Plan Completo: 3 unidades, S/ 169.80.
  - Cada oferta tiene su imagen y su precio tachado.
- **Campos:**
  - Nombre completo.
  - Celular (WhatsApp).
  - Provincia y distrito.
  - Dirección.
  - Referencia.
- **Resumen:** subtotal, envío y total.
- **Imagen de confianza** dentro del formulario ("Registro sanitario").

**Resumen en una frase:** en Perú, a este formato de página (imágenes + botones) se le llama **landing page**. La landing de Vendia tiene **dos partes y las dos se arman con bloques**:

| Parte | Bloques |
|---|---|
| **Página** | Imágenes una debajo de otra, botones entre ellas y **un botón que sigue al cliente** abajo mientras desliza. Todos los botones abren el formulario |
| **Formulario** (ventana emergente) | **Imágenes en cualquier posición** (arriba, en medio, abajo), selector de ofertas, campos del cliente, resumen (subtotal + envío = total) y botón "Confirmar pedido" |

**Esqueleto (inspeccionado en el código de la página):**

- Página sin menú ni footer, para no distraer.
- Patrón repetido: **imagen(es) → botón "Realiza tu pedido" → imagen(es) → botón…**
- Orden completo:
  1. Hero.
  2. Botón.
  3. Imagen.
  4. Carrusel.
  5. Botón.
  6. Imagen y otra imagen.
  7. Botón.
  8. Imagen y otra imagen.
  9. Botón.
  10. Testimonios estilo comentario.
  11. Reseñas con estrellas.
- Además: botón fijo inferior y formulario emergente.

**Apps de Shopify que usa:** el formulario es **EasySell COD Form**, no Releasit, y las reseñas son **Trustoo**. Vendia reemplaza las dos de forma nativa.

**Plantilla:** Vendia trae este esqueleto como **plantilla "Landing COD clásica"**. El vendedor solo sube sus imágenes y configura las ofertas.

**Cambios al plan por esta referencia (todo entra en la Fase 1):**

- Nueva tabla `product_offers`. El precio de cada oferta se valida **en el servidor**.
- Formulario COD configurable:
  - Modo **emergente** (por defecto) o **incrustado** en la página.
  - Se puede elegir qué campos mostrar, por ejemplo nombre completo en un campo o en dos.
- Bloques: imagen a todo el ancho, carrusel, marquee, botón fijo inferior, testimonios estilo comentario e imagen dentro del formulario.
- La ubicación sigue siendo departamento → provincia → distrito, porque en Perú hay provincias con el mismo nombre en distintos departamentos. Para que sea rápido, el selector permite **buscar el distrito escribiendo** ("San Juan de Lur…" → Lurigancho, Lima, Lima) y completa los tres niveles solo.

---

## 2. Arquitectura

### 2.1 Stack (se mantiene el que propusiste)

| Capa | Tecnología | Nota |
|---|---|---|
| App | **Next.js (App Router) + TypeScript + React** | Usa Server Actions y Route Handlers para la lógica de servidor |
| UI | **Tailwind + shadcn/ui** | Ordenar bloques con **dnd-kit** |
| Validación | **Zod** | Un mismo esquema valida en el formulario y en el servidor |
| BD / Auth / Storage | **Supabase** (Postgres, Auth, Storage) | **RLS en todas las tablas** |
| Hosting | **Vercel** | Conectado al repo de GitHub |
| Tests | **Vitest** (unidad + integración) y **Playwright** (más adelante) | |

No propongo cambiar ninguna tecnología.

### 2.2 Estructura de carpetas

```
src/
  app/
    (auth)/            login, registro, recuperar contraseña
    (dashboard)/       panel del vendedor (protegido)
    p/[store]/[slug]/  landing pública + formulario COD
    api/               endpoints públicos (crear pedido, webhooks)
    admin/             panel de administración de Vendia (fase posterior)
  modules/             lógica de negocio por dominio
    orders/            máquina de estados, creación de pedido
    metrics/           ÚNICO lugar donde se calculan CPA/ROAS/utilidad
    landing/           esquema de bloques + renderizado
    attribution/       captura de UTM/fbclid/fbc/fbp
    integrations/      interfaz OrderIntegration + adaptadores
    meta/              Pixel + CAPI (fase 2)
    ubigeo/
  lib/supabase/        clientes (navegador, servidor, admin)
supabase/
  migrations/          SQL versionado (tablas, RLS, funciones)
  seed/                ubigeo INEI
```

### 2.3 URL de las landings

- `vendia.../p/{tienda}/{producto}`, por ejemplo `/p/mitienda/faja-reductora`.
- Lleva el nombre de la tienda porque dos tiendas pueden vender un producto con el mismo nombre.
- Cuando existan **dominios propios** (fase futura), la misma landing responderá en `mitienda.com/p/faja-reductora`.

---

## 3. Multi-tenant y seguridad

- Toda tabla de negocio tiene `store_id uuid not null` con **FK** e **índice**.
- **RLS** en todas las tablas, con una función `is_store_member(store_id)`.
  - Un usuario solo ve filas de las tiendas donde es miembro.
  - Aunque hoy sea "1 usuario = 1 tienda", la tabla `store_members` deja listo el trabajo en equipo (confirmadores, por ejemplo).
- **El formulario público no escribe directo en la base de datos.** Llama a `POST /api/orders`, que:
  1. Valida con Zod.
  2. Calcula el precio **desde la base de datos**. El precio que manda el navegador se ignora.
  3. Valida que la combinación departamento/provincia/distrito exista.
  4. Aplica antispam: campo trampa (*honeypot*) y límite de pedidos por IP y por teléfono.
  5. Aplica **idempotencia** (`idempotency_key`): si el cliente presiona dos veces, se crea un solo pedido.
  6. Marca como "posible duplicado" un pedido del mismo teléfono y producto dentro de 30 min. No lo bloquea.
- **Estados:** solo cambian mediante una función que valida la transición. El frontend no puede saltarse estados.
- **Secretos** (token de Meta, claves de couriers): cifrados con AES-256-GCM y una clave en las variables de entorno de Vercel. Nunca llegan al navegador.
- La `service_role key` de Supabase solo existe en el servidor.

---

## 4. Esquema de base de datos

**Dinero:** se guarda como `numeric(12,2)` en PEN.

**Snapshots:** al crear el pedido se copian el precio, el costo y la ubicación. Si mañana cambias el costo del producto, la utilidad de los pedidos pasados no cambia.

### Fase 1

| Tabla | Campos clave |
|---|---|
| `profiles` | id (= auth.users), nombre |
| `stores` | id, owner_id, name, **slug único**, country `PE`, currency `PEN`, status (active/blocked) |
| `store_members` | store_id, user_id, role (owner/staff) |
| `store_settings` | store_id, logo, favicon, whatsapp, teléfono, email, dirección, **COD**: envío Lima, envío provincia, adelanto, métodos de pago, mensaje de confirmación, `purchase_trigger_status` (default `delivered`) |
| `products` | id, store_id, name, sku (único por tienda), description, price, compare_at_price, **cost**, stock, category, status |
| `product_images` | id, store_id, product_id, storage_path, position, is_primary |
| `product_offers` | id, store_id, product_id, name ("Plan Capilar"), **quantity**, **price**, compare_at_price, badge ("Lo más vendido"), image, position, is_default |
| `landing_pages` | id, store_id, product_id, slug (único por tienda), title, **content (borrador, jsonb)**, **published_content (jsonb)**, settings, status, published_at. `content` = `{ page_blocks: [...], form_blocks: [...], sticky_button: {...} }` |
| `ubigeo_departments` | code `char(2)` PK, name |
| `ubigeo_provinces` | code `char(4)` PK, department_code FK, name |
| `ubigeo_districts` | code `char(6)` PK, province_code FK, name, reniec_code, is_provisional |
| `customers` | id, store_id, nombre, apellido, **phone normalizado (único por tienda)**, whatsapp, dni, última dirección/ubigeo |
| `orders` | ver detalle abajo |
| `order_items` | order_id, store_id, product_id, offer_id, **product_name, offer_name, quantity, line_price, unit_cost (snapshot)** |
| `order_status_history` | order_id, store_id, from_status, to_status, changed_by, source (manual/integración/sistema), created_at |
| `order_attribution` | order_id, store_id, utm_source/medium/campaign/content/term, **fbclid, fbc, fbp**, campaign_id, adset_id, ad_id, landing_page_id, referrer, client_ip, user_agent |
| `platform_admins` | user_id (para el panel admin futuro) |

**Sobre los borradores de landing:** guardar `blocks` (borrador) separado de `published_blocks` permite editar una landing **sin romper la que está recibiendo tráfico pagado**.

**`orders`:**

- **Identificación:**
  - `id`
  - `store_id`
  - `order_number` (correlativo por tienda: #1001, #1002…)
  - `customer_id`
  - `landing_page_id`
  - `status`
- **Montos:**
  - `subtotal`
  - `shipping_charged` (lo que paga el cliente)
  - `total`
  - `advance_amount`
  - `balance_due`
- **Costos (snapshot):**
  - `product_cost_total`
  - `shipping_cost` (lo que **tú** pagas al courier; se puede editar después)
- **Ubicación (snapshot):**
  - `department_code`, `department_name`
  - `province_code`, `province_name`
  - `district_code`, `district_name`
  - `address`, `reference`
- **Entrega y control:**
  - `delivery_method`
  - `notes`
  - `idempotency_key`
  - `is_possible_duplicate`
- **Fechas de cada hito:**
  - `created_at`
  - `confirmed_at`
  - `shipped_at`
  - `delivered_at`
  - `collected_at`
  - `cancelled_at`
  - `failed_at`
  - `returned_at`

### Fases siguientes (se dejan diseñadas, no se crean aún)

| Tabla | Fase | Para qué |
|---|---|---|
| `store_meta_settings` | 2 | pixel_id, token CAPI cifrado, test_event_code |
| `marketing_events` | 2 | Bandeja de salida de eventos CAPI: event_name, **event_id único**, order_id, estado, intentos, respuesta de Meta |
| `page_events` | 2/4 | Visitas, ViewContent e InitiateCheckout propios para el funnel (no dependemos de Meta para contar) |
| `campaigns` | 2/4 | platform, external_id, name. Se crean solas a partir de los `campaign_id` de los pedidos |
| `integrations`, `integration_logs` | 3 | Conexión con couriers y log de cada llamada |
| `webhook_events` | 3 | provider, external_event_id **único** (idempotencia), firma válida, payload, processed_at |
| `expenses` | 5 | fecha, categoría (enum con tus 12), descripción, monto, moneda, campaign_id?, product_id? |

---

## 5. Estados del pedido

```
Nuevo → Por confirmar → Confirmado → Preparando → Enviado → En reparto → Entregado → Cobrado
  │           │              │            │            │          │
  └───────────┴──────────────┴────────────┘            └──────────┴──→ No entregado → Devuelto
              ↓
          Cancelado
```

- **Cancelado:** solo antes de salir (Nuevo → Preparando).
- **No entregado / Devuelto:** solo después de salir (Enviado / En reparto).
- **Cada cambio** se valida en la base de datos, queda en `order_status_history` y llena la fecha del hito.
- **Conteo por hitos:** un pedido "Entregado" también cuenta como confirmado y enviado. Las métricas usan las **fechas de los hitos**, no solo el estado actual.
- **"Venta real"** = Entregado (configurable a Cobrado).
  - **Cobrado** significa que el courier ya te liquidó el dinero.
  - Por defecto, el Purchase de Meta sale con **Entregado**.

---

## 6. Atribución

**Plantilla de URL** que el vendedor pega en Meta Ads. Vendia se la genera lista para copiar:

```
?utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}
&utm_term={{adset.name}}&campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}
```

**Captura en la landing:**

1. Se leen los parámetros de la URL, `fbclid` y las cookies `_fbc`/`_fbp`.
2. Se guardan en una cookie propia de primera parte durante 7 días.
3. Así no se pierden si el cliente navega o vuelve más tarde.

**Uso:**

- Al crear el pedido, todo se guarda en `order_attribution`.
- Con el `campaign_id` se arma la cadena **Campaña → Landing → Producto → Pedido → Estado → Dinero**.
- Si un pedido llega sin datos de anuncio, se clasifica como "Orgánico / Directo".

---

## 7. Métricas (un solo módulo, `modules/metrics`)

**Fórmulas:** todas viven en **un solo lugar**, como funciones puras con tests, más una función SQL `get_store_metrics(store_id, desde, hasta, filtros)` que devuelve los conteos. Ninguna página calcula por su cuenta.

**Cohortes:** los pedidos se agrupan por **fecha de creación** del pedido. El gasto de esos días se compara con lo que esos pedidos lograron después.

**Pedidos en curso:** se muestra aparte cuántos siguen "en tránsito", porque los pedidos recientes aún no se entregaron y el CPA entregado se ve peor de lo que será.

| Métrica | Fórmula |
|---|---|
| CPA pedido | gasto_ads / pedidos |
| CPA confirmado | gasto_ads / pedidos que llegaron a confirmado |
| CPA enviado | gasto_ads / pedidos que llegaron a enviado |
| **CPA entregado** ⭐ | gasto_ads / pedidos entregados |
| ROAS (pedidos) | valor total de pedidos / gasto_ads |
| **ROAS real** ⭐ | revenue cobrado / gasto_ads |
| Revenue | Σ total de pedidos entregados |
| Costo producto | Σ product_cost_total de entregados |
| Envíos | Σ shipping_cost de **todos los enviados**, incluso los no entregados y devueltos, porque ese costo también se paga |
| **Utilidad real** ⭐ | revenue − costo producto − envíos − gasto_ads − otros gastos |
| Margen | utilidad / revenue |
| Tasa de entrega | entregados / enviados |

Si un divisor es 0, se muestra "—", nunca infinito ni un error.

---

## 8. Fases

| Fase | Contenido |
|---|---|
| **1 — MVP** | Auth, tienda, dashboard, productos + imágenes, constructor de landing, landing pública, formulario COD, ubigeo completo, pedidos + estados, clientes, configuración COD, RLS, **captura de atribución** |
| **2 — Meta** | Pixel por tienda (PageView, ViewContent, InitiateCheckout, Lead), CAPI desde el servidor con deduplicación, Purchase configurable al entregar, bandeja de eventos con reintentos |
| **3 — Logística** | En lugar de Releasit: bandeja de confirmación con WhatsApp, interfaz `OrderIntegration`, exportación a courier (Excel), infraestructura de webhooks |
| **4 — Analítica** | Funnel, CPA/ROAS por campaña, producto y ubigeo |
| **5 — Gastos** | Módulo de gastos, utilidad y margen. Más adelante, importar el gasto desde la API de Meta |
| Luego | **Product page** (página de producto clásica de tienda; referencia: bioyet.com/products/derman-crema-intima-candidiasis-y-balanitis-30ml-picazon), panel admin, dominios propios, upsells, más couriers, WhatsApp API |

**Recomendación:** pasar **Gastos (5) antes que Analítica (4)**. Sin el gasto cargado, el CPA y el ROAS no se pueden calcular.

---

## 9. Plan detallado de la Fase 1

Cada paso termina con lint + tests + build y un **commit en GitHub**.

Estado: ✅ hecho · 🔄 en curso · ⬜ pendiente

| # | Estado | Paso | Resultado |
|---|---|---|---|
| 0 | 🔄 | **Preparar entorno** | ✅ Git + GitHub conectados. ✅ Node.js 24 LTS instalado. ⬜ `.env.local` con las claves de Supabase (las pegas tú). ⬜ Vincular la CLI de Supabase |
| 1 | ⬜ | **Esqueleto del proyecto** | Next.js + TS + Tailwind + shadcn + ESLint + Vitest + carpetas |
| 2 | ⬜ | **Base de datos** | Migraciones de las tablas de la Fase 1, constraints, índices, **RLS**, función de transición de estados |
| 3 | ⬜ | **Ubigeo** | Seed INEI (1,891) + 2 distritos provisionales + test de conteos e integridad |
| 4 | ⬜ | **Autenticación** | Registro → creación de la tienda (onboarding), login, logout, recuperar contraseña, middleware que protege rutas |
| 5 | ⬜ | **Dashboard base** | Sidebar con las 10 secciones (las de fases futuras dicen "Próximamente"), métricas básicas de pedidos y filtros de fecha |
| 6 | ⬜ | **Productos** | CRUD; imágenes con drag & drop, preview, principal, orden y borrado; compresión a WebP de 1600 px antes de subir |
| 6b | ⬜ | **Ofertas por cantidad** | Paquetes por producto (1, 2, 3 unidades) con precio, precio tachado, etiqueta e imagen |
| 7 | ⬜ | **Constructor de landing** | Dos pestañas: **Página** y **Formulario**, ambas con bloques. Página: **imagen a todo el ancho**, botón, carrusel, marquee, testimonios y los demás del documento, más el **botón fijo**. Formulario: **imagen**, ofertas, campos, resumen y botón confirmar; agregar/eliminar/duplicar/ordenar/editar, colores y tipografía, vista previa móvil, guardar borrador y publicar |
| 8 | ⬜ | **Landing pública + formulario COD** | Renderizado rápido (SSR + caché), mobile-first, Open Graph; formulario **emergente o incrustado** con selector de ofertas; ubigeo con búsqueda de distrito; cálculo de total, adelanto y saldo; captura de atribución; página de gracias |
| 9 | ⬜ | **Pedidos y clientes** | Tabla con filtros, detalle, cambio de estado con historial, marca de duplicados, CRM básico con historial del cliente |
| 10 | ⬜ | **Configuración** | Datos de la tienda y configuración COD |
| 11 | ⬜ | **Cierre** | Tests de RLS (un usuario no ve otra tienda), creación de pedido, idempotencia, precios manipulados, ubigeo inválido; build; despliegue en Vercel |

**Tests de la Fase 1:**

- Aislamiento entre tiendas (RLS).
- Pedido válido.
- Pedido con precio manipulado: se ignora el precio del navegador.
- Doble envío del formulario: crea un solo pedido.
- Ubigeo inválido: se rechaza.
- Transiciones de estado válidas e inválidas.
- Funciones de métricas con los ejemplos de tu documento, por ejemplo S/100 / 9 entregados = S/11.11.

---

## 10. Decisiones

**Tomadas:**

- ✅ Stack: Next.js + TypeScript + Tailwind + shadcn/ui + Supabase + Vercel.
- ✅ Prioridad: landing page + flujo COD completo. La product page va después.
- ✅ Formulario: ventana emergente armada con bloques (imágenes, ofertas, campos, resumen, botón).
- ✅ Ubigeo: INEI como código principal.
- ✅ Purchase de Meta: al entregar (configurable). Lead: al enviar el formulario.

**Pendientes (no bloquean la Fase 1):**

1. **Releasit:** no tiene API. ¿Se reemplaza por confirmación y logística propias? Se define antes de la Fase 3.
2. **Courier principal** (Shalom, Olva, motorizados propios, otro): define el primer adaptador en la Fase 3.
3. **Supabase:** ¿el proyecto está vacío? Se usa como **desarrollo**; uno de **producción** se crea antes de lanzar.
4. **Dominio** (por ejemplo vendia.pe): necesario antes de lanzar, no para desarrollar.
