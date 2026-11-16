import { router } from 'expo-router';
import i18n from '@/core/i18n';
import { stopSpeaking } from '@/core/speech/speech';
import { parseScore } from '@/core/voice/commandParser';
import { container } from '@/di/container';
import { isBlackout, LINK_PROFILES } from '@/domain/comms/linkModel';
import type { BodySystemId, HealthIndicator, IndicatorId } from '@/domain/entities/HealthIndicator';
import { buildOverview, type HealthOverview } from '@/domain/usecases/GetHealthOverview';
import { nextDueAt } from '@/domain/usecases/IndicatorHistory';
import { isMeasurable } from '@/domain/usecases/SimulateMeasurement';
import { classify } from '@/domain/rules/ruleEngine';
import { SEX_DEPENDENT_RULES } from '@/domain/rules/sexReference';
import { VAS_DIMENSIONS, type VasDimension } from '@/domain/wellbeing/trends';
import { summarize } from '@/domain/gamification/achievements';
import { formatValue } from '@/presentation/features/health/healthUi';
import { biometricsOf } from '@/presentation/hooks/useMyBiometrics';
import { useAuthStore } from '@/presentation/store/authStore';
import { useCheckInStore } from '@/presentation/store/checkInStore';
import { applyLocalReadings, useHealthLogStore } from '@/presentation/store/healthLogStore';
import { activeSession, MEASURE_ORDER, pendingOf, useMeasureSessionStore } from '@/presentation/store/measureSessionStore';
import { useOutboxStore } from '@/presentation/store/outboxStore';
import { ROUTINE, todayKey, useRoutineStore } from '@/presentation/store/routineStore';
import { useTriageStore } from '@/presentation/store/triageStore';
import { showToast } from '@/presentation/store/toastStore';
import { refreshPendingCount } from '@/presentation/sync/syncEngine';
import { useUiStore } from '@/presentation/store/uiStore';
import { cancelDialog, registerVoiceRunner } from './voiceAssistant';

/**
 * COMANDOS DE VOZ. Cada comando: patrones (texto ya normalizado, es + en), acción y respuesta hablada.
 * El orden importa: los más específicos primero. La lista se muestra en la pantalla "Comandos de voz".
 */

export interface VoiceDialog {
  id: string;
  prompt: () => string;
  onAnswer: (text: string) => { say: string; done: boolean };
}
export interface VoiceReply {
  say: string;
  dialog?: VoiceDialog;
}

export type CommandGroup = 'health' | 'measure' | 'wellbeing' | 'routine' | 'emergency' | 'navigation' | 'system';
export interface VoiceCommand {
  id: string;
  group: CommandGroup;
  patterns: RegExp[];
  run: (text: string) => VoiceReply | Promise<VoiceReply>;
}

const t = (k: string, o?: Record<string, unknown>) => i18n.t(k as never, o as never) as unknown as string;
const go = (href: Parameters<typeof router.push>[0]) => {
  try {
    router.push(href);
  } catch {
    // Navegar no debe romper la respuesta hablada.
  }
};

