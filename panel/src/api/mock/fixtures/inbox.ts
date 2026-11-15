/**
 * Bandeja de Tierra del modo demo (escalamientos a flight_surgeon) y sus hilos. Fechas relativas
 * a `t0`; todo lo que cruza el enlace llega 90 s después (`deliver_at`).
 * - Lecturas con `measured_at`, `lag_s` y `late_sync` (una sincronizada tarde).
 * - Una alerta que todavía viaja: aparece en la bandeja ~2 min después de abrir el demo.
 * - Bienestar y SLEEP_HOURS: solo el flight surgeon (admin no las recibe; 403 en hilo/acuse/respuesta).
 * - Hilos con los tres estados de entrega: entregado (pasado), en camino (futuro) y en cola (null).
 */
import type { EscalationMessage, InboxItem } from '../../types.ts';
import { DELAY_S, MISSION_ID } from './mission.ts';
import { crewByCallSign, groundUser } from './people.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const ESC = {
  /** Apertura de la emergencia activa (evento solar). */
  sessionOpen: '60000000-0000-4000-8000-000000000210',
  crewLyra: '60000000-0000-4000-8000-000000000211',
  triageLyra: '60000000-0000-4000-8000-000000000212',
  /** Pregunta de la tripulación fuera del protocolo (emergencia activa). */
  question: '60000000-0000-4000-8000-000000000213',
  triageAtlas: '60000000-0000-4000-8000-000000000214',
  bpOrion: '60000000-0000-4000-8000-000000000201',
  respLyra: '60000000-0000-4000-8000-000000000202',
  hrVega: '60000000-0000-4000-8000-000000000203',
  /** Llega a Tierra ~2 min después de abrir el demo. */
  tempLyraIncoming: '60000000-0000-4000-8000-000000000204',
  wellbeingLyra: '60000000-0000-4000-8000-000000000241',
  sleepAtlas: '60000000-0000-4000-8000-000000000242',
  manual: '60000000-0000-4000-8000-000000000251',
  /** Emergencia cerrada (hace 3 días): pregunta y triaje, ya cerrados. */
  closedQuestion: '60000000-0000-4000-8000-000000000231',
  closedTriage: '60000000-0000-4000-8000-000000000232',
  /** Emergencia cancelada ("estoy bien" de ATLAS). */
  cancelledSession: '60000000-0000-4000-8000-000000000271',
} as const;

/** Origen de las emergencias (en días/minutos antes de t0); lo comparten con emergencies.ts. */
export const ACTIVE_STARTED_MIN = -25;
export const CLOSED_BASE_MS = -(3 * 24 * HOUR + 2 * HOUR);
export const CANCELLED_BASE_MS = -(5 * 24 * HOUR + 7 * HOUR);

const iso = (ms: number) => new Date(ms).toISOString();

