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
