# Vendia: definición de producto

> Decisiones del dueño, 2026-10-08.

## Qué es
Plataforma para vendedores **contraentrega (COD)** que venden con **Meta Ads**: crean páginas de venta, reciben pedidos y ven su **utilidad real** (CPA por pedido entregado, no por formulario).

## Decisiones

| Tema | Decisión |
|---|---|
| **Usuarios** | Por ahora, uso propio del dueño y un par de usuarios más. Cada uno con su tienda y sus productos (multi-tienda). |
| **Modelo de negocio** | Vendia **todavía no cobra**: sin suscripciones ni pagos. |
| **Países** | **Solo Perú** por ahora, con la arquitectura preparada para sumar más países (moneda, ubicaciones, couriers e impuestos por país). |
| **Páginas de venta** | Por cada producto se puede crear la **landing page** (imágenes + botones + formulario emergente) y también una **product page** (página de producto estilo tienda), las que el usuario quiera. |

## Implicancias técnicas
- **Multi-país:** el país y la moneda viven en la tienda (`stores.country`, `stores.currency`). Ubigeo, couriers, formato de teléfono e impuestos deben pasar a ser módulos por país, no valores fijos de Perú.
- **Product page:** es un nuevo tipo de página por producto (galería, descripción, variantes u ofertas y el mismo formulario COD), que usa el mismo editor por bloques.
- **Sin cobro:** no hace falta módulo de suscripciones por ahora. El admin crea o habilita a los usuarios.

## CPA real y venta real (2026-10-08)

| Tema | Decisión |
|---|---|
| **Venta real** | Configurable por tienda, con dos opciones: **(A) Lima = Entregado · Provincia = Cobrado** (recomendada para COD con agencia en provincia), o **(B) Entregado en ambos**. "Lima" = Lima Metropolitana (1501) + Callao (0701). |
| **Moneda de la cuenta publicitaria** | Seleccionable por tienda: **PEN o USD**. Si es USD, el gasto se convierte a soles con el tipo de cambio del día del gasto. |
| **IGV sobre la publicidad** | **Opción seleccionable** por tienda: "sumar IGV (18 %) al gasto publicitario". |

**Reglas que se derivan:**
- La misma regla de venta real se usa en **todas** las métricas (revenue, CPA real, ROAS real, utilidad, funnel, tablas) y para enviar **Purchase a Meta**. Nunca dos definiciones distintas.
- **Tipo de cambio:** se guarda junto con cada gasto (para que los meses pasados no cambien), tomado del tipo de cambio oficial del día o ingresado a mano.
- El gasto se guarda en su moneda original y su equivalente en soles con IGV (si aplica), para poder auditarlo.

## Lectura de campañas (API de Marketing de Meta)

**Decisión (2026-10-08): opción B.** Cada usuario conecta su cuenta publicitaria con un **token de usuario del sistema** creado en su propio Business Manager, con permiso **solo de lectura** (`ads_read`) y sin caducidad. El dueño no tiene que administrar a nadie.

- Vendia guarda el token **cifrado** (igual que el de Conversions API) junto con el ID de la cuenta publicitaria (`act_…`).
- Al pegarlo, Vendia lo valida y muestra el nombre y la moneda de la cuenta.
- Sincronización diaria más un botón "Actualizar ahora": gasto, impresiones, alcance, frecuencia, CPM, clics, CTR, CPC, resultados y datos de los anuncios.
- Se puede pasar después a la opción C (app con revisión de Meta) sin cambiar el resto.

**Actualización (2026-10-08): token completo, opción 1.** El token del usuario del sistema tendrá `ads_read` + `ads_management` + `business_management`. Con él, Vendia:
1. Detecta las cuentas publicitarias y su moneda (PEN/USD).
2. Lista los Pixels existentes o crea uno nuevo.
3. Usa el mismo token para Conversions API.
4. Envía un evento de prueba.

Vendia **solo** usa la parte de escritura para crear y leer Pixels; **nunca** modifica campañas. El permiso exacto que necesita Conversions API con este token se confirmará con una prueba real.
