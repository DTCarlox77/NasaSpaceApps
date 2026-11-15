'use strict';

/**
 * Qué se escribe en los logs (Render los guarda y los ve quien tenga acceso al panel).
 *
 * Nunca: tokens, contraseñas, PIN, credenciales de tableta, bodies ni valores de salud o
 * bienestar. Por eso:
 * - las peticiones se registran sin los valores de la query (solo los nombres: ?cursor=…);
 * - un error se registra con su tipo, código, restricción y pila, sin el `detail` ni el
 *   `where` de PostgreSQL ("Failing row contains (...)", "Key (x)=(y)") y con los valores
 *   entre comillas de los mensajes de entrada inválida reemplazados.
 */

const REDACTED = '[omitido]';
const MAX_MESSAGE = 300;
// Mensajes que repiten el valor recibido (PostgreSQL y JSON.parse) y tokens sueltos.
const VALUE_PATTERNS = [
  // invalid input syntax for type uuid: "…" · invalid input value for enum x: "…"
  [/(for (?:type|enum) [^:]+: )"[^"]*"/g, `$1"${REDACTED}"`],
  // value "…" is out of range for type integer
  [/(value )"[^"]*"/g, `$1"${REDACTED}"`],
  // Unexpected token 'x', "…" is not valid JSON
  [/"[^"]*"( is not valid JSON)/g, `"${REDACTED}"$1`],
  [/(Bearer )\S+/gi, `$1${REDACTED}`],
  [/\b(?:eyJ[\w-]+\.[\w-]+\.[\w-]+|rt_[\w-]{16,}|dc_[\w-]{16,})/g, REDACTED], // JWT, refresh, tableta
];
const PG_FIELDS = ['code', 'constraint', 'table', 'column', 'routine'];

function redact(message) {
  let out = String(message ?? '');
  for (const [pattern, replacement] of VALUE_PATTERNS) out = out.replace(pattern, replacement);
  return out.length > MAX_MESSAGE ? `${out.slice(0, MAX_MESSAGE)}…` : out;
}

/** Un error en una línea (más la pila), sin datos. */
function describeError(err) {
  if (!(err instanceof Error)) return `[no es un Error: ${typeof err}]`;
  const meta = PG_FIELDS.filter((k) => typeof err[k] === 'string' && err[k]).map(
    (k) => `${k}=${err[k]}`,
  );
  const frames = String(err.stack || '')
    .split('\n')
    .filter((line) => /^\s+at /.test(line))
    .join('\n');
  return (
    `${err.name || 'Error'}: ${redact(err.message)}` +
    (meta.length ? ` (${meta.join(' ')})` : '') +
    (frames ? `\n${frames}` : '')
  );
}

/** "/api/v1/sync/pull?cursor=abc&limit=50" → "/api/v1/sync/pull?cursor=…&limit=…". */
function safeUrl(url) {
  const text = String(url ?? '');
  const at = text.indexOf('?');
  if (at === -1) return text;
  const names = text
    .slice(at + 1)
    .split('&')
    .filter(Boolean)
    .map((pair) => pair.split('=')[0].replace(/[^\w.[\]-]/g, '') || '?');
  return `${text.slice(0, at)}?${names.map((n) => `${n}=…`).join('&')}`;
}

module.exports = { describeError, safeUrl, redact, REDACTED };
