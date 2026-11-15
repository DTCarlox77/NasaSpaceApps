import * as Speech from 'expo-speech';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

/**
 * Texto a voz (offline-first).
 * Usa el motor TTS del sistema operativo. Elegimos una voz instalada en el
 * dispositivo para el idioma configurado y descartamos las voces "network"
 * de Android, que sí requieren internet.
 */

export const TTS_LOCALES: Record<string, string> = { es: 'es-ES', en: 'en-US' };

export interface TtsVoiceInfo {
  identifier: string;
  name: string;
  language: string;
  /** false = la voz declara que necesita red. null = el sistema no lo indica. */
  offline: boolean | null;
}

const voiceCache = new Map<string, TtsVoiceInfo | null>();

/**
 * Estilo "megafonía de estación": voz femenina serena, un poco más grave y pausada,
 * precedida por un tono de aviso propio (assets/sounds). Se prefieren voces femeninas
 * de alta calidad instaladas en el dispositivo (Google TTS / Samsung / iOS).
 */
export const ANNOUNCER = { pitch: 0.9, rate: 0.88 } as const;
const FEMALE_HINTS = ['female', 'mujer', '-eea', '-eec', '-sfg', '-iob', '-tpc', '-tpf', '-esc', '-sfb', 'smtf', 'helena', 'laura', 'monica', 'mónica', 'paulina', 'samantha', 'zira', 'ava', 'allison', 'susan'];
const MALE_HINTS = ['male', 'hombre', '-eed', '-eef', '-iol', '-iom', '-tpd', '-esd', 'smtm', 'jorge', 'diego', 'david', 'alex', 'fred'];
const genderScore = (v: { identifier: string; name: string }) => {
  const id = `${v.identifier} ${v.name}`.toLowerCase();
  if (FEMALE_HINTS.some((h) => id.includes(h))) return 3;
  if (MALE_HINTS.some((h) => id.includes(h))) return -2;
  return 0;
};

const CHIMES = {
  info: require('../../../assets/sounds/chime-info.wav'),
  critical: require('../../../assets/sounds/chime-critical.wav'),
};
const players: Partial<Record<keyof typeof CHIMES, AudioPlayer>> = {};
let audioReady = false;

/** Tono de aviso antes del anuncio. Devuelve cuánto esperar antes de hablar (ms). */
async function playChime(kind: keyof typeof CHIMES): Promise<number> {
  try {
    if (!audioReady) {
      await setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
      audioReady = true;
    }
    const player = (players[kind] ??= createAudioPlayer(CHIMES[kind]));
    await player.seekTo(0);
    player.play();
    return kind === 'critical' ? 950 : 700;
  } catch {
    return 0;
  }
}

const norm = (code: string) => code.replace('_', '-').toLowerCase();

function classify(identifier: string): boolean | null {
  const id = identifier.toLowerCase();
  if (id.includes('network')) return false; // Android: es-es-x-eea-network
  if (id.includes('local')) return true; // Android: es-es-x-eea-local
  return null; // iOS: las voces instaladas funcionan offline
}

/** Mejor voz offline para el idioma (cacheada). */
export async function resolveVoice(language: string): Promise<TtsVoiceInfo | null> {
  if (voiceCache.has(language)) return voiceCache.get(language) ?? null;
  let best: TtsVoiceInfo | null = null;
  try {
    const preferred = norm(TTS_LOCALES[language] ?? language);
    const voices = (await Speech.getAvailableVoicesAsync())
      .filter((v) => norm(v.language).startsWith(language))
      .map((v) => ({ identifier: v.identifier, name: v.name, language: v.language, offline: classify(v.identifier), quality: v.quality }))
      .filter((v) => v.offline !== false);

    const score = (v: (typeof voices)[number]) =>
      (v.offline === true ? 4 : 0) + (norm(v.language) === preferred ? 2 : 0) + (v.quality === Speech.VoiceQuality.Enhanced ? 2 : 0) + genderScore(v);
    voices.sort((a, b) => score(b) - score(a));
    const top = voices[0];
    best = top ? { identifier: top.identifier, name: top.name, language: top.language, offline: top.offline ?? true } : null;
  } catch {
    best = null;
  }
  voiceCache.set(language, best);
  return best;
}

export interface SpeakOptions {
  rate?: number;
  onDone?: () => void;
  /** Tono previo: 'info' (por defecto), 'critical' o false para hablar sin tono. */
  chime?: 'info' | 'critical' | false;
}

/** Habla en el idioma indicado ('es' | 'en'). Interrumpe lo que se esté diciendo. */
export async function speak(text: string, language: string, options: SpeakOptions = {}) {
  if (!text.trim()) return;
  await Speech.stop().catch(() => {});
  const [voice, wait] = await Promise.all([resolveVoice(language), options.chime === false ? 0 : playChime(options.chime ?? 'info')]);
  if (wait) await new Promise((r) => setTimeout(r, wait));
  Speech.speak(text, {
    language: voice?.language ?? TTS_LOCALES[language] ?? 'en-US',
    voice: voice?.identifier,
    rate: options.rate ?? ANNOUNCER.rate,
    pitch: ANNOUNCER.pitch,
    onDone: options.onDone,
    onStopped: options.onDone,
    onError: options.onDone,
  });
}

export function stopSpeaking() {
  Speech.stop().catch(() => {});
}
