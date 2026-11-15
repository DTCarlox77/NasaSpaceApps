/**
 * Misión del modo demo: ARES-1 en tránsito a Marte, retraso de 90 s (acelerado) y un corte
 * programado dentro de unas horas. Las fechas son relativas a `t0` (cuando arranca el mock).
 */
import type { CurrentMission, IndicatorDef, MissionRef } from '../../types.ts';

export const MISSION_ID = '20000000-0000-4000-8000-000000000001';
export const DELAY_S = 90;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const MISSION_REF: MissionRef = {
  id: MISSION_ID,
  code: 'ARES-1',
  name: 'Ares 1 · Tránsito a Marte (demo)',
  status: 'active',
};

const iso = (ms: number) => new Date(ms).toISOString();

export function currentMission(t0: number): CurrentMission {
  return {
    mission: {
      id: MISSION_ID,
      code: 'ARES-1',
      name: 'Ares 1 · Tránsito a Marte (demo)',
      environment_code: 'mars_transit',
      status: 'active',
      starts_at: iso(t0 - 45 * DAY),
      ends_at: null,
    },
    environment: {
      code: 'mars_transit',
      name: 'Tránsito a Marte',
      type: 'spacecraft',
      gravity_g: 0,
      comm_delay_seconds: DELAY_S,
      description: 'Retraso de minutos; demo acelerada',
    },
    crew_role: null,
    comm: {
      delay_seconds: DELAY_S,
      link: 'up',
      upcoming_outages: [
        {
          id: '23000000-0000-4000-8000-000000000001',
          mission_id: MISSION_ID,
          starts_at: iso(t0 + 3 * HOUR),
          ends_at: iso(t0 + 5 * HOUR),
          reason: 'Conjunción solar (demo)',
          created_at: iso(t0 - 2 * DAY),
        },
      ],
    },
  };
}

/** Catálogo estándar (GET /indicators?sensitivity=standard): nombres y unidades del contrato. */
export const STANDARD_CATALOG: IndicatorDef[] = [
  {
    code: 'BLOOD_PRESSURE',
    name: 'Presión arterial',
    unit: 'mmHg',
    value_type: 'composite',
    components: [
      { name: 'systolic', role: 'value', unit: 'mmHg', required: true },
      { name: 'diastolic', unit: 'mmHg', required: true },
    ],
    sensitivity: 'standard',
  },
  {
    code: 'HEART_RATE',
    name: 'Frecuencia cardíaca en reposo',
    unit: 'lpm',
    value_type: 'simple',
    components: [{ name: 'value', role: 'value', unit: 'lpm', required: true }],
    sensitivity: 'standard',
  },
  {
    code: 'RESP_RATE',
    name: 'Frecuencia respiratoria',
    unit: 'rpm',
    value_type: 'simple',
    components: [{ name: 'value', role: 'value', unit: 'rpm', required: true }],
    sensitivity: 'standard',
  },
  {
    code: 'SPO2',
    name: 'Saturación de oxígeno',
    unit: '%',
    value_type: 'simple',
    components: [{ name: 'value', role: 'value', unit: '%', required: true }],
    sensitivity: 'standard',
  },
  {
    code: 'BODY_TEMP',
    name: 'Temperatura corporal',
    unit: '°C',
    value_type: 'simple',
    components: [{ name: 'value', role: 'value', unit: '°C', required: true }],
    sensitivity: 'standard',
  },
  {
    code: 'RAD_DOSE_DAILY',
    name: 'Dosis de radiación diaria',
    unit: 'mSv/día',
    value_type: 'simple',
    components: [{ name: 'value', role: 'value', unit: 'mSv', required: true }],
    sensitivity: 'standard',
  },
  {
    // En el catálogo real es `standard`, pero desde v1.8 no sale en el dashboard (llega con el
    // check-in): el panel lo oculta igual por defensa.
    code: 'SLEEP_HOURS',
    name: 'Horas de sueño',
    unit: 'h',
    value_type: 'simple',
    components: [{ name: 'value', role: 'value', unit: 'h', required: true }],
    sensitivity: 'standard',
  },
];
