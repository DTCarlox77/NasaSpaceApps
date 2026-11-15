/**
 * Cuentas en el modo demo: sesión (login, refresh, logout, /me) y el equipo de la misión.
 * Rutas del contrato v1.8 (mismos esquemas y errores):
 * - POST /admin/users (admin): alta de astronauta (perfil + asignación) o de personal de Tierra;
 *   contraseña temporal mostrada una vez (aquí solo se guarda su hash).
 * - GET /missions/{id}/crew (todos los roles de la misión) y GET /admin/assignments (admin).
 * Solo en el modo demo (NO existe en el contrato; el panel no la llama en modo api):
 * - GET /admin/users: lista de cuentas con su estado (activa, bloqueada, cambio pendiente).
 */
import type {
  Assignment,
  CreatedUser,
  CrewMember,
  CrewRole,
  LoginResponse,
  Role,
  TeamAccount,
  TokenPair,
  UserAdmin,
  UserContext,
  UserSummary,
} from '../types.ts';
import { ADMIN, EVERYONE, fail, json, me, notFound, paginate, conflict, type Route, type Secrets } from './core.ts';
import type { MockAccount } from './fixtures/accounts.ts';
import { MISSION_ID, MISSION_REF } from './fixtures/mission.ts';
import { generateTemporaryPassword, HASH_PENDING, passwordHash } from './secrets.ts';
import { addAccount, patchAccount, type MockState } from './state.ts';

// ---------------------------------------------------------------- tokens

export const ACCESS = 'mock-at.';
export const REFRESH = 'mock-rt.';
let tokenSeq = 0;

export function tokensFor(user: MockAccount): TokenPair {
  tokenSeq += 1;
  return {
    access_token: `${ACCESS}${user.id}.${tokenSeq}`,
    token_type: 'Bearer',
    expires_in: 900,
    refresh_token: `${REFRESH}${user.id}.${tokenSeq}`,
  };
}

export function userFromToken(state: MockState, token: string | null | undefined, prefix: string): MockAccount | undefined {
  if (!token || !token.startsWith(prefix)) return undefined;
  const id = token.slice(prefix.length).split('.')[0] ?? '';
  const account = state.accounts.find((a) => a.id === id);
  return account && account.is_active ? account : undefined;
}

// ---------------------------------------------------------------- consultas

export const accountByUsername = (state: MockState, username: string) =>
  state.accounts.find((a) => a.username.toLowerCase() === username.trim().toLowerCase());

export const astronautAccount = (state: MockState, astronautId: string) =>
  state.accounts.find((a) => a.astronaut?.id === astronautId);

/** Tripulación vigente de la misión (cuentas de astronauta con asignación). */
export const crewAccounts = (state: MockState, missionId = MISSION_ID) =>
  state.accounts.filter((a) => a.role === 'astronaut' && a.astronaut?.mission_id === missionId);

export function summary(user: MockAccount): UserSummary {
  return { id: user.id, username: user.username, full_name: user.full_name, role: user.role, email: user.email };
}

export function contextFor(user: MockAccount): UserContext {
  if (user.role === 'astronaut' && user.astronaut) {
    return {
      astronaut_id: user.astronaut.id,
      call_sign: user.astronaut.call_sign,
      crew_role: user.astronaut.crew_role,
      mission: MISSION_REF,
    };
  }
  return { astronaut_id: null, call_sign: null, crew_role: null, ground_missions: [MISSION_REF] };
}

/** UserAdmin del contrato (sin el hash ni lo interno del demo). */
export function userAdmin(account: MockAccount): UserAdmin {
  return {
    id: account.id,
    username: account.username,
    email: account.email,
    full_name: account.full_name,
    role: account.role,
    must_change_password: account.must_change_password,
    is_active: account.is_active,
    failed_login_attempts: account.failed_login_attempts,
    locked_until: account.locked_until,
    last_login_at: account.last_login_at,
    created_at: account.created_at,
  };
}

