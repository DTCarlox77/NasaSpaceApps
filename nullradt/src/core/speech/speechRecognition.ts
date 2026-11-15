import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import type { ExpoSpeechRecognitionModule as Module } from 'expo-speech-recognition';

/**
 * Adaptador de voz a texto (offline-first).
 * `expo-speech-recognition` NO está incluido en Expo Go: importarlo directamente
 * cerraría la app. Comprobamos primero si el módulo nativo existe y solo
 * entonces lo cargamos. En Expo Go → `null` y la UI oculta el micrófono.
 */
const nativeAvailable = requireOptionalNativeModule('ExpoSpeechRecognition') != null;

let cached: typeof Module | null | undefined;

export function getSpeechRecognition(): typeof Module | null {
  if (cached !== undefined) return cached;
  cached = nativeAvailable
    ? (require('expo-speech-recognition') as typeof import('expo-speech-recognition')).ExpoSpeechRecognitionModule
    : null;
  return cached;
}

export const SPEECH_LOCALES: Record<string, string> = { es: 'es-ES', en: 'en-US' };

export interface OfflineSupport {
  /** El dispositivo puede reconocer voz sin red. */
  onDeviceSupported: boolean;
  /** Hay un modelo offline instalado para este idioma (Android 13+). null = no se puede saber. */
  installed: boolean | null;
  /** Locale exacto a usar (p. ej. es-US si ese es el modelo instalado). */
  locale: string;
}

/** Determina si se puede reconocer el idioma sin conexión y con qué locale. */
export async function getOfflineSupport(language: string): Promise<OfflineSupport> {
  const fallback = SPEECH_LOCALES[language] ?? 'en-US';
  const rec = getSpeechRecognition();
  if (!rec) return { onDeviceSupported: false, installed: false, locale: fallback };

  const onDeviceSupported = rec.supportsOnDeviceRecognition();
  try {
    const { locales, installedLocales } = await rec.getSupportedLocales({});
    const match = (list: string[]) =>
      list.find((l) => l.toLowerCase() === fallback.toLowerCase()) ??
      list.find((l) => l.toLowerCase().startsWith(language));
    if (Platform.OS === 'android') {
      const installed = match(installedLocales);
      return { onDeviceSupported, installed: !!installed, locale: installed ?? match(locales) ?? fallback };
    }
    // iOS: si soporta on-device, los idiomas descargados en Dictado funcionan offline.
    return { onDeviceSupported, installed: onDeviceSupported ? null : false, locale: match(locales) ?? fallback };
  } catch {
    return { onDeviceSupported, installed: null, locale: fallback };
  }
}

/** Android 13+: pide al sistema descargar el modelo offline del idioma. */
export async function downloadOfflineModel(language: string) {
  const rec = getSpeechRecognition();
  if (!rec || Platform.OS !== 'android') return null;
  return rec.androidTriggerOfflineModelDownload({ locale: SPEECH_LOCALES[language] ?? 'en-US' });
}
