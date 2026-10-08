# Kontrol → qué le sirve a Vendia

> Análisis del 2026-10-08 del proyecto Kontrol (`D:\COD PRO`, `index.html` ~13.300 líneas + SQL + Edge Functions) y de su resumen `para-vendia/KONTROL_PARA_VENDIA.md`.

## Lo que Vendia ya tiene (no hace falta copiar)
- **Pedido sin confirmar ≠ venta:** el estado «Por confirmar» no cuenta en métricas ni toca stock. Equivale a los «pedidos brutos» de Kontrol.
- **Duplicados:** clave de idempotencia más aviso de posible duplicado (mismo celular y producto).
- **Secuencia de contacto, asignación y «Mis pendientes»:** Llamada 1-2-3 + WhatsApp, motivos fijos y riesgo del cliente.
- **Logística por zona:** provincia con adelanto, agencia, clave y comprobantes.
- **Exportación con la plantilla oficial:** Shalom/Eva desde la plantilla original. Es mejor que el mapeo configurable que propone Kontrol.
- **Números:**
  - CPA y ROAS reales con la venta real por zona;
  - gasto de Meta sincronizado;
  - IGV y dólares;
  - costo de devolución (0/1/2 envíos).
- **Plataforma:**
  - roles con RLS en el servidor;
  - tiempo real;
  - registro de errores;
  - Purchase de Meta/TikTok por venta real;
  - order bumps y upsell;
  - abandonados;
  - A/B.
- **Arquitectura:** Kontrol tiene un solo HTML, datos en un blob JSON, permisos solo en la pantalla e imágenes en base64. Vendia ya evita todo eso.

## Lo mejor de Kontrol que sí conviene traer
| # | Idea | Por qué vale | Tamaño |
|---|---|---|---|
| 1 | **Plantillas de WhatsApp por momento del pedido** con variables (`{nombre}`, `{producto}`, `{adelanto}`, `{saldo}`, `{agencia}`, `{clave}`, `{dias_en_agencia}`…): confirmación Lima, pedir adelanto, llegó a agencia con clave, recordatorios de recojo, post-entrega | Vendia solo tiene un mensaje fijo de confirmación; el flujo de provincia se hace a mano | Mediano |
| 2 | **Alertas de pedidos estancados**: en camino más de 3 o 7 días; en agencia más de 3 o 5 días (Shalom devuelve a los 30) | Es dinero que se pierde en silencio | Chico |
| 3 | **Liquidación con el courier (Lima)**: neto por recibir = cobrado − envío, agrupado por courier, días sin liquidar, «liquidar» en lote (pasa a Cobrado) e historial. Además, **por cobrar** total | Vendia tiene el estado «Cobrado» pero no la pantalla para controlar el efectivo de los motorizados | Mediano |
| 4 | **Variantes (talla/color) con stock propio** | Vendia no tiene variantes. Fajas y ropa las necesitan | Grande |
| 5 | **Comisiones del confirmador**: se generan al confirmar, se anulan si no se entrega o se cancela, y se registran los pagos (generada − pagada = pendiente) | Vendia ya tiene confirmadores y les falta esto | Mediano |
| 6 | **Métricas por confirmador** por cohorte (confirmados ÷ trabajados, entregados ÷ confirmados, tiempo de primera respuesta) + color por persona | Saber quién confirma bien | Mediano |
| 7 | **Metas y semáforos + comparación con el período anterior** en Inicio (efectividad, ROAS mínimo, % devolución máx., venta diaria) | Barato y muy útil | Chico |
| 8 | **Rótulos de envío imprimibles** | Ahorra tiempo al despachar | Chico |
| 9 | **Costo de embalaje por unidad** en la utilidad | Exactitud de la utilidad real | Chico |
| 10 | **PWA** (instalar el panel en el celular del equipo) | El equipo trabaja desde el celular | Chico |

## Bug de Kontrol que también tenía Vendia
- **Corte de 1000 filas de Supabase:** los contadores de Pedidos, Logística y Abandonados bajaban todas las filas para contarlas en la página. Con más de 1000 pedidos los números saldrían mal. Hay que contarlos en la base de datos (RPC con `group by`).

## No copiar
- Tabla aparte de pedidos brutos: Vendia ya usa el estado «Por confirmar».
- Ingesta de Shopify/Sheets: solo si alguien migra.
- Autocompletado de texto libre: el formulario ya usa selectores.
- Telegram: ya hay notificaciones del navegador.
- Backup JSON.
- Pool con límites y devolución con motivo: es demasiado para 2 o 3 personas.
- Etapas configurables: los resultados de contacto ya lo cubren.
- Stock que se descuenta al entregar: se decidió descontarlo al confirmar.