export function assignmentOf(account: MockAccount): Assignment | null {
  const a = account.astronaut;
  if (!a) return null;
  return {
    id: a.assignment_id,
    mission_id: a.mission_id,
    astronaut_id: a.id,
    call_sign: a.call_sign,
    crew_role: a.crew_role,
    assigned_from: a.assigned_from,
    assigned_to: null,
    created_at: a.assigned_from,
  };
}

// ---------------------------------------------------------------- contraseñas (hash async)

/** Hash de las contraseñas del body (login y cambio de contraseña), antes de la ruta. */
export async function prepareSecrets(
  state: MockState,
  request: { method: string; path: string; bearer: string | null; body?: unknown },
): Promise<Secrets> {
  const path = request.path.split('?')[0];
  const body = (request.body ?? {}) as Record<string, unknown>;
  if (request.method.toUpperCase() !== 'POST') return {};
  if (path === '/auth/login' && typeof body.username === 'string' && typeof body.password === 'string') {
    const account = accountByUsername(state, body.username);
    return account ? { password: await passwordHash(account.id, body.password) } : {};
  }
  if (path === '/auth/change-password') {
    const account = changePasswordAccount(state, request.bearer);
    if (!account) return {};
    return {
      current: typeof body.current_password === 'string' ? await passwordHash(account.id, body.current_password) : undefined,
      next: typeof body.new_password === 'string' ? await passwordHash(account.id, body.new_password) : undefined,
    };
  }
  return {};
}

/** Cuenta del token de cambio de contraseña (el del 428) o del token normal. */
export const PASSWORD_CHANGE = 'mock-pct.';
export function changePasswordAccount(state: MockState, bearer: string | null): MockAccount | undefined {
  return userFromToken(state, bearer, PASSWORD_CHANGE) ?? userFromToken(state, bearer, ACCESS);
}

/** Convierte en hash las contraseñas temporales recién generadas (y guarda). */
export async function settlePasswords(state: MockState): Promise<boolean> {
  if (state.pendingPasswords.length === 0) return false;
  const pending = state.pendingPasswords.splice(0);
  for (const { userId, password } of pending) {
    const account = state.accounts.find((a) => a.id === userId);
    if (account) patchAccount(state, account, { password_hash: await passwordHash(userId, password) });
  }
  return true;
}

/** Contraseña temporal nueva: se devuelve una vez; el hash se calcula antes de responder. */
export function issueTemporaryPassword(state: MockState, account: MockAccount): string {
  const password = generateTemporaryPassword();
  patchAccount(state, account, { password_hash: HASH_PENDING, must_change_password: true });
  state.pendingPasswords.push({ userId: account.id, password });
  return password;
}

/** ¿La contraseña del login coincide? Las cuentas del seed sin hash aceptan cualquiera. */
export const passwordMatches = (account: MockAccount, hash: string | undefined) =>
  account.password_hash === null || (!!hash && account.password_hash === hash);

// ---------------------------------------------------------------- alta (POST /admin/users)

const USERNAME = /^[a-z0-9._-]{3,40}$/;
const ROLES: Role[] = ['astronaut', 'flight_surgeon', 'behavioral_health', 'admin', 'service'];
const CREW_ROLES: CrewRole[] = ['commander', 'pilot', 'crew_medical_officer', 'flight_engineer', 'mission_specialist'];
/** Uno por misión a la vez (contrato: CREW_ROLE_TAKEN). */
const UNIQUE_CREW_ROLES: CrewRole[] = ['commander', 'crew_medical_officer'];
const CREW_ROLE_NAMES: Partial<Record<CrewRole, string>> = {
  commander: 'un comandante',
  crew_medical_officer: 'un oficial médico',
};

const invalid = (message: string, field: string) => fail(400, 'VALIDATION_ERROR', message, { field });

export function crewRoleTaken(state: MockState, missionId: string, role: CrewRole, exceptAccountId?: string) {
  if (!UNIQUE_CREW_ROLES.includes(role)) return undefined;
  return crewAccounts(state, missionId).find((a) => a.astronaut?.crew_role === role && a.id !== exceptAccountId);
}

