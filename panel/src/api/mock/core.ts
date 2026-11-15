/**
 * Piezas comunes del adaptador del modo demo: respuestas y errores con el esquema del contrato
 * ({ error: { code, message, details } }), paginación por cursor y el tipo de una ruta.
 */
import type { Role } from '../types.ts';
import type { MockAccount } from './fixtures/accounts.ts';
import { MISSION_ID } from './fixtures/mission.ts';
import type { MockState } from './state.ts';

export class MockHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: unknown = null,
  ) {
    super(message);
  }
}

export const fail = (status: number, code: string, message: string, details: unknown = null): never => {
  throw new MockHttpError(status, code, message, details);
};

export function json(status: number, body: unknown): Response {
  if (status === 204) return new Response(null, { status });
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const forbidden = (roles: Role[]) =>
  fail(403, 'FORBIDDEN', 'Tu rol no tiene permiso para esta acción.', { required_roles: roles });
export const notFound = (message = 'El recurso no existe.') => fail(404, 'NOT_FOUND', message);
export const conflict = (message: string, code = 'CONFLICT', details: unknown = null) =>
  fail(409, code, message, details);

export const iso = (ms: number) => new Date(ms).toISOString();
export const delivered = (deliverAt: string | null | undefined, now: number) =>
  !!deliverAt && new Date(deliverAt).getTime() <= now;

export function paginate<T>(items: T[], query: URLSearchParams): { items: T[]; next_cursor: string | null } {
  const rawLimit = query.get('limit');
  const limit = rawLimit === null ? 50 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    fail(400, 'VALIDATION_ERROR', 'limit debe ser un entero entre 1 y 200.');
  }
  const rawCursor = query.get('cursor');
  const offset = rawCursor === null ? 0 : Number(rawCursor);
  if (!Number.isInteger(offset) || offset < 0) fail(400, 'VALIDATION_ERROR', 'Cursor inválido.');
  const page = items.slice(offset, offset + limit);
  const next = offset + limit < items.length ? String(offset + limit) : null;
  return { items: page, next_cursor: next };
}

export function checkMission(query: URLSearchParams): void {
  const missionId = query.get('mission_id');
  if (missionId && missionId !== MISSION_ID) notFound('La misión no existe o no es de tu equipo.');
}

export function readBody(body: unknown): string {
  const text = (body as { body?: unknown } | undefined)?.body;
  if (typeof text !== 'string' || text.trim().length === 0 || text.length > 4000) {
    fail(400, 'VALIDATION_ERROR', 'body es obligatorio (1 a 4000 caracteres).', { field: 'body' });
  }
  return (text as string).trim();
}

/** Hash de las contraseñas del body, calculado antes de la ruta (crypto.subtle es async). */
export interface Secrets {
  password?: string;
  current?: string;
  next?: string;
}

export interface Ctx {
  method: string;
  query: URLSearchParams;
  params: Record<string, string>;
  body: unknown;
  /** Cuenta del token (null en las rutas públicas). */
  user: MockAccount | null;
  /** Token Bearer tal como llegó (p. ej. el password_change_token). */
  bearer: string | null;
  secrets: Secrets;
  state: MockState;
  now: number;
}

export interface Route {
  method: string;
  pattern: string;
  /** x-roles del contrato; 'public' = sin sesión ('own' = la ruta valida su propio token). */
  roles: Role[] | 'public';
  /** true = no existe en el contrato v1.8 (solo modo demo). */
  mockOnly?: boolean;
  handle(ctx: Ctx): Response;
}

export const GROUND: Role[] = ['flight_surgeon', 'admin'];
export const BEHAVIORAL: Role[] = ['behavioral_health'];
export const ADMIN: Role[] = ['admin'];
export const EVERYONE: Role[] = ['astronaut', 'flight_surgeon', 'behavioral_health', 'admin'];

export const me = (ctx: Ctx) => ctx.user as MockAccount;
