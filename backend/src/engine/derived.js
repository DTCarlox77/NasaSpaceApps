'use strict';

/**
 * Campos derivados del semáforo: implementa los `derived_fields` de
 * docs/catalogo-indicadores.json. Funciones PURAS: reciben la lectura actual y el
 * historial ya consultado (lecturas anteriores, no corregidas); no tocan la base.
 *
 * Regla del catálogo: si un campo no se puede calcular (falta historial), se OMITE.
 * Así la condición que lo usa es falsa y una regla nunca dispara por falta de datos.
 *
 * Forma de una lectura: { components: { value, ... }, measured_at }.
 * En las PVT el historial trae además `rest` (true = corrida en condiciones de descanso).
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const CAREER_LIMIT_MSV = 600;
const WB_RECENT = 3; // check-ins del promedio reciente
const WB_BASELINE_DAYS = 14;
const WB_BASELINE_MIN = 7;
const WB_ADVERSE_Z = 1.5;
const PVT_BASELINE_MIN = 3;

const ms = (value) => new Date(value).getTime();
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const valueOf = (reading) =>
  reading && reading.components && isNum(reading.components.value)
    ? reading.components.value
    : null;
const utcDay = (time) => Math.floor(time / DAY_MS);

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const mean = (values) => (values.length ? values.reduce((s, v) => s + v, 0) / values.length : null);

/** Desviación estándar muestral (n − 1). */
function sampleSd(values) {
  if (values.length < 2) return null;
  const m = mean(values);
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1));
}

/** Lecturas anteriores a `before` (estrictamente), de la más reciente a la más antigua. */
const previous = (history, before) =>
  (history || [])
    .filter((r) => ms(r.measured_at) < before)
    .sort((a, b) => ms(b.measured_at) - ms(a.measured_at));

/** Lecturas con measured_at en [from, to). */
const between = (history, from, to) =>
  (history || []).filter((r) => {
    const t = ms(r.measured_at);
    return t >= from && t < to;
  });

const values = (readings) => readings.map(valueOf).filter((v) => v !== null);

// ---------------------------------------------------------------- SLEEP_HOURS

/**
 * consecutive_nights_le_6h: noches seguidas (incluida la actual) con ≤ 6 h.
 * Una noche = un día UTC de measured_at (si hay varias lecturas ese día, manda la más
 * reciente). Una noche sin registro corta la racha.
 */
function consecutiveNightsLe6h(reading, history) {
  const value = valueOf(reading);
  if (value === null) return undefined;
  if (value > 6) return 0;
  const now = ms(reading.measured_at);
  const byDay = new Map();
  for (const r of previous(history, now)) {
    const day = utcDay(ms(r.measured_at));
    if (!byDay.has(day)) byDay.set(day, valueOf(r));
  }
  let count = 1;
  for (let day = utcDay(now) - 1; byDay.has(day); day -= 1) {
    const v = byDay.get(day);
    if (v === null || v > 6) break;
    count += 1;
  }
  return count;
}

// ---------------------------------------------------------------- RAD_DOSE_DAILY

/** Dosis diarias de los 7 días anteriores a `now`, sin días de evento solar. */
const dailyBaseline = (history, now) =>
  values(between(history, now - 7 * DAY_MS, now).filter((r) => r.components.event_active !== true));

/** ratio_to_baseline: valor / mediana de los últimos 7 días (sin días de evento). */
function ratioToBaseline(reading, history) {
  const value = valueOf(reading);
  if (value === null) return undefined;
  const base = median(dailyBaseline(history, ms(reading.measured_at)));
  if (base === null || base <= 0) return undefined;
  return value / base;
}

/**
 * event_dose_msv: suma de dosis desde que se activó la alerta de evento solar (la racha
 * de lecturas con event_active = true que termina en la actual). Sin evento → se omite.
 */
function eventDoseMsv(reading, history) {
  if (!reading.components || reading.components.event_active !== true) return undefined;
  const value = valueOf(reading);
  if (value === null) return undefined;
  let sum = value;
  for (const r of previous(history, ms(reading.measured_at))) {
    if (r.components.event_active !== true) break;
    sum += valueOf(r) ?? 0;
  }
  return sum;
}

// ---------------------------------------------------------------- RAD_DOSE_CUM

