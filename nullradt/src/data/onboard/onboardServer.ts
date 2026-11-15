import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import i18n from '@/core/i18n';
import { base64url, base64urlDecode, fromUtf8, hashSecret, hmacSha256, randomId, safeEqual, sha256Hex, temporaryPassword, utf8, verifySecret } from '@/core/security/crypto';
import { can, isStrongPassword, isValidPin, type Actor, type AdminAction } from '@/domain/access/permissions';
import {
  AccountLockedError,
  InvalidCredentialsError,
  PermissionDeniedError,
  TokenReuseError,
  WeakPasswordError,
  type GlobalRole,
  type MissionCrewRole,
  type Session,
} from '@/domain/entities/Session';
import { sendToEarth } from '@/presentation/store/outboxStore';

/**
 * SERVIDOR A BORDO (simulado en el dispositivo para la demo).
 * En vuelo es la fuente de verdad y se replica a Tierra con retraso; aquí corre un solo "backend" local
 * con el retraso del enlace simulado (outboxStore). Mismo contrato que tendría el servidor Node:
 *  - contraseñas y PIN con bcrypt · bloqueo tras N intentos · JWT HS256 de vida corta
 *  - refresh tokens rotativos de un solo uso con detección de reuso (revoca toda la familia)
 *  - permisos delegados del comandante, auditados y reportados a Tierra
 */

export const AUTH_CONFIG = {
  maxAttempts: 5,
  lockMinutes: 15,
  accessTtlMin: 15,
  refreshTtlDays: 7,
  offlineUnlockHours: 72,
  currentMissionId: 'artemis-gateway-7',
} as const;

export interface Account {
  id: string;
  fullName: string;
  displayName: string;
  globalRole: GlobalRole;
  missionId?: string;
  crewRole?: MissionCrewRole;
  passwordHash: string;
  mustChangePassword: boolean;
  pinHash?: string;
  failedAttempts: number;
  lockedUntil?: number;
  createdAt: string;
  createdBy: string;
  synthetic: boolean;
}

export interface RefreshRecord {
  tokenHash: string;
  family: string;
  userId: string;
  deviceId: string;
  issuedAt: number;
  expiresAt: number;
  usedAt?: number;
  revokedAt?: number;
}

export interface DeviceRecord {
  deviceId: string;
  label: string;
  fingerprint: string;
  registeredBy: string;
  registeredAt: string;
}

export type AuditAction =
  | 'login'
  | 'loginFailed'
  | 'locked'
  | 'unlockAccount'
  | 'resetPin'
  | 'registerDevice'
  | 'createAccount'
  | 'passwordChanged'
  | 'pinSet'
  | 'tokenRefresh'
  | 'tokenReuse'
  | 'logout'
  | 'emergencyAccess';

export interface AuditEntry {
  id: string;
  at: string;
  actorId: string;
  action: AuditAction;
  targetId?: string;
  detail?: string;
  /** Acción delegada del comandante (se reporta a Tierra). */
  delegated?: boolean;
}

const seed = (id: string, fullName: string, displayName: string, globalRole: GlobalRole, passwordHash: string, crewRole?: MissionCrewRole): Account => ({
  id,
  fullName,
  displayName,
  globalRole,
  passwordHash,
  crewRole,
  missionId: globalRole === 'astronaut' ? AUTH_CONFIG.currentMissionId : undefined,
  mustChangePassword: false,
  failedAttempts: 0,
  createdAt: '2026-11-01T00:00:00.000Z',
  createdBy: 'NR-A-9001',
  synthetic: true,
});

/**
 * ⚠️ CUENTAS SINTÉTICAS de la demo. Hashes bcrypt (coste 8) precalculados de las contraseñas de prueba
 * documentadas en crewMockDataSource (astronautas) y aquí (personal de Tierra):
 * NR-A-9001 Control2026 · NR-A-9002 Surgeon2026 · NR-A-9003 Mente2026.
 */
