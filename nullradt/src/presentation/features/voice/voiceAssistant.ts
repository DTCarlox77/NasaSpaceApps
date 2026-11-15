import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import i18n from '@/core/i18n';
import { speak, stopSpeaking } from '@/core/speech/speech';
import {
  getOfflineSupport,
  getRecognizerOwner,
  getSpeechRecognition,
  onRecognizerOwnerChange,
  setRecognizerOwner,
} from '@/core/speech/speechRecognition';
import { detectWake, normalize } from '@/core/voice/commandParser';
import type { VoiceDialog, VoiceReply } from './voiceCommands';

/**
 * ASISTENTE DE VOZ "NullRadt" (manos libres).
 * Escucha de forma continua y en el dispositivo (sin internet) hasta oír "NullRadt"; entonces toma la orden
 * (en la misma frase o en la siguiente), la ejecuta y responde en voz alta. Mientras habla, deja de escuchar
 * para no oírse a sí mismo. Cede el micrófono a los dictados de notas y lo retoma al terminar.
 * Requiere el APK (expo-speech-recognition no existe en Expo Go); allí los comandos se pueden escribir.
 */
export type AssistantStatus = 'off' | 'unsupported' | 'starting' | 'listening' | 'awake' | 'thinking' | 'speaking' | 'dialog' | 'paused' | 'error';

interface VoiceState {
  enabled: boolean;
  status: AssistantStatus;
  transcript: string;
  lastCommand: string;
  lastReply: string;
  error: string | null;
  setEnabled: (on: boolean) => void;
}

export const useVoiceStore = create<VoiceState>()(
  persist(
    (set) => ({
      enabled: true,
      status: 'off',
      transcript: '',
      lastCommand: '',
      lastReply: '',
      error: null,
      setEnabled: (enabled) => set({ enabled }),
    }),
    { name: 'nullradt-voice', storage: createJSONStorage(() => AsyncStorage), partialize: ({ enabled }) => ({ enabled }) },
  ),
);

const rec = getSpeechRecognition();
export const voiceSupported = rec != null;

/** Tiempo para decir la orden después de "NullRadt". */
const AWAKE_MS = 8000;
const DIALOG_MS = 25000;

let active = false; // el asistente debe estar escuchando (habilitado, app al frente y con sesión)
let dialog: VoiceDialog | null = null;
let awakeTimer: ReturnType<typeof setTimeout> | null = null;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
let handled = ''; // última frase ya procesada (evita ejecutar dos veces la misma orden)
let runner: ((text: string) => Promise<VoiceReply>) | null = null;
let backoff = 400;

const lang = () => (i18n.language === 'es' ? 'es' : 'en');
const setStatus = (status: AssistantStatus) => useVoiceStore.setState({ status });
const clearTimer = (t: ReturnType<typeof setTimeout> | null) => t && clearTimeout(t);

/** Registra el ejecutor de comandos (evita un import circular con voiceCommands). */
export function registerVoiceRunner(fn: (text: string) => Promise<VoiceReply>) {
  runner = fn;
}

async function startRecognizer() {
  if (!rec || !active) return;
  const owner = getRecognizerOwner();
  if (owner === 'dictation' || owner === 'assistant') return; // dictado en curso o ya escuchando
  if (useVoiceStore.getState().status === 'speaking') return;
  clearTimer(restartTimer);
  try {
    const perm = await rec.requestPermissionsAsync();
    if (!perm.granted) {
      useVoiceStore.setState({ status: 'error', error: 'permission' });
      return;
    }
    const support = await getOfflineSupport(lang());
    const offline = support.onDeviceSupported && support.installed !== false;
    if (!active || getRecognizerOwner() === 'dictation') return;
    setRecognizerOwner('assistant');
    rec.start({
      lang: support.locale,
      interimResults: true,
      continuous: true,
      requiresOnDeviceRecognition: offline,
      addsPunctuation: false,
      contextualStrings: ['NullRadt', 'Null Radt', 'NullRad'],
      androidIntentOptions: { EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 1500 },
    });
    useVoiceStore.setState({ error: null });
    if (!dialog) setStatus(useVoiceStore.getState().status === 'awake' ? 'awake' : 'listening');
  } catch {
    scheduleRestart();
  }
}

function scheduleRestart(delay = backoff) {
  clearTimer(restartTimer);
  if (!active) return;
  restartTimer = setTimeout(() => {
    backoff = Math.min(backoff * 2, 5000);
    startRecognizer();
  }, delay);
}

function stopRecognizer() {
  clearTimer(restartTimer);
  if (rec && getRecognizerOwner() === 'assistant') {
    rec.abort();
    setRecognizerOwner(null);
  }
}

function goAwake() {
  setStatus('awake');
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  clearTimer(awakeTimer);
  awakeTimer = setTimeout(() => {
    if (useVoiceStore.getState().status === 'awake') setStatus('listening');
  }, AWAKE_MS);
}

