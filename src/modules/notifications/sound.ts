/**
 * Sonido de los avisos de Vendia (con la app abierta). Se generan con el navegador, sin archivos.
 * Cada persona elige el suyo en su celular o computadora (se guarda en ese navegador).
 */
export const SOUNDS = {
  dingdong: "Ding-dong",
  caja: "Caja registradora",
  moneda: "Moneda",
  campana: "Campana",
} as const;
export type SoundKind = keyof typeof SOUNDS;

export const VOLUMES = { bajo: "Bajo", medio: "Medio", alto: "Alto" } as const;
export type SoundVolume = keyof typeof VOLUMES;
const GAIN: Record<SoundVolume, number> = { bajo: 0.1, medio: 0.25, alto: 0.5 };

export type SoundPrefs = { enabled: boolean; sound: SoundKind; volume: SoundVolume; onlyOrders: boolean };
export const DEFAULT_SOUND_PREFS: SoundPrefs = { enabled: true, sound: "dingdong", volume: "medio", onlyOrders: false };

export const SOUND_PREFS_KEY = "vd_sound";
export const SOUND_PREFS_EVENT = "vendia:sound-prefs";

/** Lee lo guardado; cualquier valor raro vuelve al predeterminado. */
export function parseSoundPrefs(raw: string | null | undefined): SoundPrefs {
  try {
    const v = JSON.parse(raw ?? "{}") as Partial<SoundPrefs>;
    return {
      enabled: typeof v.enabled === "boolean" ? v.enabled : DEFAULT_SOUND_PREFS.enabled,
      sound: v.sound && v.sound in SOUNDS ? v.sound : DEFAULT_SOUND_PREFS.sound,
      volume: v.volume && v.volume in VOLUMES ? v.volume : DEFAULT_SOUND_PREFS.volume,
      onlyOrders: typeof v.onlyOrders === "boolean" ? v.onlyOrders : DEFAULT_SOUND_PREFS.onlyOrders,
    };
  } catch {
    return { ...DEFAULT_SOUND_PREFS };
  }
}

export function readSoundPrefs(): SoundPrefs {
  try {
    return parseSoundPrefs(localStorage.getItem(SOUND_PREFS_KEY));
  } catch {
    return { ...DEFAULT_SOUND_PREFS };
  }
}

export function saveSoundPrefs(prefs: SoundPrefs) {
  try {
    localStorage.setItem(SOUND_PREFS_KEY, JSON.stringify(prefs));
  } catch {}
  window.dispatchEvent(new Event(SOUND_PREFS_EVENT));
}

/** ¿Suena este aviso? Con «solo pedidos nuevos», el resto aparece en pantalla sin sonido. */
export function shouldPlay(prefs: SoundPrefs, kind: "new_order" | "other"): boolean {
  if (!prefs.enabled) return false;
  return prefs.onlyOrders ? kind === "new_order" : true;
}

type Note = { at: number; freq: number; dur: number; type?: OscillatorType; level?: number };

const PATTERNS: Record<SoundKind, Note[]> = {
  // Dos tonos (el de siempre)
  dingdong: [
    { at: 0, freq: 880, dur: 0.15 },
    { at: 0.16, freq: 1320, dur: 0.15 },
  ],
  // «Cha-ching»: golpe corto y dos campanitas agudas
  caja: [
    { at: 0, freq: 2100, dur: 0.05, type: "square", level: 0.35 },
    { at: 0.06, freq: 1568, dur: 0.12, type: "triangle" },
    { at: 0.18, freq: 2093, dur: 0.12, type: "triangle" },
    { at: 0.18, freq: 2637, dur: 0.35, type: "sine", level: 0.6 },
  ],
  // Moneda: dos notas rápidas, la segunda más larga
  moneda: [
    { at: 0, freq: 988, dur: 0.08, type: "square", level: 0.4 },
    { at: 0.08, freq: 1319, dur: 0.35, type: "square", level: 0.4 },
  ],
  // Campana: una nota con armónicos que se apaga lento
  campana: [
    { at: 0, freq: 1046, dur: 1.1 },
    { at: 0, freq: 2093, dur: 0.7, level: 0.35 },
    { at: 0, freq: 3136, dur: 0.4, level: 0.2 },
  ],
};

/** Toca el sonido. Los navegadores lo permiten después de que la persona tocó algo en la página. */
export function playSound(sound: SoundKind = "dingdong", volume: SoundVolume = "medio") {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const peakBase = GAIN[volume] ?? GAIN.medio;
    let end = 0;
    for (const n of PATTERNS[sound] ?? PATTERNS.dingdong) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = n.type ?? "sine";
      osc.frequency.value = n.freq;
      const t = ctx.currentTime + n.at;
      const peak = Math.max(peakBase * (n.level ?? 1), 0.0002);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(peak, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + n.dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + n.dur + 0.02);
      end = Math.max(end, n.at + n.dur);
    }
    setTimeout(() => void ctx.close(), (end + 0.3) * 1000);
  } catch {}
}

/** Toca el sonido elegido por esta persona si corresponde a este tipo de aviso. */
export function playNotificationSound(kind: "new_order" | "other") {
  const prefs = readSoundPrefs();
  if (shouldPlay(prefs, kind)) playSound(prefs.sound, prefs.volume);
}