// ---------- datos ----------
const SYSTEM_WORDS: [RegExp, BodySystemId][] = [
  [/\b(ojo|ojos|vista|vision|ocular|eye|eyes|sight)\b/, 'eyes'],
  [/\b(corazon|cardi\w*|heart)\b/, 'cardiovascular'],
  [/\b(pulmon\w*|respirator\w*|respiracion|lung\w*|breathing)\b/, 'respiratory'],
  [/\b(cerebro|mente|mental|cognitiv\w*|brain|mind)\b/, 'brain'],
  [/\b(hueso\w*|esquelet\w*|osea|oseo|bone\w*|skelet\w*)\b/, 'skeletal'],
  [/\b(musculo\w*|muscul\w*|muscle\w*)\b/, 'muscular'],
  [/\b(inmun\w*|defensas|immun\w*)\b/, 'immune'],
];
const INDICATOR_WORDS: [RegExp, IndicatorId][] = [
  [/\b(presion (ocular|intraocular|del ojo|de los ojos)|eye pressure)\b/, 'eyePressure'],
  [/\b(presion|tension|blood pressure|pressure)\b/, 'bloodPressure'],
  [/\b(oxigeno|saturacion|spo2|oxygen|saturation)\b/, 'spo2'],
  [/\b(frecuencia respiratoria|respiraciones|breathing rate|respiratory rate)\b/, 'respRate'],
  [/\b(frecuencia cardiaca|pulso|ritmo cardiaco|latidos|heart rate|pulse)\b/, 'heartRate'],
  [/\b(temperatura|fiebre|temperature|fever)\b/, 'bodyTemperature'],
  [/\b(tiempo de reaccion|reflejos|reaction time)\b/, 'reactionTime'],
  [/\b(agarre|fuerza|grip|strength)\b/, 'gripStrength'],
  [/\b(calcio|calcium)\b/, 'urinaryCalcium'],
];
const findSystem = (text: string) => SYSTEM_WORDS.find(([re]) => re.test(text))?.[1];
const findIndicator = (text: string) => INDICATOR_WORDS.find(([re]) => re.test(text))?.[1];

const userId = () => useAuthStore.getState().session?.userId ?? '';

/** Resumen de salud actual (maqueta/backend + mediciones locales + reglas por sexo), fuera de React. */
async function overviewNow(): Promise<HealthOverview> {
  const base = await container.getHealthOverview.execute();
  const sex = biometricsOf(userId())?.sex;
  const indicators = base.snapshot.indicators.map((ind) =>
    SEX_DEPENDENT_RULES.includes(ind.id) && ind.latest
      ? { ...ind, status: classify(ind.id, ind.latest.value, ind.latest.secondaryValue, ind.trend.slice(0, -1), sex).status }
      : ind,
  );
  return buildOverview({ ...base.snapshot, indicators: applyLocalReadings(indicators, useHealthLogStore.getState().readings[userId()]) });
}

const statusWord = (s: HealthIndicator['status']) => t(`status.${s}`);
const unitWord = (ind: HealthIndicator) => t(`assistant.units.${ind.id}`);
/** "Presión arterial: 118 sobre 76 milímetros de mercurio, normal". */
function indicatorSentence(ind: HealthIndicator) {
  if (!ind.latest) return t('assistant.noData', { name: t(`indicators.${ind.id}.name`) });
  const v = ind.latest.secondaryValue !== undefined ? t('assistant.over', { a: ind.latest.value, b: ind.latest.secondaryValue }) : formatValue(ind).replace('.', i18n.language === 'es' ? ',' : '.');
  return t('assistant.indicatorLine', { name: t(`indicators.${ind.id}.name`), value: v, unit: unitWord(ind), status: statusWord(ind.status) });
}

function nextRoutineItem() {
  const done = useRoutineStore.getState().done[todayKey()] ?? [];
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
  return ROUTINE.find((i) => !done.includes(i.id) && toMin(i.time) >= mins - 30) ?? ROUTINE.find((i) => !done.includes(i.id));
}

/** Abre una medición (con inicio automático y resultado en voz). */
function openMeasure(id: IndicatorId, replace = false) {
  const inSession = !!activeSession(useMeasureSessionStore.getState().session, userId());
  const params: Record<string, string> = { indicator: id, auto: '1', ...(inSession ? { session: '1' } : {}) };
  const href = { pathname: isMeasurable(id) ? '/measure' : '/register', params } as const;
  if (replace) router.replace(href);
  else go(href);
}