/** pct_of_career_limit: valor / 600 × 100. */
function pctOfCareerLimit(reading) {
  const value = valueOf(reading);
  return value === null ? undefined : (value / CAREER_LIMIT_MSV) * 100;
}

/**
 * projected_end_msv: valor + mediana diaria × días restantes de misión. La mediana
 * diaria sale de las dosis diarias de los últimos 7 días (sin días de evento). Sin
 * fecha de fin de misión o sin dosis diarias → se omite.
 */
function projectedEndMsv(reading, dailyDoses, missionEndsAt) {
  const value = valueOf(reading);
  if (value === null || !missionEndsAt) return undefined;
  const now = ms(reading.measured_at);
  const daily = median(
    values(
      between(dailyDoses, now - 7 * DAY_MS, now + 1).filter(
        (r) => r.components.event_active !== true,
      ),
    ),
  );
  if (daily === null) return undefined;
  const daysLeft = Math.max(0, (ms(missionEndsAt) - now) / DAY_MS);
  return value + daily * daysLeft;
}

// ---------------------------------------------------------------- HAB_CO2

/**
 * avg_7d: promedio de 7 días del mismo módulo, incluida la lectura actual. Sin lecturas
 * anteriores en la ventana → se omite (una sola lectura no es un promedio de 7 días).
 */
function avg7d(reading, history) {
  const value = valueOf(reading);
  if (value === null) return undefined;
  const now = ms(reading.measured_at);
  const window = values(between(history, now - 7 * DAY_MS, now));
  if (window.length === 0) return undefined;
  return mean([...window, value]);
}

// ---------------------------------------------------------------- BODY_MASS

/**
 * pct_change_from_preflight: (valor − línea base) / línea base × 100. Línea base = la
 * primera lectura de masa del astronauta en la misión (no hay campo preflight en el
 * catálogo). Si la lectura actual es la primera → se omite.
 */
function pctChangeFromPreflight(reading, baseline) {
  const value = valueOf(reading);
  const base = valueOf(baseline);
  if (value === null || base === null || base <= 0) return undefined;
  if (ms(baseline.measured_at) >= ms(reading.measured_at)) return undefined;
  return ((value - base) / base) * 100;
}

// ---------------------------------------------------------------- EXERCISE_MIN

/**
 * rolling_7d_pct_of_prescription: minutos de los últimos 7 días (incluida la lectura
 * actual) / prescripción semanal × 100. Solo si el historial cubre la ventana (hay un
 * registro de hace 6 días o más); si no, "pocos minutos" sería falta de datos.
 */
function rolling7dPctOfPrescription(reading, history, weeklyPrescriptionMin) {
  const value = valueOf(reading);
  if (value === null || !isNum(weeklyPrescriptionMin) || weeklyPrescriptionMin <= 0)
    return undefined;
  const now = ms(reading.measured_at);
  const earlier = previous(history, now);
  if (!earlier.some((r) => ms(r.measured_at) <= now - 6 * DAY_MS)) return undefined;
  const minutes = values(between(earlier, now - 7 * DAY_MS, now)).reduce((s, v) => s + v, value);
  return (minutes / weeklyPrescriptionMin) * 100;
}

// ---------------------------------------------------------------- WB_* (bienestar)

/**
 * baseline_ready, adverse_z_3d y adverse_sustained_days de un indicador de bienestar.
 * - Línea base: check-ins de los 14 días anteriores, sin contar los últimos 3; lista si hay ≥ 7.
 * - adverse_z_3d: z del promedio de los últimos 3 check-ins contra la línea base, orientado
 *   para que positivo = peor (con direction = 'high', más bajo es peor: se invierte el signo).
 * - adverse_sustained_days: check-ins seguidos (desde el actual) con adverse_z_3d ≥ 1.5.
 */
