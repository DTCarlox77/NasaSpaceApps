'use strict';

/**
 * Líneas base del simulador (datos SINTÉTICOS).
 *
 * Cada valor medio está dentro de la banda "normal" del catálogo
 * (docs/catalogo-indicadores.json) y el recorte (clamp) de la historia normal lo mantiene por
 * debajo de los umbrales que escalan a la tripulación o a Tierra: en la historia normal solo
 * aparecen precauciones de autocuidado (self_care), nunca escalamientos ni críticos.
 *
 * Fuentes (ids del catálogo):
 * - Radiación: ntrs_ascend_rad, en la ISS se acumulan 0.2–0.5 mSv por día.
 * - Ejercicio: ochmo_exercise, en la ISS el promedio es de 600 min por semana.
 * - CO₂: ochmo_co2 (precaución > 3 mmHg o promedio de 7 días ≥ 2.5); en la ISS se han medido
 *   1–9 mmHg (guía del indicador).
 * - Temperatura y humedad: ochmo_eclss (20–25 °C y 30–60 % HR).
 * - Ruido: ntrs_nc_dba (NC-50 ≈ 58 dBA en trabajo y NC-40 ≈ 49 dBA en sueño).
 * - Masa: ntrs_body_mass (pérdida de 2–5 % el primer mes); aquí la masa ya está estable.
 * - Sueño: la guía (NASA OCHMO) dice que en vuelo se duerme 6–6.5 h. La demo usa ≈ 7.2 h
 *   para que la historia quede en normal (suposición de diseño).
 * - PVT: pvt_fd y pvtb_basner (lapso = respuesta ≥ 355 ms; precaución desde 11 lapsos).
 * Todo lo demás (medias y desviaciones de cada astronauta, horarios) es SUPOSICIÓN DE DISEÑO.
 */

// Suposición de diseño: rangos de la historia normal. El mínimo y el máximo de cada uno
// quedan antes del umbral que escala (crew / flight_surgeon) del catálogo.
const LIMITS = Object.freeze({
  systolic: [100, 134], // ≥ 140 escala a flight_surgeon; 130–134 = precaución self_care
  diastolic: [62, 86], // ≥ 90 escala; 80–86 = precaución self_care
  HEART_RATE: [61, 98], // > 100 self_care, ≥ 111 crew
  RESP_RATE: [12, 19], // ≥ 21 crew
  SPO2: [95, 100], // ≤ 94 self_care, ≤ 93 crew
  BODY_TEMP: [36.1, 37.3], // ≤ 36 self_care, ≥ 38 crew
  GLUCOSE: [72, 104], // en ayunas: ≥ 100 self_care, ≥ 126 flight_surgeon
  SLEEP_HOURS: [6.1, 8.6], // < 7 self_care; nunca ≤ 6 (3 noches seguidas escalan a crew)
  EXERCISE_MIN: [60, 120], // promedio ≈ 600 min/semana (ochmo_exercise)
  RAD_DOSE_DAILY: [0.22, 0.48], // ntrs_ascend_rad: 0.2–0.5 mSv/día; el doble de la mediana escala
  WB: [0, 100],
  HAB_CO2: [1.4, 2.8], // > 3 crew; promedio de 7 días < 2.5
  HAB_TEMP: [20.5, 24.5], // fuera de 20–25 crew
  HAB_HUMIDITY: [32, 58], // fuera de 30–60 crew
  NOISE_WORK: [46, 57], // > 58 crew
  NOISE_SLEEP: [40, 48], // > 49 crew
});

/**
 * Por astronauta (call sign del seed). Medias y desviaciones: suposición de diseño.
 * rad_factor: blindaje y puesto de trabajo (±5 %); rad_prior_msv: dosis de carrera previa.
 */