// ---------- check-in por voz ----------
/** Mismo envío que la pantalla Bienestar: POST /wellbeing/checkins (o cola / local en demo). Sin sueño inventado. */
async function submitVoiceCheckIn(answers: Partial<Record<VasDimension, number>>) {
  const uid = userId();
  const values = { mood: answers.mood ?? 50, fatigue: answers.fatigue ?? 50, stress: answers.stress ?? 50, crewConflict: answers.crewConflict ?? 50 };
  try {
    const today = useCheckInStore.getState().entries[uid]?.[todayKey()];
    const out = await container.submitCheckIn.execute({ ...values, sleepHours: null, privateNote: null, measuredAt: new Date().toISOString() });
    useCheckInStore.getState().save(uid, {
      ...values,
      symptoms: [],
      clientUuid: out.clientUuid,
      state: out.status,
      message: out.status === 'sent' ? out.message : undefined,
      streak: out.status === 'sent' ? out.streak : null,
      screeningDue: out.status === 'sent' ? out.screeningDue : false,
      corrected: out.status === 'sent' ? !!out.supersedesId : !!today,
    });
    if (out.status === 'queued') void refreshPendingCount();
    const routine = useRoutineStore.getState();
    if (!(routine.done[todayKey()] ?? []).includes('dailyCheck')) routine.toggleDone('dailyCheck');
  } catch {
    showToast({ level: 'caution', title: t('wellbeing.errorTitle'), body: t('wellbeing.errorBody') });
  }
}

function checkInDialog(): VoiceDialog {
  const answers: Partial<Record<VasDimension, number>> = {};
  let step = 0;
  let retried = false;
  return {
    id: 'checkIn',
    prompt: () => t(`assistant.checkIn.q.${VAS_DIMENSIONS[step]}`),
    onAnswer: (text) => {
      if (/\b(cancela\w*|cancel|para|stop|salir)\b/.test(text)) return { say: t('assistant.checkIn.cancelled'), done: true };
      const n = parseScore(text);
      if (n === null) {
        if (retried) return { say: t('assistant.checkIn.cancelled'), done: true };
        retried = true;
        return { say: `${t('assistant.checkIn.repeat')} ${t(`assistant.checkIn.q.${VAS_DIMENSIONS[step]}`)}`, done: false };
      }
      retried = false;
      // Escala hablada 0–10 → VAS interna 0–100.
      answers[VAS_DIMENSIONS[step]!] = n * 10;
      step++;
      if (step < VAS_DIMENSIONS.length) return { say: t(`assistant.checkIn.q.${VAS_DIMENSIONS[step]}`), done: false };
      void submitVoiceCheckIn(answers);
      return { say: t('assistant.checkIn.saved'), done: true };
    },
  };
}