const SEED_ACCOUNTS: Account[] = [
  seed('NR-A-0101', 'Claudia Sofía Vargas Ayerdis', 'Claudia Vargas', 'astronaut', '$2b$08$eEGUcMdoS8jN2MrLzn6WBOVXO/7lck2rgINPmnf5NT4ZdwX3niH.G', 'crew'),
  seed('NR-A-0102', 'María Alejandra Sarante Salinas', 'María Sarante', 'astronaut', '$2b$08$.vEBl.U6/eU6qdZNEKaIpOVUm5MkBZYKBee573t.8lvpvAmk5HTd2', 'medical_officer'),
  seed('NR-A-0103', 'Carlos Adrián Espinosa Luna', 'Carlos Espinosa', 'astronaut', '$2b$08$I/41vwEWE0/kNqZ1ykTGneiq7lCLxiEfZcuRFqcNkPxIePwrdCoam', 'commander'),
  seed('NR-A-0104', 'Mauro Engelbert Delgado Saenz', 'Mauro Delgado', 'astronaut', '$2b$08$bHOnCmzdf4HNYWHMU9EgeOQM4db.y3fUcZZYAoKQKyifTIJd3gH4a', 'crew'),
  seed('NR-A-0105', 'Víctor Mateo Alcocer López', 'Víctor Alcocer', 'astronaut', '$2b$08$J7ie9hvy/OZu3iKk3hbVH.NEE7pO2lCELJYUnmLwfRCY8QuTUZr92', 'crew'),
  seed('NR-A-0106', 'Jorge Adán Ortega Torres', 'Jorge Ortega', 'astronaut', '$2b$08$vpFzlXMnxYr6NJ.7O9ZQVux/Uh8YR8YMdWemc0Ob.3S6JDZOc5tAe', 'crew'),
  seed('NR-A-9001', 'Mission Control', 'Mission Control', 'admin', '$2b$08$mO1WK9IUTNyDxle7us7aOOJ7D8RSX5pV0DAJx6HXHUSGWJLG.VKDu'),
  seed('NR-A-9002', 'Flight Surgeon (Earth)', 'Flight Surgeon', 'flight_surgeon', '$2b$08$7WtEzXjnkms4crcwVzfT8eGB/ZZN6Kmgd1wIV6JFghp0qo29PaXYa'),
  seed('NR-A-9003', 'Behavioral Health (Earth)', 'Behavioral Health', 'behavioral_health', '$2b$08$Dzb3DkxjdvGqbaTuRBi1S.yL1VpXbfEU4udg.3Tr4wHp7Wyf/GyaS'),
];

interface OnboardState {
  accounts: Record<string, Account>;
  refreshTokens: RefreshRecord[];
  devices: Record<string, DeviceRecord>;
  audit: AuditEntry[];
  jwtSecret: string;
}

export const useOnboardStore = create<OnboardState>()(
  persist(
    (): OnboardState => ({
      accounts: Object.fromEntries(SEED_ACCOUNTS.map((a) => [a.id, a])),
      refreshTokens: [],
      devices: {},
      audit: [],
      jwtSecret: '',
    }),
    { name: 'nullradt-onboard-server', storage: createJSONStorage(() => AsyncStorage) },
  ),
);

const get = () => useOnboardStore.getState();
const set = useOnboardStore.setState;
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

function audit(entry: Omit<AuditEntry, 'id' | 'at'>, reportToEarth = false) {
  const full: AuditEntry = { ...entry, id: newId(), at: new Date().toISOString() };
  set((s) => ({ audit: [full, ...s.audit].slice(0, 300) }));
  if (reportToEarth) {
    sendToEarth({
      kind: 'audit',
      audience: 'missionControl',
      fromId: entry.actorId,
      subjectId: entry.targetId,
      title: i18n.t('access.auditEarthTitle', { action: i18n.t(`access.auditActions.${entry.action}`) }),
      body: i18n.t('access.auditEarthBody', { actor: entry.actorId, target: entry.targetId ?? '—', detail: entry.detail ?? '' }),
      confidential: false,
    });
  }
  return full;
}

// ---------------- JWT (HS256) ----------------

