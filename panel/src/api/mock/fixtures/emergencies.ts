/**
 * Emergencias del modo demo (vista completa del flight surgeon; el servidor mock recorta la de
 * admin). Tres sesiones:
 * - Activa (hace 25 min): botón manual de ORION durante un evento solar, LYRA se une por una
 *   lectura crítica; LYRA roja, ATLAS amarilla, VEGA verde y ORION en evaluación; una pregunta a Tierra.
 * - Cerrada (hace 3 días): activación automática por radiación, hombre muerto vencido, reporte.
 * - Cancelada (hace 5 días): check-in no completado y ATLAS confirmó "estoy bien".
 * Las preguntas (`questions`) no van aquí: salen del hilo de su escalamiento (inbox.ts).
 */
import type {
  Assessment,
  AttentionEntry,
  EmergencyDetail,
  EmergencyEvent,
  EscalationRef,
  StoredAnswer,
} from '../../types.ts';
import { ACTIVE_STARTED_MIN, CANCELLED_BASE_MS, CLOSED_BASE_MS, ESC } from './inbox.ts';
import { DELAY_S, MISSION_ID } from './mission.ts';
import { crewByCallSign } from './people.ts';

const MINUTE = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

export const EMERGENCY = {
  active: '40000000-0000-4000-8000-000000000001',
  closed: '40000000-0000-4000-8000-000000000002',
  cancelled: '40000000-0000-4000-8000-000000000003',
} as const;

export interface MockEmergency {
  detail: EmergencyDetail;
  /** Escalamientos de las preguntas de la tripulación (sus hilos son las `questions`). */
  questionEscalations: string[];
  /** Latido en vivo (sesión activa): el mock lo recalcula en cada consulta. */
  liveHeartbeat: boolean;
}

const PROTOCOL = { id: 1, code: 'crew_emergency', version: 1 };
export const REPORT_DISCLAIMER =
  'Apoyo a la decisión. No diagnostica ni receta: lo que no cubre el protocolo se consulta con el flight surgeon.';

function answers(baseMs: number, list: [string, StoredAnswer['answer']][]): StoredAnswer[] {
  return list.map(([code, answer], i) => ({
    question_code: code,
    answer,
    source: i % 3 === 1 ? 'voice' : 'tap',
    answered_at: iso(baseMs + (i + 1) * 12_000),
    received_at: iso(baseMs + (i + 1) * 12_000 + 1_000),
  }));
}

interface AssessmentSeed {
  id: string;
  callSign: string;
  assessedBy: string;
  self?: boolean;
  seq: number;
  startedMs: number;
  completedMs?: number;
  category?: 'green' | 'yellow' | 'red' | 'black';
  radiation?: 'none' | 'possible' | 'probable';
  answers: [string, StoredAnswer['answer']][];
}

function assessment(sessionId: string, seed: AssessmentSeed): Assessment {
  const member = crewByCallSign(seed.callSign);
  const done = seed.completedMs !== undefined;
  return {
    id: seed.id,
    client_uuid: seed.id.replace(/^5/, 'c'),
    session_id: sessionId,
    astronaut_id: member.astronaut_id,
    call_sign: member.call_sign,
    assessed_by: crewByCallSign(seed.assessedBy).id,
    is_self_assessment: !!seed.self,
    sequence_no: seed.seq,
    status: done ? 'completed' : 'in_progress',
    triage_category: done ? (seed.category ?? null) : null,
    radiation_flag: done ? (seed.radiation ?? null) : null,
    computed_by: done ? 'server' : null,
    rules_version: done ? 1 : null,
    started_at: iso(seed.startedMs),
    completed_at: done ? iso(seed.completedMs as number) : null,
    reassessment_of: null,
    matches_device: done ? true : null,
    device_result: null,
    answers: answers(seed.startedMs, seed.answers),
  };
}

function event(
  id: number,
  type: EmergencyEvent['event_type'],
  atMs: number,
  extra: Partial<EmergencyEvent> = {},
): EmergencyEvent {
  return {
    id,
    event_type: type,
    at: iso(atMs),
    device_at: null,
    delivered_at: iso(atMs + DELAY_S * 1000),
    astronaut_id: extra.call_sign ? crewByCallSign(extra.call_sign).astronaut_id : null,
    call_sign: null,
    actor_role: null,
    ...extra,
  };
}

