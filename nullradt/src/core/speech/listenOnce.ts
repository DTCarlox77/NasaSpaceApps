import { Platform } from 'react-native';
import { AudioModule } from 'expo-audio';
import { getOfflineSupport, getSpeechRecognition } from './speechRecognition';
import { dictateWithSystem, systemDictationAvailable } from './systemDictation';

/**
 * Escucha corta para respuestas de vocabulario cerrado (triaje).
 * - Development build (módulo nativo `expo-speech-recognition`): escucha unos segundos, en el dispositivo
 *   (`requiresOnDeviceRecognition`) cuando `getOfflineSupport` dice que hay modelo, con `contextualStrings`
 *   (las opciones de la pregunta) para sesgar el reconocimiento. Devuelve las alternativas.
 * - Expo Go en Android (sin módulo nativo): reconocedor del sistema (`dictateWithSystem`), con un toque.
 * - Expo Go en iOS: sin reconocimiento (solo botones; la voz que LEE sí funciona).
 */
export type ListenMode = 'native' | 'system' | 'none';

export const listenMode = (): ListenMode => (getSpeechRecognition() ? 'native' : systemDictationAvailable ? 'system' : 'none');

export type MicPermission = 'granted' | 'denied';

/** Pide el micrófono (y el reconocedor, si existe). En Expo Go se usa expo-audio (incluido en Expo Go). */
export async function requestMicPermission(): Promise<MicPermission> {
  try {
    const rec = getSpeechRecognition();
    if (rec) return (await rec.requestPermissionsAsync()).granted ? 'granted' : 'denied';
    if (Platform.OS === 'web') return 'denied';
    return (await AudioModule.requestRecordingPermissionsAsync()).granted ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

export interface ListenResult {
  /** Transcripciones posibles (la primera es la más probable). Vacío = no se oyó nada útil. */
  alternatives: string[];
  error?: 'permission' | 'unavailable' | 'failed';
  /** true = se reconoció en el dispositivo (sin red). */
  offline: boolean;
}

export interface OfflineVoiceInfo {
  mode: ListenMode;
  /** null = no se puede saber; false = el idioma no tiene modelo sin conexión instalado. */
  offlineModel: boolean | null;
}

export async function offlineVoiceInfo(language: string): Promise<OfflineVoiceInfo> {
  const mode = listenMode();
  if (mode !== 'native') return { mode, offlineModel: null };
  const s = await getOfflineSupport(language);
  return { mode, offlineModel: s.onDeviceSupported ? s.installed : false };
}

let active: { abort: () => void } | null = null;

/** Corta una escucha en curso (al salir de la pantalla o al tocar un botón). */
export function cancelListening() {
  active?.abort();
  active = null;
}

/** Escucha hasta `timeoutMs` (o hasta el resultado final) y devuelve lo reconocido. */
export async function listenOnce(opts: { language: string; contextualStrings?: string[]; timeoutMs?: number; prompt?: string }): Promise<ListenResult> {
  cancelListening();
  const rec = getSpeechRecognition();
  if (!rec) {
    if (!systemDictationAvailable) return { alternatives: [], error: 'unavailable', offline: false };
    try {
      const text = await dictateWithSystem(opts.language, opts.prompt ?? '');
      return { alternatives: text ? [text] : [], offline: false };
    } catch {
      return { alternatives: [], error: 'failed', offline: false };
    }
  }

  const support = await getOfflineSupport(opts.language);
  const onDevice = support.onDeviceSupported && support.installed !== false;
  return new Promise<ListenResult>((resolve) => {
    let done = false;
    let alternatives: string[] = [];
    const subs: { remove: () => void }[] = [];
    const finish = (r: Omit<ListenResult, 'offline'>) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(hardStop);
      subs.forEach((s) => s.remove());
      if (active === handle) active = null;
      resolve({ ...r, offline: onDevice });
    };
    const handle = {
      abort: () => {
        try {
          rec.abort();
        } catch {
          // ya estaba detenido
        }
        finish({ alternatives: [] });
      },
    };
    active = handle;
    subs.push(
      rec.addListener('result', (e) => {
        const list = (e.results ?? []).map((r) => r.transcript).filter((t): t is string => !!t && !!t.trim());
        if (list.length) alternatives = list;
        if (e.isFinal) finish({ alternatives });
      }),
      rec.addListener('error', (e) => {
        if (e.error === 'not-allowed') finish({ alternatives: [], error: 'permission' });
        else if (e.error === 'no-speech' || e.error === 'aborted' || e.error === 'speech-timeout') finish({ alternatives });
        else finish({ alternatives, error: 'failed' });
      }),
      rec.addListener('end', () => finish({ alternatives })),
    );
    // "Unos segundos": al vencer se pide el resultado final; si no llega, se corta.
    const timer = setTimeout(() => {
      try {
        rec.stop();
      } catch {
        // ya estaba detenido
      }
    }, opts.timeoutMs ?? 6000);
    const hardStop = setTimeout(() => handle.abort(), (opts.timeoutMs ?? 6000) + 2500);
    try {
      rec.start({
        lang: support.locale,
        interimResults: true,
        continuous: false,
        maxAlternatives: 5,
        requiresOnDeviceRecognition: onDevice,
        addsPunctuation: false,
        contextualStrings: opts.contextualStrings,
      });
    } catch {
      finish({ alternatives: [], error: 'failed' });
    }
  });
}
