# Kit de exportación a couriers de Nodo: análisis y plan

> Recibido el 2026-10-08 (`kit-export-couriers.zip`). Guardado sin cambios en `vendor/nodo-couriers-kit/`.

## Qué es

Es el exportador de **Nodo** (otro proyecto COD del dueño, por WhatsApp), separado para reutilizarlo. **No llena un Excel cualquiera:** abre la **plantilla original del courier** y solo escribe las filas de datos. Todo lo demás (validaciones, desplegables, macros, tablas, estilos) se copia byte por byte. Por eso el portal de carga masiva lo acepta. En Nodo se probó la subida real a Shalom y a Eva sin errores.

| Pieza | Qué hace |
|---|---|
| `xlsx-fill.js` | Motor sin librerías: lee el .xlsx/.xlsm (que es un ZIP), reemplaza el `sheetData` de una hoja, ajusta el rango de la tabla y lo vuelve a empaquetar. Funciona en el navegador y en Node 18+. |
| `couriers.js` | Mapeo de columnas por courier, chequeos previos (`revisar`), `sugerirAgencia()` para Shalom y `generarExcel()` / `exportar()`. |
| `plantillas/shalom.xlsx` | Plantilla de carga masiva de **Shalom** (provincia, recojo en agencia). |
| `plantillas/eva.xlsm` | Plantilla de **Eva Courier** (Lima, contraentrega). Trae macros del propio courier (`vbaProject.bin`), que Vendia no ejecuta: solo las copia. |
| `plantillas/listas.json` | Listas oficiales: **552 agencias de destino Shalom**, 498 de origen, 6 medidas (SOBRE, PAQUETE XXS…L), **65 distritos de Eva** y 6 métodos de cobro. |

## Columnas

- **Shalom (Hoja1):**
  - A DNI (como **texto**, para conservar el 0 inicial)
  - B celular de 9 dígitos
  - F agencia de **origen** (configuración de la tienda)
  - G agencia de **destino** (exacta de la lista oficial)
  - H **medida** (no el nombre del producto)
  - I–L alto, ancho, largo y peso (0 explícito, no vacío)
  - M bultos = 1
- **Eva (FORMULARIO):**
  - B destinatario
  - C celular de 9 dígitos
  - D distrito (de la lista de Eva)
  - E dirección y F referencia
  - H método («EFECTIVO»)
  - I **importe a cobrar = total − adelanto**
  - K descripción y L cantidad

## Lecciones de Nodo que se respetan
1. El DNI va como texto.
2. Las medidas en 0 se escriben como 0.
3. MERCADERÍA es la medida, no el producto.
4. El destino de Shalom tiene que estar en la lista oficial: si es ambiguo (Cusco tiene 4 agencias) **no se adivina**, decide una persona.
5. El celular va sin el 51.
6. El importe de Eva es **lo que falta cobrar**.
7. Hay que ajustar la tabla de Eva a la cantidad de filas.
8. Los envíos aéreos de Shalom no van en el Excel masivo.
9. **Antes de generar el archivo, el pedido se marca como exportado** con una sola sentencia (`update … where exported_at is null returning id`). Así dos personas no exportan el mismo pedido y no se pagan dos guías.
10. Si el courier cambia su plantilla, se reemplaza el archivo y se regenera `listas.json`.

## Cómo se aplica en Vendia

| Necesita el kit | Vendia hoy | Qué hay que agregar |
|---|---|---|
| DNI (Shalom lo exige) | Opcional en el formulario | **Obligatorio para provincia**: se pide en el formulario o lo completa el confirmador |
| Agencia de destino Shalom | No existe | Campo **agencia de destino** en el pedido, con buscador de las 552 agencias y sugerencia automática según el distrito o la provincia. La elige el confirmador al contactar al cliente |
| Agencia de origen | No existe | Configuración de la tienda por courier |
| Medida y peso del paquete | No existe | Por **producto u oferta** (por defecto PAQUETE S, 1 kg), editable en el pedido |
| Distrito de Eva | Ubigeo INEI | Equivalencia por nombre normalizado; si no coincide, aviso antes de exportar |
| Importe a cobrar | `balance_due` (total − adelanto) | ✅ Ya existe |
| No exportar dos veces | No existe | Columnas `exported_at`, `export_batch_id` y `courier_id` + función atómica `reserve_orders_for_export()` |

## Flujo propuesto en Logística → «Por despachar»
1. Se seleccionan los pedidos confirmados. Se separan en **Lima** (courier local, por ejemplo Eva) y **Provincia** (Shalom u Olva).
2. **Revisar:** se ven los avisos del kit (falta DNI, agencia no oficial, distrito fuera de la lista…) y se corrigen en la misma pantalla.
3. **Exportar:** se marcan como exportados en la base de datos (atómico), se genera el Excel con la **plantilla oficial** y se descarga. Los pedidos pasan a «Enviado» con su **lote de exportación**.
4. **Historial de lotes:** quién exportó, cuándo y qué pedidos, con opción de volver a descargar el mismo archivo.

## Couriers
- **Kit listo:** Shalom (provincia) y Eva (Lima).
- **Falta la plantilla de Olva:** pedirla al dueño o a Nodo y agregarla con una entrada nueva en el catálogo.
- **Otros couriers locales de Lima:** según lo que use cada usuario. Cada uno es una plantilla más; mientras tanto se usa la exportación genérica CSV que ya existe.

## Implementación técnica
- Pasar el kit a TypeScript dentro de `src/modules/couriers/`, conservando la lógica probada.
- Mover las plantillas a `public/couriers/` para generar el archivo en el navegador, como en Nodo.
- La reserva atómica y el registro del lote se hacen en el servidor.
- Tests: generar los dos Excel, abrir el ZIP resultante y verificar celdas, DNI como texto, rango de la tabla y XML válido.
