'use strict';

/**
 * Catálogo de indicadores, reglas activas, zonas y síntomas.
 * Se cachea en memoria y se recarga cuando cambia la marca de versión de la base
 * (otra versión de reglas activa, un indicador actualizado, etc.).
 * Contrato: GET /indicators, /indicators/{code}, /rules, /body-zones y /symptoms.
 */
const catalogModel = require('../models/catalog.model');
// Del JSON del catálogo solo se toma su versión y el orden de presentación.
const catalogJson = require('../../docs/catalogo-indicadores.json');

const CATALOG_VERSION = catalogJson.catalog_version;
const orderOf = (list) => new Map(list.map((item, index) => [item.code, index]));
const INDICATOR_ORDER = orderOf(catalogJson.indicators);
const ZONE_ORDER = orderOf(catalogJson.body_zones);
const SYMPTOM_ORDER = orderOf(catalogJson.symptoms);
const byOrder = (order) => (a, b) =>
  (order.get(a.code) ?? 1e9) - (order.get(b.code) ?? 1e9) || a.code.localeCompare(b.code);

let cache = null;

/** Indicador con la forma del contrato (misma forma que docs/catalogo-indicadores.json). */
function toIndicator(row, ruleSet) {
  const indicator = {
    code: row.code,
    name: row.name,
    unit: row.unit,
    value_type: row.value_type,
    components: row.components,
    derived_fields: row.derived_fields,
    hazards: row.hazards,
    body_zone: row.body_zone,
    input_methods: row.input_methods,
    sensitivity: row.sensitivity,
    rules_version: ruleSet ? ruleSet.version : null,
  };
  if (row.direction) indicator.direction = row.direction;
  indicator.guide = row.guide;
  indicator.sources = row.sources;
  if (Array.isArray(row.notes) && row.notes.length > 0) indicator.notes = row.notes;
  return indicator;
}

function build(data, stamp) {
  const rulesByCode = new Map(data.rules.map((r) => [r.indicator_code, r]));
  const list = data.indicators.sort(byOrder(INDICATOR_ORDER)).map((row) => ({
    indicator: toIndicator(row, rulesByCode.get(row.code)),
    rules: rulesByCode.get(row.code) || null,
  }));
  return {
    stamp,
    list,
    byCode: new Map(list.map((entry) => [entry.indicator.code, entry])),
    rulesVersion: data.rules.reduce((max, r) => Math.max(max, r.version), 0),
    zones: data.zones.sort(byOrder(ZONE_ORDER)),
    symptoms: data.symptoms.sort(byOrder(SYMPTOM_ORDER)),
  };
}

async function getCatalog() {
  const stamp = await catalogModel.versionStamp();
  if (!cache || cache.stamp !== stamp) cache = build(await catalogModel.loadCatalog(), stamp);
  return cache;
}

/** Fuerza la recarga (p. ej. después de publicar reglas nuevas en este proceso). */
function invalidate() {
  cache = null;
}

async function listIndicators({ bodyZone, sensitivity } = {}) {
  const catalog = await getCatalog();
  const items = catalog.list
    .map((e) => e.indicator)
    .filter((i) => !bodyZone || i.body_zone === bodyZone)
    .filter((i) => !sensitivity || i.sensitivity === sensitivity);
  return { catalog_version: CATALOG_VERSION, rules_version: catalog.rulesVersion, items };
}

/** Indicador con sus reglas activas, o null si no existe. */
async function getIndicator(code) {
  const entry = (await getCatalog()).byCode.get(code);
  if (!entry) return null;
  return { ...entry.indicator, rules: entry.rules ? entry.rules.rules : [] };
}

/** Reglas activas con versión mayor que sinceVersion (todas si no se indica). */
async function rulesSince(sinceVersion) {
  const catalog = await getCatalog();
  const indicators = catalog.list
    .filter((e) => e.rules && (sinceVersion === undefined || e.rules.version > sinceVersion))
    .map((e) => ({ code: e.indicator.code, rules_version: e.rules.version, rules: e.rules.rules }));
  return {
    catalog_version: CATALOG_VERSION,
    rules_version: catalog.rulesVersion,
    up_to_date: sinceVersion !== undefined && indicators.length === 0,
    indicators,
  };
}

async function bodyZones() {
  return { items: (await getCatalog()).zones.map(({ code, name }) => ({ code, name })) };
}

async function symptoms() {
  return { items: (await getCatalog()).symptoms };
}

/** Uso interno del motor: indicador + reglas activas ({ version, rules }). */
async function indicatorWithRules(code) {
  const entry = (await getCatalog()).byCode.get(code);
  return entry ? { indicator: entry.indicator, ruleSet: entry.rules } : null;
}

async function rulesVersion() {
  return (await getCatalog()).rulesVersion;
}

async function symptomZones() {
  return new Map((await getCatalog()).symptoms.map((s) => [s.code, s.body_zone]));
}

async function zoneList() {
  return (await getCatalog()).zones;
}

async function standardIndicators() {
  return (await getCatalog()).list
    .map((e) => e.indicator)
    .filter((i) => i.sensitivity === 'standard');
}

module.exports = {
  CATALOG_VERSION,
  listIndicators,
  getIndicator,
  rulesSince,
  bodyZones,
  symptoms,
  indicatorWithRules,
  rulesVersion,
  symptomZones,
  zoneList,
  standardIndicators,
  invalidate,
};
