# Kit «Exportar a Shalom / Eva Courier»

Es el mismo exportador de Nodo, pero separado de Nodo para usarlo en cualquier app. No usa librerías.
Rellena la **plantilla original** de cada courier, así el portal de carga masiva lo acepta
(con Nodo se probó la subida real en los dos portales y no dio errores).

## Qué trae

| Archivo | Para qué |
|---|---|
| `xlsx-fill.js` | Motor que abre el .xlsx/.xlsm (es un ZIP), cambia **solo** las filas de una hoja y lo vuelve a armar. Macros, validaciones, desplegables y estilos se copian tal cual. |
| `couriers.js` | Qué columna lleva qué dato, los chequeos previos, la sugerencia de agencia Shalom, `generarExcel()` y `exportar()`. |
| `plantillas/shalom.xlsx`, `plantillas/eva.xlsm` | Las plantillas reales, ya sin datos de ejemplo de terceros. |
| `plantillas/listas.json` | Listas de los desplegables: 552 agencias de destino Shalom, 498 de origen, 6 medidas, 65 distritos de Eva y 6 métodos de cobro. |
| `ejemplo.html` | Página mínima con los dos botones. |
| `probar-node.mjs` | La misma prueba desde Node (y sirve de modelo si prefieres generar el Excel en tu backend). |

## Cómo meterlo en tu app (3 pasos)

1. **Copia la carpeta** a la parte pública de tu app (por ejemplo `public/couriers/`) para que `plantillas/` se pueda descargar con `fetch`.
2. **Convierte tus pedidos a la forma neutra.** Solo tienes que escribir una función:
   ```js
   const aPedido = (o) => ({
     cliente: o.nombre_cliente,
     telefono: o.celular,
     dni: o.dni,
     // Lima (Eva)
     distrito: o.distrito, direccion: o.direccion, referencia: o.referencia,
     cobrar: o.total - (o.adelanto || 0),  // lo que se cobra en la puerta
     descripcion: `${o.producto} (${o.talla})`, cantidad: o.cantidad,
     // Provincia (Shalom)
     destino: o.agencia_shalom,   // nombre exacto de la lista; si no lo tienes, pasa `ciudad`
     ciudad: o.ciudad,
     mercaderia: o.medida,        // SOBRE / PAQUETE XXS…L (opcional, sale de la config)
     peso: o.peso,
   });
   ```
3. **Llama a exportar** desde el botón:
   ```js
   import { exportar, revisar, cargarListas } from "/couriers/couriers.js";
   const cfg = { shalom: { origen: "TU AGENCIA", mercaderia: "PAQUETE S", alto: 0, ancho: 0, largo: 0, peso: 1 } };
   const pedidos = misPedidos.map(aPedido);
   const avisos = revisar("shalom", pedidos, { cfg, listas: await cargarListas("/couriers/plantillas/") });
   // muestra los avisos; si el usuario sigue:
   await exportar("shalom", pedidos, { cfg, base: "/couriers/plantillas/" });   // o "eva"
   ```

En el backend (Node 18+, Deno o Bun) usa `generarExcel(id, pedidos, { plantilla, cfg, listas })`: devuelve
`{ bytes, nombreArchivo }` y tú lo mandas como respuesta o lo guardas. Mira `probar-node.mjs`.

## Qué va en cada columna

**Shalom** (hoja `Hoja1`): A DNI · B celular · F ORIGEN (de la config) · G DESTINO (agencia) · H MERCADERÍA (medida) · I-L alto/ancho/largo/peso · M cantidad = 1. C, D y E van vacías.

**Eva Courier** (hoja `FORMULARIO`): B destinatario · C celular · D distrito · E dirección · F referencia · H método («EFECTIVO») · I importe a cobrar · K descripción · L cantidad.

## Lo que aprendimos en Nodo (no lo cambies)

- **El DNI va como texto**, si no Excel borra el 0 inicial (`01234567` pasaría a `1234567`).
- **Las medidas en 0 se escriben como 0**, no vacías: Shalom exige al menos un 0.
- **MERCADERÍA no es el nombre del producto**: es la medida de Shalom (SOBRE / PAQUETE XXS, XS, S, M, L).
- **El DESTINO de Shalom tiene que estar en la lista oficial.** Si pones una ciudad suelta («CUSCO»), rechazan la fila. `sugerirAgencia()` intenta pasar lo que escribió el cliente a la agencia oficial. Si hay varias posibles (Cusco tiene 4), devuelve vacío para que elijas tú.
- **Celular de 9 dígitos sin el 51**: la plantilla de Eva lo valida.
- **El importe de Eva es lo que falta cobrar**, no el total: si hubo adelanto, se resta.
- **La tabla de Eva (`table2`) se ajusta** a la cantidad de filas; si no, Excel dice que el archivo está dañado. Ya lo hace `generarExcel`.
- **Los envíos aéreos de Shalom no van en el Excel masivo**: se registran a mano en la agencia. Fíltralos antes.
- **Para no exportar dos veces el mismo pedido** (dos personas a la vez = dos guías y dos fletes), en Nodo se marca el pedido como exportado *antes* de generar el Excel, en una sola sentencia de la base (`update … where exportado_at is null returning id`), y solo esos ids van al archivo.
- Si el courier cambia su plantilla, reemplaza el archivo y vuelve a sacar `listas.json` de sus desplegables (no solo de las cabeceras).

## Probarlo

```bash
node probar-node.mjs
```
