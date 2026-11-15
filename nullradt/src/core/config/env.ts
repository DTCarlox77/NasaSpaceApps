/**
 * Variables de entorno públicas (Expo inyecta las que empiezan con EXPO_PUBLIC_).
 * Configúralas en `.env` (ver `.env.example`).
 * - API_URL: host de la API SIN `/api/v1` (p. ej. https://astro-health-api-81jd.onrender.com).
 *   Vacío → modo demo sin servidor: datos de maqueta y todo queda en el dispositivo.
 * - REQUIRE_AUTH distinto de "true" → se entra directo con una sesión demo (sin usuario ni contraseña).
 *   Con API conviene "true": sin login no hay token y la API responde 401.
 */
const rawApiUrl = (process.env.EXPO_PUBLIC_API_URL ?? '').trim().replace(/\/+$/, '');

export const env = {
  /** Host sin barra final ni `/api/v1` (si alguien lo pone, se quita). */
  apiUrl: rawApiUrl.replace(/\/api\/v1$/, ''),
  /** Timeout normal de cada petición. */
  apiTimeoutMs: Number(process.env.EXPO_PUBLIC_API_TIMEOUT_MS ?? 15000),
  /** Timeout de GET /api/v1/health al abrir la app: Render gratuito se duerme y tarda ~50 s en despertar. */
  apiWakeTimeoutMs: Number(process.env.EXPO_PUBLIC_API_WAKE_TIMEOUT_MS ?? 60000),
  /** Con API el login es obligatorio (sin token la API responde 401). */
  requireAuth: process.env.EXPO_PUBLIC_REQUIRE_AUTH === 'true' || !!rawApiUrl,
};

/** true = hay servidor configurado (modo integrado); false = modo demo sin servidor. */
export const apiEnabled = () => !!env.apiUrl;
