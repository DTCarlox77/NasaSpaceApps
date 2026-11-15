/** Mensajes del login y del cambio de contraseña según el `code` del error (nunca el texto). */
import { HttpError, NetworkError, SESSION_ENDED_MESSAGE } from '../api/http.ts';

export const ASTRONAUT_MESSAGE =
  'Este panel es para el equipo en Tierra. Los astronautas usan la app móvil.';
export const INVALID_CREDENTIALS_MESSAGE = 'Usuario o contraseña incorrectos.';
export const NETWORK_MESSAGE = 'No se pudo conectar con el servidor.';
export { SESSION_ENDED_MESSAGE };

/** Hora local hh:mm de un instante ISO (p. ej. locked_until del 423). */
export function localTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
}

function detail<T>(err: HttpError, key: string): T | undefined {
  const details = err.details;
  if (details && typeof details === 'object' && key in details) {
    return (details as Record<string, unknown>)[key] as T;
  }
  return undefined;
}

export function loginErrorMessage(err: unknown): string {
  if (err instanceof NetworkError) return NETWORK_MESSAGE;
  if (!(err instanceof HttpError)) return 'Ocurrió un error inesperado. Intenta de nuevo.';
  switch (err.code) {
    case 'INVALID_CREDENTIALS':
      return INVALID_CREDENTIALS_MESSAGE;
    case 'ACCOUNT_LOCKED': {
      const until = detail<string>(err, 'locked_until');
      return until
        ? `Cuenta bloqueada hasta las ${localTime(until)}. Pide a control de misión que la desbloquee.`
        : 'Cuenta bloqueada. Pide a control de misión que la desbloquee.';
    }
    case 'RATE_LIMITED': {
      const seconds = detail<number>(err, 'retry_after_seconds');
      return seconds
        ? `Demasiados intentos desde esta red. Espera ${seconds} s e intenta de nuevo.`
        : 'Demasiados intentos desde esta red. Espera unos segundos e intenta de nuevo.';
    }
    case 'NO_ACTIVE_ASSIGNMENT':
      return 'Esta cuenta no tiene una misión asignada. Pide a control de misión que la revise.';
    case 'VALIDATION_ERROR':
      return 'Revisa el usuario (minúsculas, sin espacios) y la contraseña.';
    default:
      break;
  }
  if (err.status === 403) return 'Esta cuenta no tiene permiso para entrar al panel.';
  if (err.status === 429) return 'Demasiados intentos. Espera unos segundos e intenta de nuevo.';
  if (err.status >= 500) return 'El servidor tuvo un problema. Intenta de nuevo en un momento.';
  return err.message || 'No se pudo iniciar sesión.';
}

export function changePasswordErrorMessage(err: unknown): string {
  if (err instanceof NetworkError) return NETWORK_MESSAGE;
  if (err instanceof HttpError) {
    if (err.code === 'WEAK_PASSWORD') {
      return 'La contraseña nueva debe tener al menos 10 caracteres y ser distinta de la actual.';
    }
    if (err.code === 'INVALID_CREDENTIALS') return 'La contraseña actual no es correcta.';
    if (err.code === 'UNAUTHENTICATED') {
      return 'El permiso para cambiar la contraseña venció. Inicia sesión de nuevo.';
    }
  }
  return loginErrorMessage(err);
}
