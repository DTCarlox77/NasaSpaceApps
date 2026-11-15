/**
 * Lógica de Emergencias (sin React, para probarla sola). Triaje autónomo a bordo: el panel
 * muestra el protocolo y su resultado tal como los manda la API; no diagnostica ni recalcula.
 * - admin: solo estado operativo. Si la API mandara algo clínico, screenEmergency() lo quita.
 * - Hombre muerto: el umbral es `heartbeat.dead_man_switch_seconds` de la sesión (contrato).
 */
import type {
  Assessment,
  EmergencyDetail,
  EmergencyEvent,
  EmergencyListItem,
  EmergencySession,
  EmergencyStatus,
  GroundRole,
  RadiationFlag,
  StoredAnswer,
  TriageCategory,
  TriageCounts,
  TriggerType,
} from '../../api/types.ts';
import type { EmergencyFilter } from '../../api/emergencies.ts';
import { formatDuration } from '../../lib/time.ts';

export const EMERGENCY_DISCLAIMER = 'Triaje autónomo a bordo · protocolo, no diagnóstico';

export const ADMIN_OPERATIONAL_NOTE =
  'Control de misión ve solo el estado operativo (estado, tiempos y conteos). El detalle clínico es del flight surgeon.';

/** Sondeo: 10 s con una emergencia abierta; 30 s si no hay. */
export const POLL_OPEN_MS = 10_000;
export const POLL_IDLE_MS = 30_000;

export const isOpen = (status: EmergencyStatus | null | undefined): boolean =>
  status === 'pending' || status === 'active';

export const anyOpen = (items: EmergencyListItem[] | undefined): boolean =>
  (items ?? []).some((item) => isOpen(item.status));

export const pollInterval = (open: boolean): number => (open ? POLL_OPEN_MS : POLL_IDLE_MS);

export const STATUS_META: Record<EmergencyStatus, { icon: string; text: string }> = {
  pending: { icon: '◐', text: 'Esperando "estoy bien"' },
  active: { icon: '■', text: 'Activa' },
  closed: { icon: '✓', text: 'Cerrada' },
  cancelled: { icon: '○', text: 'Cancelada' },
  merged: { icon: '↪', text: 'Unida a otra sesión' },
};

export const STATUS_FILTERS: readonly EmergencyFilter[] = ['active', 'pending', 'closed', 'cancelled'];

const TRIGGERS: Record<TriggerType, { automatic: boolean; text: string }> = {
  manual_button: { automatic: false, text: 'botón de emergencia' },
  crew_event: { automatic: false, text: 'aviso de un tripulante' },
  missed_checkin: { automatic: true, text: 'check-in no completado' },
  critical_reading: { automatic: true, text: 'lectura crítica' },
  environment_alarm: { automatic: true, text: 'alarma del entorno' },
};

/** "Manual: botón de emergencia" / "Automática: lectura crítica". */
export function triggerLabel(trigger: TriggerType | string): string {
  const meta = TRIGGERS[trigger as TriggerType];
  if (!meta) return trigger;
  return `${meta.automatic ? 'Automática' : 'Manual'}: ${meta.text}`;
}

/**
 * Quién la abrió y por qué, con lo que haya: el disparador, el tripulante del evento `opened`,
 * el indicador (lectura crítica) y el contexto (evento solar, alarma del entorno).
 */
export function openedByLabel(session: EmergencySession, timeline: EmergencyEvent[]): string {
  const opened = timeline.find((e) => e.event_type === 'opened');
  const parts = [triggerLabel(session.trigger_type)];
  const indicator = opened?.details?.indicator_code;
  if (typeof indicator === 'string') parts[0] += ` (${indicator})`;
  if (opened?.call_sign) parts.push(opened.call_sign);
  else if (!session.started_by) parts.push('el sistema');
  if (session.context?.solar_event_active) parts.push('evento solar activo');
  if (session.context?.environment_alarm) parts.push(`alarma: ${session.context.environment_alarm}`);
  return parts.join(' · ');
}

// ---------------------------------------------------------------- triaje

