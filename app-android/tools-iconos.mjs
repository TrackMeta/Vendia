// Genera los íconos del APK a partir de la V roja (Recursos Iconos/Logo sin Fondo.png, que no se sube al repo):
//   mipmap-*/ic_launcher.png y ic_launcher_round.png → V roja sobre blanco (celulares viejos)
//   mipmap-*/ic_launcher_foreground.png              → V dentro de la zona segura del ícono adaptable (fondo blanco aparte)
//   drawable-*/ic_stat_vendia.png                    → V blanca sobre transparente (ícono chico de los avisos)
//   drawable*/splash.png                             → pantalla de inicio (Android 11 o menos)
// Uso (desde D:\Vendia): node app-android/tools-iconos.mjs   (usa sharp de la web)
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));
const ORIGEN = join(aqui, "..", "Recursos Iconos", "Logo sin Fondo.png");
const RES = join(aqui, "android", "app", "src", "main", "res");
const DENS = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const BLANCO = { r: 255, g: 255, b: 255, alpha: 1 };
const NADA = { r: 0, g: 0, b: 0, alpha: 0 };

// Recorta la V a su contorno (sin el margen transparente del archivo original)
async function recortarV() {
  const { data, info } = await sharp(ORIGEN).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width, y0 = info.height, x1 = 0, y1 = 0;
  for (let i = 0; i < info.width * info.height; i++) {
    if (data[i * 4 + 3] < 8) continue;
    const x = i % info.width, y = Math.floor(i / info.width);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return sharp(ORIGEN).extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }).png().toBuffer();
}

// La V con `ancho` píxeles; blanca = solo la silueta (para los avisos)
async function v(V, ancho, blanca = false) {
  const buf = await sharp(V).resize({ width: Math.round(ancho) }).png().toBuffer();
  if (!blanca) return buf;
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) data[i] = data[i + 1] = data[i + 2] = 255;
  return sharp(data, { raw: info }).png().toBuffer();
}

// Lienzo de w×h con la V centrada encima de `fondo` (color o imagen)
async function lienzo(w, h, V, fondo, archivo) {
  const meta = await sharp(V).metadata();
  const capas = [];
  if (Buffer.isBuffer(fondo)) capas.push({ input: fondo, left: 0, top: 0 });
  capas.push({ input: V, left: Math.round((w - meta.width) / 2), top: Math.round((h - meta.height) / 2) });
  mkdirSync(dirname(archivo), { recursive: true });
  await sharp({ create: { width: w, height: h, channels: 4, background: Buffer.isBuffer(fondo) ? NADA : fondo } })
    .composite(capas)
    .png()
    .toFile(archivo);
}

const forma = (s, redondo) =>
  Buffer.from(
    redondo
      ? `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}"><circle cx="${s / 2}" cy="${s / 2}" r="${s * 0.46}" fill="#fff"/></svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}"><rect x="${s * 0.04}" y="${s * 0.04}" width="${s * 0.92}" height="${s * 0.92}" rx="${s * 0.19}" fill="#fff"/></svg>`,
  );

const V = await recortarV();
for (const [d, k] of Object.entries(DENS)) {
  const mip = join(RES, `mipmap-${d}`);
  const s = Math.round(48 * k);
  await lienzo(s, s, await v(V, s * 0.56), await sharp(forma(s, false)).png().toBuffer(), join(mip, "ic_launcher.png"));
  await lienzo(s, s, await v(V, s * 0.52), await sharp(forma(s, true)).png().toBuffer(), join(mip, "ic_launcher_round.png"));
  // Ícono adaptable: lienzo de 108dp; la V (46% de ancho) queda dentro del círculo seguro de 66dp
  const f = Math.round(108 * k);
  await lienzo(f, f, await v(V, f * 0.46), NADA, join(mip, "ic_launcher_foreground.png"));
  // Avisos: 24dp con 2dp de margen
  const n = Math.round(24 * k);
  await lienzo(n, n, await v(V, 20 * k, true), NADA, join(RES, `drawable-${d}`, "ic_stat_vendia.png"));
}

// Splash para Android 11 o menos (mismos tamaños que la plantilla de Capacitor)
const SPLASH = {
  drawable: [480, 320],
  "drawable-land-mdpi": [480, 320], "drawable-land-hdpi": [800, 480], "drawable-land-xhdpi": [1280, 720],
  "drawable-land-xxhdpi": [1600, 960], "drawable-land-xxxhdpi": [1920, 1280],
  "drawable-port-mdpi": [320, 480], "drawable-port-hdpi": [480, 800], "drawable-port-xhdpi": [720, 1280],
  "drawable-port-xxhdpi": [960, 1600], "drawable-port-xxxhdpi": [1280, 1920],
};
for (const [carpeta, [w, h]] of Object.entries(SPLASH)) {
  await lienzo(w, h, await v(V, Math.min(w, h) * 0.3), BLANCO, join(RES, carpeta, "splash.png"));
}
// Pantalla de inicio animada (MainActivity): la V sola, nítida aunque crezca al abrir la app
mkdirSync(join(RES, "drawable-nodpi"), { recursive: true });
await sharp(await v(V, 480)).toFile(join(RES, "drawable-nodpi", "inicio_v.png"));
console.log("íconos listos en", RES);
