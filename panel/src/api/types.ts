/** Tipos del contrato (docs/openapi.yaml v1.7) que usa el panel. */

export type Role = 'astronaut' | 'flight_surgeon' | 'behavioral_health' | 'admin' | 'service';

export const GROUND_ROLES = ['admin', 'flight_surgeon', 'behavioral_health'] as const;
export type GroundRole = (typeof GROUND_ROLES)[number];

export const isGroundRole = (role: string | undefined | null): role is GroundRole =>
  (GROUND_ROLES as readonly string[]).includes(role ?? '');

export interface UserSummary {
  id: string;
  username: string;
  full_name: string;
  role: Role;
  email?: string | null;
}

export interface MissionRef {
  id: string;
  code: string;
  name?: string;
  status: 'planned' | 'active' | 'completed' | 'aborted';
}

export interface UserContext {
  astronaut_id?: string | null;
  call_sign?: string | null;
  crew_role?: string | null;
  mission?: MissionRef;
  ground_missions?: MissionRef[];
}

export interface TokenPair {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
}

export interface LoginResponse extends TokenPair {
  must_change_password: boolean;
  offline_unlock_until?: string | null;
  user: UserSummary;
  context: UserContext;
}

export interface Me {
  user: UserSummary;
  context: UserContext;
}

export interface Health {
  status: 'ok' | 'error';
  db: 'up' | 'down';
  time: string;
  version: string;
}

/** Cuerpo de error único del backend: { error: { code, message, details } }. */
export interface ErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

// ---------------------------------------------------------------- misión vigente (P2)

export interface CommOutage {
  id: string;
  mission_id: string;
  starts_at: string;
  /** null = corte en curso. */
  ends_at?: string | null;
  reason: string;
  created_at?: string;
}

export interface CommStatus {
  delay_seconds: number;
  /** down = hay un corte en curso. */
  link: 'up' | 'down';
  current_outage?: CommOutage;
  upcoming_outages: CommOutage[];
}

export interface Environment {
  code: string;
  name: string;
  type: 'spacecraft' | 'space_station' | 'rover' | 'lunar_base' | 'mars_base';
  gravity_g: number;
  comm_delay_seconds: number;
  description?: string | null;
}

export interface Mission {
  id: string;
  code: string;
  name: string;
  environment_code: string;
  status: MissionRef['status'];
  starts_at: string;
  ends_at?: string | null;
}

/** GET /missions/current (CurrentMission). */
export interface CurrentMission {
  mission: Mission;
  environment: Environment;
  crew_role?: string | null;
  comm: CommStatus;
}
