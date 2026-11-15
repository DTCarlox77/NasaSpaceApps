/** Tipos del contrato (backend/docs/openapi.yaml v1.8) que usa el panel. */

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

/** GET /admin/escalations/{id}/messages (v1.8): el hilo visto desde Tierra. */
export interface EscalationMessagePage {
  items: EscalationMessage[];
  next_cursor: string | null;
}

// ---------------------------------------------------------------- emergencias (triaje)

export type EmergencyStatus = 'pending' | 'active' | 'closed' | 'cancelled' | 'merged';
export type TriggerType =
  | 'manual_button'
  | 'crew_event'
  | 'missed_checkin'
  | 'critical_reading'
  | 'environment_alarm';
export type RadiationFlag = 'none' | 'possible' | 'probable';

export interface TriageCounts {
  green: number;
  yellow: number;
  red: number;
  black: number;
  unreachable: number;
  in_progress: number;
}

/** Elemento de GET /admin/emergencies. `counts` es null para admin (solo estado operativo). */
export interface EmergencyListItem {
  id: string;
  mission_id: string;
  mission_code?: string;
  trigger_type: TriggerType;
  status: EmergencyStatus;
  started_at: string;
  closed_at?: string | null;
  received_at: string;
  first_delivered_at: string;
  counts: TriageCounts | null;
}

export interface EmergencyListPage {
  items: EmergencyListItem[];
  next_cursor: string | null;
}

export interface DeadmanEntry {
  astronaut_id: string;
  call_sign: string;
  trigger_type?: TriggerType;
  deadline_at?: string;
  confirmed_at?: string | null;
  expired_at?: string | null;
  status: 'waiting' | 'confirmed' | 'expired';
}

export interface EmergencyHeartbeat {
  dead_man_switch_seconds?: number;
  last_heartbeat_at?: string | null;
  expires_at?: string | null;
  lapsed_at?: string | null;
}

export interface EmergencySession {
  id: string;
  client_uuid: string;
  mission_id: string;
  mission_code?: string;
  protocol: { id: number; code: string; version: number };
  trigger_type: TriggerType;
  /** null si la activó el sistema. */
  started_by?: string | null;
  status: EmergencyStatus;
  context: { solar_event_active?: boolean; environment_alarm?: string | null; [key: string]: unknown };
  responder_safe: boolean | null;
  next_step: 'start_assessments' | 'secure_self';
  started_at: string;
  activated_at?: string | null;
  closed_at?: string | null;
  received_at: string;
  merged_into?: string | null;
  deadman?: DeadmanEntry[];
  heartbeat?: EmergencyHeartbeat;
  joined_activations?: number;
  synthetic?: boolean;
}

/** Respuesta guardada de una evaluación (sí/no, número, opción u opción múltiple). */
export interface StoredAnswer {
  question_code: string;
  answer: { value?: boolean | number; choice?: string | string[] };
  source: 'tap' | 'voice' | 'prefill' | 'auto';
  answered_at: string;
  received_at?: string;
}

export interface Assessment {
  id: string;
  client_uuid: string;
  session_id: string;
  astronaut_id: string;
  call_sign?: string;
  assessed_by?: string | null;
  is_self_assessment: boolean;
  sequence_no: number;
  status: 'in_progress' | 'completed' | 'unreachable';
  triage_category?: TriageCategory | null;
  radiation_flag?: RadiationFlag | null;
  computed_by?: 'device' | 'server' | null;
  rules_version?: number | null;
  started_at: string;
  completed_at?: string | null;
  reassessment_of?: string | null;
  matches_device?: boolean | null;
  device_result?: Record<string, unknown> | null;
  /** Solo flight_surgeon. */
  answers?: StoredAnswer[];
}

export interface EscalationRef {
  id: string;
  level: string;
  priority: Priority;
  status: EscalationStatus;
  deliver_at?: string | null;
}

export interface AttentionEntry {
  position: number;
  astronaut_id: string;
  call_sign: string;
  status: 'assessed' | 'in_progress' | 'unassessed';
  assessment_id?: string | null;
  triage_category?: TriageCategory | null;
  radiation_flag?: RadiationFlag | null;
  matches_device?: boolean | null;
  reason: string;
}

export interface EmergencyQuestion {
  id: string;
  session_id: string;
  /** Hilo con Tierra (se responde con POST /admin/escalations/{id}/messages). */
  escalation_id: string;
  direction: 'to_earth' | 'to_crew';
  body: string;
  created_at: string;
  /** null = en cola esperando enlace. */
  deliver_at: string | null;
}

export type EmergencyEventType =
  | 'opened'
  | 'joined'
  | 'merged'
  | 'deadman_started'
  | 'deadman_confirmed'
  | 'deadman_expired'
  | 'activated'
  | 'cancelled'
  | 'assessment_started'
  | 'assessment_completed'
  | 'device_mismatch'
  | 'heartbeat_lost'
  | 'question_to_earth'
  | 'closed';