export const TRIAGE_META: Record<TriageCategory, { icon: string; text: string; detail: string }> = {
  red: { icon: '■', text: 'Rojo', detail: 'inmediato' },
  yellow: { icon: '▲', text: 'Amarillo', detail: 'diferido' },
  green: { icon: '●', text: 'Verde', detail: 'leve' },
  black: { icon: '◆', text: 'Negro', detail: 'expectante' },
};

/** De peor a mejor. */
const WORST_ORDER: readonly TriageCategory[] = ['black', 'red', 'yellow', 'green'];

export function worstCategory(counts: TriageCounts | null | undefined): TriageCategory | null {
  if (!counts) return null;
  return WORST_ORDER.find((c) => (counts[c] ?? 0) > 0) ?? null;
}

export const assessedCount = (counts: TriageCounts): number =>
  counts.green + counts.yellow + counts.red + counts.black;

/** "3 evaluados · 1 en curso · 1 sin respuesta". */
export function countsLabel(counts: TriageCounts): string {
  const parts = [`${assessedCount(counts)} ${assessedCount(counts) === 1 ? 'evaluado' : 'evaluados'}`];
  if (counts.in_progress) parts.push(`${counts.in_progress} en curso`);
  if (counts.unreachable) parts.push(`${counts.unreachable} sin respuesta`);
  return parts.join(' · ');
}

export const RADIATION_TEXT: Record<RadiationFlag, string> = {
  none: 'Sin indicio de radiación',
  possible: 'Radiación posible',
  probable: 'Radiación probable',
};

const TIME_TO_VOMITING: Record<string, string> = {
  lt_1h: 'menos de 1 h después del evento',
  '1_2h': 'entre 1 y 2 h después del evento',
  gt_2h: 'más de 2 h después del evento',
  unknown: 'no se sabe cuándo',
};

const PRODROMAL: Record<string, string> = {
  nausea: 'náusea',
  diarrhea: 'diarrea',
  fatigue: 'fatiga',
  headache: 'dolor de cabeza',
  fever: 'fiebre',
  skin_erythema: 'piel enrojecida',
  none: 'ninguno',
};

const answerOf = (answers: StoredAnswer[] | undefined, code: string) =>
  answers?.find((a) => a.question_code === code)?.answer;

/** Respuestas del módulo de radiación (vómito, cuándo y síntomas), en texto. */
export function radiationAnswers(assessment: Assessment | undefined): string[] {
  if (!assessment?.answers) return [];
  const lines: string[] = [];
  const vomiting = answerOf(assessment.answers, 'vomiting')?.value;
  if (typeof vomiting === 'boolean') {
    const when = answerOf(assessment.answers, 'time_to_vomiting')?.choice;
    lines.push(
      vomiting
        ? `Vómito: sí${typeof when === 'string' ? `, ${TIME_TO_VOMITING[when] ?? when}` : ''}`
        : 'Vómito: no',
    );
  }
  const symptoms = answerOf(assessment.answers, 'prodromal_symptoms')?.choice;
  if (Array.isArray(symptoms) && symptoms.length > 0) {
    lines.push(`Síntomas: ${symptoms.map((s) => PRODROMAL[s] ?? s).join(', ')}`);
  }
  return lines;
}

// ---------------------------------------------------------------- hombre muerto

export type HeartbeatKind = 'ok' | 'late' | 'lapsed' | 'none' | 'closed';

export interface HeartbeatState {
  kind: HeartbeatKind;
  /** Umbral del contrato (s) o null si la sesión no lo trae. */
  thresholdSeconds: number | null;
  /** Segundos desde el último latido (null si no hubo). */
  ageSeconds: number | null;
}

/**
 * Último latido de la tableta frente al umbral del hombre muerto del contrato:
 * - `lapsed`: la API marcó el corte (`lapsed_at`) y no llegó otro latido después;
 * - `late`: pasaron más de `dead_man_switch_seconds` desde el último latido;
 * - `none`: sesión abierta sin latidos todavía; `closed`: la sesión ya no está abierta.
 */