/** Habla y, al terminar, vuelve a escuchar (en diálogo o esperando "NullRadt"). */
export function assistantSay(text: string, chime: 'info' | 'critical' | false = false) {
  useVoiceStore.setState({ lastReply: text });
  if (!text) {
    setStatus(dialog ? 'dialog' : 'listening');
    return;
  }
  // Primero "hablando" (así nadie reabre el micrófono) y luego se suelta.
  setStatus('speaking');
  stopRecognizer();
  speak(text, lang(), {
    chime,
    onDone: () => {
      if (!active) {
        setStatus(voiceSupported ? (useVoiceStore.getState().enabled ? 'paused' : 'off') : 'unsupported');
        return;
      }
      setStatus(dialog ? 'dialog' : 'listening');
      if (dialog) {
        handled = '';
        clearTimer(awakeTimer);
        awakeTimer = setTimeout(() => {
          if (dialog) {
            dialog = null;
            assistantSay(i18n.t('assistant.dialogTimeout'));
          }
        }, DIALOG_MS);
      }
      setTimeout(startRecognizer, 250);
    },
  });
}

/** Ejecuta una orden (por voz o escrita). */
export async function handleCommand(raw: string) {
  const text = normalize(raw);
  if (!text) return;
  clearTimer(awakeTimer);
  useVoiceStore.setState({ lastCommand: raw });
  if (dialog) {
    const d = dialog;
    const res = d.onAnswer(text);
    if (res.done) dialog = null;
    assistantSay(res.say);
    return;
  }
  if (!runner) return;
  setStatus('thinking');
  try {
    const reply = await runner(text);
    if (reply.dialog) dialog = reply.dialog;
    assistantSay(reply.dialog ? `${reply.say} ${reply.dialog.prompt()}`.trim() : reply.say);
  } catch {
    assistantSay(i18n.t('assistant.failed'));
  }
}

/** Pulsar el indicador = como decir "NullRadt" (sin tocar nada más). */
export function wakeManually() {
  if (!voiceSupported) return;
  stopSpeaking();
  // Tras cortar la voz (su onDone vuelve a "escuchando"), se pasa a "te escucho".
  setTimeout(() => {
    goAwake();
    startRecognizer();
  }, 200);
}

export function cancelDialog() {
  dialog = null;
}

// ---------- eventos del reconocedor (una sola vez) ----------
if (rec) {
  rec.addListener('start', () => {
    if (getRecognizerOwner() === 'assistant') backoff = 400;
  });
  rec.addListener('result', (e) => {
    if (getRecognizerOwner() !== 'assistant' || !active) return;
    const text = e.results[0]?.transcript ?? '';
    if (!text) return;
    useVoiceStore.setState({ transcript: text });
    const status = useVoiceStore.getState().status;

    if (status === 'dialog' || dialog) {
      if (e.isFinal && text !== handled) {
        handled = text;
        handleCommand(text);
      }
      return;
    }
    const { woke, rest } = detectWake(text);
    if (status === 'listening') {
      if (!woke) return;
      if (e.isFinal && rest.split(' ').length >= 1 && rest.length > 2) {
        handled = text;
        handleCommand(rest);
      } else goAwake();
      return;
    }
    if (status === 'awake' && e.isFinal && text !== handled) {
      handled = text;
      const command = woke ? rest : normalize(text);
      if (command.length > 1) handleCommand(command);
    }
  });
  rec.addListener('end', () => {
    if (getRecognizerOwner() !== 'assistant') return;
    setRecognizerOwner(null);
    const s = useVoiceStore.getState().status;
    // En Android la sesión continua se corta cada tanto: se reabre sola.
    if (active && s !== 'speaking' && s !== 'thinking') scheduleRestart(300);
  });
  rec.addListener('error', (e) => {
    if (getRecognizerOwner() !== 'assistant') return;
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      useVoiceStore.setState({ status: 'error', error: 'permission' });
      setRecognizerOwner(null);
      return;
    }
    if (e.error === 'aborted') return;
    // 'no-speech', 'busy', 'network'… → reintentar con espera creciente.
    setRecognizerOwner(null);
    scheduleRestart();
  });
  // Cuando un dictado suelta el micrófono, el asistente lo retoma.
  onRecognizerOwnerChange((o) => {
    const s = useVoiceStore.getState().status;
    if (o === null && active && s !== 'speaking' && s !== 'thinking') scheduleRestart(1200);
  });
}

/** Enciende / apaga la escucha según la app (habilitado, al frente, con sesión). */
export function setAssistantActive(on: boolean) {
  if (!rec) {
    setStatus('unsupported');
    return;
  }
  if (on === active) return;
  active = on;
  if (on) {
    setStatus('starting');
    startRecognizer();
  } else {
    dialog = null;
    clearTimer(awakeTimer);
    stopRecognizer();
    setStatus(useVoiceStore.getState().enabled ? 'paused' : 'off');
  }
}