export function assertCrewRoleFree(state: MockState, missionId: string, role: CrewRole, exceptAccountId?: string) {
  const holder = crewRoleTaken(state, missionId, role, exceptAccountId);
  if (holder) {
    conflict(`ARES-1 ya tiene ${CREW_ROLE_NAMES[role] ?? 'ese rol'} vigente (${holder.astronaut?.call_sign}).`, 'CREW_ROLE_TAKEN', {
      crew_role: role,
    });
  }
}

function createUser(state: MockState, body: unknown, now: number): CreatedUser {
  const input = (body ?? {}) as Record<string, unknown>;
  const username = typeof input.username === 'string' ? input.username : '';
  const fullName = typeof input.full_name === 'string' ? input.full_name.trim() : '';
  const role = input.role as Role;
  const email = typeof input.email === 'string' && input.email ? input.email : null;
  if (!USERNAME.test(username)) invalid('Usuario: minúsculas, números, punto, guion o guion bajo (3 a 40).', 'username');
  if (!fullName || fullName.length > 120) invalid('El nombre completo es obligatorio (hasta 120 caracteres).', 'full_name');
  if (!ROLES.includes(role)) invalid('Rol inválido.', 'role');
  if (role === 'service') invalid('El modo demo no crea cuentas de servicio.', 'role');
  if (accountByUsername(state, username)) {
    conflict(`El usuario ${username} ya existe.`, 'USERNAME_TAKEN', { field: 'username' });
  }
  if (email && state.accounts.some((a) => a.email?.toLowerCase() === email.toLowerCase())) {
    conflict(`El correo ${email} ya existe.`, 'EMAIL_TAKEN', { field: 'email' });
  }

  const id = crypto.randomUUID();
  const createdAt = new Date(now).toISOString();
  const account: MockAccount = {
    id,
    username,
    full_name: fullName,
    email,
    role,
    must_change_password: true,
    is_active: true,
    failed_login_attempts: 0,
    locked_until: null,
    last_login_at: null,
    created_at: createdAt,
    password_hash: HASH_PENDING,
    created_in_demo: true,
  };

  if (role === 'astronaut') {
    const astro = (input.astronaut ?? {}) as Record<string, unknown>;
    const callSign = typeof astro.call_sign === 'string' ? astro.call_sign.trim() : '';
    const missionId = astro.mission_id;
    const crewRole = astro.crew_role as CrewRole;
    if (callSign.length < 2 || callSign.length > 20) invalid('El indicativo debe tener de 2 a 20 caracteres.', 'astronaut.call_sign');
    if (missionId !== MISSION_ID) notFound('La misión no existe.');
    if (!CREW_ROLES.includes(crewRole)) invalid('Rol de tripulación inválido.', 'astronaut.crew_role');
    if (state.accounts.some((a) => a.astronaut?.call_sign.toLowerCase() === callSign.toLowerCase())) {
      conflict(`El call sign ${callSign} ya existe.`, 'CALL_SIGN_TAKEN', { field: 'astronaut.call_sign' });
    }
    assertCrewRoleFree(state, MISSION_ID, crewRole);
    account.astronaut = {
      id: crypto.randomUUID(),
      call_sign: callSign,
      agency: typeof astro.agency === 'string' ? astro.agency : 'Demo Agency',
      mission_id: MISSION_ID,
      crew_role: crewRole,
      assignment_id: crypto.randomUUID(),
      assigned_from: createdAt,
    };
  } else {
    const missions = Array.isArray(input.ground_mission_ids) ? input.ground_mission_ids : [MISSION_ID];
    account.ground_mission_ids = missions.filter((m): m is string => m === MISSION_ID);
  }

  addAccount(state, account);
  const temporaryPassword = issueTemporaryPassword(state, account);
  return {
    user: userAdmin(account),
    ...(account.astronaut
      ? {
          astronaut: {
            id: account.astronaut.id,
            user_id: account.id,
            call_sign: account.astronaut.call_sign,
            agency: account.astronaut.agency,
            synthetic: true,
          },
          assignment: assignmentOf(account) as Assignment,
        }
      : {}),
    temporary_password: temporaryPassword,
  };
}

// ---------------------------------------------------------------- rutas