export function heartbeatState(session: EmergencySession, now: number): HeartbeatState {
  const hb = session.heartbeat ?? {};
  const threshold = typeof hb.dead_man_switch_seconds === 'number' ? hb.dead_man_switch_seconds : null;
  const lastMs = hb.last_heartbeat_at ? new Date(hb.last_heartbeat_at).getTime() : null;
  const age = lastMs === null ? null : Math.max(0, Math.round((now - lastMs) / 1000));
  if (!isOpen(session.status)) return { kind: 'closed', thresholdSeconds: threshold, ageSeconds: age };
  const lapsedMs = hb.lapsed_at ? new Date(hb.lapsed_at).getTime() : null;
  if (lapsedMs !== null && (lastMs === null || lapsedMs >= lastMs)) {
    return { kind: 'lapsed', thresholdSeconds: threshold, ageSeconds: age };
  }
  if (age === null) return { kind: 'none', thresholdSeconds: threshold, ageSeconds: null };
  if (threshold !== null && age > threshold) return { kind: 'late', thresholdSeconds: threshold, ageSeconds: age };
  return { kind: 'ok', thresholdSeconds: threshold, ageSeconds: age };
}

export const thresholdLabel = (seconds: number | null): string =>
  seconds === null ? 'umbral del hombre muerto: sin dato' : `umbral del hombre muerto: ${formatDuration(seconds)}`;

// ---------------------------------------------------------------- línea de tiempo

export const EVENT_LABELS: Record<EmergencyEvent['event_type'], string> = {
  opened: 'Se abrió la emergencia',
  joined: 'Otra activación se unió',
  merged: 'Se unió a otra sesión',
  deadman_started: 'Empezó el plazo de "estoy bien"',
  deadman_confirmed: 'Confirmó "estoy bien"',
  deadman_expired: 'Venció el plazo de "estoy bien"',
  activated: 'Se activó el protocolo',
  cancelled: 'Se canceló',
  assessment_started: 'Empezó una evaluación',
  assessment_completed: 'Terminó una evaluación',
  device_mismatch: 'La tableta y el servidor no coinciden',
  heartbeat_lost: 'Se perdió el latido de la tableta',
  question_to_earth: 'Pregunta a Tierra',
  closed: 'Se cerró la emergencia',
};

const REASONS: Record<string, string> = {
  deadman_expired: 'venció el plazo de "estoy bien"',
  deadman_confirmed: 'el tripulante confirmó "estoy bien"',
};

/** Detalle de un evento en texto (solo flight surgeon: admin no recibe `details`). */
export function eventDetail(event: EmergencyEvent): string {
  const d = event.details ?? {};
  switch (event.event_type) {
    case 'opened':
    case 'joined': {
      const trigger = typeof d.trigger_type === 'string' ? triggerLabel(d.trigger_type) : '';
      const indicator = typeof d.indicator_code === 'string' ? ` (${d.indicator_code})` : '';
      return trigger ? `${trigger}${indicator}` : '';
    }
    case 'assessment_completed': {
      const category = d.triage_category as TriageCategory | undefined;
      const radiation = d.radiation_flag as RadiationFlag | undefined;
      const parts: string[] = [];
      if (category && TRIAGE_META[category]) {
        parts.push(`Triaje: ${TRIAGE_META[category].text} (${TRIAGE_META[category].detail})`);
      }
      if (radiation && RADIATION_TEXT[radiation]) parts.push(RADIATION_TEXT[radiation].toLowerCase());
      if (d.matches_device === false) parts.push('no coincide con la tableta');
      return parts.join(' · ');
    }
    case 'activated':
    case 'cancelled':
      return typeof d.reason === 'string' ? `Motivo: ${REASONS[d.reason] ?? d.reason}` : '';
    case 'heartbeat_lost':
      return typeof d.dead_man_switch_seconds === 'number'
        ? `Más de ${formatDuration(d.dead_man_switch_seconds)} sin latido`
        : '';
    default:
      return '';
  }
}

// ---------------------------------------------------------------- lo que ve cada rol