function attention(
  position: number,
  callSign: string,
  status: AttentionEntry['status'],
  reason: string,
  a?: Assessment,
): AttentionEntry {
  return {
    position,
    astronaut_id: crewByCallSign(callSign).astronaut_id,
    call_sign: callSign,
    status,
    assessment_id: a?.id ?? null,
    triage_category: a?.triage_category ?? null,
    radiation_flag: a?.radiation_flag ?? null,
    matches_device: a?.matches_device ?? null,
    reason,
  };
}

const ref = (
  id: string,
  level: string,
  priority: EscalationRef['priority'],
  status: EscalationRef['status'],
  deliverMs: number,
): EscalationRef => ({ id, level, priority, status, deliver_at: iso(deliverMs) });

// ---------------------------------------------------------------- activa

function activeEmergency(t0: number): MockEmergency {
  const at = (minutes: number) => t0 + minutes * MINUTE;
  const id = EMERGENCY.active;
  const started = at(ACTIVE_STARTED_MIN);
  const vega = assessment(id, {
    id: '50000000-0000-4000-8000-000000000001',
    callSign: 'VEGA',
    assessedBy: 'VEGA',
    self: true,
    seq: 1,
    startedMs: at(-24),
    completedMs: at(-23),
    category: 'green',
    radiation: 'none',
    answers: [
      ['responder_safe', { value: true }],
      ['responsive_and_mobile', { value: true }],
      ['vomiting', { value: false }],
      ['prodromal_symptoms', { choice: ['none'] }],
    ],
  });
  const lyra = assessment(id, {
    id: '50000000-0000-4000-8000-000000000002',
    callSign: 'LYRA',
    assessedBy: 'VEGA',
    seq: 2,
    startedMs: at(-22),
    completedMs: at(-20),
    category: 'red',
    radiation: 'probable',
    answers: [
      ['responsive_and_mobile', { value: false }],
      ['breathing', { value: false }],
      ['breathing_after_airway', { value: true }],
      ['vomiting', { value: true }],
      ['time_to_vomiting', { choice: '1_2h' }],
      ['prodromal_symptoms', { choice: ['nausea', 'fatigue'] }],
    ],
  });
  const atlas = assessment(id, {
    id: '50000000-0000-4000-8000-000000000003',
    callSign: 'ATLAS',
    assessedBy: 'VEGA',
    seq: 3,
    startedMs: at(-18),
    completedMs: at(-15),
    category: 'yellow',
    radiation: 'possible',
    answers: [
      ['responsive_and_mobile', { value: false }],
      ['breathing', { value: true }],
      ['resp_rate_over_30', { value: false }],
      ['perfusion_ok', { value: true }],
      ['follows_commands', { value: true }],
      ['vomiting', { value: false }],
      ['prodromal_symptoms', { choice: ['nausea', 'headache'] }],
    ],
  });
  const orion = assessment(id, {
    id: '50000000-0000-4000-8000-000000000004',
    callSign: 'ORION',
    assessedBy: 'VEGA',
    seq: 4,
    startedMs: at(-6),
    answers: [['responsive_and_mobile', { value: true }]],
  });

  const detail: EmergencyDetail = {
    session: {
      id,
      client_uuid: 'c4000000-0000-4000-8000-000000000001',
      mission_id: MISSION_ID,
      mission_code: 'ARES-1',
      protocol: PROTOCOL,
      trigger_type: 'manual_button',
      started_by: crewByCallSign('ORION').id,
      status: 'active',
      context: { solar_event_active: true, environment_alarm: null },
      responder_safe: true,
      next_step: 'start_assessments',
      started_at: iso(started),
      activated_at: iso(started),
      closed_at: null,
      received_at: iso(started + 1_000),
      merged_into: null,
      deadman: [],
      heartbeat: { dead_man_switch_seconds: 120, last_heartbeat_at: null, expires_at: null, lapsed_at: null },
      joined_activations: 1,
      synthetic: true,
    },
    assessments: [vega, lyra, atlas, orion],
    escalations: [
      ref(ESC.sessionOpen, 'flight_surgeon', 'emergency', 'acknowledged', started + DELAY_S * 1000),
      ref(ESC.crewLyra, 'crew', 'emergency', 'acknowledged', at(-20)),
      ref(ESC.triageLyra, 'flight_surgeon', 'emergency', 'delivered', at(-20) + DELAY_S * 1000),
      ref(ESC.triageAtlas, 'flight_surgeon', 'emergency', 'acknowledged', at(-15) + DELAY_S * 1000),
      ref(ESC.question, 'flight_surgeon', 'emergency', 'responded', at(-12) + DELAY_S * 1000),
    ],
    timeline: [
      event(1, 'opened', started + 1_000, {
        call_sign: 'ORION',
        actor_role: 'astronaut',
        details: { trigger_type: 'manual_button', automatic: false, solar_event_active: true },
      }),
      event(2, 'joined', at(-24.5), {
        call_sign: 'LYRA',
        details: { automatic: true, trigger_type: 'critical_reading', indicator_code: 'RESP_RATE' },
      }),
      event(3, 'assessment_started', at(-24), { call_sign: 'VEGA', assessment_id: vega.id, details: { reassessment_of: null } }),
      event(4, 'assessment_completed', at(-23), {
        call_sign: 'VEGA',
        assessment_id: vega.id,
        details: { triage_category: 'green', radiation_flag: 'none', rules_version: 1, matches_device: true },
      }),
      event(5, 'assessment_started', at(-22), { call_sign: 'LYRA', assessment_id: lyra.id, details: { reassessment_of: null } }),
      event(6, 'assessment_completed', at(-20), {
        call_sign: 'LYRA',
        assessment_id: lyra.id,
        details: { triage_category: 'red', radiation_flag: 'probable', rules_version: 1, matches_device: true },
      }),
      event(7, 'assessment_started', at(-18), { call_sign: 'ATLAS', assessment_id: atlas.id, details: { reassessment_of: null } }),
      event(8, 'assessment_completed', at(-15), {
        call_sign: 'ATLAS',
        assessment_id: atlas.id,
        details: { triage_category: 'yellow', radiation_flag: 'possible', rules_version: 1, matches_device: true },
      }),
      event(9, 'question_to_earth', at(-12), {
        actor_role: 'astronaut',
        details: { message_id: '61000000-0000-4000-8000-000000000303' },
      }),
      event(10, 'assessment_started', at(-6), { call_sign: 'ORION', assessment_id: orion.id, details: { reassessment_of: null } }),
    ],
    attention_order: [
      attention(1, 'LYRA', 'assessed', 'Rojo (inmediato), radiación probable (vómito)', lyra),
      attention(2, 'ORION', 'in_progress', 'En evaluación: todavía sin categoría', orion),
      attention(3, 'ATLAS', 'assessed', 'Amarillo (diferido), radiación posible (síntomas prodrómicos)', atlas),
      attention(4, 'VEGA', 'assessed', 'Verde (leve)', vega),
    ],
    report: null,
  };
  return { detail, questionEscalations: [ESC.question], liveHeartbeat: true };
}

