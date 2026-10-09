# Plan de construcción (consolidado)

> Versión final acordada con el dueño el 2026-10-08. Reúne todo lo definido en [PRODUCTO.md](PRODUCTO.md), [CONTROLADOR-PEDIDOS.md](CONTROLADOR-PEDIDOS.md), [NODO-COURIERS.md](NODO-COURIERS.md), [UI.md](UI.md) y [BACKLOG.md](BACKLOG.md).
> Al final de cada bloque: SQL validado localmente para pegar en Supabase, tests y publicación en Vercel.

## Bloque 1: Controlador de pedidos
- [x] **Notificaciones:** campana con contador, página de historial, sonido y notificación del navegador mientras Vendia esté abierta.
- [x] **Secuencia de contacto:** Llamada 1 → 2 → 3 → WhatsApp, seguidas, con resultado de cada intento. Se puede cancelar desde el primer intento. Al terminar, **solo aviso** (no cancela solo).
- [x] **Motivos fijos** de cancelación y de no entrega.
- [x] **Lista de pedidos mejorada:** etiqueta Lima / Provincia con filtro y orden, próxima acción, intentos, asignado, courier, tiempo real.
- [x] **Registro manual de pedidos** (WhatsApp, Instagram, llamada) con origen.
- [x] **Equipo:** rol Confirmador, asignación de pedidos, «Mis pendientes».

## Bloque 2: Provincia y despacho
- [x] **Flujo de provincia:**
  - Agencia de destino (la elige el confirmador al contactar al cliente) y número de orden y código de envío.
  - Clave de recojo, visible solo para el equipo.
  - **Estados en orden inverso a Lima:** Enviado → En agencia → Cobrado → Entregado.
- [x] **Adelanto solo en provincia;** Lima es contraentrega. **Pagos con comprobantes:** adelanto y saldo, con monto, método, fecha y quién verificó.
- [x] **DNI obligatorio en provincia.**
- [x] **Couriers por tienda:**
  - Eva Courier en Lima (catálogo ampliable con más empresas de delivery).
  - Shalom en provincia, con agencia de origen predeterminada y seleccionable.
  - **Olva: próximamente.**
- [x] **Exportación a la plantilla oficial** de Shalom y Eva (kit de Nodo): revisión previa, reserva atómica, lotes y nueva descarga.
- [x] **Medida y peso** por producto (y editable por pedido). La base de datos ya acepta medida por oferta; falta su pantalla.
- [x] **Stock:** se descuenta al confirmar; se devuelve al cancelar, en una devolución por falta de pago o en un rechazo en puerta.
- [x] **Costos por pedido:** costo de envío (valor sugerido por courier y zona, editable) y devolución de 0, 1 o 2 envíos. Cuenta en todas las métricas.

## Bloque 3: Números correctos
- [x] **Venta real por zona:** Lima = Entregado y Provincia = Cobrado, o Entregado en ambos (configurable). Se aplica en todas las métricas y en el Purchase de Meta.
- [x] **Moneda de la cuenta publicitaria** (PEN/USD) con tipo de cambio guardado por gasto. **IGV 18 % opcional.**
- [x] **Solo CPA real** (sin proyección) y **% de pedidos atribuidos** a campaña. El costo de devolución (0/1/2 envíos) ya cuenta en todas las tablas.
- [x] **Selector de fechas estilo Meta** en toda la app.

## Bloque 4: Meta total y Rendimiento
- [x] **«Conectar Meta» con un token** de usuario del sistema (`ads_read` + `ads_management` + `business_management`): detecta cuentas y moneda, elige o crea el Pixel y activa las conversiones.
- [x] **Sincronización diaria** de campañas, conjuntos y anuncios, más un botón «Actualizar ahora». Reemplaza la importación por CSV, que se mantiene como alternativa.
- [x] **Rendimiento** por campaña, conjunto, anuncio, **ángulo**, producto y página: columnas de Meta junto al **CPA real** y la utilidad, con selector de columnas. La pestaña «Ángulos» se llena cuando existan los ángulos (Bloque 5).
- [x] **Tarjeta del anuncio** en cada pedido (miniatura, texto, «Ver anuncio»).