export function buildInbox(t0: number): InboxItem[] {
  const at = (minutes: number) => t0 + minutes * MINUTE;
  const dr = groundUser('flight_surgeon');
  const orion = crewByCallSign('ORION');
  const vega = crewByCallSign('VEGA');
  const lyra = crewByCallSign('LYRA');
  const atlas = crewByCallSign('ATLAS');

  const base = {
    mission_id: MISSION_ID,
    mission_code: 'ARES-1',
    level: 'flight_surgeon',
    acknowledged_at: null,
    acknowledged_by: null,
  };
  /** created → deliver_at = created + retraso. */
  const sent = (createdMs: number) => ({
    created_at: iso(createdMs),
    deliver_at: iso(createdMs + DELAY_S * 1000),
  });
  const acked = (ms: number) => ({ acknowledged_at: iso(ms), acknowledged_by: dr.id });
  const reading = (measuredMs: number, createdMs: number) => {
    const lag = Math.round((createdMs - measuredMs) / 1000);
    return { measured_at: iso(measuredMs), lag_s: lag, late_sync: lag > 15 * 60 };
  };

  return [
    // ---------------------------------------------------------- emergencia activa
    {
      ...base,
      id: ESC.sessionOpen,
      astronaut_id: orion.astronaut_id,
      call_sign: orion.call_sign,
      category: 'emergency',
      source_type: 'emergency_session',
      source_id: '40000000-0000-4000-8000-000000000001',
      priority: 'emergency',
      status: 'acknowledged',
      reason: 'Emergencia activa: botón manual de ORION durante un evento solar.',
      ...sent(at(ACTIVE_STARTED_MIN)),
      ...acked(at(-22)),
    },
    {
      ...base,
      id: ESC.triageLyra,
      astronaut_id: lyra.astronaut_id,
      call_sign: lyra.call_sign,
      category: 'emergency',
      source_type: 'emergency_assessment',
      source_id: '50000000-0000-4000-8000-000000000002',
      priority: 'emergency',
      status: 'delivered',
      reason: 'Triaje rojo con radiación probable (START adaptado v1).',
      ...sent(at(-20)),
      triage: { triage_category: 'red', radiation_flag: 'probable' },
    },
    {
      ...base,
      id: ESC.triageAtlas,
      astronaut_id: atlas.astronaut_id,
      call_sign: atlas.call_sign,
      category: 'emergency',
      source_type: 'emergency_assessment',
      source_id: '50000000-0000-4000-8000-000000000003',
      priority: 'emergency',
      status: 'acknowledged',
      reason: 'Triaje amarillo con radiación posible (START adaptado v1).',
      ...sent(at(-15)),
      ...acked(at(-13)),
      triage: { triage_category: 'yellow', radiation_flag: 'possible' },
    },
    {
      ...base,
      id: ESC.question,
      astronaut_id: null,
      call_sign: null,
      category: 'emergency',
      source_type: 'emergency_session',
      source_id: '40000000-0000-4000-8000-000000000001',
      priority: 'emergency',
      status: 'responded',
      reason: 'Pregunta de la tripulación fuera del protocolo (emergencia activa).',
      ...sent(at(-12)),
      ...acked(at(-9)),
    },
    // ---------------------------------------------------------- lecturas
    {
      ...base,
      id: ESC.respLyra,
      astronaut_id: lyra.astronaut_id,
      call_sign: lyra.call_sign,
      category: 'reading',
      source_type: 'reading',
      source_id: '30000000-0000-4000-8000-000000000102',
      priority: 'urgent',
      status: 'delivered',
      reason: 'RESP_RATE crítico: 31 rpm.',
      ...sent(at(-34)),
      ...reading(at(-35), at(-34)),
      evaluation: {
        code: 'RESP_RATE',
        level: 'critical',
        rule_index: 1,
        rules_version: 1,
        escalation: 'flight_surgeon',
        basis: 'source',
        recommendation: 'Respiración muy rápida. Avisa al oficial médico de a bordo.',
      },
    },
    {
      ...base,
      id: ESC.hrVega,
      astronaut_id: vega.astronaut_id,
      call_sign: vega.call_sign,
      category: 'reading',
      source_type: 'reading',
      source_id: '30000000-0000-4000-8000-000000000103',
      priority: 'routine',
      status: 'responded',
      reason: 'HEART_RATE en precaución: 96 lpm en reposo.',
      // Medida hace 95 min y sincronizada 35 min después: llegó tarde.
      ...sent(at(-60)),
      ...reading(at(-95), at(-60)),
      ...acked(at(-52)),
      evaluation: {
        code: 'HEART_RATE',
        level: 'caution',
        rule_index: 2,
        rules_version: 1,
        escalation: 'flight_surgeon',
        basis: 'source',
        recommendation: 'Tu pulso en reposo está alto. Repite la medición después de descansar.',
      },
    },
    {
      ...base,
      id: ESC.bpOrion,
      astronaut_id: orion.astronaut_id,
      call_sign: orion.call_sign,
      category: 'reading',
      source_type: 'reading',
      source_id: '30000000-0000-4000-8000-000000000101',
      priority: 'routine',
      status: 'acknowledged',
      reason: 'BLOOD_PRESSURE en precaución: 145/88 mmHg.',
      ...sent(at(-128)),
      ...reading(at(-130), at(-128)),
      ...acked(at(-100)),
      evaluation: {
        code: 'BLOOD_PRESSURE',
        level: 'caution',
        rule_index: 3,
        rules_version: 1,
        escalation: 'flight_surgeon',
        basis: 'source',
        recommendation:
          'Tu presión está alta. Repite la medición mañana a la misma hora; si sigue así, el flight surgeon la revisará.',
        source_ids: ['aha_bp', 'ama_bp2025'],
      },
    },
    {
      ...base,
      id: ESC.tempLyraIncoming,
      astronaut_id: lyra.astronaut_id,
      call_sign: lyra.call_sign,
      category: 'reading',
      source_type: 'reading',
      source_id: '30000000-0000-4000-8000-000000000104',
      priority: 'urgent',
      // Todavía viaja a Tierra: la bandeja no la muestra hasta deliver_at.
      status: 'queued',
      reason: 'BODY_TEMP en precaución: 37,9 °C.',
      created_at: iso(t0 + 30_000),
      deliver_at: iso(t0 + 30_000 + DELAY_S * 1000),
      ...reading(t0 + 20_000, t0 + 30_000),
      evaluation: {
        code: 'BODY_TEMP',
        level: 'caution',
        rule_index: 2,
        rules_version: 1,
        escalation: 'flight_surgeon',
        basis: 'source',
      },
    },
    // ---------------------------------------------------------- solo flight surgeon
    {
      ...base,
      id: ESC.wellbeingLyra,
      astronaut_id: lyra.astronaut_id,
      call_sign: lyra.call_sign,
      category: 'wellbeing',
      source_type: 'wellbeing',
      source_id: null,
      priority: 'routine',
      status: 'delivered',
      reason: 'Aptitud no confirmada (prueba de reacción).',
      ...sent(at(-9 * 60)),
    },
    {
      ...base,
      id: ESC.sleepAtlas,
      astronaut_id: atlas.astronaut_id,
      call_sign: atlas.call_sign,
      category: 'reading',
      source_type: 'reading',
      source_id: '30000000-0000-4000-8000-000000000105',
      priority: 'urgent',
      status: 'delivered',
      reason: 'SLEEP_HOURS crítico: 7 noches seguidas con 6 h o menos.',
      ...sent(at(-14 * 60)),
      ...reading(at(-14 * 60 - 1), at(-14 * 60)),
      evaluation: {
        code: 'SLEEP_HOURS',
        level: 'critical',
        rule_index: 1,
        rules_version: 1,
        escalation: 'flight_surgeon',
        basis: 'source',
      },
    },
    // ---------------------------------------------------------- manual
    {
      ...base,
      id: ESC.manual,
      astronaut_id: null,
      call_sign: null,
      category: 'manual',
      source_type: 'manual',
      source_id: null,
      priority: 'routine',
      status: 'acknowledged',
      reason: 'Revisión semanal: confirmar los check-ins pendientes antes del corte de enlace.',
      ...sent(at(-26 * 60)),
      ...acked(at(-25 * 60)),
    },
    // ---------------------------------------------------------- cerradas (no salen en la bandeja)
    {
      ...base,
      id: ESC.closedQuestion,
      astronaut_id: null,
      call_sign: null,
      category: 'emergency',
      source_type: 'emergency_session',
      source_id: '40000000-0000-4000-8000-000000000002',
      priority: 'emergency',
      status: 'closed',
      reason: 'Pregunta de la tripulación fuera del protocolo (emergencia cerrada).',
      ...sent(t0 + CLOSED_BASE_MS + 20 * MINUTE),
      ...acked(t0 + CLOSED_BASE_MS + 23 * MINUTE),
    },
    {
      ...base,
      id: ESC.closedTriage,
      astronaut_id: lyra.astronaut_id,
      call_sign: lyra.call_sign,
      category: 'emergency',
      source_type: 'emergency_assessment',
      source_id: '50000000-0000-4000-8000-000000000012',
      priority: 'emergency',
      status: 'closed',
      reason: 'Triaje rojo con radiación probable (START adaptado v1).',
      ...sent(t0 + CLOSED_BASE_MS + 12 * MINUTE),
      ...acked(t0 + CLOSED_BASE_MS + 14 * MINUTE),
      triage: { triage_category: 'red', radiation_flag: 'probable' },
    },
    {
      ...base,
      id: ESC.cancelledSession,
      astronaut_id: atlas.astronaut_id,
      call_sign: atlas.call_sign,
      category: 'emergency',
      source_type: 'emergency_session',
      source_id: '40000000-0000-4000-8000-000000000003',
      priority: 'urgent',
      status: 'closed',
      reason: 'Activación automática por check-in no completado (ATLAS confirmó "estoy bien").',
      ...sent(t0 + CANCELLED_BASE_MS),
    },
  ];
}