const ASTRONAUTS = Object.freeze({
  ORION: {
    bp: [114, 74],
    hr: 64,
    rr: 14,
    spo2: 98,
    temp: 36.6,
    glucose: 88,
    sleep: 7.2,
    exercise: 90,
    mass: 72.4,
    rad_factor: 1.0,
    rad_prior_msv: 40,
    wb: { WB_MOOD: 70, WB_FATIGUE: 30, WB_STRESS: 28, WB_CREW_CONFLICT: 12 },
    pvt: { lapses: [1, 2, 3], mean_rt: [262, 271, 279], false_starts: [0, 1, 1] },
  },
  VEGA: {
    bp: [110, 70],
    hr: 68,
    rr: 15,
    spo2: 97,
    temp: 36.7,
    glucose: 92,
    sleep: 7.1,
    exercise: 86,
    mass: 81.0,
    rad_factor: 0.97,
    rad_prior_msv: 25,
    wb: { WB_MOOD: 66, WB_FATIGUE: 34, WB_STRESS: 35, WB_CREW_CONFLICT: 15 },
    pvt: { lapses: [2, 3, 4], mean_rt: [271, 280, 290], false_starts: [1, 1, 2] },
  },
  LYRA: {
    bp: [108, 68],
    hr: 66,
    rr: 14,
    spo2: 98,
    temp: 36.5,
    glucose: 85,
    sleep: 7.5,
    exercise: 95,
    mass: 63.5,
    rad_factor: 1.04,
    rad_prior_msv: 0,
    wb: { WB_MOOD: 74, WB_FATIGUE: 26, WB_STRESS: 24, WB_CREW_CONFLICT: 10 },
    pvt: { lapses: [0, 1, 2], mean_rt: [248, 255, 263], false_starts: [0, 0, 1] },
  },
  ATLAS: {
    bp: [116, 75],
    hr: 62,
    rr: 13,
    spo2: 97,
    temp: 36.6,
    glucose: 90,
    sleep: 7.2,
    exercise: 88,
    mass: 78.2,
    rad_factor: 1.02,
    rad_prior_msv: 60,
    wb: { WB_MOOD: 68, WB_FATIGUE: 32, WB_STRESS: 30, WB_CREW_CONFLICT: 14 },
    pvt: { lapses: [1, 2, 4], mean_rt: [258, 266, 277], false_starts: [0, 1, 2] },
  },
});

// Para un call sign que no está arriba (otra tripulación): perfil promedio.
const DEFAULT_PROFILE = ASTRONAUTS.ORION;
const profileFor = (callSign) => ASTRONAUTS[callSign] || DEFAULT_PROFILE;

// Desviaciones día a día (suposición de diseño).
const SD = Object.freeze({
  systolic: 4,
  diastolic: 3,
  hr: 3,
  rr: 1,
  spo2: 0.6,
  temp: 0.15,
  glucose: 5,
  sleep: 0.4,
  exercise: 10,
  mass: 0.25,
  rad: 0.04,
  wb: 5,
});

// Mediana diaria de la ISS (ntrs_ascend_rad: 0.2–0.5 mSv/día). ARES-1 es un tránsito a Marte,
// donde la dosis real es mayor; la demo usa la referencia del catálogo (suposición de diseño).
const RAD_DAILY_MSV = 0.35;

/** Módulos del hábitat de ARES-1 (seed 003: HAB-1 y HAB-2). Suposición de diseño. */
const MODULES = Object.freeze({
  'HAB-1': { co2: 2.1, temp: 22.5, humidity: 45, noise_work: 53, noise_sleep: 45, offset_min: 5 },
  'HAB-2': { co2: 1.9, temp: 22.0, humidity: 48, noise_work: 51, noise_sleep: 44, offset_min: 35 },
});

// Periodo de sueño de la tripulación en UTC (la ISS usa GMT): 22:00–06:00. Suposición de diseño.
const isSleepHour = (hour) => hour >= 22 || hour < 6;

// Tableta donde se hace la PVT (la línea base es por dispositivo). Seed 003: TAB-1.
const PVT_DEVICE = 'TAB-1';

module.exports = {
  LIMITS,
  ASTRONAUTS,
  SD,
  RAD_DAILY_MSV,
  MODULES,
  PVT_DEVICE,
  profileFor,
  isSleepHour,
};
