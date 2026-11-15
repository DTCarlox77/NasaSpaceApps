/**
 * Configuración del panel. VITE_API_URL es la URL base del backend SIN /api/v1
 * (p. ej. https://astro-health-api-81jd.onrender.com o http://localhost:3000).
 */

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Normaliza la URL (sin "/" final) y le agrega /api/v1. Lanza ConfigError si falta. */
export function resolveApiBase(raw: string | undefined): string {
  const url = (raw ?? '').trim().replace(/\/+$/, '');
  if (!url) {
    throw new ConfigError(
      'Falta VITE_API_URL. Copia panel/.env.example a panel/.env (Copy-Item .env.example .env) y reinicia npm run dev.',
    );
  }
  if (!/^https?:\/\//.test(url)) {
    throw new ConfigError(`VITE_API_URL debe empezar con http:// o https:// (recibido: "${url}").`);
  }
  if (/\/api\/v1$/.test(url)) {
    throw new ConfigError('VITE_API_URL va sin /api/v1: el panel lo agrega solo.');
  }
  return `${url}/api/v1`;
}

let cached: string | null = null;

/** API_BASE (con /api/v1). Se calcula una vez; lanza ConfigError si la variable falta. */
export function apiBase(): string {
  if (cached === null) cached = resolveApiBase(import.meta.env.VITE_API_URL as string | undefined);
  return cached;
}

// ---------------------------------------------------------------- modo de datos

/**
 * VITE_DATA_MODE:
 * - `api` (por defecto): el panel llama al backend de VITE_API_URL.
 * - `mock`: modo demo sin servidor. El cliente HTTP no sale a la red: responde el adaptador de
 *   src/api/mock/ con las mismas rutas, esquemas y códigos de error del contrato (datos
 *   sintéticos). No hace falta VITE_API_URL.
 */
export type DataMode = 'api' | 'mock';

export function resolveDataMode(raw: string | undefined): DataMode {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === '' || value === 'api') return 'api';
  if (value === 'mock') return 'mock';
  throw new ConfigError(`VITE_DATA_MODE debe ser "api" o "mock" (recibido: "${raw}").`);
}

/** Se lee en cada llamada (las pruebas la cambian con vi.stubEnv). Lanza ConfigError si es inválida. */
export function dataMode(): DataMode {
  return resolveDataMode(import.meta.env.VITE_DATA_MODE as string | undefined);
}

/** ¿Modo demo sin servidor? Nunca lanza (un valor inválido lo muestra main.tsx al arrancar). */
export function isMockMode(): boolean {
  try {
    return dataMode() === 'mock';
  } catch {
    return false;
  }
}

/** Revisa la configuración al arrancar: en modo api hace falta VITE_API_URL. */
export function checkConfig(): void {
  if (dataMode() === 'api') apiBase();
}
