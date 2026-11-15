import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { matchKeys, matchOne, parseSpokenNumber } from '@/core/speech/closedVocabulary';
import { cancelListening, listenMode, listenOnce, offlineVoiceInfo, type MicPermission } from '@/core/speech/listenOnce';
import { speak, stopSpeaking } from '@/core/speech/speech';
import type { TriageQuestion } from '@/domain/entities/Triage';
import { choiceDictionary, choiceLabel, COMMANDS, contextualStrings, YES_NO } from './triageLexicon';

type Lang = 'es' | 'en';
export type RawAnswer = boolean | number | string | string[];

/** Pregunta a leer y escuchar. `key` cambia con cada pregunta nueva (aunque sea la misma repetida tras "atrás"). */
export interface VoiceQuestion {
  key: string;
  question: TriageQuestion;
  /** Texto ya en el idioma de la app y con {call_sign} reemplazado. */
  text: string;
}

export type VoicePhase = 'idle' | 'speaking' | 'listening' | 'confirming' | 'buttons';

/** Lo dicho → respuesta del protocolo (vocabulario cerrado). null = no se entendió o es ambiguo. */
export function interpretAnswer(text: string, q: TriageQuestion): RawAnswer | null {
  switch (q.type) {
    case 'boolean': {
      const k = matchOne(text, YES_NO);
      return k === 'yes' ? true : k === 'no' ? false : null;
    }
    case 'number':
      return parseSpokenNumber(text);
    case 'choice':
      return matchOne(text, choiceDictionary(q.choices ?? []));
    case 'multi_choice': {
      const keys = matchKeys(text, choiceDictionary(q.choices ?? []));
      if (!keys.length || (keys.includes('none') && keys.length > 1)) return null;
      return keys;
    }
    default:
      return null;
  }
}

/** Cómo se dice la respuesta al confirmar ("Entendí: náusea y fatiga"). */
export function answerLabel(raw: RawAnswer, lang: Lang, yes: string, no: string, and: string): string {
  if (typeof raw === 'boolean') return raw ? yes : no;
  if (typeof raw === 'number') return String(raw);
  if (typeof raw === 'string') return choiceLabel(raw, lang);
  const labels = raw.map((c) => choiceLabel(c, lang).toLowerCase());
  return labels.length > 1 ? `${labels.slice(0, -1).join(', ')} ${and} ${labels[labels.length - 1]}` : (labels[0] ?? '');
}

/** speak() como promesa (termina al acabar, al cortarse o por error; con un tope por si el motor no avisa). */
function say(text: string, lang: Lang, chime: 'critical' | false): Promise<void> {
  return new Promise((resolve) => {
    const cap = setTimeout(resolve, 4000 + text.length * 90);
    void speak(text, lang, {
      chime,
      onDone: () => {
        clearTimeout(cap);
        resolve();
      },
    });
  });
}

const MAX_FAILURES = 2;

interface VoiceUi {
  key: string | undefined;
  phase: VoicePhase;
  heard: string | null;
  pending: { raw: RawAnswer; label: string } | null;
  message: string | null;
}
const INITIAL: Omit<VoiceUi, 'key'> = { phase: 'idle', heard: null, pending: null, message: null };

interface Env {
  current: VoiceQuestion | null;
  permission: MicPermission | null;
  onAnswer: (raw: RawAnswer) => void;
  onBack: () => void;
  lang: Lang;
  t: TFunction;
  voiceOn: boolean;
}

/**
 * Voz del triaje, sin IA y sin conexión:
 * 1. Lee la pregunta (voz offline del sistema, tono "critical").
 * 2. Escucha unos segundos (development build) o al tocar el micrófono (Expo Go Android: reconocedor del sistema).
 * 3. Compara con el vocabulario cerrado (sí/no, opciones del protocolo, números) y los comandos
 *    "repetir", "botones", "atrás".
 * 4. Confirma SIEMPRE: "Entendí: X. ¿Correcto?" → "sí" responde (source "voice"), "no" vuelve a preguntar.
 * 5. Si no entiende 2 veces, lo dice y pasa a botones. Los botones están siempre en pantalla.
 */
