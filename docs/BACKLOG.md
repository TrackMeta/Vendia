# Vendia: mejoras elegidas (pendientes)

> Elegidas por el dueño el 2026-10-08, a partir del análisis completo de la plataforma.
> Estado: **pendientes**. Decisiones de producto en [PRODUCTO.md](PRODUCTO.md).

## 🆕 Producto
- **Product page por producto** (además de la landing): ver [PRODUCTO.md](PRODUCTO.md).
- **Preparar multi-país**: moneda, ubicaciones, couriers y teléfono por país.

## 🔴 Crítico

### 1. Utilidad real sin inflar
- **Hoy:** el costo de envío de cada pedido se escribe a mano (por defecto S/ 0), no existe la comisión de cobranza del courier y no se registra el costo de devolución de un no entregado.
- **Mejora:**
  - Tarifas automáticas por zona (Lima / provincia / agencia).
  - Comisión de cobranza en %.
  - Costo de retorno para los no entregados.
- **Resultado:** cada pedido trae sus costos sin que nadie los escriba.

## 🟠 Vender más (conversión)

| Mejora | Por qué |
|---|---|
| Bloque de video en la landing | Muchas landings COD venden con video |
| Botón flotante de WhatsApp | Muchos clientes preguntan antes de pedir |
| Upsell en la página de gracias («agrega otro por S/ 30») | Sube el ticket sin más publicidad |
| Recuperar formularios abandonados | Si escribió su celular y no envió, se le escribe por WhatsApp |
| Método de entrega: domicilio en Lima vs. agencia Shalom/Olva en provincia | En provincia hay que saber a qué agencia enviar |
| Control del adelanto (pagado o no, comprobante de Yape) | Hoy se calcula el monto, pero no se registra si se pagó |
| Descontar el stock con cada pedido | El campo existe pero no baja |
| Subir varias imágenes y crear sus bloques de una vez | Hoy se sube imagen por imagen |
| Más plantillas y copiar bloques entre landings | Hoy hay una sola plantilla |

## 🟡 Marketing y medición
- **Dominio propio por tienda:** Meta pide verificar el dominio y el vendedor no puede verificar `vendia-theta.vercel.app`.
- **ROI por conjunto y por anuncio:** hoy solo hay tabla por campaña.
- **Importación automática del gasto** desde la API de Meta (hoy es por CSV).
- **TikTok Pixel y Events API.**
- **Correo opcional en el formulario:** mejora la coincidencia de eventos en Meta.
- **Pruebas A/B** de landings y de ofertas.

## 🟢 Producto (SaaS)
- **Tutorial de bienvenida** y centro de ayuda.
- **Equipo:** invitar confirmadores con permisos limitados. La base de datos ya lo soporta; falta la pantalla.

## ⚙️ Técnico
- **Tests automáticos en cada cambio** (GitHub Actions) y pruebas de punta a punta con navegador.
- **Monitoreo de errores** (Sentry). Vercel gratis guarda los registros solo 1 hora.
- **Landing pre-armada y guardada en caché:** carga más rápido y cuesta menos.
- **Contraseña de la base de datos:** sin ella, cada cambio de tablas se pega a mano en Supabase.
