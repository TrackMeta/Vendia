# Plan de construcción (consolidado)

> Versión final acordada con el dueño el 2026-10-08. Reúne todo lo definido en [PRODUCTO.md](PRODUCTO.md), [CONTROLADOR-PEDIDOS.md](CONTROLADOR-PEDIDOS.md), [NODO-COURIERS.md](NODO-COURIERS.md), [UI.md](UI.md) y [BACKLOG.md](BACKLOG.md).
> Al final de cada bloque: SQL validado localmente para pegar en Supabase, tests y publicación en Vercel.

## Bloque 1: Controlador de pedidos
- [ ] **Notificaciones:** campana con contador, página de historial, sonido y notificación del navegador mientras Vendia esté abierta.
- [ ] **Secuencia de contacto:** Llamada 1 → 2 → 3 → WhatsApp, seguidas, con resultado de cada intento. Se puede cancelar desde el primer intento. Al terminar, **solo aviso** (no cancela solo).
- [ ] **Motivos fijos** de cancelación y de no entrega.
- [ ] **Lista de pedidos mejorada:** etiqueta Lima / Provincia con filtro y orden, próxima acción, intentos, asignado, courier, tiempo real.
- [ ] **Registro manual de pedidos** (WhatsApp, Instagram, llamada) con origen.
- [ ] **Equipo:** rol Confirmador, asignación de pedidos, «Mis pendientes».

## Bloque 2: Provincia y despacho
- [ ] **Flujo de provincia:**
  - Agencia de destino (la elige el confirmador al contactar al cliente) y número de orden y código de envío.
  - Clave de recojo, visible solo para el equipo.
  - **Estados en orden inverso a Lima:** Enviado → En agencia → Cobrado → Entregado.
- [ ] **Adelanto solo en provincia;** Lima es contraentrega. **Pagos con comprobantes:** adelanto y saldo, con monto, método, fecha y quién verificó.
- [ ] **DNI obligatorio en provincia.**
- [ ] **Couriers por tienda:**
  - Eva Courier en Lima (catálogo ampliable con más empresas de delivery).
  - Shalom en provincia, con agencia de origen predeterminada y seleccionable.
  - **Olva: próximamente.**
- [ ] **Exportación a la plantilla oficial** de Shalom y Eva (kit de Nodo): revisión previa, reserva atómica, lotes y nueva descarga.
- [ ] **Medida y peso** por producto u oferta.
- [ ] **Stock:** se descuenta al confirmar; se devuelve al cancelar, en una devolución por falta de pago o en un rechazo en puerta.
- [ ] **Costos por pedido:** costo de envío (valor sugerido por courier y zona, editable) y devolución de 0, 1 o 2 envíos.

## Bloque 3: Números correctos
- [ ] **Venta real por zona:** Lima = Entregado y Provincia = Cobrado, o Entregado en ambos (configurable). Se aplica en todas las métricas y en el Purchase de Meta.
- [ ] **Moneda de la cuenta publicitaria** (PEN/USD) con tipo de cambio guardado por gasto. **IGV 18 % opcional.**
- [ ] **Solo CPA real** (sin proyección) y **% de pedidos atribuidos** a campaña.
- [ ] **Selector de fechas estilo Meta** en toda la app.

## Bloque 4: Meta total y Rendimiento
- [ ] **«Conectar Meta» con un token** de usuario del sistema (`ads_read` + `ads_management` + `business_management`): detecta cuentas y moneda, elige o crea el Pixel y activa las conversiones.
- [ ] **Sincronización diaria** de campañas, conjuntos y anuncios, más un botón «Actualizar ahora». Reemplaza la importación por CSV, que se mantiene como alternativa.
- [ ] **Rendimiento** por campaña, conjunto, anuncio, **ángulo**, producto y página: columnas de Meta junto al **CPA real** y la utilidad, con selector de columnas.
- [ ] **Tarjeta del anuncio** en cada pedido (miniatura, texto, «Ver anuncio»).

## Bloque 5: Landing y ventas
- [ ] **Product page** por producto, además de la landing.
- [ ] **GIF** en la landing. **Video: próximamente.**
- [ ] **Botón flotante de WhatsApp:** opcional, abajo a la derecha, tamaño personalizable.
- [ ] **Upsells en el formulario** (*order bumps* personalizables) y **en la página de gracias**.
- [ ] **Formularios abandonados**, con aviso de privacidad.
- [ ] **Subir varias imágenes de una vez** y crear sus bloques.
- [ ] **Más plantillas** (Clásica, Video primero, Packs) y copiar bloques entre landings.
- [ ] **Pruebas A/B y ángulos creativos** con redirección a la landing del ángulo.
- [ ] **Correo opcional** en el formulario.

## Bloque 6: Plataforma
- [ ] **Varias tiendas por usuario,** con selector de tienda.
- [ ] **Dominio propio de Vendia** y **dominios propios** por tienda, o uno para todas las tiendas del usuario.
- [ ] **Multi-país:** moneda, ubicaciones, couriers, teléfono e impuestos como módulos por país. Perú primero.
- [ ] **TikTok listo** (Pixel + Events API + plantilla de URL).
- [ ] **Tutorial de bienvenida** y página de ayuda.
- [ ] **Registro de errores propio** en /admin → Errores.
- [ ] **Tests automáticos en cada cambio** (GitHub Actions) y pruebas de punta a punta.
- [ ] **Landing en caché.**

## Pendiente del dueño
- [ ] Enviar **Kontrol** para analizarlo.
- [ ] Restablecer la **contraseña de la base de datos** (opcional; sin ella, el SQL se pega a mano).
- [ ] Hacer **privado** el repositorio de GitHub (recomendado).
