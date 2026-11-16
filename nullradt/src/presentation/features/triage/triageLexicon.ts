import type { TriageDefinition, TriageQuestion } from '@/domain/entities/Triage';

/**
 * Textos del protocolo en el idioma de la app y vocabulario de voz (sin IA).
 *
 * El protocolo del servidor trae los textos en un solo idioma (el seed v2 está en español). Regla:
 * - Si la app está en el idioma del protocolo → se lee el texto del protocolo TAL CUAL.
 * - Si no → traducción por `question_code`, SOLO si el texto del protocolo es el mismo del que se tradujo
 *   (`source`). Si el servidor cambió el texto, la traducción ya no vale y se lee el texto del protocolo.
 *   Así una traducción nunca cambia el significado de una pregunta.
 */

type Lang = 'es' | 'en';

/** Idioma de los textos del protocolo (el seed del backend está en español). */
export const protocolLanguage = (definition: TriageDefinition): Lang =>
  definition.language === 'en' || definition.lang === 'en' ? 'en' : 'es';

/** Traducciones al inglés de los textos del protocolo v2 (del texto `source` exacto). */
const PROMPT_EN: Record<string, { source: string; en: string }> = {
  responder_safe: {
    source: 'Antes de ayudar: ¿estás en un lugar seguro? Si hay alarma de radiación o del hábitat, primero ve al refugio.',
    en: 'Before helping: are you in a safe place? If there is a radiation or habitat alarm, go to the shelter first.',
  },
  responsive_and_mobile: {
    source: '¿{call_sign} responde y puede desplazarse por sí mismo hasta el punto de reunión?',
    en: 'Does {call_sign} respond and can they move by themselves to the assembly point?',
  },
  breathing: { source: '¿{call_sign} está respirando?', en: 'Is {call_sign} breathing?' },
  breathing_after_airway: {
    source: 'Reposiciona la vía aérea (inclina la cabeza hacia atrás). ¿Respira ahora?',
    en: 'Reposition the airway (tilt the head back). Are they breathing now?',
  },
  resp_rate_over_30: { source: '¿Respira más de 30 veces por minuto?', en: 'Are they breathing more than 30 times per minute?' },
  perfusion_ok: {
    source: '¿Tiene pulso en la muñeca, o al presionar una uña el color vuelve en 2 segundos o menos?',
    en: 'Do they have a pulse at the wrist, or when you press a fingernail does the color come back in 2 seconds or less?',
  },
  follows_commands: {
    source: "Pídele: 'aprieta mi mano'. ¿Obedece órdenes simples?",
    en: "Ask them: 'squeeze my hand'. Do they follow simple commands?",
  },
  can_self_report: { source: '¿{call_sign} puede contestarte por sí mismo?', en: 'Can {call_sign} answer you by themselves?' },
  vomiting: { source: '¿{call_sign} ha vomitado desde el evento de radiación?', en: 'Has {call_sign} vomited since the radiation event?' },
  time_to_vomiting: {
    source: '¿Cuánto tiempo después del evento empezó a vomitar?',
    en: 'How long after the event did the vomiting start?',
  },
  prodromal_symptoms: {
    source: '¿Tiene alguno de estos síntomas? Náusea, diarrea, fatiga, dolor de cabeza, fiebre, piel enrojecida.',
    en: 'Do they have any of these symptoms? Nausea, diarrhea, fatigue, headache, fever, reddened skin.',
  },
  vomiting_observed: {
    source: '¿Alguien vio a {call_sign} vomitar desde el evento de radiación?',
    en: 'Did anyone see {call_sign} vomit since the radiation event?',
  },
  time_to_vomiting_observed: {
    source: 'Según quien lo vio, ¿cuánto tiempo después del evento vomitó?',
    en: 'According to whoever saw it, how long after the event did they vomit?',
  },
  consciousness_level: {
    source: '¿Cómo responde {call_sign}? Alerta, responde a la voz, solo al dolor, o no responde.',
    en: 'How does {call_sign} respond? Alert, responds to voice, only to pain, or unresponsive.',
  },
};

