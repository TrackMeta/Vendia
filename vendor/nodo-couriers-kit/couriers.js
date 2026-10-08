// ═══════════════════════════════════════════════════════════════════
// couriers.js — arma el Excel de carga masiva de Shalom y Eva Courier
// rellenando SU plantilla original (ver xlsx-fill.js), para que el portal de
// carga masiva lo acepte sin errores.
//
// No depende de ninguna base de datos ni framework: recibe una lista de
// PEDIDOS con la forma de abajo. Tu app solo tiene que convertir sus pedidos
// a esa forma (una función `aPedido(tuPedido)`) y llamar a exportar().
//
// Forma del pedido (todos los campos son opcionales salvo lo que exige cada courier):
//   {
//     cliente:     "Ana Ríos",            // nombre del destinatario
//     telefono:    "51987654321",         // con o sin +51; se toman los últimos 9 dígitos
//     dni:         "01234567",            // SHALOM: 8 dígitos (va como TEXTO, conserva el 0)
//     // ── Eva (Lima, contraentrega) ──
//     distrito:    "Miraflores",
//     direccion:   "Av. Larco 123, dpto 401",
//     referencia:  "Frente al parque",
//     cobrar:      89.9,                  // lo que el motorizado cobra en la puerta (total − adelanto)
//     descripcion: "Zapatillas Runner (Talla: 42)",
//     cantidad:    1,
//     // ── Shalom (provincia, agencia) ──
//     destino:     "ABANCAY",             // agencia de destino EXACTA de la lista (listas.json → shalom.destino)
//     ciudad:      "Abancay",             // lo que dijo el cliente; si no hay `destino` se sugiere desde acá
//     mercaderia:  "PAQUETE S",           // medida interna Shalom (SOBRE / PAQUETE XXS…L), NO el producto
//     alto, ancho, largo, peso,           // números; si faltan se usan los de la config
//   }
//
// Config del negocio (solo Shalom la necesita):
//   { shalom: { origen: "ATOCONGO", mercaderia: "PAQUETE S", alto: 0, ancho: 0, largo: 0, peso: 1 } }
// ═══════════════════════════════════════════════════════════════════
import { leerZip, textoDe, entradaPorNombre, ponerTexto, rellenarSheet, ajustarTablaRef, escribirZip, descargar } from "./xlsx-fill.js";

// Número para la celda (redondeado a 2 decimales: evita colas tipo 66.67000000000002).
const N = (v) => ({ t: "n", v: Math.round((Number(v) || 0) * 100) / 100 });
// Los couriers piden el celular sin código de país (9 dígitos en Perú).
const tel9 = (t) => String(t || "").replace(/\D/g, "").slice(-9);
// Primer valor "presente" (0 cuenta como presente: Shalom EXIGE al menos un 0 en medidas).
const num = (...xs) => { for (const x of xs) if (x !== undefined && x !== null && x !== "") return Number(x) || 0; return 0; };
const cant = (p) => (Number(p.cantidad) > 1 ? Number(p.cantidad) : 1);

