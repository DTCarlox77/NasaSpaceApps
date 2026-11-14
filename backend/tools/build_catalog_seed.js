'use strict';
/**
 * Genera db/seeds/002_catalogo_indicadores.sql desde docs/catalogo-indicadores.json.
 *
 * Uso (desde backend/):
 *   node tools/build_catalog_seed.js          -> escribe el .sql
 *   node tools/build_catalog_seed.js --check  -> falla si el .sql no está al día
 *
 * El catálogo (peligros, zonas, síntomas e indicadores) se refresca con
 * ON CONFLICT DO UPDATE. Las reglas se cargan como versión activa y, si ya
 * existen, no se tocan (ON CONFLICT DO NOTHING): un cambio de reglas es una
 * versión nueva, nunca una edición.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'docs', 'catalogo-indicadores.json');
const OUTPUT = path.join(ROOT, 'db', 'seeds', '002_catalogo_indicadores.sql');
const TAG = '$cat$';

const text = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const textArray = (a) => `ARRAY[${a.map(text).join(', ')}]::text[]`;
function json(v) {
  const s = JSON.stringify(v);
  if (s.includes(TAG)) throw new Error(`El JSON contiene el delimitador ${TAG}`);
  return `${TAG}${s}${TAG}::jsonb`;
}

function insert(table, columns, rows, conflict) {
  const values = rows.map((r) => `  (${r.join(', ')})`).join(',\n');
  return `INSERT INTO ${table} (${columns.join(', ')}) VALUES\n${values}\n${conflict};\n`;
}
const updateAll = (key, columns) =>
  `ON CONFLICT (${key}) DO UPDATE SET\n  ` +
  columns
    .filter((c) => c !== key)
    .map((c) => `${c} = EXCLUDED.${c}`)
    .join(',\n  ');

function build(catalog) {
  const indicatorCols = [
    'code',
    'name',
    'unit',
    'value_type',
    'sensitivity',
    'body_zone',
    'hazards',
    'input_methods',
    'direction',
    'components',
    'derived_fields',
    'guide',
    'sources',
    'notes',
  ];
  const out = [
    '-- =====================================================================',
    '-- 002_catalogo_indicadores.sql  ·  GENERADO: no editar a mano.',
    '-- Fuente: docs/catalogo-indicadores.json',
    `--   catalog_version ${catalog.catalog_version} · generated_at ${catalog.generated_at}`,
    '-- Regenerar: node tools/build_catalog_seed.js',
    '-- Idempotente: el catálogo se refresca (DO UPDATE); las reglas existentes no se tocan (DO NOTHING).',
    '-- =====================================================================',
    '',
    insert(
      'hazards',
      ['code', 'name'],
      catalog.hazards.map((h) => [text(h.code), text(h.name)]),
      updateAll('code', ['code', 'name']),
    ),
    insert(
      'body_zones',
      ['code', 'name'],
      catalog.body_zones.map((z) => [text(z.code), text(z.name)]),
      updateAll('code', ['code', 'name']),
    ),
    insert(
      'symptoms',
      ['code', 'label', 'body_zone', 'red_flag'],
      catalog.symptoms.map((s) => [
        text(s.code),
        text(s.label),
        text(s.body_zone),
        String(Boolean(s.red_flag)),
      ]),
      updateAll('code', ['code', 'label', 'body_zone', 'red_flag']),
    ),
    insert(
      'indicators',
      indicatorCols,
      catalog.indicators.map((i) => [
        text(i.code),
        text(i.name),
        text(i.unit),
        text(i.value_type),
        text(i.sensitivity),
        text(i.body_zone),
        textArray(i.hazards),
        textArray(i.input_methods || []),
        text(i.direction || null),
        json(i.components),
        json(i.derived_fields || []),
        json(i.guide),
        json(i.sources || []),
        json(i.notes || []),
      ]),
      updateAll('code', indicatorCols),
    ),
    '-- Reglas v1 activas (una sola versión activa por indicador).',
    insert(
      'indicator_rule_versions',
      ['indicator_code', 'version', 'rules', 'is_active', 'change_reason'],
      catalog.indicators.map((i) => [
        text(i.code),
        String(i.rules_version),
        json(i.rules),
        'true',
        text(`Catálogo v${catalog.catalog_version} (${catalog.generated_at})`),
      ]),
      'ON CONFLICT DO NOTHING',
    ),
  ];
  return out.join('\n');
}

const sql = build(JSON.parse(fs.readFileSync(SOURCE, 'utf8')));
if (process.argv.includes('--check')) {
  const current = fs.existsSync(OUTPUT)
    ? fs.readFileSync(OUTPUT, 'utf8').replace(/\r\n/g, '\n')
    : '';
  if (current !== sql) {
    console.error(
      '002_catalogo_indicadores.sql no está al día: corre node tools/build_catalog_seed.js',
    );
    process.exit(1);
  }
  console.log('OK: 002_catalogo_indicadores.sql al día');
} else {
  fs.writeFileSync(OUTPUT, sql);
  console.log(`OK: ${path.relative(ROOT, OUTPUT)}`);
}