const NOTE_EN: Record<string, { source: string; en: string }> = {
  responsive_and_mobile: {
    source: "En microgravedad no aplica 'caminar' de START: se adapta a desplazarse por sí mismo.",
    en: "In microgravity START's 'walking' does not apply: it is adapted to moving by themselves.",
  },
  can_self_report: {
    source: 'Si no puede, solo se preguntan signos que tú puedas observar.',
    en: "If they can't, only signs you can observe are asked.",
  },
  time_to_vomiting: {
    source: 'El tiempo hasta el vómito es un indicador orientativo de gravedad; lo interpreta el flight surgeon.',
    en: 'Time to vomiting is an approximate indicator of severity; the flight surgeon interprets it.',
  },
  time_to_vomiting_observed: {
    source: "Si nadie sabe la hora, responde 'unknown'. Lo interpreta el flight surgeon.",
    en: "If nobody knows the time, answer 'unknown'. The flight surgeon interprets it.",
  },
  consciousness_level: {
    source: "Escala ACVPU de NEWS2 (sin la 'C' de confusión nueva, que requiere conversar con el paciente). Solo informa: no cambia la categoría.",
    en: "NEWS2 ACVPU scale (without the 'C' for new confusion, which requires talking with the patient). Informational only: it does not change the category.",
  },
};

/** Texto de la pregunta en el idioma de la app (ver la regla arriba). */
export function promptFor(question: TriageQuestion, definition: TriageDefinition, lang: Lang): string {
  if (lang === protocolLanguage(definition)) return question.prompt;
  const tr = lang === 'en' ? PROMPT_EN[question.code] : undefined;
  return tr && tr.source === question.prompt ? tr.en : question.prompt;
}

export function noteFor(question: TriageQuestion, definition: TriageDefinition, lang: Lang): string | null {
  if (!question.note) return null;
  if (lang === protocolLanguage(definition)) return question.note;
  const tr = lang === 'en' ? NOTE_EN[question.code] : undefined;
  return tr && tr.source === question.note ? tr.en : question.note;
}

/**
 * Etiquetas de los códigos de opción del protocolo y sus sinónimos para la voz (es + en: se acepta
 * cualquiera de los dos). Las etiquetas en español son las mismas palabras que usa el texto de la pregunta.
 */
const CHOICES: Record<string, { es: string; en: string; say: string[] }> = {
  lt_1h: {
    es: 'Menos de 1 hora',
    en: 'Less than 1 hour',
    say: ['menos de una hora', 'menos de 1 hora', 'antes de una hora', 'antes de 1 hora', 'less than an hour', 'less than one hour', 'less than 1 hour', 'under an hour', 'within an hour'],
  },
  '1_2h': {
    es: 'Entre 1 y 2 horas',
    en: 'Between 1 and 2 hours',
    say: ['entre una y dos horas', 'entre 1 y 2 horas', 'de una a dos horas', 'de 1 a 2 horas', 'una a dos horas', '1 a 2 horas', 'between one and two hours', 'between 1 and 2 hours', 'one to two hours', '1 to 2 hours'],
  },
  gt_2h: {
    es: 'Más de 2 horas',
    en: 'More than 2 hours',
    say: ['mas de dos horas', 'mas de 2 horas', 'despues de dos horas', 'despues de 2 horas', 'more than two hours', 'more than 2 hours', 'over two hours', 'over 2 hours', 'after two hours'],
  },
  unknown: {
    es: 'No se sabe',
    en: 'Unknown',
    say: ['no se sabe', 'no se', 'no lo se', 'nadie sabe', 'no sabemos', 'desconocido', 'unknown', 'dont know', 'do not know', 'not sure', 'nobody knows', 'no idea'],
  },
  nausea: { es: 'Náusea', en: 'Nausea', say: ['nausea', 'nauseas', 'nauseoso', 'nauseosa', 'nauseous', 'nauseated'] },
  diarrhea: { es: 'Diarrea', en: 'Diarrhea', say: ['diarrea', 'diarrhea', 'diarrhoea'] },
  fatigue: { es: 'Fatiga', en: 'Fatigue', say: ['fatiga', 'cansancio', 'cansado', 'cansada', 'agotado', 'agotada', 'fatigue', 'tired', 'tiredness', 'exhausted'] },
  headache: { es: 'Dolor de cabeza', en: 'Headache', say: ['dolor de cabeza', 'cefalea', 'le duele la cabeza', 'headache', 'head hurts'] },
  fever: { es: 'Fiebre', en: 'Fever', say: ['fiebre', 'calentura', 'fever', 'feverish'] },
  skin_erythema: {
    es: 'Piel enrojecida',
    en: 'Reddened skin',
    say: ['piel enrojecida', 'piel roja', 'enrojecida', 'enrojecimiento', 'eritema', 'red skin', 'reddened skin', 'skin redness', 'redness', 'erythema'],
  },
  none: { es: 'Ninguno', en: 'None', say: ['ninguno', 'ninguna', 'nada', 'ningun sintoma', 'sin sintomas', 'none', 'nothing', 'no symptoms', 'none of them'] },
  alert: { es: 'Alerta', en: 'Alert', say: ['alerta', 'despierto', 'despierta', 'alert', 'awake'] },
  voice: { es: 'Responde a la voz', en: 'Responds to voice', say: ['responde a la voz', 'a la voz', 'voz', 'responds to voice', 'to voice', 'voice'] },
  pain: { es: 'Solo al dolor', en: 'Only to pain', say: ['solo al dolor', 'al dolor', 'dolor', 'only to pain', 'to pain', 'pain'] },
  unresponsive: {
    es: 'No responde',
    en: 'Unresponsive',
    say: ['no responde', 'no reacciona', 'inconsciente', 'unresponsive', 'no response', 'not responding', 'does not respond', 'doesnt respond', 'unconscious'],
  },
};

