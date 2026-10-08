# Fase 1: reporte de cierre

> Fecha: 2026-10-08 · Estado: **completada y probada de punta a punta en local**.

## 1. Qué se implementó

| Área | Detalle |
|---|---|
| **Autenticación** | Registro, login, logout y recuperación de contraseña (enlace por correo → `/nueva-clave`). El proxy protege `/dashboard`, `/onboarding` y `/admin`. Después de registrarse, el usuario crea su tienda en `/onboarding`. |
| **Tienda** | Una por usuario. País Perú, moneda PEN. Enlace único (`/p/{tienda}/...`). |
| **Dashboard** | Menú lateral con 10 secciones, adaptado a celular. **Inicio** con métricas de Ventas, Marketing y Rentabilidad, filtros Hoy / Ayer / 7 días / 30 días / Este mes / Mes anterior / Personalizado (hora de Lima) y últimos pedidos. |
| **Productos** | CRUD completo. Imágenes con arrastrar y soltar: compresión WebP en el navegador, orden, imagen principal y borrado. **Ofertas por cantidad** (1, 2, 3 unidades…) con precio, precio tachado, etiqueta e imagen. |
| **Landing builder** | Pestañas **Página / Formulario / Estilo**. 14 bloques de página (imagen, botón, carrusel, barra animada, título, texto, beneficios, imagen + texto, precio, contador, testimonios, FAQ, separador, formulario incrustado). **Botón fijo**. Formulario armado con bloques (imagen, texto, ofertas, datos del cliente, resumen, botón). Vista previa en celular donde tocar un bloque lo selecciona. Borrador separado de la versión publicada. Plantilla **«Landing COD clásica»**. Guardar con Ctrl + S. |
| **Landing pública** | `/p/{tienda}/{landing}`, mobile-first, caché de 5 minutos que se invalida al publicar, Open Graph, imagen principal precargada y página de gracias con botón de WhatsApp. |
| **Formulario COD** | Ventana emergente o incrustado. Ofertas seleccionables. **Búsqueda de distrito** que llena departamento, provincia y distrito, más 3 selects dependientes. Resumen con subtotal, envío, total, adelanto y saldo. Campo trampa anti-bots. Clave de idempotencia. |
| **Ubigeo** | INEI oficial: **25 departamentos, 196 provincias, 1,891 distritos**, más 2 provisionales (Santa Rosa de Loreto, Sangani). |
| **Pedidos** | Lista con filtros por estado, búsqueda y paginación. Detalle con cambio de estado según la máquina de estados, notas, WhatsApp con mensaje de confirmación prellenado, costo de envío editable, origen del pedido e historial. |
| **Clientes** | CRM básico: pedidos, entregados, cancelados, no entregados, revenue y marca de «Recurrente». |
| **Configuración** | Datos de la tienda, logo y favicon, envío Lima/Callao vs. provincias, adelanto, métodos de pago, mensaje de confirmación y **estado que cuenta como venta real** (por defecto Entregado). |
| **Atribución** | Desde el primer pedido se guardan UTM, fbclid, `_fbc`/`_fbp`, campaign_id, adset_id, ad_id, landing, referrer, IP y user agent. Una cookie propia los conserva 7 días. |
| **Métricas** | Un único módulo (`src/modules/metrics`): CPA pedido, confirmado, enviado y entregado; ROAS de pedidos y ROAS real; utilidad; margen; tasas. |

## 2. Archivos principales

