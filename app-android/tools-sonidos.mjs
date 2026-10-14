// Genera los sonidos de los avisos del APK (WAV 16 bits mono 44,1 kHz) con LAS MISMAS NOTAS que la web
// (src/modules/notifications/sound.ts, PATTERNS) a volumen «alto», para que el celular suene igual que el panel:
//   dingdong · caja · moneda · campana  → canales vendia_dingdong, vendia_caja, vendia_moneda, vendia_campana
// (vendia_silencio no lleva archivo). Si cambian las notas en sound.ts, copiarlas aquí y volver a correr.
// Uso (desde D:\Vendia): node app-android/tools-sonidos.mjs  → android/app/src/main/res/raw/*.wav
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SR = 44100;
const PICO = 0.5; // GAIN.alto de sound.ts
const COLA = 0.15; // silencio al final

// Copia de PATTERNS (sound.ts): at = inicio, freq, dur, type (sine por defecto), level (1 por defecto)
const PATRONES = {
  dingdong: [
    { at: 0, freq: 880, dur: 0.15 },
    { at: 0.16, freq: 1320, dur: 0.15 },
  ],
  caja: [
    { at: 0, freq: 2100, dur: 0.05, type: "square", level: 0.35 },
    { at: 0.06, freq: 1568, dur: 0.12, type: "triangle" },
    { at: 0.18, freq: 2093, dur: 0.12, type: "triangle" },
    { at: 0.18, freq: 2637, dur: 0.35, type: "sine", level: 0.6 },
  ],
  moneda: [
    { at: 0, freq: 988, dur: 0.08, type: "square", level: 0.4 },
    { at: 0.08, freq: 1319, dur: 0.35, type: "square", level: 0.4 },
  ],
  campana: [
    { at: 0, freq: 1046, dur: 1.1 },
    { at: 0, freq: 2093, dur: 0.7, level: 0.35 },
    { at: 0, freq: 3136, dur: 0.4, level: 0.2 },
  ],
};

// Ondas sin «serrucho» (como WebAudio): suma de armónicos hasta 20 kHz
function onda(tipo, f, t) {
  const w = 2 * Math.PI * f * t;
  if (tipo === "square") {
    let s = 0;
    for (let k = 1; k * f < 20000; k += 2) s += Math.sin(k * w) / k;
    return (4 / Math.PI) * s;
  }
  if (tipo === "triangle") {
    let s = 0;
    for (let k = 1, signo = 1; k * f < 20000; k += 2, signo = -signo) s += (signo * Math.sin(k * w)) / (k * k);
    return (8 / (Math.PI * Math.PI)) * s;
  }
  return Math.sin(w);
}

// Misma envolvente que la web: 0.0001 → pico en 10 ms → 0.0001 al final de la nota (rampas exponenciales)
function nota(buf, n) {
  const pico = Math.max(PICO * (n.level ?? 1), 0.0002);
  const ataque = 0.01;
  const a = Math.round(n.at * SR);
  const largo = Math.round((n.dur + 0.02) * SR);
  for (let i = 0; i < largo && a + i < buf.length; i++) {
    const t = i / SR;
    let e;
    if (t < ataque) e = 0.0001 * Math.pow(pico / 0.0001, t / ataque);
    else if (t < n.dur) e = pico * Math.pow(0.0001 / pico, (t - ataque) / (n.dur - ataque));
    else e = 0.0001;
    buf[a + i] += e * onda(n.type ?? "sine", n.freq, t);
  }
}

function wav(m) {
  const n = m.length, b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(SR, 24);
  b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(m[i] * 32767))), 44 + i * 2);
  return b;
}

const dir = join(dirname(fileURLToPath(import.meta.url)), "android", "app", "src", "main", "res", "raw");
mkdirSync(dir, { recursive: true });
for (const [nombre, notas] of Object.entries(PATRONES)) {
  const fin = Math.max(...notas.map((n) => n.at + n.dur + 0.02));
  const buf = new Float32Array(Math.round((fin + COLA) * SR));
  for (const n of notas) nota(buf, n);
  writeFileSync(join(dir, `${nombre}.wav`), wav(buf));
}
console.log("sonidos:", Object.keys(PATRONES).join(", "));