export const ACCOUNT_ROUTES: Route[] = [
  {
    method: 'POST',
    pattern: '/auth/login',
    roles: 'public',
    handle: ({ body, state, secrets, now }) => {
      const { username, password } = (body ?? {}) as { username?: unknown; password?: unknown };
      if (typeof username !== 'string' || !username.trim() || typeof password !== 'string' || !password) {
        return fail(400, 'VALIDATION_ERROR', 'username y password son obligatorios.');
      }
      const user = accountByUsername(state, username);
      if (!user || !user.is_active || !passwordMatches(user, secrets.password)) {
        return fail(401, 'INVALID_CREDENTIALS', 'Usuario o contraseña incorrectos.');
      }
      patchAccount(state, user, { last_login_at: new Date(now).toISOString(), failed_login_attempts: 0 });
      const response: LoginResponse = {
        ...tokensFor(user),
        must_change_password: false,
        offline_unlock_until: null,
        user: summary(user),
        context: contextFor(user),
      };
      return json(200, response);
    },
  },
  {
    method: 'POST',
    pattern: '/auth/refresh',
    roles: 'public',
    handle: ({ body, state }) => {
      const user = userFromToken(state, (body as { refresh_token?: string } | undefined)?.refresh_token, REFRESH);
      if (!user) return fail(401, 'UNAUTHENTICATED', 'El refresh token no es válido.');
      return json(200, tokensFor(user));
    },
  },
  { method: 'POST', pattern: '/auth/logout', roles: 'public', handle: () => json(204, undefined) },
  {
    method: 'GET',
    pattern: '/me',
    roles: EVERYONE,
    handle: (ctx) => json(200, { user: summary(me(ctx)), context: contextFor(me(ctx)) }),
  },
  {
    method: 'POST',
    pattern: '/admin/users',
    roles: ADMIN,
    handle: (ctx) => json(201, createUser(ctx.state, ctx.body, ctx.now)),
  },
  {
    // SOLO modo demo: el contrato v1.8 no tiene una lista de cuentas.
    method: 'GET',
    pattern: '/admin/users',
    roles: ADMIN,
    mockOnly: true,
    handle: ({ state, query }) => {
      const kind = query.get('kind');
      const items: TeamAccount[] = state.accounts
        .filter((a) => a.role !== 'service')
        .filter((a) => kind !== 'crew' || a.role === 'astronaut')
        .filter((a) => kind !== 'ground' || a.role !== 'astronaut')
        .map((a) => ({
          ...userAdmin(a),
          ...(a.astronaut
            ? {
                astronaut: {
                  id: a.astronaut.id,
                  call_sign: a.astronaut.call_sign,
                  crew_role: a.astronaut.crew_role,
                  mission_id: a.astronaut.mission_id,
                  assignment_id: a.astronaut.assignment_id,
                },
              }
            : { ground_mission_ids: a.ground_mission_ids ?? [] }),
        }));
      return json(200, paginate(items, query));
    },
  },
  {
    method: 'GET',
    pattern: '/missions/:id/crew',
    roles: EVERYONE,
    handle: ({ params, state, query }) => {
      if (params.id !== MISSION_ID) return notFound('La misión no existe.');
      const items: CrewMember[] = crewAccounts(state).map((a) => ({
        astronaut_id: a.astronaut?.id as string,
        user_id: a.id,
        call_sign: a.astronaut?.call_sign as string,
        full_name: a.full_name,
        crew_role: a.astronaut?.crew_role as CrewRole,
        assigned_from: a.astronaut?.assigned_from as string,
      }));
      return json(200, paginate(items, query));
    },
  },
  {
    method: 'GET',
    pattern: '/admin/assignments',
    roles: ADMIN,
    handle: ({ state, query }) => {
      const missionId = query.get('mission_id');
      if (missionId && missionId !== MISSION_ID) return notFound('La misión no existe.');
      // Todas las del demo son vigentes (sin fecha de fin): active=false no devuelve nada.
      const items = query.get('active') === 'false' ? [] : crewAccounts(state).map((a) => assignmentOf(a) as Assignment);
      return json(200, paginate(items, query));
    },
  },
];