function secret(): Uint8Array {
  let s = get().jwtSecret;
  if (!s) {
    s = randomId(32);
    set({ jwtSecret: s });
  }
  return utf8(s);
}

export interface AccessClaims {
  sub: string;
  role: GlobalRole;
  crewRole?: MissionCrewRole;
  mission?: string;
  dev: string;
  iat: number;
  exp: number;
}

function signJwt(claims: AccessClaims): string {
  const header = base64url(utf8(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payload = base64url(utf8(JSON.stringify(claims)));
  const sig = base64url(hmacSha256(secret(), utf8(`${header}.${payload}`)));
  return `${header}.${payload}.${sig}`;
}

/** Verifica firma y expiración. Devuelve los claims o null. */
export function verifyAccessToken(jwt: string, now = Date.now()): AccessClaims | null {
  const [h, p, sig] = jwt.split('.');
  if (!h || !p || !sig) return null;
  const expected = base64url(hmacSha256(secret(), utf8(`${h}.${p}`)));
  if (!safeEqual(expected, sig)) return null;
  try {
    const claims = JSON.parse(fromUtf8(base64urlDecode(p))) as AccessClaims;
    return claims.exp * 1000 > now ? claims : null;
  } catch {
    return null;
  }
}

export const decodeClaims = (jwt: string): AccessClaims | null => {
  try {
    return JSON.parse(fromUtf8(base64urlDecode(jwt.split('.')[1] ?? ''))) as AccessClaims;
  } catch {
    return null;
  }
};

function issueTokens(account: Account, deviceId: string, family = randomId(12)) {
  const now = Date.now();
  const exp = now + AUTH_CONFIG.accessTtlMin * 60_000;
  const token = signJwt({
    sub: account.id,
    role: account.globalRole,
    crewRole: account.crewRole,
    mission: account.missionId,
    dev: deviceId,
    iat: Math.floor(now / 1000),
    exp: Math.floor(exp / 1000),
  });
  const refreshToken = randomId(32);
  const record: RefreshRecord = {
    tokenHash: sha256Hex(refreshToken),
    family,
    userId: account.id,
    deviceId,
    issuedAt: now,
    expiresAt: now + AUTH_CONFIG.refreshTtlDays * 86_400_000,
  };
  set((s) => ({ refreshTokens: [record, ...s.refreshTokens.filter((r) => r.expiresAt > now)].slice(0, 200) }));
  return { token, refreshToken, accessExpiresAt: new Date(exp).toISOString() };
}

function toSession(account: Account, tokens: ReturnType<typeof issueTokens>): Session {
  return {
    userId: account.id,
    displayName: account.displayName,
    role: account.globalRole,
    crewRole: account.crewRole,
    missionId: account.missionId,
    token: tokens.token,
    refreshToken: tokens.refreshToken,
    accessExpiresAt: tokens.accessExpiresAt,
    issuedAt: new Date().toISOString(),
    demo: true,
    authMode: 'onboard',
    mustChangePassword: account.mustChangePassword,
    offlineUnlockUntil: account.pinHash ? new Date(Date.now() + AUTH_CONFIG.offlineUnlockHours * 3_600_000).toISOString() : undefined,
  };
}

function registerFailure(account: Account): never {
  const attempts = account.failedAttempts + 1;
  const lock = attempts >= AUTH_CONFIG.maxAttempts;
  const lockedUntil = lock ? Date.now() + AUTH_CONFIG.lockMinutes * 60_000 : undefined;
  set((s) => ({ accounts: { ...s.accounts, [account.id]: { ...account, failedAttempts: lock ? 0 : attempts, lockedUntil } } }));
  audit({ actorId: account.id, action: lock ? 'locked' : 'loginFailed', detail: `${attempts}/${AUTH_CONFIG.maxAttempts}` }, lock);
  if (lock) throw new AccountLockedError(lockedUntil!);
  throw new InvalidCredentialsError();
}

function checkLock(account: Account) {
  if (account.lockedUntil && account.lockedUntil > Date.now()) throw new AccountLockedError(account.lockedUntil);
}

// ---------------- API del servidor ----------------

export const onboardServer = {
  async login(identifier: string, password: string, deviceId: string): Promise<Session> {
    const account = get().accounts[identifier.trim().toUpperCase()];
    if (!account) throw new InvalidCredentialsError();
    checkLock(account);
    if (!(await verifySecret(password, account.passwordHash))) registerFailure(account);
    const fresh = { ...account, failedAttempts: 0, lockedUntil: undefined };
    set((s) => ({ accounts: { ...s.accounts, [account.id]: fresh } }));
    audit({ actorId: account.id, action: 'login', detail: deviceId });
    return toSession(fresh, issueTokens(fresh, deviceId));
  },

  /** Cambio de contraseña (obligatorio tras la temporal). */
  async changePassword(userId: string, next: string): Promise<void> {
    const account = get().accounts[userId];
    if (!account) throw new InvalidCredentialsError();
    if (!isStrongPassword(next)) throw new WeakPasswordError();
    if (await verifySecret(next, account.passwordHash)) throw new WeakPasswordError();
    const passwordHash = await hashSecret(next);
    set((s) => ({ accounts: { ...s.accounts, [userId]: { ...account, passwordHash, mustChangePassword: false } } }));
    audit({ actorId: userId, action: 'passwordChanged' });
  },

  /** PIN de 6 dígitos para desbloquear sin conexión hasta offline_unlock_until. */
  async setPin(userId: string, pin: string): Promise<string> {
    const account = get().accounts[userId];
    if (!account) throw new InvalidCredentialsError();
    if (!isValidPin(pin)) throw new WeakPasswordError();
    const pinHash = await hashSecret(pin);
    set((s) => ({ accounts: { ...s.accounts, [userId]: { ...account, pinHash } } }));
    audit({ actorId: userId, action: 'pinSet' });
    return new Date(Date.now() + AUTH_CONFIG.offlineUnlockHours * 3_600_000).toISOString();
  },

  hasPin: (userId: string) => !!get().accounts[userId]?.pinHash,

  /** Desbloqueo con PIN (local, sin red). Comparte el contador de intentos y el bloqueo. */
  async verifyPin(userId: string, pin: string): Promise<void> {
    const account = get().accounts[userId];
    if (!account?.pinHash) throw new InvalidCredentialsError();
    checkLock(account);
    if (!(await verifySecret(pin, account.pinHash))) registerFailure(account);
    set((s) => ({ accounts: { ...s.accounts, [userId]: { ...account, failedAttempts: 0, lockedUntil: undefined } } }));
  },

  /** Rotación: cada refresh token sirve UNA vez. Reutilizar uno ya usado revoca toda la familia. */
  refresh(refreshToken: string): Session {
    const now = Date.now();
    const hash = sha256Hex(refreshToken);
    const record = get().refreshTokens.find((r) => r.tokenHash === hash);
    if (!record || record.expiresAt < now) throw new InvalidCredentialsError();
    if (record.usedAt || record.revokedAt) {
      set((s) => ({ refreshTokens: s.refreshTokens.map((r) => (r.family === record.family ? { ...r, revokedAt: r.revokedAt ?? now } : r)) }));
      audit({ actorId: record.userId, action: 'tokenReuse', detail: record.deviceId }, true);
      throw new TokenReuseError();
    }
    const account = get().accounts[record.userId];
    if (!account) throw new InvalidCredentialsError();
    set((s) => ({ refreshTokens: s.refreshTokens.map((r) => (r.tokenHash === hash ? { ...r, usedAt: now } : r)) }));
    audit({ actorId: account.id, action: 'tokenRefresh' });
    return toSession(account, issueTokens(account, record.deviceId, record.family));
  },

  logout(refreshToken?: string) {
    if (!refreshToken) return;
    const hash = sha256Hex(refreshToken);
    const record = get().refreshTokens.find((r) => r.tokenHash === hash);
    if (!record) return;
    const now = Date.now();
    set((s) => ({ refreshTokens: s.refreshTokens.map((r) => (r.family === record.family ? { ...r, revokedAt: r.revokedAt ?? now } : r)) }));
    audit({ actorId: record.userId, action: 'logout' });
  },

  /** Solo control de misión. Devuelve la contraseña temporal UNA vez (solo se guarda su hash bcrypt). */
  async createAccount(actor: Actor, input: { fullName: string; displayName: string; globalRole: GlobalRole; crewRole?: MissionCrewRole }) {
    authorize(actor, 'createAccount');
    const ids = Object.keys(get().accounts);
    const staff = input.globalRole !== 'astronaut';
    let n = staff ? 9004 : 107;
    const fmt = (x: number) => `NR-A-${String(x).padStart(4, '0')}`;
    while (ids.includes(fmt(n))) n++;
    const id = fmt(n);
    const temp = temporaryPassword();
    const account: Account = {
      id,
      fullName: input.fullName.trim(),
      displayName: input.displayName.trim() || input.fullName.trim().split(' ').slice(0, 2).join(' '),
      globalRole: input.globalRole,
      crewRole: input.globalRole === 'astronaut' ? (input.crewRole ?? 'crew') : undefined,
      // Asignación automática a la misión vigente.
      missionId: input.globalRole === 'astronaut' ? AUTH_CONFIG.currentMissionId : undefined,
      passwordHash: await hashSecret(temp),
      mustChangePassword: true,
      failedAttempts: 0,
      createdAt: new Date().toISOString(),
      createdBy: actor.userId,
      synthetic: false,
    };
    set((s) => ({ accounts: { ...s.accounts, [id]: account } }));
    audit({ actorId: actor.userId, action: 'createAccount', targetId: id, detail: input.globalRole });
    return { id, temporaryPassword: temp };
  },

  unlockAccount(actor: Actor, targetId: string) {
    const target = get().accounts[targetId];
    if (!target) throw new InvalidCredentialsError();
    const { delegated } = authorize(actor, 'unlockAccount', target);
    set((s) => ({ accounts: { ...s.accounts, [targetId]: { ...target, failedAttempts: 0, lockedUntil: undefined } } }));
    audit({ actorId: actor.userId, action: 'unlockAccount', targetId, delegated }, true);
  },

  resetPin(actor: Actor, targetId: string) {
    const target = get().accounts[targetId];
    if (!target) throw new InvalidCredentialsError();
    const { delegated } = authorize(actor, 'resetPin', target);
    set((s) => ({ accounts: { ...s.accounts, [targetId]: { ...target, pinHash: undefined } } }));
    audit({ actorId: actor.userId, action: 'resetPin', targetId, delegated }, true);
  },

  registerDevice(actor: Actor, device: { deviceId: string; label: string; fingerprint: string }) {
    const { delegated } = authorize(actor, 'registerDevice');
    const record: DeviceRecord = { ...device, registeredBy: actor.userId, registeredAt: new Date().toISOString() };
    set((s) => ({ devices: { ...s.devices, [device.deviceId]: record } }));
    audit({ actorId: actor.userId, action: 'registerDevice', targetId: device.deviceId, detail: device.label, delegated }, true);
  },

  /** Registro inicial de la tableta principal (lo hizo control de misión antes del vuelo). */
  provisionDevice(device: { deviceId: string; label: string; fingerprint: string }) {
    set((s) => ({ devices: { ...s.devices, [device.deviceId]: { ...device, registeredBy: 'NR-A-9001', registeredAt: new Date().toISOString() } } }));
  },

  deviceFingerprint: (deviceId: string) => get().devices[deviceId]?.fingerprint,

  logEmergencyAccess(deviceId: string) {
    audit({ actorId: `device:${deviceId}`, action: 'emergencyAccess', detail: 'triage' }, true);
  },
};

function authorize(actor: Actor, action: AdminAction, target?: { missionId?: string }) {
  const res = can(actor, action, target);
  if (!res.allowed) throw new PermissionDeniedError();
  return res;
}

/** Actor a partir de la sesión actual. */
export const actorFrom = (s: Pick<Session, 'userId' | 'role' | 'crewRole' | 'missionId'>): Actor => ({ userId: s.userId, role: s.role, crewRole: s.crewRole, missionId: s.missionId });