export function buildMessages(t0: number): EscalationMessage[] {
  const at = (minutes: number) => t0 + minutes * MINUTE;
  const dr = groundUser('flight_surgeon');
  const orion = crewByCallSign('ORION');
  const vega = crewByCallSign('VEGA');
  const toEarth = (id: string, escalation: string, author: string, body: string, createdMs: number) => ({
    id,
    escalation_id: escalation,
    direction: 'to_earth' as const,
    author_id: author,
    author_role: 'astronaut' as const,
    body,
    created_at: iso(createdMs),
    deliver_at: iso(createdMs + DELAY_S * 1000),
  });
  const toCrew = (id: string, escalation: string, body: string, createdMs: number, deliverAt: string | null) => ({
    id,
    escalation_id: escalation,
    direction: 'to_crew' as const,
    author_id: dr.id,
    author_role: 'flight_surgeon' as const,
    body,
    created_at: iso(createdMs),
    deliver_at: deliverAt,
  });
  const closed = (minutes: number) => t0 + CLOSED_BASE_MS + minutes * MINUTE;

  return [
    // Pregunta de la emergencia activa: entregado, en camino y en cola.
    toEarth(
      '61000000-0000-4000-8000-000000000303',
      ESC.question,
      orion.id,
      '¿La dejamos en el refugio o la llevamos a la litera?',
      at(-12),
    ),
    toCrew(
      '61000000-0000-4000-8000-000000000301',
      ESC.question,
      'Recibido. Mantener a LYRA en el refugio y repetir signos vitales cada 15 min.',
      at(-9),
      iso(at(-9) + DELAY_S * 1000),
    ),
    toCrew(
      '61000000-0000-4000-8000-000000000302',
      ESC.question,
      'Si se corta el enlace, sigan en el refugio y reporten la SpO₂ de LYRA cuando vuelva.',
      at(-4),
      null,
    ),
    toCrew(
      '61000000-0000-4000-8000-000000000304',
      ESC.question,
      'Confirmen si LYRA sigue con náusea; si sigue, antiemético del botiquín según el protocolo de a bordo.',
      t0 - 20_000,
      iso(t0 - 20_000 + DELAY_S * 1000),
    ),
    // Lecturas.
    toEarth(
      '61000000-0000-4000-8000-000000000311',
      ESC.bpOrion,
      orion.id,
      'Repetí la medición y sigue en 144/90.',
      at(-110),
    ),
    toCrew(
      '61000000-0000-4000-8000-000000000312',
      ESC.hrVega,
      'Recibido. Repite la medición en reposo después de la próxima comida.',
      at(-52),
      iso(at(-52) + DELAY_S * 1000),
    ),
    toEarth(
      '61000000-0000-4000-8000-000000000313',
      ESC.hrVega,
      vega.id,
      'Hecho: 91 lpm en reposo.',
      at(-40),
    ),
    // Emergencia cerrada: el hilo se lee, pero ya no admite respuestas (409).
    toEarth(
      '61000000-0000-4000-8000-000000000321',
      ESC.closedQuestion,
      vega.id,
      'Fuera del protocolo: VEGA pide algo para la náusea y LYRA sigue sin responder. ¿Qué indican?',
      closed(20),
    ),
    toCrew(
      '61000000-0000-4000-8000-000000000322',
      ESC.closedQuestion,
      'Antiemético para VEGA. LYRA: posición lateral y vía aérea; reporten en 10 min.',
      closed(24),
      iso(closed(24) + DELAY_S * 1000),
    ),
  ];
}