```
supabase/migrations/   6 migraciones (esquema, RLS, funciones, storage, ubigeo, vista de clientes)
supabase/setup-completo.sql   las 6 migraciones juntas (para pegar en el SQL Editor)
data/ubigeo/           CSV oficial del INEI + distritos provisionales + README de fuentes
scripts/               build-ubigeo-seed.ts, db-migrate.ts, create-test-user.ts
src/proxy.ts           sesión + protección de rutas
src/lib/               supabase (server/client/admin), auth, env, format, upload
src/modules/
  landing/             schema (Zod), defaults (plantilla), render (bloques, formulario COD, ubigeo), public-data
  orders/              state-machine, order-input (validación)
  metrics/             fórmulas centralizadas + rangos de fecha (Lima)
  attribution/         captura de UTM / fbclid / fbc
  ubigeo/              parser y nombres
  products/            validación
src/app/
  (auth)/              login, registro, recuperar, nueva-clave
  onboarding/          crear tienda
  dashboard/           inicio, pedidos, productos, landings (+ editor), clientes, configuración, y páginas de fases futuras
  p/[store]/[slug]/    landing pública + gracias
  api/orders/          crear pedido COD
tests/db/core.test.ts  tests de integración contra Supabase
```

## 3. Tablas creadas

`profiles`, `platform_admins`, `stores`, `store_members`, `store_settings`, `ubigeo_departments`, `ubigeo_provinces`, `ubigeo_districts`, `products`, `product_images`, `product_offers`, `landing_pages`, `customers`, `orders`, `order_items`, `order_status_history`, `order_attribution`, vista `customer_stats` y bucket de Storage `store-assets`.

**Funciones de base de datos:**

- **Acceso por tienda:** `is_store_member`, `create_store`.
- **Estados del pedido:** `order_transition_allowed`, `apply_order_status`, `change_order_status`.
- **Landings:** `publish_landing_page`, `unpublish_landing_page`, `get_public_landing`.
- **Pedidos y métricas:** `create_cod_order` (solo servidor), `get_order_stats`.

## 4. Tests ejecutados

| Suite | Resultado |
|---|---|
| Unitarios (`npm test`) | **48 / 48 ✅** |
| Integración con la base de datos (`npm run test:db`) | **19 / 19 ✅** |
| TypeScript (`npm run typecheck`) | ✅ sin errores |
| ESLint (`npm run lint`) | ✅ sin errores |
| Build de producción (`npm run build`) | ✅ 26 rutas |
| Prueba manual en el navegador | ✅ ver abajo |

**Tests unitarios:**

- **Métricas:** CPA pedido S/100/20 = S/5; CPA entregado S/100/9 = S/11.11; utilidad 7110 − 2700 − 900 − 1000 − 100 = 2410; ROAS real; campaña A vs. B; divisiones entre cero.
- **Estados del pedido:** transiciones válidas e inválidas.
- **Ubigeo:** conteos, sin duplicados, jerarquía, capitales terminadas en «01», Callao = 07 (INEI).
- **Validación del pedido:** se ignoran precios del navegador, celular, DNI, campo trampa anti-bots.
- **Atribución:** UTM, IDs de Meta, formato de fbc.
- **Landing:** plantilla válida, bloques obligatorios, colores, bloques desconocidos rechazados.
- **Fechas:** rangos en hora de Lima.

**Tests contra la base de datos real:**

- **Aislamiento entre tiendas (RLS):** una tienda no puede ver, crear, editar ni borrar productos de otra; un visitante anónimo no lee tablas de negocio; un usuario no puede crear pedidos directamente; no se puede crear una segunda tienda; otra tienda no puede publicar ni ver mis pedidos.
- **Pedidos:**
  - Precio, envío (Lima S/10 vs. provincia S/15), adelanto, saldo y costo calculados en el servidor.
  - Idempotencia: el mismo envío del formulario no duplica el pedido.
  - Se marca como posible duplicado el mismo celular y producto en 30 minutos.
  - Se rechazan distrito inexistente, oferta ajena y teléfono inválido.
- **Estados:**
  - El vendedor no puede cambiar el estado editando la tabla directamente.
  - Pasar a Entregado completa los hitos intermedios; Entregado → Cancelado se rechaza.
  - El historial queda registrado.
- **Métricas:** solo se cuenta revenue de pedidos entregados, y otra tienda no puede leer las estadísticas.

**Prueba manual de punta a punta** (navegador, localhost):

