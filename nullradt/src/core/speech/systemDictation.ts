import { Platform } from 'react-native';
import * as IntentLauncher from 'expo-intent-launcher';
import { SPEECH_LOCALES } from './speechRecognition';

/**
 * Dictado con el reconocedor del sistema (Android, intent RECOGNIZE_SPEECH).
 * Funciona también en Expo Go, donde no existe el módulo nativo de reconocimiento.
 * Usa el idioma de la app ('es' → es-ES, 'en' → en-US); si el teléfono tiene el paquete
 * de idioma descargado, el reconocimiento funciona sin conexión.
 */
export const systemDictationAvailable = Platform.OS === 'android';

export async function dictateWithSystem(language: string, prompt: string): Promise<string | null> {
  if (!systemDictationAvailable) return null;
  const locale = SPEECH_LOCALES[language] ?? 'en-US';
  const res = await IntentLauncher.startActivityAsync('android.speech.action.RECOGNIZE_SPEECH', {
    extra: {
      'android.speech.extra.LANGUAGE_MODEL': 'free_form',
      'android.speech.extra.LANGUAGE': locale,
      'android.speech.extra.LANGUAGE_PREFERENCE': locale,
      'android.speech.extra.PROMPT': prompt,
      'android.speech.extra.MAX_RESULTS': 1,
    },
  });
  if (res.resultCode !== IntentLauncher.ResultCode.Success) return null;
  const results = (res.extra as Record<string, unknown> | undefined)?.['android.speech.extra.RESULTS'];
  const text = Array.isArray(results) ? String(results[0] ?? '') : '';
  return text.trim() || null;
}
