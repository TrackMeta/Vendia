# Vendia: mejoras elegidas (pendientes)

> Elegidas por el dueño el 2026-10-08, a partir del análisis completo de la plataforma.
> Estado: **pendientes**. Decisiones de producto en [PRODUCTO.md](PRODUCTO.md).

## 🆕 Producto
- **Product page por producto** (además de la landing): ver [PRODUCTO.md](PRODUCTO.md).
- **Preparar multi-país**: moneda, ubicaciones, couriers y teléfono por país.
- **Venta real por zona**: Lima = Entregado, Provincia = Cobrado (o Entregado en ambos), configurable.
- **Moneda de la cuenta publicitaria (PEN/USD) con tipo de cambio** y **opción de sumar IGV 18 %** al gasto.
- **% de pedidos atribuidos a campaña** (alerta si hay anuncios sin plantilla de URL). Decisión: se muestra **solo el CPA real**, sin proyección.

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

## 🆕 Controlador de pedidos y rendimiento (2026-10-08)
- **Controlador de pedidos:** ver [CONTROLADOR-PEDIDOS.md](CONTROLADOR-PEDIDOS.md). Incluye notificaciones, secuencia de llamadas, registro manual de pedidos, zona Lima/Provincia, equipo y couriers.
- **Selector de fechas estilo Meta** en toda la app: ver [UI.md](UI.md).
- **Origen del pedido estilo Meta:** campaña → conjunto → anuncio con nombres e IDs. La vista previa del anuncio (imagen, texto, "Ver anuncio") requiere la API de Marketing de Meta.
- **Conexión de lectura de Meta (opción B, token de usuario del sistema por tienda):** ver [PRODUCTO.md](PRODUCTO.md).
- **Sección Rendimiento:** tablas por campaña, conjunto, anuncio, producto y página (landing / product page), con columnas de Meta (impresiones, CPM, clics, CTR, CPC, resultados y costo por resultado según Meta…) y columnas de Vendia (pedidos, confirmados, venta real, **CPA real** junto al costo por resultado de Meta para compararlos, ROAS real, utilidad), más un selector de columnas.

## 🆕 Segunda ronda de definiciones (2026-10-08)
Ver [PRODUCTO.md](PRODUCTO.md) (sección «segunda ronda») y [NODO-COURIERS.md](NODO-COURIERS.md):
- Exportación a la **plantilla oficial** de Shalom y Eva (kit de Nodo), con reserva atómica y lotes. Falta la plantilla de Olva.
- Flujo de provincia: agencia, adelanto, pago del saldo, clave de recojo, comprobantes y estados en orden inverso a Lima.
- Costos de envío variables por pedido y devolución (0, 1 o 2 envíos).
- GIF en la landing, botón de WhatsApp personalizable, upsells en el formulario y en la página de gracias, formularios abandonados.
- Stock: se descuenta al confirmar y se devuelve al cancelar o devolver.
- Varias tiendas por usuario y dominios propios (de Vendia y de cada usuario o tienda).
- TikTok listo (Pixel + Events API).
- A/B y **ángulos creativos** con redirección y pestaña en Rendimiento.
- Tutorial de bienvenida.
- **Pendiente:** analizar **Kontrol** cuando el dueño lo envíe.