1. Login.
2. Crear tienda.
3. Crear producto.
4. Crear landing desde la plantilla.
5. Subir imagen.
6. Ver el formulario emergente en la vista previa.
7. Publicar.
8. Abrir la landing en modo celular con UTM y fbclid.
9. Buscar «san juan de lu» y elegir el distrito.
10. Confirmar el pedido.
11. Ver la página de gracias (#1001).
12. Ver el pedido en el panel con toda su atribución.
13. Pasarlo a «Por confirmar».

**Bugs encontrados y corregidos durante las pruebas:**

- Relaciones uno a uno que llegaban como lista.
- Función de tipografías importada desde un componente de cliente.
- Variable de la fuente del panel.
- Imágenes vacías visibles en la landing pública.
- Borrado en cascada bloqueado por reglas `restrict`.

## 5. Qué falta

- **Fase 2, Meta:**
  - Pixel por tienda: PageView, ViewContent, InitiateCheckout, Lead.
  - Conversions API desde el servidor con deduplicación.
  - Purchase al llegar al estado de venta real.
- **Gastos (recomendado antes de Analítica):** registro de gasto publicitario y otros gastos. Hoy el CPA y el ROAS se muestran «—» porque el gasto es 0.
- **Fase 3, Logística:** Releasit no tiene API (ver `PLAN.md` §1.1). Confirmación y logística propias, más exportación al courier.
- **Fase 4, Analítica:** funnel; tablas por campaña, producto y ubigeo.
- **Despliegue en Vercel** y proyecto de Supabase de producción.
- **Configurar en Supabase → Authentication → URL Configuration** el Site URL de producción y la URL de redirección `https://TU-DOMINIO/auth/callback`. Para local, `http://localhost:3000/auth/callback`.
- **Contraseña de la base de datos:** la de `SUPABASE_DB_URL` en `.env.local` no es correcta. No bloquea nada, porque las migraciones se pueden pegar en el SQL Editor, pero sirve para `npm run db:migrate`.

## 6. Cómo probarlo localmente

```bash
npm install
npm run dev
```

1. Abre http://localhost:3000.
2. **Usuario de prueba:** `npx tsx scripts/create-test-user.ts` crea uno con el correo ya confirmado. Las credenciales quedan en `.env.test.local`.
3. **Cuenta real:** puedes registrarte en `/registro`. Supabase envía un correo de confirmación.
4. **Tests:** `npm test` (unitarios) y `npm run test:db` (contra Supabase).
5. **Si se agregan migraciones nuevas:** pegarlas en Supabase → SQL Editor, o usar `npm run db:migrate` con una contraseña de base de datos válida.

## 7. Decisiones técnicas importantes

1. **Releasit reemplazado.** No tiene API pública y solo funciona dentro de Shopify o Tiendanube. Vendia hace su propio formulario COD y su propia confirmación.
2. **Pedidos solo por el servidor.** El formulario llama a `/api/orders`, que valida con Zod, aplica el límite anti-spam por IP y llama a `create_cod_order()`. Esa función calcula precio, envío, adelanto y ubicación **en la base de datos**, en una sola transacción.
3. **RLS en todas las tablas** y privilegios por columna:
   - El vendedor no puede cambiar el `status` de un pedido editando la tabla, solo con `change_order_status()`.
   - No puede publicar sin pasar por `publish_landing_page()`.
4. **Snapshots en el pedido:** precio, costo y ubicación se copian al pedido. Si cambias el costo mañana, la utilidad pasada no cambia.
5. **Métricas por cohorte:** se toman los pedidos creados en el rango y se mide lo que esos pedidos lograron después. Se muestran aparte los «En proceso» para no subestimar el CPA real.
6. **Ubigeo INEI**, no RENIEC, como código principal. Callao = 07.
7. **Hitos con fecha** (`confirmed_at`, `shipped_at`, `delivered_at`…). Un pedido Entregado también cuenta como confirmado y enviado.
8. **Next.js 16 sin Cache Components:** modelo clásico, más simple para un panel con sesión. La landing pública usa caché con etiqueta y se invalida al publicar.
9. **Imágenes comprimidas a WebP en el navegador** antes de subir. Así no se paga optimización en Vercel y las landings cargan rápido en celular.