export interface EmergencyEvent {
  id: number | string;
  event_type: EmergencyEventType;
  at: string;
  device_at?: string | null;
  delivered_at?: string | null;
  astronaut_id?: string | null;
  call_sign?: string | null;
  actor_role?: string | null;
  assessment_id?: string | null;
  /** No viene para admin en los eventos clínicos. */
  details?: Record<string, unknown>;
}

/** Reporte al cierre (solo flight_surgeon); forma abierta (additionalProperties). */
export type EmergencyReport = Record<string, unknown>;

/** GET /admin/emergencies/{id}. Para admin: sin answers, categorías, preguntas ni reporte. */
export interface EmergencyDetail {
  session: EmergencySession;
  assessments: Assessment[];
  escalations: EscalationRef[];
  timeline: EmergencyEvent[];
  /** Solo flight_surgeon. */
  attention_order?: AttentionEntry[];
  /** Solo flight_surgeon. */
  questions?: EmergencyQuestion[];
  report: EmergencyReport | null;
}

// ---------------------------------------------------------------- salud conductual (confidencial)

export type SupportUrgency = 'later' | 'today' | 'now';

export interface BehavioralInboxItem {
  id: string;
  astronaut_id: string;
  call_sign: string;
  kind: 'wellbeing_alert' | 'screening_alert' | 'support_request';
  indicator_code?: string | null;
  urgency?: SupportUrgency | null;
  channel?: 'message' | 'session' | null;
  /** Solo alertas. */
  priority?: Priority | null;
  /** Alertas: delivered | acknowledged | responded | closed. Solicitudes: open | acknowledged | closed. */
  status: string;
  summary: string;
  created_at: string;
  measured_at?: string | null;
  deliver_at?: string | null;
}

export interface BehavioralInboxPage {
  items: BehavioralInboxItem[];
  next_cursor: string | null;
}

export interface BehavioralIndicator {
  code: string;
  level: Level;
  escalation: string;
  last_value?: number | null;
  adverse_z_3d?: number | null;
  adverse_sustained_days?: number;
  trend?: Trend;
  series: SeriesPoint[];
}

/** Check-in tal como lo ve behavioral_health: SIN la nota privada (solo la ve el astronauta). */
export interface BehavioralCheckin {
  id: string;
  measured_at: string;
  received_at?: string;
  mood: number | null;
  fatigue: number | null;
  stress: number | null;
  crew_conflict: number | null;
  sleep_hours?: number | null;
  supersedes_id?: string | null;
}

export interface Screening {
  id: string;
  instrument: 'PHQ2' | 'GAD2';
  score: number;
  item_1: number;
  item_2: number;
  level: Level;
  measured_at: string;
}

export interface PvtRun {
  id: string;
  measured_at: string;
  lapses: number;
  mean_rt_ms: number;
  false_starts: number;
  before_critical_task: boolean;
  fitness: 'fit' | 'not_confirmed';
}

export interface SupportRequest {
  id: string;
  client_uuid: string;
  astronaut_id: string;
  status: 'open' | 'acknowledged' | 'closed';
  urgency: SupportUrgency;
  channel: 'message' | 'session';
  content: string;
  created_at: string;
  received_at: string;
  /** Llegada a Tierra; null = en cola. */
  deliver_at?: string | null;
}

export interface BehavioralEscalation {
  id: string;
  indicator_code?: string | null;
  status: string;
  priority?: string;
  created_at: string;
  deliver_at: string;
  measured_at?: string | null;
}

/** GET /admin/behavioral/astronauts/{id}. */
export interface BehavioralAstronautDetail {
  astronaut: { id: string; call_sign: string };
  generated_at: string;
  baseline_ready: boolean;
  indicators: BehavioralIndicator[];
  checkins?: BehavioralCheckin[];
  escalations?: BehavioralEscalation[];
  screenings: Screening[];
  pvt_runs: PvtRun[];
  support_requests: SupportRequest[];
}

/** POST /admin/behavioral/support-requests/{id}/messages (201). */
export interface SupportMessage {
  id: string;
  request_id: string;
  direction: 'to_earth' | 'to_crew';
  author_role: 'astronaut' | 'behavioral_health';
  body: string;
  created_at: string;
  deliver_at?: string | null;
}

export interface SupportRequestAck {
  id: string;
  status: 'open' | 'acknowledged' | 'closed';
  acknowledged_at: string;
  acknowledged_by: string | null;
}

export interface ClosedItem {
  id: string;
  status: 'closed';
  closed_at: string;
  closed_by: string | null;
}

/** GET /admin/audit/confidential-access (solo behavioral_health). */
export interface ConfidentialAccess {
  id: string;
  actor_user_id: string;
  actor_username?: string;
  actor_role: Role;
  astronaut_id: string;
  call_sign?: string;
  resource: string;
  accessed_at: string;
}

export interface ConfidentialAccessPage {
  items: ConfidentialAccess[];
  next_cursor: string | null;
}
