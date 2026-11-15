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

// ---------------------------------------------------------------- dashboard de tripulación (P2)

/** Nivel del semáforo. unrated = sin evaluar. */
export type Level = 'normal' | 'caution' | 'critical' | 'unrated';

export type CrewRole =
  | 'commander'
  | 'pilot'
  | 'crew_medical_officer'
  | 'flight_engineer'
  | 'mission_specialist';

export type Trend = 'rising' | 'falling' | 'stable' | 'insufficient_data';

/** Componentes del indicador por nombre; un indicador simple es { value: n }. */
export type ReadingValues = Record<string, unknown>;

export interface SeriesPoint {
  measured_at: string;
  value: number;
}

export interface DashboardIndicator {
  code: string;
  level: Level;
  last_value: ReadingValues;
  measured_at: string;
  trend: Trend;
  /** Hasta 10 puntos con el valor principal (p. ej. la sistólica). */
  series: SeriesPoint[];
}

export interface Compliance {
  checkins_completed_7d: number;
  checkins_expected_7d: number;
}

export interface DashboardAstronaut {
  astronaut_id: string;
  call_sign: string;
  crew_role: CrewRole;
  worst_level: Level;
  indicators: DashboardIndicator[];
  /** Solo admin; null para el flight surgeon. */
  compliance: Compliance | null;
  /** null para un rol que no puede verla. */
  fitness: 'fit' | 'not_confirmed' | null;
}

/** GET /admin/dashboard/crew. */
export interface CrewDashboard {
  mission_id: string;
  mission_code: string;
  generated_at: string;
  astronauts: DashboardAstronaut[];
}

// ---------------------------------------------------------------- catálogo de indicadores

export interface IndicatorComponent {
  name: string;
  type?: string;
  role?: string;
  unit?: string;
  required?: boolean;
}

export interface IndicatorDef {
  code: string;
  name: string;
  unit: string;
  value_type: 'simple' | 'composite' | 'boolean' | 'scale' | 'catalog';
  components: IndicatorComponent[];
  sensitivity: 'standard' | 'confidential';
}

/** GET /indicators. */
export interface IndicatorList {
  catalog_version: number;
  rules_version: number;
  items: IndicatorDef[];
}

// ---------------------------------------------------------------- bandeja de Tierra (P2)

export type Priority = 'routine' | 'urgent' | 'emergency';
export type EscalationStatus = 'queued' | 'delivered' | 'acknowledged' | 'responded' | 'closed';
export type InboxCategory = 'reading' | 'emergency' | 'wellbeing' | 'manual';
export type TriageCategory = 'green' | 'yellow' | 'red' | 'black';

export interface IndicatorEvaluation {
  code: string;
  level: Level;
  rule_index: number;
  escalation: string;
  rules_version?: number;
  recommendation?: string;
  basis?: string;
  source_ids?: string[];
}

/** Elemento de GET /admin/inbox. */
export interface InboxItem {
  id: string;
  mission_id: string;
  mission_code?: string;
  astronaut_id?: string | null;
  call_sign?: string | null;
  category: InboxCategory;
  source_type: 'reading' | 'emergency_assessment' | 'emergency_session' | 'wellbeing' | 'manual';
  source_id?: string | null;
  level: string;
  priority: Priority;
  status: EscalationStatus;
  reason: string;
  created_at: string;
  deliver_at: string;
  acknowledged_at?: string | null;
  acknowledged_by?: string | null;
  /** Solo si viene de una lectura. */
  measured_at?: string;
  late_sync?: boolean;
  lag_s?: number;
  evaluation?: IndicatorEvaluation;
  /** Solo para el flight surgeon (admin no la recibe). */
  triage?: { triage_category?: TriageCategory; radiation_flag?: 'none' | 'possible' | 'probable' };
}

export interface InboxPage {
  items: InboxItem[];
  next_cursor: string | null;
}

/** POST /admin/escalations/{id}/ack. */
export interface EscalationAck {
  id: string;
  status: EscalationStatus;
  acknowledged_at: string;
  acknowledged_by: string;
}

/** POST /admin/escalations/{id}/messages (201). deliver_at null = en cola sin enlace. */
export interface EscalationMessage {
  id: string;
  escalation_id: string;
  direction: 'to_earth' | 'to_crew';
  author_id?: string | null;
  author_role?: 'astronaut' | 'flight_surgeon' | 'admin';
  body: string;
  created_at: string;
  deliver_at?: string | null;
}