export function useTriageVoice(opts: {
  current: VoiceQuestion | null;
  permission: MicPermission | null;
  onAnswer: (raw: RawAnswer) => void;
  onBack: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language === 'es' ? 'es' : 'en';
  const mode = listenMode();
  const [voiceOn, setVoiceOn] = useState(true);
  const [ui, setUi] = useState<VoiceUi>({ key: undefined, ...INITIAL });
  const [offlineModel, setOfflineModel] = useState<boolean | null>(null);

  const token = useRef(0);
  const failures = useRef(0);
  const env = useRef<Env>({ ...opts, lang, t, voiceOn });
  useEffect(() => {
    env.current = { ...opts, lang, t, voiceOn };
  });

  useEffect(() => {
    void offlineVoiceInfo(lang).then((i) => setOfflineModel(i.offlineModel));
  }, [lang]);

  const flow = useMemo(() => {
    const autoListen = listenMode() === 'native';
    const canListen = () => listenMode() !== 'none' && env.current.permission === 'granted';
    const patch = (key: string | undefined, p: Partial<VoiceUi>) =>
      setUi((prev) => ({ ...(prev.key === key ? prev : { key, ...INITIAL }), ...p, key }));
    const label = (raw: RawAnswer) => {
      const { lang: l, t: tr } = env.current;
      return answerLabel(raw, l, tr('triage.assess.yes'), tr('triage.assess.no'), tr('triage.voice.and'));
    };
    const spoken = (v: VoiceQuestion) => {
      const { lang: l, t: tr } = env.current;
      const q = v.question;
      const options = (q.choices ?? []).map((c) => choiceLabel(c, l));
      if (q.type === 'choice' && options.length) return `${v.text} ${tr('triage.voice.options', { options: options.join(', ') })}`;
      if (q.type === 'multi_choice') return `${v.text} ${tr('triage.voice.multiHint')}`;
      return v.text;
    };

    const toButtons = async (key: string | undefined, text: string) => {
      env.current.voiceOn = false;
      setVoiceOn(false);
      cancelListening();
      patch(key, { phase: 'buttons', message: text, pending: null });
      await say(text, env.current.lang, false);
    };

    const ask = async (my: number): Promise<void> => {
      const v = env.current.current;
      if (!v) return;
      patch(v.key, { phase: 'speaking', pending: null });
      await say(spoken(v), env.current.lang, 'critical');
      if (my !== token.current) return;
      if (env.current.voiceOn && canListen() && autoListen) await listen(my);
      else patch(v.key, { phase: env.current.voiceOn ? 'idle' : 'buttons' });
    };

    const listen = async (my: number): Promise<void> => {
      const v = env.current.current;
      if (!v) return;
      const { lang: l, t: tr } = env.current;
      patch(v.key, { phase: 'listening' });
      const r = await listenOnce({ language: l, contextualStrings: contextualStrings(v.question, l), timeoutMs: 6000, prompt: v.text });
      if (my !== token.current) return;
      if (r.error === 'permission' || r.error === 'unavailable') {
        return toButtons(v.key, tr(r.error === 'permission' ? 'triage.voice.permissionDenied' : 'triage.voice.unavailable'));
      }
      const alts = r.alternatives;
      patch(v.key, { heard: alts[0] ?? null });
      for (const alt of alts) {
        const cmd = matchOne(alt, COMMANDS);
        if (cmd === 'repeat') return ask(my);
        if (cmd === 'buttons') return toButtons(v.key, tr('triage.voice.buttonsMode'));
        if (cmd === 'back') return env.current.onBack();
      }
      const raw = alts.map((a) => interpretAnswer(a, v.question)).find((x) => x !== null) ?? null;
      if (raw !== null) return confirm(my, raw);
      failures.current += 1;
      if (failures.current >= MAX_FAILURES) return toButtons(v.key, tr('triage.voice.switchToButtons'));
      patch(v.key, { message: tr('triage.voice.notUnderstood') });
      await say(tr('triage.voice.notUnderstood'), l, false);
      if (my !== token.current) return;
      if (autoListen) await listen(my);
      else patch(v.key, { phase: 'idle' });
    };

    const confirm = async (my: number, raw: RawAnswer): Promise<void> => {
      const v = env.current.current;
      if (!v) return;
      const { lang: l, t: tr } = env.current;
      const text = label(raw);
      patch(v.key, { phase: 'confirming', pending: { raw, label: text }, message: null });
      await say(tr('triage.voice.understood', { answer: text }), l, false);
      if (my !== token.current) return;
      // La confirmación también se escucha (en Expo Go Android vuelve a abrir el reconocedor del sistema).
      const r = await listenOnce({ language: l, contextualStrings: l === 'es' ? ['sí', 'no'] : ['yes', 'no'], timeoutMs: 5000, prompt: tr('triage.voice.understood', { answer: text }) });
      if (my !== token.current) return;
      patch(v.key, { heard: r.alternatives[0] ?? null });
      for (const alt of r.alternatives) {
        const cmd = matchOne(alt, COMMANDS);
        if (cmd === 'repeat') return confirm(my, raw);
        if (cmd === 'buttons') return toButtons(v.key, tr('triage.voice.buttonsMode'));
        if (cmd === 'back') return env.current.onBack();
        const yn = matchOne(alt, YES_NO);
        if (yn === 'yes') return env.current.onAnswer(raw);
        if (yn === 'no') return ask(my);
      }
      failures.current += 1;
      if (failures.current >= MAX_FAILURES) {
        // La tarjeta "Entendí…" sigue en pantalla para confirmarla con un toque.
        env.current.voiceOn = false;
        setVoiceOn(false);
        patch(v.key, { phase: 'buttons', message: tr('triage.voice.switchToButtons') });
        await say(tr('triage.voice.switchToButtons'), l, false);
        return;
      }
      await say(tr('triage.voice.notUnderstood'), l, false);
      if (my === token.current) return confirm(my, raw);
    };

    return { ask, listen, patch };
  }, []);

  // Cada pregunta nueva: se corta lo anterior, se lee y (si hay voz) se escucha.
  const key = opts.current?.key;
  useEffect(() => {
    const my = ++token.current;
    failures.current = 0;
    cancelListening();
    if (key) void flow.ask(my);
    else stopSpeaking();
  }, [key, flow]);

  // Al salir de la pantalla: nada sigue hablando ni escuchando.
  useEffect(
    () => () => {
      token.current += 1;
      cancelListening();
      stopSpeaking();
    },
    [],
  );

  const view = ui.key === key ? ui : { key, ...INITIAL };
  const phase: VoicePhase = !voiceOn && view.phase !== 'speaking' ? 'buttons' : view.phase;

  /** Repetir: vuelve a leer la pregunta (y a escuchar si hay voz). */
  const repeat = useCallback(() => {
    const my = ++token.current;
    cancelListening();
    void flow.ask(my);
  }, [flow]);

  /** Micrófono: escucha ahora (y reactiva la voz), o la pausa si estaba escuchando. */
  const toggleVoice = useCallback(() => {
    const my = ++token.current;
    cancelListening();
    stopSpeaking();
    const busy = phase === 'listening' || phase === 'confirming';
    if (busy && mode === 'native') {
      env.current.voiceOn = false;
      setVoiceOn(false);
      flow.patch(key, { phase: 'buttons', pending: null });
      return;
    }
    failures.current = 0;
    env.current.voiceOn = true;
    setVoiceOn(true);
    flow.patch(key, { message: null, pending: null });
    void flow.listen(my);
  }, [flow, key, mode, phase]);

  /** Botones de la tarjeta "Entendí…": confirmar o corregir con un toque. */
  const confirmTap = useCallback(
    (ok: boolean) => {
      const p = view.pending;
      const my = ++token.current;
      cancelListening();
      stopSpeaking();
      flow.patch(key, { pending: null });
      if (ok && p) env.current.onAnswer(p.raw);
      else void flow.ask(my);
    },
    [flow, key, view.pending],
  );

  /** Un toque en un botón de respuesta corta la voz. */
  const cancel = useCallback(() => {
    token.current += 1;
    cancelListening();
    stopSpeaking();
  }, []);

  return {
    mode,
    canListen: mode !== 'none' && opts.permission === 'granted',
    voiceOn,
    phase,
    heard: view.heard,
    pending: view.pending,
    message: view.message,
    offlineModel,
    repeat,
    toggleVoice,
    confirmTap,
    cancel,
  };
}