## Bloque 5: Landing y ventas
- [x] **Product page** por producto, además de la landing (plantilla «Product page» con el bloque «Producto»: galería, precio, ofertas y botón).
- [x] **GIF** en la landing. **Video: próximamente.**
- [x] **Botón flotante de WhatsApp:** opcional, abajo a la derecha, tamaño personalizable.
- [x] **Upsells en el formulario** (*order bumps* personalizables) y **en la página de gracias**.
- [x] **Formularios abandonados**, con aviso de privacidad.
- [x] **Subir varias imágenes de una vez** y crear sus bloques.
- [x] **Más plantillas** (Clásica, Video primero, Packs) y copiar bloques entre landings.
- [x] **Pruebas A/B y ángulos creativos** con redirección a la landing del ángulo.
- [x] **Correo opcional** en el formulario.

## Bloque 6: Plataforma
- [x] **Varias tiendas por usuario,** con selector de tienda.
- [x] **Dominio propio de Vendia** y **dominios propios** por tienda, o uno para todas las tiendas del usuario.
- [x] **Multi-país:** moneda, ubicaciones, couriers, teléfono e impuestos como módulos por país (`src/modules/country`). Perú listo; los demás países se agregan como una entrada nueva.
- [x] **TikTok listo** (Pixel + Events API + plantilla de URL).
- [x] **Tutorial de bienvenida** y página de ayuda.
- [x] **Registro de errores propio** en /admin → Errores.
- [x] **Tests automáticos en cada cambio** (GitHub Actions) y pruebas de punta a punta.
- [x] **Landing en caché:** datos de la landing en caché (se limpian al publicar o al cambiar la configuración) y archivos grandes (ubicaciones, plantillas) con caché del navegador. La página completa no se guarda en la CDN porque las pruebas A/B dependen de cada visitante.

## Bloque 7: Operación y equipo (ideas de Kontrol, ver KONTROL.md)
- [x] **Contadores en la base de datos** (Pedidos, Logística, Abandonados): sin el corte de 1000 filas.
- [x] **Variantes** (talla, color…) con stock propio: una por unidad en la landing, en el pedido manual y editable al confirmar.
- [x] **Comisiones del confirmador:** se ganan al confirmar (Lima/provincia), se anulan si no se entrega; pagos registrados (y como gasto «Comisiones»).
- [x] **Métricas por confirmador** (por cohorte) y **color por persona**; página «Mi rendimiento» para el confirmador.
- [x] **Liquidación con el courier de Lima:** cuánto te debe cada uno, liquidar en lote (pasa a Cobrado), historial y anular.
- [x] **Rótulos de envío** para imprimir (A4 o 10×15).
- [x] **Costo de embalaje** por unidad en la utilidad.
- [x] **Instalar en el celular (PWA).**

## Bloque 8: Diseño y velocidad
- [x] **Velocidad:** Vercel en São Paulo (junto a la base), sesión verificada sin consultar, esqueleto al instante, precarga al pasar el mouse y caché de 30 s.
- [x] **Paleta Vendia:** rojo #E53935 (acciones e identidad), grafito #202124 (menú), blanco y gris claro. Estados con su propio color (cancelado en gris).
- [x] **Logo y favicon** provisionales (V blanca sobre rojo) en vez del logo de Next.js.
- [x] **Menú agrupado** (Operación, Ventas, Números, Ajustes) y todo en español.
- [x] **Celular:** barra inferior, pedidos como tarjetas, Llamar/WhatsApp fijos en el detalle.
- [x] **Buscador rápido** (Ctrl+K o «/»): pedidos por teléfono, nombre o número; clientes; secciones.
- [x] **Inicio nuevo:** 4 cifras clave, gráfico de pedidos y ventas por día (requiere `actualizacion-bloque-8.sql`), detalle compacto y guía de bienvenida plegable.
- [x] **Rendimiento y Analítica unidas** (pestañas Anuncios · Embudo · Zonas) y embudo rediseñado.
- [x] **Varias cuentas publicitarias de Meta por tienda** (requiere `actualizacion-bloque-9.sql`) y lectura automática al abrir el panel.
- [x] **Lectura de Meta cada hora (configurable)** con el reloj de Supabase (pg_cron), requiere `actualizacion-bloque-10.sql`.
- [x] **Modo oscuro** del panel (Claro / Oscuro / Como el dispositivo, en el pie del menú). Las landings siempre en claro.

## Pendiente del dueño
- [x] Enviar **Kontrol** para analizarlo (ver docs/KONTROL.md).
- [ ] Restablecer la **contraseña de la base de datos** (opcional; sin ella, el SQL se pega a mano).
- [ ] Hacer **privado** el repositorio de GitHub (recomendado).