// ---------------------------------------------------------------- cerrada (con reporte)

function closedEmergency(t0: number): MockEmergency {
  const b = t0 + CLOSED_BASE_MS;
  const at = (minutes: number) => b + minutes * MINUTE;
  const id = EMERGENCY.closed;
  const vega = assessment(id, {
    id: '50000000-0000-4000-8000-000000000011',
    callSign: 'VEGA',
    assessedBy: 'ORION',
    seq: 1,
    startedMs: at(3),
    completedMs: at(6),
    category: 'green',
    radiation: 'probable',
    answers: [
      ['responder_safe', { value: true }],
      ['responsive_and_mobile', { value: true }],
      ['vomiting', { value: true }],
      ['time_to_vomiting', { choice: '1_2h' }],
      ['prodromal_symptoms', { choice: ['nausea', 'fatigue'] }],
    ],
  });
  const lyra = assessment(id, {
    id: '50000000-0000-4000-8000-000000000012',
    callSign: 'LYRA',
    assessedBy: 'ORION',
    seq: 2,
    startedMs: at(7),
    completedMs: at(10),
    category: 'red',
    radiation: 'probable',
    answers: [
      ['responsive_and_mobile', { value: false }],
      ['breathing', { value: true }],
      ['resp_rate_over_30', { value: true }],
      ['vomiting', { value: true }],
      ['time_to_vomiting', { choice: 'lt_1h' }],
      ['prodromal_symptoms', { choice: ['nausea', 'headache'] }],
    ],
  });
  const atlas = assessment(id, {
    id: '50000000-0000-4000-8000-000000000013',
    callSign: 'ATLAS',
    assessedBy: 'ORION',
    seq: 3,
    startedMs: at(11),
    completedMs: at(13),
    category: 'green',
    radiation: 'none',
    answers: [
      ['responsive_and_mobile', { value: true }],
      ['vomiting', { value: false }],
      ['prodromal_symptoms', { choice: ['none'] }],
    ],
  });
  const attentionOrder = [
    attention(1, 'LYRA', 'assessed', 'Rojo (inmediato), radiación probable (vómito)', lyra),
    attention(2, 'ORION', 'unassessed', 'Sin evaluar: evalúalo (puede ser rojo)'),
    attention(3, 'VEGA', 'assessed', 'Verde (leve), radiación probable (vómito)', vega),
    attention(4, 'ATLAS', 'assessed', 'Verde (leve)', atlas),
  ];
  const timeline: EmergencyEvent[] = [
    event(1, 'opened', b, {
      call_sign: 'VEGA',
      details: { automatic: true, trigger_type: 'critical_reading', indicator_code: 'RAD_DOSE_DAILY' },
    }),
    event(2, 'deadman_started', b, { call_sign: 'VEGA', details: { deadline_at: iso(b + 60_000) } }),
    event(3, 'joined', b + 20_000, {
      call_sign: 'LYRA',
      details: { automatic: true, trigger_type: 'critical_reading', indicator_code: 'RAD_DOSE_DAILY' },
    }),
    event(4, 'deadman_started', b + 20_000, { call_sign: 'LYRA', details: { deadline_at: iso(b + 80_000) } }),
    event(5, 'deadman_expired', b + 60_000, { call_sign: 'VEGA', details: { deadline_at: iso(b + 60_000) } }),
    event(6, 'activated', b + 60_000, { details: { reason: 'deadman_expired' } }),
    event(7, 'deadman_expired', b + 80_000, { call_sign: 'LYRA', details: { deadline_at: iso(b + 80_000) } }),
    event(8, 'assessment_completed', at(6), {
      call_sign: 'VEGA',
      assessment_id: vega.id,
      details: { triage_category: 'green', radiation_flag: 'probable', rules_version: 1, matches_device: true },
    }),
    event(9, 'assessment_completed', at(10), {
      call_sign: 'LYRA',
      assessment_id: lyra.id,
      details: { triage_category: 'red', radiation_flag: 'probable', rules_version: 1, matches_device: true },
    }),
    event(10, 'assessment_completed', at(13), {
      call_sign: 'ATLAS',
      assessment_id: atlas.id,
      details: { triage_category: 'green', radiation_flag: 'none', rules_version: 1, matches_device: true },
    }),
    event(11, 'question_to_earth', at(20), {
      actor_role: 'astronaut',
      details: { message_id: '61000000-0000-4000-8000-000000000321' },
    }),
    event(12, 'heartbeat_lost', at(31), { details: { dead_man_switch_seconds: 120 } }),
    event(13, 'closed', at(50), { actor_role: 'astronaut', call_sign: 'ORION', details: { status: 'closed' } }),
  ];
  const counts = { green: 2, yellow: 0, red: 1, black: 0, unreachable: 0, in_progress: 0 };

  const detail: EmergencyDetail = {
    session: {
      id,
      client_uuid: 'c4000000-0000-4000-8000-000000000002',
      mission_id: MISSION_ID,
      mission_code: 'ARES-1',
      protocol: PROTOCOL,
      trigger_type: 'critical_reading',
      started_by: null,
      status: 'closed',
      context: { solar_event_active: true, environment_alarm: null },
      responder_safe: true,
      next_step: 'start_assessments',
      started_at: iso(b),
      activated_at: iso(b + 60_000),
      closed_at: iso(at(50)),
      received_at: iso(b + 1_000),
      merged_into: null,
      deadman: [
        { astronaut_id: crewByCallSign('VEGA').astronaut_id, call_sign: 'VEGA', trigger_type: 'critical_reading', deadline_at: iso(b + 60_000), confirmed_at: null, expired_at: iso(b + 60_000), status: 'expired' },
        { astronaut_id: crewByCallSign('LYRA').astronaut_id, call_sign: 'LYRA', trigger_type: 'critical_reading', deadline_at: iso(b + 80_000), confirmed_at: null, expired_at: iso(b + 80_000), status: 'expired' },
      ],
      heartbeat: { dead_man_switch_seconds: 120, last_heartbeat_at: iso(at(49)), expires_at: null, lapsed_at: iso(at(31)) },
      joined_activations: 1,
      synthetic: true,
    },
    assessments: [vega, lyra, atlas],
    escalations: [
      ref(ESC.closedTriage, 'flight_surgeon', 'emergency', 'closed', at(12) + DELAY_S * 1000),
      ref(ESC.closedQuestion, 'flight_surgeon', 'emergency', 'closed', at(20) + DELAY_S * 1000),
    ],
    timeline,
    attention_order: attentionOrder,
    report: {
      generated_at: iso(at(50) + 5_000),
      synthetic: true,
      disclaimer: REPORT_DISCLAIMER,
      wellbeing: 'No incluido: el triaje no usa datos de bienestar (decisión del MVP).',
      protocol: PROTOCOL,
      counts,
      attention_order: attentionOrder,
      differences: [],
      joined_activations: 1,
      messages: [
        {
          id: '61000000-0000-4000-8000-000000000321',
          direction: 'to_earth',
          author_role: 'astronaut',
          body: 'Fuera del protocolo: VEGA pide algo para la náusea y LYRA sigue sin responder. ¿Qué indican?',
          created_at: iso(at(20)),
          deliver_at: iso(at(20) + DELAY_S * 1000),
        },
        {
          id: '61000000-0000-4000-8000-000000000322',
          direction: 'to_crew',
          author_role: 'flight_surgeon',
          body: 'Antiemético para VEGA. LYRA: posición lateral y vía aérea; reporten en 10 min.',
          created_at: iso(at(24)),
          deliver_at: iso(at(24) + DELAY_S * 1000),
        },
      ],
      notes: 'LYRA estable en el refugio al cierre; seguimiento por el flight surgeon.',
    },
  };
  return { detail, questionEscalations: [ESC.closedQuestion], liveHeartbeat: false };
}