// ---------- comandos ----------
export const VOICE_COMMANDS: VoiceCommand[] = [
  {
    id: 'stop',
    group: 'system',
    patterns: [/^(para|detente|silencio|callate|cancela\w*|basta|stop|cancel|quiet|shut up)\b/],
    run: () => {
      stopSpeaking();
      cancelDialog();
      return { say: '' };
    },
  },
  {
    id: 'help',
    group: 'system',
    patterns: [/\b(ayuda|que puedo decir|comandos|que sabes hacer|help|what can i say|commands)\b/],
    run: () => {
      go('/voice-commands');
      return { say: t('assistant.reply.help') };
    },
  },
  {
    id: 'emergency',
    group: 'emergency',
    patterns: [/\b(emergencia|triaje|sos|auxilio|socorro|mayday|emergency|triage)\b/],
    run: () => {
      const active = useTriageStore.getState().active;
      if (active) router.push({ pathname: '/triage/[sessionId]', params: { sessionId: active.ref } });
      else router.push({ pathname: '/alert', params: { trigger: 'manual' } });
      return { say: t('assistant.reply.emergency') };
    },
  },
  {
    id: 'talk',
    group: 'wellbeing',
    patterns: [/\b(quiero hablar|hablar con (alguien|un psicologo|salud)|necesito hablar|talk to someone|i want to talk)\b/],
    run: () => {
      go('/support');
      return { say: t('assistant.reply.talk') };
    },
  },
  {
    id: 'checkIn',
    group: 'wellbeing',
    patterns: [/\b(check ?in|checking|chequeo diario|registro de bienestar|como me siento|bienestar diario|daily check)\b/],
    run: () => {
      router.navigate('/wellbeing');
      return { say: t('assistant.checkIn.intro'), dialog: checkInDialog() };
    },
  },
  {
    id: 'dailyAnalysis',
    group: 'health',
    patterns: [/\b(analisis diario|resumen( diario| de salud| del dia)?|estado general|como estoy|reporte diario|informe diario|daily (analysis|summary|report)|how am i)\b/],
    run: async () => {
      const o = await overviewNow();
      const parts: string[] = [];
      const attention = o.needsAttention;
      parts.push(attention.length === 0 ? t('assistant.reply.allNormal', { count: o.indicators.length }) : t('assistant.reply.attention', { count: attention.length }));
      attention.slice(0, 3).forEach((ind) => parts.push(indicatorSentence(ind)));
      const checked = !!useCheckInStore.getState().entries[userId()]?.[todayKey()];
      parts.push(checked ? t('assistant.reply.checkInDone') : t('assistant.reply.checkInPending'));
      const s = activeSession(useMeasureSessionStore.getState().session, userId());
      if (s && pendingOf(s).length) parts.push(t('assistant.reply.measurementsPending', { count: pendingOf(s).length }));
      const next = nextRoutineItem();
      if (next) parts.push(t('assistant.reply.nextTask', { time: next.time, task: t(`routine.items.${next.id}.title`) }));
      go('/');
      return { say: parts.join(' ') };
    },
  },
  {
    id: 'measureAll',
    group: 'measure',
    patterns: [/\b((registrar|tomar|hacer|hagamos|empezar) (las )?(mediciones|medidas|signos vitales)|signos vitales|medir todo|mediciones pendientes|vital signs|take (my )?measurements|measure everything)\b/],
    run: async () => {
      const o = await overviewNow();
      const today = todayKey();
      const local = useHealthLogStore.getState().readings[userId()] ?? [];
      const measured = new Set(local.filter((r) => todayKey(new Date(r.reading.takenAt)) === today).map((r) => r.indicatorId));
      const pending = MEASURE_ORDER.filter((id) => {
        const ind = o.indicators.find((i) => i.id === id);
        if (!ind || measured.has(id)) return false;
        if (isMeasurable(id)) return true;
        const due = nextDueAt(ind);
        return due !== null && due < Date.now();
      });
      if (!pending.length) return { say: t('assistant.reply.noPending') };
      useMeasureSessionStore.getState().start(userId(), pending, 'guided');
      go('/measure-session');
      setTimeout(() => openMeasure(pending[0]!), 600);
      return { say: t('assistant.reply.sessionStart', { count: pending.length, first: t(`indicators.${pending[0]}.name`) }) };
    },
  },
  {
    id: 'next',
    group: 'measure',
    patterns: [/^(siguiente|continua\w*|la siguiente|next|continue)\b/],
    run: () => {
      const s = activeSession(useMeasureSessionStore.getState().session, userId());
      const next = s ? pendingOf(s)[0] : undefined;
      if (next) {
        openMeasure(next, true);
        return { say: t('assistant.reply.nextMeasure', { name: t(`indicators.${next}.name`) }) };
      }
      const item = nextRoutineItem();
      return { say: item ? t('assistant.reply.nextTask', { time: item.time, task: t(`routine.items.${item.id}.title`) }) : t('assistant.reply.routineDone') };
    },
  },
  {
    id: 'reactionTest',
    group: 'wellbeing',
    patterns: [/\b(prueba de (reaccion|aptitud)|test de reaccion|aptitud|reaction test|fitness test|pvt)\b/],
    run: () => {
      go('/tests/reaction');
      return { say: t('assistant.reply.reactionTest') };
    },
  },
  {
    id: 'visionTest',
    group: 'wellbeing',
    patterns: [/\b(test de (vision|vista)|prueba de (vision|vista)|claridad visual|vision test|eye test)\b/],
    run: () => {
      go('/tests/vision');
      return { say: t('assistant.reply.visionTest') };
    },
  },
  {
    id: 'tests',
    group: 'wellbeing',
    patterns: [/\b(tests|test diarios|pruebas cognitivas|juegos mentales|cognitive tests)\b/],
    run: () => {
      go('/tests');
      return { say: t('assistant.reply.tests') };
    },
  },
  {
    id: 'screening',
    group: 'wellbeing',
    patterns: [/\b(cuestionario|phq|gad|questionnaire)\b/],
    run: () => {
      go('/screening');
      return { say: t('assistant.reply.screening') };
    },
  },
  {
    id: 'measureOne',
    group: 'measure',
    patterns: [/\b(medir|mide|medirme|tomar|toma|tomame|registrar|registra|measure|take|check)\b.*\b(presion|tension|oxigeno|saturacion|pulso|frecuencia|temperatura|fiebre|agarre|calcio|pressure|oxygen|pulse|heart rate|temperature|grip|calcium|respira\w*)\b/],
    run: (text) => {
      const id = findIndicator(text);
      if (!id) return { say: t('assistant.notUnderstood') };
      openMeasure(id);
      return { say: isMeasurable(id) ? t('assistant.reply.measureStart', { name: t(`indicators.${id}.name`) }) : t('assistant.reply.measureManual', { name: t(`indicators.${id}.name`) }) };
    },
  },
  {
    id: 'systemHealth',
    group: 'health',
    patterns: [/\b(salud|estado|como (esta|estan|va|van)|revisa\w*|health|status|how (is|are))\b/],
    run: async (text) => {
      const sys = findSystem(text);
      if (!sys) return { say: '', fallthrough: true } as VoiceReply & { fallthrough: boolean };
      const o = await overviewNow();
      const system = o.systems.find((s) => s.id === sys)!;
      useUiStore.getState().setSelectedSystem(sys);
      router.navigate('/body');
      const lines = system.indicators.map(indicatorSentence);
      return { say: `${t('assistant.reply.systemStatus', { system: t(`systems.${sys}.name`), status: statusWord(system.status) })} ${lines.join(' ')}` };
    },
  },
  {
    id: 'indicatorValue',
    group: 'health',
    patterns: [/\b(presion|tension|oxigeno|saturacion|pulso|frecuencia|temperatura|fiebre|reaccion|reflejos|agarre|calcio|pressure|oxygen|pulse|heart rate|temperature|reaction|grip|calcium|respira\w*)\b/],
    run: async (text) => {
      const id = findIndicator(text);
      if (!id) return { say: t('assistant.notUnderstood') };
      const o = await overviewNow();
      const ind = o.indicators.find((i) => i.id === id);
      if (!ind) return { say: t('assistant.notUnderstood') };
      go({ pathname: '/indicator/[id]', params: { id } });
      return { say: indicatorSentence(ind) };
    },
  },
  {
    id: 'routineDone',
    group: 'routine',
    patterns: [/\b(marca\w*|ya (la )?hice|tarea (hecha|completada|lista)|listo con|mark( it| task)? (as )?done|task done)\b/],
    run: () => {
      const item = nextRoutineItem();
      if (!item) return { say: t('assistant.reply.routineDone') };
      if (item.critical) {
        go('/tests/reaction');
        return { say: t('assistant.reply.criticalNeedsFit') };
      }
      useRoutineStore.getState().toggleDone(item.id);
      const next = nextRoutineItem();
      return { say: `${t('assistant.reply.marked', { task: t(`routine.items.${item.id}.title`) })} ${next ? t('assistant.reply.nextTask', { time: next.time, task: t(`routine.items.${next.id}.title`) }) : ''}` };
    },
  },
  {
    id: 'routineNext',
    group: 'routine',
    patterns: [/\b(que sigue|que me toca|proxima tarea|siguiente tarea|rutina|agenda|what s next|whats next|next task|routine|schedule)\b/],
    run: () => {
      router.navigate('/routine');
      const item = nextRoutineItem();
      return { say: item ? t('assistant.reply.nextTask', { time: item.time, task: t(`routine.items.${item.id}.title`) }) : t('assistant.reply.routineDone') };
    },
  },
  {
    id: 'achievements',
    group: 'system',
    patterns: [/\b(logros|puntos|racha|nivel|achievements|points|streak|level)\b/],
    run: () => {
      const uid = userId();
      const checkIns = useCheckInStore.getState().entries[uid] ?? {};
      const readings = useHealthLogStore.getState().readings[uid] ?? [];
      const byDay: Record<string, number> = {};
      readings.forEach((r) => {
        const d = todayKey(new Date(r.reading.takenAt));
        byDay[d] = (byDay[d] ?? 0) + 1;
      });
      const g = summarize({ readingsByDay: byDay, cameraReadings: 0, checkInDays: Object.keys(checkIns), testsByDay: {}, exerciseByDay: {}, sleepDays: [], screenings: 0, fitnessChecks: 0, today: todayKey() });
      go('/achievements');
      return { say: t('assistant.reply.achievements', { level: g.level, streak: g.streaks.checkIn }) };
    },
  },
  {
    id: 'comms',
    group: 'system',
    patterns: [/\b(enlace|comunicacion\w*|retraso|tierra|link|communications|delay|earth)\b/],
    run: () => {
      const { profile, forcedOffline, messages } = useOutboxStore.getState();
      const p = LINK_PROFILES[profile];
      const down = isBlackout(Date.now(), p, forcedOffline);
      const pending = messages.filter((m) => m.direction === 'toEarth' && (m.deliverAt === null || m.deliverAt > Date.now())).length;
      go('/comms');
      return { say: t(down ? 'assistant.reply.linkDown' : 'assistant.reply.linkUp', { delay: Math.round(p.oneWayDelaySec), pending }) };
    },
  },
  {
    id: 'crew',
    group: 'navigation',
    patterns: [/\b(tripulacion|companeros|crew|crewmates)\b/],
    run: () => {
      go('/crew');
      return { say: t('assistant.reply.crew') };
    },
  },
  {
    id: 'navigate',
    group: 'navigation',
    patterns: [/\b(inicio|home|monitor|cuerpo|bienestar|wellbeing|mas opciones|perfil|profile|ajustes|configuracion|settings|seguridad|security|bandeja|inbox|3d|logros)\b/],
    run: (text) => {
      const routes: [RegExp, Parameters<typeof router.push>[0], string][] = [
        [/\b(3d)\b/, '/body-3d', 'body3d'],
        [/\b(monitor|cuerpo)\b/, '/body', 'monitor'],
        [/\b(bienestar|wellbeing)\b/, '/wellbeing', 'wellbeing'],
        [/\b(perfil|profile)\b/, '/profile', 'profile'],
        [/\b(ajustes|configuracion|settings)\b/, '/settings', 'settings'],
        [/\b(seguridad|security)\b/, '/access', 'access'],
        [/\b(bandeja|inbox)\b/, '/earth', 'earth'],
        [/\b(mas opciones)\b/, '/more', 'more'],
        [/\b(inicio|home)\b/, '/', 'home'],
      ];
      const hit = routes.find(([re]) => re.test(text));
      if (!hit) return { say: t('assistant.notUnderstood') };
      if (typeof hit[1] === 'string' && ['/', '/body', '/wellbeing', '/more', '/routine'].includes(hit[1])) router.navigate(hit[1] as never);
      else go(hit[1]);
      return { say: t('assistant.reply.opening', { page: t(`assistant.pages.${hit[2]}`) }) };
    },
  },
];

/** Busca y ejecuta el comando (primer patrón que coincida). */
export async function runVoiceCommand(text: string): Promise<VoiceReply> {
  for (const cmd of VOICE_COMMANDS) {
    if (!cmd.patterns.some((re) => re.test(text))) continue;
    const reply = (await cmd.run(text)) as VoiceReply & { fallthrough?: boolean };
    if (reply.fallthrough) continue;
    return reply;
  }
  return { say: t('assistant.notUnderstood') };
}

registerVoiceRunner(runVoiceCommand);
