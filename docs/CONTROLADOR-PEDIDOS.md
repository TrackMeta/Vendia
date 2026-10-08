# Controlador de pedidos: diseño acordado

> Decisiones del dueño, 2026-10-08. Estado: **por construir**.

## Operación real
- **Quién confirma:** el dueño o alguien de su equipo.
- **Canales:** llamada y WhatsApp.
- **Volumen:** entre 10 y 100 pedidos diarios por tienda.
- **Despacho:** provincia con Shalom y/u Olva (agencia); Lima con couriers locales, distintos según cada usuario.

## Secuencia de contacto
- **Intentos seguidos, sin esperas forzadas:** Llamada 1 → Llamada 2 → Llamada 3 → WhatsApp → Cancelar.
- **Se puede cancelar desde el primer intento** (por ejemplo, si el cliente dice que ya no lo quiere).
- **Cada intento registra:** canal, resultado (confirmó, no contesta, apagado, llamar después, rechazó, número equivocado), nota, quién y cuándo.
- **"Llamar después"** solo cuando el cliente lo pide (se elige la hora y genera recordatorio).
- **Motivos fijos** de cancelación y de no entrega, para analizar por qué se caen los pedidos.

## Notificaciones
- **Apartado de Notificaciones** en el panel: campana con contador y página de historial.
- **Avisos:** pedido nuevo (con sonido), recordatorio de "llamar después", posible duplicado, cliente riesgoso, fallos de Meta o webhooks.
- **Notificaciones del navegador**, por tienda, a todos sus miembros.

## Lista de pedidos
- **Zona Lima / Provincia** visible en cada pedido, con filtro y orden por zona.
- **Columnas:** próxima acción, intentos, asignado a, courier.
- **Actualización en tiempo real.**
- **Registro manual de pedidos** (pedidos por WhatsApp, Instagram, llamada), con origen.

## Equipo y couriers
- **Rol Confirmador:** trabaja pedidos, sin ver gastos ni configuración.
- **Asignación de pedidos** y filtro "Mis pendientes".
- **Couriers por tienda:** Lima con los locales propios de cada usuario; provincia con Shalom y Olva, más la agencia de destino.

## Decisiones finales (2026-10-08)
- **Fin de la secuencia:** **solo aviso**. Vendia marca el pedido como «Secuencia completa, sin respuesta» y avisa; la cancelación la confirma una persona.
- **Notificaciones:** **con el navegador abierto** (cualquier pestaña de Vendia): aviso en la app, sonido y notificación del navegador. Las notificaciones con el navegador cerrado (Web Push) quedan para más adelante.