/** Etiqueta visible de un código de opción; si la app no lo conoce, el código legible (nunca se inventa). */
export function choiceLabel(code: string, lang: Lang): string {
  return CHOICES[code]?.[lang] ?? code.replace(/_/g, ' ');
}

/** Sinónimos de las opciones de una pregunta (incluye la etiqueta y el código). */
export function choiceDictionary(choices: string[]): Record<string, string[]> {
  return Object.fromEntries(
    choices.map((c) => [c, [...(CHOICES[c]?.say ?? []), CHOICES[c]?.es ?? '', CHOICES[c]?.en ?? '', c.replace(/_/g, ' ')].filter(Boolean)]),
  );
}

/** Sí / no (es + en). "No sé" NO es "no": va a `doubt` y se vuelve a preguntar. */
export const YES_NO: Record<'yes' | 'no' | 'doubt', string[]> = {
  yes: ['si', 'afirmativo', 'correcto', 'claro', 'exacto', 'asi es', 'eso es', 'por supuesto', 'yes', 'yeah', 'yep', 'affirmative', 'correct', 'right'],
  no: ['no', 'negativo', 'incorrecto', 'nope', 'negative', 'wrong'],
  doubt: ['no se', 'no lo se', 'no estoy seguro', 'no estoy segura', 'tal vez', 'quizas', 'dont know', 'do not know', 'not sure', 'maybe'],
};

/** Comandos de voz: repetir la pregunta, pasar a botones, volver a la anterior. */
export const COMMANDS: Record<'repeat' | 'buttons' | 'back', string[]> = {
  repeat: ['repetir', 'repite', 'repitelo', 'otra vez', 'de nuevo', 'repeat', 'again', 'say again'],
  buttons: ['botones', 'boton', 'usar botones', 'buttons', 'button', 'use buttons'],
  back: ['atras', 'regresar', 'volver', 'anterior', 'back', 'go back', 'previous'],
};

/** Palabras que el reconocedor debe esperar (contextualStrings): opciones + sí/no + comandos. */
export function contextualStrings(question: TriageQuestion | null, lang: Lang): string[] {
  const base = lang === 'es' ? ['sí', 'no', 'repetir', 'botones', 'atrás'] : ['yes', 'no', 'repeat', 'buttons', 'back'];
  const opts = (question?.choices ?? []).map((c) => choiceLabel(c, lang));
  return [...new Set([...opts, ...base])].slice(0, 50);
}
