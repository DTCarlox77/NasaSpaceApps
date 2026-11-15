/**
 * Variables de entorno públicas (Expo inyecta las que empiezan con EXPO_PUBLIC_).
 * Configúralas en `.env` (ver `.env.example`).
 * - API_URL vacío → alertas en cola local y datos de salud de maqueta.
 * - REQUIRE_AUTH distinto de "true" → se entra directo con una sesión demo (sin usuario ni contraseña).
 */
export const env = {
  apiUrl: (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/+$/, ''),
  apiTimeoutMs: Number(process.env.EXPO_PUBLIC_API_TIMEOUT_MS ?? 8000),
  requireAuth: process.env.EXPO_PUBLIC_REQUIRE_AUTH === 'true',
};
