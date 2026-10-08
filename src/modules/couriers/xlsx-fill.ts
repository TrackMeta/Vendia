/**
 * Rellena una plantilla .xlsx/.xlsm REAL del courier (portado del kit de Nodo, ya probado
 * con la carga masiva de Shalom y Eva).
 *
 * No se inventa un Excel nuevo: se toma una copia del archivo original y solo se reemplaza
 * el `sheetData` de UNA hoja (cabecera + filas). Todo lo demás (macros, validaciones,
 * tablas, estilos) se copia byte por byte, así el portal del courier lo acepta.
 * Funciona en el navegador y en Node 18+ sin librerías.
 */

export type ZipEntry = {
  name: string;
  flag: number;
  method: number;
  time: number;
  date: number;
  crc: number;
  uncompSize: number;
  extAttr: number;
  data: Uint8Array;
};

/** Celda: null/"" se omite; {t:"n"} = número; cualquier otra cosa = texto. */
export type Cell = string | { t: "n"; v: number } | null | undefined;

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(u8: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Lee el ZIP conservando los bytes comprimidos de cada entrada (las partes no tocadas salen idénticas). */
export function readZip(buf: ArrayBuffer): ZipEntry[] {
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= 0 && i > u8.length - 66000; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("El archivo no parece un Excel válido.");
  const nEntries = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const entries: ZipEntry[] = [];
  for (let i = 0; i < nEntries; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const flag = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const time = dv.getUint16(p + 12, true);
    const date = dv.getUint16(p + 14, true);
    const crc = dv.getUint32(p + 16, true);
    const compSize = dv.getUint32(p + 20, true);
    const uncompSize = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const cmtLen = dv.getUint16(p + 32, true);
    const extAttr = dv.getUint32(p + 38, true);
    const lhOff = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    const lhNameLen = dv.getUint16(lhOff + 26, true);
    const lhExtraLen = dv.getUint16(lhOff + 28, true);
    const start = lhOff + 30 + lhNameLen + lhExtraLen;
    entries.push({ name, flag, method, time, date, crc, uncompSize, extAttr, data: u8.slice(start, start + compSize) });
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return entries;
}

async function inflate(entry: ZipEntry): Promise<Uint8Array> {
  if (entry.method === 0) return entry.data;
  const stream = new Blob([entry.data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function entryText(entry: ZipEntry): Promise<string> {
  return new TextDecoder("utf-8").decode(await inflate(entry));
}

export const entryByName = (entries: ZipEntry[], name: string) => entries.find((e) => e.name === name);

/** Reemplaza una entrada por texto nuevo, guardado sin comprimir (method 0). */
export function setEntryText(entry: ZipEntry, text: string) {
  const bytes = new TextEncoder().encode(text);
  entry.method = 0;
  entry.flag = 0;
  entry.data = bytes;
  entry.uncompSize = bytes.length;
  entry.crc = crc32(bytes);
}

export function writeZip(entries: ZipEntry[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const push = (arr: Uint8Array) => {
    parts.push(arr);
    offset += arr.length;
  };
  for (const e of entries) {
    const nameB = enc.encode(e.name);
    const flag = e.flag & ~0x08; // sin "data descriptor": los tamaños van en la cabecera
    const lh = new Uint8Array(30 + nameB.length);
    const dv = new DataView(lh.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, flag, true);
    dv.setUint16(8, e.method, true);
    dv.setUint16(10, e.time || 0, true);
    dv.setUint16(12, e.date || 0, true);
    dv.setUint32(14, e.crc, true);
    dv.setUint32(18, e.data.length, true);
    dv.setUint32(22, e.uncompSize, true);
    dv.setUint16(26, nameB.length, true);
    dv.setUint16(28, 0, true);
    lh.set(nameB, 30);
    const localOff = offset;
    push(lh);
    push(e.data);
    const cd = new Uint8Array(46 + nameB.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, flag, true);
    cv.setUint16(10, e.method, true);
    cv.setUint16(12, e.time || 0, true);
    cv.setUint16(14, e.date || 0, true);
    cv.setUint32(16, e.crc, true);
    cv.setUint32(20, e.data.length, true);
    cv.setUint32(24, e.uncompSize, true);
    cv.setUint16(28, nameB.length, true);
    cv.setUint32(38, e.extAttr || 0, true);
    cv.setUint32(42, localOff, true);
    cd.set(nameB, 46);
    central.push(cd);
  }
  const cdStart = offset;
  let cdSize = 0;
  for (const c of central) {
    push(c);
    cdSize += c.length;
  }
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, cdStart, true);
  push(eocd);
  const out = new Uint8Array(offset);
  let o = 0;
  for (const c of parts) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

// Además de escapar & < > ", se quitan los caracteres de control inválidos en XML: uno pegado
// en una dirección hacía que el portal del courier reportara «archivo dañado».
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g;
export const escXml = (s: unknown) =>
  String(s ?? "")
    .replace(CONTROL_CHARS, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export function colLetter(n: number): string {
  let s = "";
  let x = n + 1;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

/** Conserva `headerRows` filas de cabecera y reemplaza el resto (borra los ejemplos). */
export function fillSheet(xml: string, rows: Cell[][], { headerRows = 1 } = {}): string {
  const m = xml.match(/<sheetData(\s[^>]*)?>([\s\S]*?)<\/sheetData>/);
  if (!m || m.index === undefined) throw new Error("La hoja no tiene sheetData.");
  const existing = m[2].match(/<row[^>]*\/>|<row[\s\S]*?<\/row>/g) ?? [];
  const header = existing.slice(0, headerRows).join("");
  let body = "";
  rows.forEach((row, idx) => {
    const r = headerRows + 1 + idx;
    let cells = "";
    row.forEach((cell, col) => {
      if (cell == null || cell === "") return;
      const ref = colLetter(col) + r;
      if (typeof cell === "object" && cell.t === "n") cells += `<c r="${ref}"><v>${cell.v}</v></c>`;
      else cells += `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escXml(cell)}</t></is></c>`;
    });
    body += `<row r="${r}">${cells}</row>`;
  });
  const replaced = `<sheetData${m[1] ?? ""}>${header}${body}</sheetData>`;
  let out = xml.slice(0, m.index) + replaced + xml.slice(m.index + m[0].length);
  const lastRow = Math.max(headerRows + rows.length, 1);
  out = out.replace(/<dimension ref="([A-Z]+)\d+:([A-Z]+)\d+"\s*\/>/, (_, c1, c2) => `<dimension ref="${c1}1:${c2}${lastRow}"/>`);
  return out;
}

/** Ajusta el rango de una tabla de Excel: si declara filas que no existen, Excel dice «archivo dañado». */
export function adjustTableRef(tableXml: string, lastRow: number): string {
  const fix = (s: string) =>
    s.replace(/(ref=")([A-Z]+)(\d+):([A-Z]+)(\d+)(")/, (_, a, c1, r1, c2, _r2, b) => `${a}${c1}${r1}:${c2}${Math.max(lastRow, Number(r1))}${b}`);
  let out = tableXml.replace(/<table [^>]*ref="[^"]*"[^>]*>/, fix);
  out = out.replace(/<autoFilter [^>]*ref="[^"]*"[^>]*\/?>/, fix);
  return out;
}