export interface ScreenedEmergency {
  detail: EmergencyDetail;
  /** Cuántos bloques clínicos se quitaron porque el rol no debe verlos. */
  hidden: number;
}

const CLINICAL_ASSESSMENT_FIELDS = [
  'answers',
  'triage_category',
  'radiation_flag',
  'matches_device',
  'device_result',
] as const;

/**
 * admin: solo estado operativo (estado, tiempos, conteos). Aunque la API mande algo clínico
 * (respuestas, categorías, orden de atención, preguntas, reporte o detalles de eventos), aquí
 * se quita. El flight surgeon lo ve todo.
 */
export function screenEmergency(detail: EmergencyDetail, role: GroundRole | null): ScreenedEmergency {
  if (role === 'flight_surgeon') return { detail, hidden: 0 };
  let hidden = 0;
  const assessments = (detail.assessments ?? []).map((a) => {
    const copy: Assessment = { ...a };
    for (const field of CLINICAL_ASSESSMENT_FIELDS) {
      if (copy[field] !== undefined && copy[field] !== null) hidden += 1;
      delete copy[field];
    }
    return copy;
  });
  const timeline = (detail.timeline ?? []).map((e) => {
    if (!e.details) return e;
    const { details, ...rest } = e;
    if (Object.keys(details).length > 0 && e.event_type === 'assessment_completed') hidden += 1;
    return rest;
  });
  if (detail.attention_order?.length) hidden += 1;
  if (detail.questions?.length) hidden += 1;
  if (detail.report) hidden += 1;
  return {
    detail: {
      session: detail.session,
      assessments,
      escalations: detail.escalations ?? [],
      timeline,
      report: null,
    },
    hidden,
  };
}

/** Evaluaciones por estado (operativo: sin categorías). */
export function assessmentStatusLabel(assessments: Assessment[]): string {
  const latest = new Map<string, Assessment>();
  for (const a of assessments) latest.set(a.astronaut_id, a);
  const list = [...latest.values()];
  const completed = list.filter((a) => a.status === 'completed').length;
  const inProgress = list.filter((a) => a.status === 'in_progress').length;
  const unreachable = list.filter((a) => a.status === 'unreachable').length;
  const parts = [`${completed} ${completed === 1 ? 'completada' : 'completadas'}`];
  if (inProgress) parts.push(`${inProgress} en curso`);
  if (unreachable) parts.push(`${unreachable} sin respuesta`);
  return parts.join(' · ');
}

export const ASSESSMENT_STATUS_TEXT: Record<Assessment['status'], string> = {
  completed: 'Evaluación completada',
  in_progress: 'En evaluación',
  unreachable: 'Sin respuesta',
};

/** Ruta de Alertas con el escalamiento abierto (para responder una pregunta de la tripulación). */
export const alertHref = (escalationId: string): string =>
  `/alertas?categoria=emergency&alerta=${encodeURIComponent(escalationId)}`;

// ---------------------------------------------------------------- reporte al cierre

export interface ReportView {
  generatedAt: string | null;
  counts: TriageCounts | null;
  differences: number;
  messages: number;
  joinedActivations: number | null;
  disclaimer: string | null;
  wellbeing: string | null;
  notes: string | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** Lo que el panel muestra del reporte (forma abierta en el contrato): solo campos conocidos. */
export function reportView(report: Record<string, unknown>): ReportView {
  const counts = report.counts as TriageCounts | undefined;
  const validCounts =
    counts && typeof counts === 'object' && ['green', 'yellow', 'red', 'black'].every((k) => typeof (counts as unknown as Record<string, unknown>)[k] === 'number')
      ? counts
      : null;
  return {
    generatedAt: str(report.generated_at),
    counts: validCounts,
    differences: Array.isArray(report.differences) ? report.differences.length : 0,
    messages: Array.isArray(report.messages) ? report.messages.length : 0,
    joinedActivations: num(report.joined_activations),
    disclaimer: str(report.disclaimer),
    wellbeing: str(report.wellbeing),
    notes: str(report.notes),
  };
}