// Normaliza para comparar contra las listas oficiales (sin tildes, sin "SHALOM", mayúsculas).
export const norm = (s) => String(s ?? "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^A-Z0-9 ]/g, " ").replace(/\bSHALOM\b/g, " ").replace(/\s+/g, " ").trim();

// ── EVA COURIER (Lima, contraentrega) — hoja "FORMULARIO" (sheet2 + tabla table2) ──
// B destinatario · C celular · D distrito · E dirección · F referencia · G GPS
// · H método de cobro · I importe a cobrar · J observaciones · K descripción
// · L cantidad · N SKU. (A y las opcionales van vacías.)
function filasEva(pedidos) {
  return pedidos.map((p) => {
    const f = [];
    f[1] = p.cliente || "";                      // B DESTINATARIO
    f[2] = tel9(p.telefono);                     // C CELULAR (la plantilla valida largo = 9)
    f[3] = String(p.distrito || "").toUpperCase(); // D DISTRITO ENTREGA
    f[4] = p.direccion || "";                    // E DIRECCIÓN
    f[5] = p.referencia || "";                   // F REFERENCIA
    f[7] = p.metodo || "EFECTIVO";               // H MÉTODO DE COBRANZA (lista: listas.json → eva.metodo)
    f[8] = N(p.cobrar);                          // I IMPORTE A COBRAR: lo que FALTA, no el total
    f[10] = String(p.descripcion || "").slice(0, 250); // K DESCRIPCIÓN DEL PRODUCTO
    f[11] = N(cant(p));                          // L CANTIDAD
    return f;
  });
}
function revisarEva(pedidos, _cfg, listas) {
  const oficiales = new Set(((listas && listas.eva && listas.eva.distrito) || []).map(norm).filter(Boolean));
  const out = [];
  pedidos.forEach((p) => {
    const q = p.cliente || "un pedido";
    if (!p.direccion) out.push(`${q}: falta dirección.`);
    // Una ubicación compartida por WhatsApp NO es una dirección: el repartidor no tiene a dónde ir.
    else if (/^https?:\/\//i.test(String(p.direccion).trim())) out.push(`${q}: la dirección es un enlace de mapa, no una dirección escrita.`);
    if (!p.distrito) out.push(`${q}: falta distrito.`);
    else if (oficiales.size && !oficiales.has(norm(p.distrito))) out.push(`${q}: el distrito “${p.distrito}” no está en la lista de Eva.`);
    if (tel9(p.telefono).length !== 9) out.push(`${q}: falta un celular válido de 9 dígitos.`);
  });
  return out;
}

// ── SHALOM (provincia, agencia) — hoja "Hoja1" (sheet1) ─────────────
// A doc destinatario · B telf destinatario · C/D contacto (opc) · E GRR (opc)
// · F origen · G destino · H mercadería · I-L alto/ancho/largo/peso · M cantidad.
const destinoShalom = (p, ags) => (p.destino || sugerirAgencia(p.ciudad, ags) || p.ciudad || "").trim().toUpperCase();
function filasShalom(pedidos, cfg, listas) {
  const sh = (cfg && cfg.shalom) || {};
  const ags = listas && listas.shalom && listas.shalom.destino;
  return pedidos.map((p) => {
    const f = [];
    f[0] = String(p.dni || "").trim();          // A DESTINATARIO (DOC) — TEXTO: conserva el 0 inicial
    f[1] = tel9(p.telefono);                    // B TELF. DESTINATARIO
    f[5] = String(sh.origen || "").toUpperCase(); // F ORIGEN (tu agencia, de la config)
    f[6] = destinoShalom(p, ags);               // G DESTINO (agencia oficial)
    f[7] = String(p.mercaderia || sh.mercaderia || "PAQUETE S").toUpperCase(); // H MERCADERIA = medida
    f[8] = N(num(p.alto, sh.alto));             // I ALTO
    f[9] = N(num(p.ancho, sh.ancho));           // J ANCHO
    f[10] = N(num(p.largo, sh.largo));          // K LARGO
    f[11] = N(num(p.peso, sh.peso));            // L PESO
    f[12] = N(1);                               // M CANTIDAD (bultos)
    return f;
  });
}
function revisarShalom(pedidos, cfg, listas) {
  const sh = (cfg && cfg.shalom) || {}, out = [];
  const ags = listas && listas.shalom && listas.shalom.destino;
  const oficiales = new Set((ags || []).map(norm).filter(Boolean));
  if (!sh.origen) out.push("Falta configurar tu oficina de ORIGEN Shalom.");
  pedidos.forEach((p) => {
    const q = p.cliente || p.dni || "un pedido";
    if (!p.dni) out.push(`${q}: falta DNI.`);
    else if (!/^\d{8}$/.test(String(p.dni).trim())) out.push(`${q}: el DNI “${p.dni}” no tiene 8 dígitos.`);
    const t = tel9(p.telefono);
    if (t.length !== 9 || !/^9/.test(t)) out.push(`${q}: el celular no parece un móvil peruano de 9 dígitos.`);
    // DESTINO tiene validación de lista en la plantilla: una ciudad cruda ("CUSCO") hace rechazar la fila.
    const d = destinoShalom(p, ags);
    if (!d) out.push(`${q}: falta la agencia de DESTINO.`);
    else if (oficiales.size && !oficiales.has(norm(d))) out.push(`${q}: “${d}” no es una agencia Shalom de la lista.`);
  });
  return out;
}

// ── Catálogo ───────────────────────────────────────────────────────
// Para sumar otro courier (Olva…): su plantilla en plantillas/ + una entrada acá.
export const COURIERS = {
  eva: { id: "eva", nombre: "Eva Courier", zona: "lima", ext: "xlsm", color: "#1f6feb", logo: "eva-logo.png",
    plantilla: "eva.xlsm", sheet: "xl/worksheets/sheet2.xml", tabla: "xl/tables/table2.xml",
    filas: filasEva, revisar: revisarEva },
  shalom: { id: "shalom", nombre: "Shalom", zona: "provincia", ext: "xlsx", color: "#e2261c", logo: "shalom-logo.png",
    plantilla: "shalom.xlsx", sheet: "xl/worksheets/sheet1.xml",
    filas: filasShalom, revisar: revisarShalom },
};

// Sugiere la agencia oficial que más se parece a lo que escribió el cliente.
// Si es ambiguo (Cusco tiene varias oficinas) devuelve "" para que el dueño elija.
export function sugerirAgencia(texto, agencias) {
  const t = norm(texto);
  if (!t || !Array.isArray(agencias) || !agencias.length) return "";
  const exacta = agencias.find((a) => norm(a) === t);
  if (exacta) return exacta;
  // El nombre de una agencia aparece dentro de lo que escribió → la más específica.
  const dentro = agencias.filter((a) => { const na = norm(a); return na && t.includes(na); })
    .sort((a, b) => norm(b).length - norm(a).length);
  if (dentro.length) return dentro[0];
  // Lo que escribió es parte del nombre de UNA sola agencia.
  const contienen = agencias.filter((a) => { const na = norm(a); return na && na.includes(t); });
  if (contienen.length === 1) return contienen[0];
  if (contienen.length > 1) return "";
  // Palabras compartidas, solo si gana UNA.
  const tk = new Set(t.split(" ").filter((w) => w.length > 2));
  if (!tk.size) return "";
  let best = "", score = 0, empate = false;
  for (const a of agencias) {
    let sc = 0; for (const w of norm(a).split(" ")) if (w.length > 2 && tk.has(w)) sc++;
    if (sc > score) { score = sc; best = a; empate = false; } else if (sc === score && sc > 0) empate = true;
  }
  return score > 0 && !empate ? best : "";
}

// ── Núcleo (sirve en navegador y en Node 18+) ──────────────────────
// plantilla = ArrayBuffer del .xlsx/.xlsm del courier. Devuelve los bytes del Excel listo.
export async function generarExcel(courierId, pedidos, { plantilla, cfg = {}, listas = {} }) {
  const c = COURIERS[courierId];
  if (!c) throw new Error(`Courier desconocido: ${courierId}`);
  const entries = leerZip(plantilla);
  const hoja = entradaPorNombre(entries, c.sheet);
  if (!hoja) throw new Error(`La plantilla de ${c.nombre} cambió de estructura.`);
  const filas = c.filas(pedidos, cfg, listas);
  ponerTexto(hoja, rellenarSheet(await textoDe(hoja), filas, { headerRows: 1 }));
  if (c.tabla) {
    const t = entradaPorNombre(entries, c.tabla);
    if (t) ponerTexto(t, ajustarTablaRef(await textoDe(t), 1 + filas.length));
  }
  // Fecha local del usuario (no UTC: en Perú, de noche toISOString ya da "mañana").
  const hoy = new Intl.DateTimeFormat("en-CA").format(new Date());
  return { bytes: escribirZip(entries), nombreArchivo: `${c.nombre.replace(/\s+/g, "_")}_por_enviar_${hoy}.${c.ext}`, filas: filas.length };
}

// Avisos de datos que faltan ANTES de exportar (array de textos; vacío = todo bien).
export function revisar(courierId, pedidos, { cfg = {}, listas = {} } = {}) {
  return COURIERS[courierId].revisar(pedidos, cfg, listas);
}

// ── Atajos para el navegador ───────────────────────────────────────
// base = carpeta pública donde serviste plantillas/ (con la barra final).
let _listas = null;
export async function cargarListas(base = "plantillas/") {
  if (_listas) return _listas;
  try { const r = await fetch(base + "listas.json", { cache: "no-cache" }); _listas = r.ok ? await r.json() : {}; }
  catch { _listas = {}; }
  return _listas;
}
export async function exportar(courierId, pedidos, { cfg = {}, base = "plantillas/" } = {}) {
  const c = COURIERS[courierId];
  const r = await fetch(base + c.plantilla);
  if (!r.ok) throw new Error(`No pude cargar la plantilla de ${c.nombre}.`);
  const listas = await cargarListas(base);
  const out = await generarExcel(courierId, pedidos, { plantilla: await r.arrayBuffer(), cfg, listas });
  descargar(out.bytes, out.nombreArchivo);
  return out.filas;
}
