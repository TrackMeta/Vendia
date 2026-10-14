/**
 * Canales de aviso de la app de celular (Android). Cada sonido es un canal con su archivo
 * en res/raw (mismo nombre): Android toca el sonido del canal aunque la app esté cerrada.
 * Los mismos nombres usa la app (app-android) al crearlos.
 */
import { SOUNDS, type SoundKind } from "@/modules/notifications/sound";

export const PUSH_SILENT_CHANNEL = "vendia_silencio";

export function pushChannelFor(sound: SoundKind): string {
  return `vendia_${sound}`;
}

/** Todos los canales que crea la app: uno por sonido y uno sin sonido. */
export const PUSH_CHANNELS: { id: string; name: string; sound: SoundKind | null }[] = [
  ...(Object.keys(SOUNDS) as SoundKind[]).map((k) => ({ id: pushChannelFor(k), name: `Avisos · ${SOUNDS[k]}`, sound: k })),
  { id: PUSH_SILENT_CHANNEL, name: "Avisos sin sonido", sound: null },
];

export type PushDevicePrefs = { sound: string; sound_enabled: boolean; only_orders: boolean };

/** Mismo criterio que la campanita web: sin sonido si lo apagó, o si solo quiere sonido con pedidos nuevos. */
export function channelForNotification(device: PushDevicePrefs, type: string): string {
  if (!device.sound_enabled) return PUSH_SILENT_CHANNEL;
  if (device.only_orders && type !== "new_order") return PUSH_SILENT_CHANNEL;
  return device.sound in SOUNDS ? pushChannelFor(device.sound as SoundKind) : pushChannelFor("dingdong");
}
