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
