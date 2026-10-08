// Prueba rápida en Node 18+ (o para generar el Excel en tu BACKEND):
//   node probar-node.mjs
// Escribe Shalom_*.xlsx y Eva_Courier_*.xlsm en esta carpeta.
import { readFile, writeFile } from "node:fs/promises";
import { generarExcel, revisar } from "./couriers.js";

const dir = new URL("./plantillas/", import.meta.url);
const listas = JSON.parse(await readFile(new URL("listas.json", dir), "utf8"));
const cfg = { shalom: { origen: "ATOCONGO", mercaderia: "PAQUETE S", alto: 0, ancho: 0, largo: 0, peso: 1 } };

const casos = {
  eva: [{ cliente: "Ana Ríos", telefono: "+51 987 654 321", distrito: "Miraflores", direccion: "Av. Larco 123",
          referencia: "Frente al parque", cobrar: 89.9, descripcion: "Zapatillas Runner (Talla: 42)" }],
  shalom: [{ cliente: "Pedro Quispe", telefono: "51912345678", dni: "01234567", ciudad: "Abancay" },
           { cliente: "Luz Mamani", telefono: "956789123", dni: "45678912", destino: "ANDAHUAYLAS", mercaderia: "PAQUETE M", peso: 2 }],
};

for (const [id, pedidos] of Object.entries(casos)) {
  const avisos = revisar(id, pedidos, { cfg, listas });
  if (avisos.length) console.log(`⚠ ${id}:\n  ` + avisos.join("\n  "));
  const b = await readFile(new URL(id === "eva" ? "eva.xlsm" : "shalom.xlsx", dir));
  const plantilla = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); // ArrayBuffer exacto
  const out = await generarExcel(id, pedidos, { plantilla, cfg, listas });
  await writeFile(new URL(out.nombreArchivo, import.meta.url), out.bytes);
  console.log(`✔ ${out.nombreArchivo} (${out.filas} filas)`);
}