function wellbeingDerived(reading, history, direction) {
  const now = ms(reading.measured_at);
  const series = [reading, ...previous(history, now)].filter((r) => valueOf(r) !== null);
  if (series.length === 0 || valueOf(reading) === null) return {};

  const zAt = (index) => {
    const at = ms(series[index].measured_at);
    const recent = series.slice(index, index + WB_RECENT);
    const base = series
      .slice(index + WB_RECENT)
      .filter((r) => ms(r.measured_at) >= at - WB_BASELINE_DAYS * DAY_MS);
    const ready = base.length >= WB_BASELINE_MIN;
    if (!ready || recent.length < WB_RECENT) return { ready, z: undefined };
    const sd = sampleSd(values(base));
    if (!(sd > 0)) return { ready, z: undefined };
    const diff = (mean(values(recent)) - mean(values(base))) / sd;
    return { ready, z: direction === 'high' ? -diff : diff };
  };

  const current = zAt(0);
  const out = { baseline_ready: current.ready };
  if (current.z === undefined) return out;
  out.adverse_z_3d = current.z;
  let days = 0;
  for (let i = 0; i < series.length; i += 1) {
    const { z } = i === 0 ? current : zAt(i);
    if (z === undefined || z < WB_ADVERSE_Z) break;
    days += 1;
  }
  out.adverse_sustained_days = days;
  return out;
}

// ---------------------------------------------------------------- PVT_*

/**
 * baseline_ready: al menos 3 corridas previas en el mismo dispositivo y en condiciones de
 * descanso (`rest`). z_device_baseline: z contra esas corridas (positivo = peor).
 */
function pvtDerived(reading, history) {
  const value = valueOf(reading);
  const device = reading.components && reading.components.device_id;
  if (value === null || !device) return {};
  const base = previous(history, ms(reading.measured_at)).filter(
    (r) => r.rest === true && r.components.device_id === device,
  );
  const out = { baseline_ready: base.length >= PVT_BASELINE_MIN };
  if (!out.baseline_ready) return out;
  const sd = sampleSd(values(base));
  if (sd > 0) out.z_device_baseline = (value - mean(values(base))) / sd;
  return out;
}

// ---------------------------------------------------------------- entrada única

/**
 * Calcula los derivados del indicador. ctx = {
 *   history,                 // lecturas anteriores del mismo indicador y sujeto
 *   dailyDoses,              // RAD_DOSE_CUM: dosis diarias (RAD_DOSE_DAILY) recientes
 *   missionEndsAt,           // RAD_DOSE_CUM: fin de la misión (o null)
 *   baseline,                // BODY_MASS: primera lectura de masa en la misión
 *   weeklyPrescriptionMin,   // EXERCISE_MIN
 * }
 * Devuelve solo los campos que se pudieron calcular.
 */
function computeDerived(indicator, reading, ctx = {}) {
  const out = {};
  const put = (name, value) => {
    if (
      value !== undefined &&
      value !== null &&
      !(typeof value === 'number' && !Number.isFinite(value))
    ) {
      out[name] = value;
    }
  };
  const code = indicator.code;
  if (code === 'SLEEP_HOURS') {
    put('consecutive_nights_le_6h', consecutiveNightsLe6h(reading, ctx.history));
  } else if (code === 'RAD_DOSE_DAILY') {
    put('ratio_to_baseline', ratioToBaseline(reading, ctx.history));
    put('event_dose_msv', eventDoseMsv(reading, ctx.history));
  } else if (code === 'RAD_DOSE_CUM') {
    put('pct_of_career_limit', pctOfCareerLimit(reading));
    put('projected_end_msv', projectedEndMsv(reading, ctx.dailyDoses, ctx.missionEndsAt));
  } else if (code === 'HAB_CO2') {
    put('avg_7d', avg7d(reading, ctx.history));
  } else if (code === 'BODY_MASS') {
    put('pct_change_from_preflight', pctChangeFromPreflight(reading, ctx.baseline));
  } else if (code === 'EXERCISE_MIN') {
    put(
      'rolling_7d_pct_of_prescription',
      rolling7dPctOfPrescription(reading, ctx.history, ctx.weeklyPrescriptionMin),
    );
  } else if (code.startsWith('WB_')) {
    for (const [k, v] of Object.entries(
      wellbeingDerived(reading, ctx.history, indicator.direction),
    ))
      put(k, v);
  } else if (code.startsWith('PVT_')) {
    for (const [k, v] of Object.entries(pvtDerived(reading, ctx.history))) put(k, v);
  }
  return out;
}

module.exports = {
  computeDerived,
  consecutiveNightsLe6h,
  ratioToBaseline,
  eventDoseMsv,
  pctOfCareerLimit,
  projectedEndMsv,
  avg7d,
  pctChangeFromPreflight,
  rolling7dPctOfPrescription,
  wellbeingDerived,
  pvtDerived,
  DAY_MS,
};
