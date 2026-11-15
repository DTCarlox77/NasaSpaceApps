'use strict';

/**
 * UUID determinista (RFC 9562, versión 8) a partir de un espacio de nombres y unas partes:
 * los mismos datos dan siempre el mismo UUID. Lo usa /sync/push para las lecturas de un
 * grupo (p. ej. los deslizadores de un check-in, que llegan con un solo client_uuid): así
 * un reintento produce los mismos client_uuid y no duplica.
 */
const crypto = require('node:crypto');

function derivedUuid(namespace, ...parts) {
  const hex = crypto
    .createHash('sha256')
    .update(JSON.stringify([namespace, ...parts.map(String)]))
    .digest('hex');
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `8${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

module.exports = { derivedUuid };