// ---------------------------------------------------------------- cancelada ("estoy bien")

function cancelledEmergency(t0: number): MockEmergency {
  const c = t0 + CANCELLED_BASE_MS;
  const id = EMERGENCY.cancelled;
  const atlas = crewByCallSign('ATLAS');
  const detail: EmergencyDetail = {
    session: {
      id,
      client_uuid: 'c4000000-0000-4000-8000-000000000003',
      mission_id: MISSION_ID,
      mission_code: 'ARES-1',
      protocol: PROTOCOL,
      trigger_type: 'missed_checkin',
      started_by: null,
      status: 'cancelled',
      context: { solar_event_active: false, environment_alarm: null },
      responder_safe: null,
      next_step: 'start_assessments',
      started_at: iso(c),
      activated_at: null,
      closed_at: iso(c + 45_000),
      received_at: iso(c + 1_000),
      merged_into: null,
      deadman: [
        { astronaut_id: atlas.astronaut_id, call_sign: 'ATLAS', trigger_type: 'missed_checkin', deadline_at: iso(c + 60_000), confirmed_at: iso(c + 40_000), expired_at: null, status: 'confirmed' },
      ],
      heartbeat: { dead_man_switch_seconds: 120, last_heartbeat_at: null, expires_at: null, lapsed_at: null },
      joined_activations: 0,
      synthetic: true,
    },
    assessments: [],
    escalations: [ref(ESC.cancelledSession, 'flight_surgeon', 'urgent', 'closed', c + DELAY_S * 1000)],
    timeline: [
      event(1, 'opened', c, { call_sign: 'ATLAS', details: { automatic: true, trigger_type: 'missed_checkin' } }),
      event(2, 'deadman_started', c, { call_sign: 'ATLAS', details: { deadline_at: iso(c + 60_000) } }),
      event(3, 'deadman_confirmed', c + 40_000, { call_sign: 'ATLAS', actor_role: 'astronaut', details: {} }),
      event(4, 'cancelled', c + 45_000, { details: { reason: 'deadman_confirmed' } }),
    ],
    attention_order: [],
    report: null,
  };
  return { detail, questionEscalations: [], liveHeartbeat: false };
}

export function buildEmergencies(t0: number): MockEmergency[] {
  return [activeEmergency(t0), closedEmergency(t0), cancelledEmergency(t0)];
}
