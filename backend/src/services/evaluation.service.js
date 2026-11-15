'use strict';

/**
 * Motor del semáforo en el servidor: reglas activas (versionadas) + campos derivados +
 * evaluateIndicator (src/engine/conditions.js, el mismo evaluador que usa la app offline).
 */
const env = require('../config/env');
const { evaluateIndicator } = require('../engine/conditions');
const { computeDerived } = require('../engine/derived');
const catalog = require('./catalog.service');
const readings = require('../models/readings.model');

// Ventanas de historial que necesita cada indicador (en días).
const HISTORY_DAYS = {
  SLEEP_HOURS: 30,
  RAD_DOSE_DAILY: 30,
  HAB_CO2: 7,
  EXERCISE_MIN: 30,
};

/** Consulta solo el historial que el indicador necesita para sus derivados. */
async function derivationContext(indicator, reading, db) {
  const code = indicator.code;
  const base = {
    astronautId: reading.astronaut_id,
    missionId: reading.mission_id,
    moduleId: reading.module_id,
    before: reading.measured_at,
    excludeId: reading.id,
  };
  if (HISTORY_DAYS[code]) {
    return {
      history: await readings.history(
        { ...base, indicatorCode: code, days: HISTORY_DAYS[code] },
        db,
      ),
      weeklyPrescriptionMin: env.health.exerciseWeeklyPrescriptionMin,
    };
  }
  if (code === 'RAD_DOSE_CUM') {
    return {
      dailyDoses: await readings.history({ ...base, indicatorCode: 'RAD_DOSE_DAILY', days: 8 }, db),
      missionEndsAt: await readings.missionEndsAt(reading.mission_id, db),
    };
  }
  if (code === 'BODY_MASS') {
    return { baseline: await readings.firstInMission({ ...base, indicatorCode: code }, db) };
  }
  if (code.startsWith('WB_')) {
    return { history: await readings.history({ ...base, indicatorCode: code, days: 30 }, db) };
  }
  if (code.startsWith('PVT_')) {
    return {
      history: await readings.history(
        { ...base, indicatorCode: code, days: 90, withRest: true },
        db,
      ),
    };
  }
  return {};
}

/**
 * Contexto de las reglas: componentes de la lectura + derivados + datos del perfil.
 * `sex` (sexo biológico, migración 009) solo si el perfil lo tiene: así una regla puede usar
 * { "field": "sex", "op": "eq", "value": "female" } y, sin dato, la condición es falsa.
 * Ninguna regla actual lo usa; la radiación no depende del sexo (límite de carrera universal,
 * NASA-STD-3001 Vol. 1 [V1 4030]). Los datos de la lectura ganan sobre los del perfil.
 */
function ruleContext({ components, derived, sex }) {
  return { ...(sex ? { sex } : {}), ...components, ...derived };
}

/**
 * Evalúa una lectura ya guardada. Devuelve { evaluation, derived }: evaluation tiene la
 * forma de evaluateIndicator (con la versión de reglas activa).
 */
async function evaluateReading(reading, db) {
  const entry = await catalog.indicatorWithRules(reading.indicator_code);
  if (!entry || !entry.ruleSet)
    throw new Error(`Sin reglas activas para ${reading.indicator_code}`);
  const { indicator, ruleSet } = entry;
  const ctx = await derivationContext(indicator, reading, db);
  const derived = computeDerived(indicator, reading, ctx);
  const sex = reading.astronaut_id ? await readings.astronautSex(reading.astronaut_id, db) : null;
  const evaluation = evaluateIndicator(
    { code: indicator.code, rules: ruleSet.rules, rules_version: ruleSet.version },
    ruleContext({ components: reading.components, derived, sex }),
  );
  return { evaluation, derived };
}

module.exports = { evaluateReading, ruleContext };
