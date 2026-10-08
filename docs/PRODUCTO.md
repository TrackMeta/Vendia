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

## Decisiones del 2026-10-08 (segunda ronda)

### Costos de envío y devolución
- Cada courier cobra un **monto variable por envío**. El costo se registra **por pedido**, con un valor sugerido por courier y zona que se puede editar.
- **No hay comisión porcentual de cobranza**: el costo es el envío.
- **La devolución varía por pedido:** sin costo, 1 costo de envío o 2 costos de envío. Se elige al marcar «No entregado» o «Devuelto».

### Landing
- **GIF:** se pueden subir (sin recomprimir, con límite de peso).
- **Video:** todavía no.
- **Botón flotante de WhatsApp:** opcional, abajo a la derecha, con tamaño personalizable y mensaje editable.
- **Upsells:**
  1. **En el formulario** (*order bumps*): casillas debajo de los campos, cada una con imagen, nombre, precio, texto de escasez o descuento y colores personalizables. El total del botón «Comprar ahora» se actualiza al marcarlas. El servidor valida precios y productos.
  2. **En la página de gracias:** agregar al mismo pedido con un clic.
- **Formularios abandonados:** sí, con aviso de privacidad.

### Entrega en provincia (flujo real)
1. Se despacha por **Shalom u Olva**. **El cliente elige su agencia cuando lo contactamos** (no en el formulario).
2. El cliente de provincia paga un **adelanto** a nuestras cuentas (Yape u otra) **antes del envío**.
3. Se despacha y se hace **seguimiento con el número de orden y el código de envío**.
4. Cuando el pedido **llega a su agencia**, el cliente **paga el saldo**. Recién entonces se le entrega la **clave de recojo**.
5. El cliente **recoge con su DNI y la clave**.
- **Lima:** contraentrega pura, **sin adelanto**.
- **Comprobantes:** el cliente los envía por WhatsApp. En el pedido se pueden **adjuntar el comprobante del adelanto y el del pago del saldo**, con monto, método, fecha y quién lo verificó.
- **Campos nuevos en el pedido:** agencia de destino, número de orden del courier, código de envío, clave de recojo (visible solo para el equipo) y pagos con comprobantes.
- **Impacto en los estados:** en provincia el orden es *Enviado → En agencia → **Cobrado** (pagó el saldo) → **Entregado** (recogió)*. Es el **orden inverso a Lima** (Entregado → Cobrado). La máquina de estados debe aceptar los dos flujos sin completar hitos que no ocurrieron (en provincia, «Cobrado» **no** implica «Entregado»).

### Stock
- **Se descuenta al confirmar el pedido** (cuando sale).
- **Se devuelve** si se cancela después de confirmar, si se devuelve por falta de pago del saldo o si el cliente lo rechaza en la puerta.

### Dominios y tiendas
- **Vendia tendrá su propio dominio.**
- **Cada tienda** puede tener su propio dominio, o el usuario puede usar **un dominio suyo para todas sus tiendas**.
- ⚠️ Esto implica que **un usuario puede tener varias tiendas**. Hoy está limitado a 1. Hay que permitir varias tiendas por usuario y un selector de tienda.

### TikTok
- **Dejarlo listo** (TikTok Pixel + Events API y plantilla de URL con macros de TikTok), aunque hoy no se use.

### Pruebas A/B y ángulos creativos
- **A/B:** un mismo link reparte el tráfico entre versiones de landing u oferta; gana la de **mejor CPA real**.
- **Ángulos creativos:** cada anuncio tiene un **ángulo** (por ejemplo «dolor», «antes/después», «precio»). Si el visitante llega desde un anuncio de ese ángulo, se le **redirige a la landing de ese ángulo**.
- **Rendimiento** tendrá una pestaña **por ángulo**, igual que por anuncio o por producto.

### Tutorial de bienvenida
- Sí: lista de pasos guiados para usuarios nuevos y una página de ayuda.

### Otros proyectos del dueño
- **Nodo:** COD por WhatsApp. Aporta el **kit de exportación a couriers** (ver [NODO-COURIERS.md](NODO-COURIERS.md)).
- **Kontrol:** gestionador de pedidos COD en Perú. **Pendiente:** el dueño lo enviará para analizar qué sirve.
