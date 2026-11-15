import { useCallback, useEffect, useRef, useState } from 'react';
import { stopSpeaking } from '@/core/speech/speech';
import { getOfflineSupport, getSpeechRecognition } from '@/core/speech/speechRecognition';

export type DictationError = 'permission' | 'unavailable' | 'offlineUnavailable' | 'failed';
/** Cómo se está reconociendo la voz. */
export type DictationMode = 'offline' | 'online';

export interface DictationOptions {
  /** Si no hay modelo offline, usar el servicio en línea del sistema. Por defecto true. */
  allowNetworkFallback?: boolean;
  onFinal?: (text: string) => void;
}

/**
 * Dictado por voz en el idioma configurado ('es' | 'en').
 * Offline-first: si el dispositivo tiene el modelo del idioma, se fuerza el
 * reconocimiento en el dispositivo. Solo si no lo tiene (y se permite) usa la red.
 */
export function useVoiceDictation(language: string, options: DictationOptions = {}) {
  const { allowNetworkFallback = true } = options;
  const recognizer = getSpeechRecognition();
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<DictationError | null>(null);
  const [mode, setMode] = useState<DictationMode | null>(null);
  const onFinalRef = useRef(options.onFinal);
  onFinalRef.current = options.onFinal;
  const session = useRef<{ locale: string; triedOnline: boolean; allowNetwork: boolean } | null>(null);

  useEffect(() => {
    if (!recognizer) return;
    const subs = [
      recognizer.addListener('start', () => setListening(true)),
      recognizer.addListener('end', () => setListening(false)),
      recognizer.addListener('result', (e) => {
        const text = e.results[0]?.transcript ?? '';
        setTranscript(text);
        if (e.isFinal && text) onFinalRef.current?.(text);
      }),
      recognizer.addListener('error', (e) => {
        const s = session.current;
        // El modelo offline falló/no existe: reintentar en línea una sola vez (si se permite).
        if (e.error === 'language-not-supported' && s && !s.triedOnline && s.allowNetwork) {
          s.triedOnline = true;
          setMode('online');
          recognizer.start({ lang: s.locale, interimResults: true, requiresOnDeviceRecognition: false, addsPunctuation: true });
          return;
        }
        setListening(false);
        if (e.error === 'not-allowed') setError('permission');
        else if (e.error === 'language-not-supported' || e.error === 'network') setError('offlineUnavailable');
        else if (e.error !== 'aborted' && e.error !== 'no-speech') setError('failed');
      }),
    ];
    return () => {
      subs.forEach((s) => s.remove());
      recognizer.abort();
    };
  }, [recognizer]);

  const start = useCallback(async () => {
    if (!recognizer) return setError('unavailable');
    stopSpeaking(); // que el micrófono no capte la voz de la propia app
    setError(null);
    setTranscript('');
    const perm = await recognizer.requestPermissionsAsync();
    if (!perm.granted) return setError('permission');

    const support = await getOfflineSupport(language);
    const canOffline = support.onDeviceSupported && support.installed !== false;
    if (!canOffline && !allowNetworkFallback) return setError('offlineUnavailable');

    session.current = { locale: support.locale, triedOnline: !canOffline, allowNetwork: allowNetworkFallback };
    setMode(canOffline ? 'offline' : 'online');
    recognizer.start({
      lang: support.locale,
      interimResults: true,
      continuous: false,
      requiresOnDeviceRecognition: canOffline,
      addsPunctuation: true,
    });
  }, [recognizer, language, allowNetworkFallback]);

  const stop = useCallback(() => recognizer?.stop(), [recognizer]);
  const reset = useCallback(() => setTranscript(''), []);

  return { supported: recognizer != null, listening, transcript, error, mode, start, stop, reset };
}
