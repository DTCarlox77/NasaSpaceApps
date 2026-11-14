'use strict';

const { pool } = require('../config/db');

/**
 * Marca de versión del catálogo: cambia si cambia un indicador, si se activa otra
 * versión de reglas o si cambian zonas o síntomas. El servicio la usa para invalidar
 * su caché en memoria.
 */
async function versionStamp(db = pool) {
  const { rows } = await db.query(
    `SELECT concat_ws('|',
       (SELECT max(updated_at) FROM indicators),
       (SELECT count(*) FROM indicators),
       (SELECT string_agg(id::text, ',' ORDER BY id) FROM indicator_rule_versions WHERE is_active),
       (SELECT count(*) FROM body_zones),
       (SELECT count(*) FROM symptoms)) AS stamp`,
  );
  return rows[0].stamp;
}

async function loadCatalog(db = pool) {
  const [indicators, rules, zones, symptoms] = await Promise.all([
    db.query(
      `SELECT code, name, unit, value_type, components, derived_fields, hazards, body_zone,
              input_methods, sensitivity, direction, guide, sources, notes
       FROM indicators`,
    ),
    db.query('SELECT indicator_code, version, rules FROM indicator_rule_versions WHERE is_active'),
    db.query('SELECT code, name FROM body_zones'),
    db.query('SELECT code, label, body_zone, red_flag FROM symptoms'),
  ]);
  return {
    indicators: indicators.rows,
    rules: rules.rows,
    zones: zones.rows,
    symptoms: symptoms.rows,
  };
}

module.exports = { versionStamp, loadCatalog };
