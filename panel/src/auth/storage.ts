/**
 * Almacenamiento de la sesión del panel [DECISIÓN]:
 * - device_id: `panel-<uuid>` en localStorage. Se crea una vez y sobrevive al logout (el
 *   backend liga el refresh token a este dispositivo).
 * - access_token: SOLO en memoria (no lo puede leer otra pestaña ni queda en disco).
 * - refresh_token, user y context: en sessionStorage (se borran al cerrar la pestaña). Al
 *   recargar, el panel usa el refresh_token para pedir un access_token nuevo.
 * Todo acceso a storage va en try/catch: en modo privado o con el storage bloqueado, el
 * panel sigue funcionando en memoria.
 */
import type { MissionRef, UserContext, UserSummary } from '../api/types.ts';

const DEVICE_KEY = 'astro-panel.device_id';
const SESSION_KEY = 'astro-panel.session';
const MISSION_KEY = 'astro-panel.mission_id';

export interface StoredSession {
  refresh_token: string;
  user: UserSummary;
  context: UserContext;
}

let accessToken: string | null = null;
let memoryDeviceId: string | null = null;
let memorySession: StoredSession | null = null;

function read(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}

function write(storage: () => Storage, key: string, value: string | null): void {
  try {
    if (value === null) storage().removeItem(key);
    else storage().setItem(key, value);
  } catch {
    // Storage bloqueado: queda en memoria.
  }
}

const local = () => window.localStorage;
const session = () => window.sessionStorage;

/** device_id estable del panel en este navegador. */
export function getDeviceId(): string {
  const stored = read(local, DEVICE_KEY);
  if (stored) return stored;
  if (!memoryDeviceId) memoryDeviceId = `panel-${crypto.randomUUID()}`;
  write(local, DEVICE_KEY, memoryDeviceId);
  return memoryDeviceId;
}

export const getAccessToken = (): string | null => accessToken;

export function getRefreshToken(): string | null {
  return loadSession()?.refresh_token ?? null;
}

/** Guarda los DOS tokens (el refresh es rotativo: el anterior ya no sirve). */
export function setTokens(access: string, refresh: string): void {
  accessToken = access;
  const current = loadSession();
  if (current) saveSession({ ...current, refresh_token: refresh });
  else memorySession = memorySession ? { ...memorySession, refresh_token: refresh } : null;
}

export function saveSession(value: StoredSession, access?: string): void {
  if (access !== undefined) accessToken = access;
  memorySession = value;
  write(session, SESSION_KEY, JSON.stringify(value));
}

export function loadSession(): StoredSession | null {
  const raw = read(session, SESSION_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as StoredSession;
      if (parsed && typeof parsed.refresh_token === 'string' && parsed.user) return parsed;
    } catch {
      // JSON roto: se ignora.
    }
  }
  return memorySession;
}

/** Borra tokens y sesión (no el device_id). */
export function clearSession(): void {
  accessToken = null;
  memorySession = null;
  write(session, SESSION_KEY, null);
  write(session, MISSION_KEY, null);
}

// ---------------------------------------------------------------- misión elegida

export function getSelectedMissionId(): string | null {
  return read(session, MISSION_KEY);
}

export function setSelectedMissionId(id: string | null): void {
  write(session, MISSION_KEY, id);
}

/** Misión por defecto: la elegida si sigue disponible; si no, la primera activa; si no, la primera. */
export function pickMission(missions: MissionRef[] | undefined): MissionRef | null {
  if (!missions || missions.length === 0) return null;
  const selected = getSelectedMissionId();
  return (
    missions.find((m) => m.id === selected) ??
    missions.find((m) => m.status === 'active') ??
    missions[0] ??
    null
  );
}

// ---------------------------------------------------------------- fin de sesión

export type SessionEndReason = 'expired' | 'logout';
type Listener = (reason: SessionEndReason) => void;
const listeners = new Set<Listener>();

/** El AuthProvider se suscribe para volver al login cuando el refresh falla. */
export function onSessionEnded(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function endSession(reason: SessionEndReason): void {
  clearSession();
  for (const listener of listeners) listener(reason);
}
