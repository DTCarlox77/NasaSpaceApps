/**
 * Formas del contrato (OpenAPI v1.6) que usa la app. Solo los campos que se leen.
 * Si algo no coincide con la app, manda el backend: se adapta la app, nunca el contrato.
 */

export type ApiLevel = 'normal' | 'caution' | 'critical' | 'unrated';
export type ApiEscalationLevel = 'self_care' | 'crew' | 'flight_surgeon' | 'behavioral_health';

export interface ApiMissionRef {
  id: string;
  code: string;
  name?: string;
  status: string;
}

export interface ApiUserContext {
  astronaut_id: string | null;
  call_sign: string | null;
  crew_role: 'commander' | 'pilot' | 'crew_medical_officer' | 'flight_engineer' | 'mission_specialist' | null;
  sex?: 'female' | 'male' | null;
  mission?: ApiMissionRef;
  environment?: { code: string; name?: string; type?: string; gravity_g: number; comm_delay_seconds: number };
}

export interface ApiLoginResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  must_change_password: boolean;
  offline_unlock_until?: string | null;
  user: { id: string; username: string; full_name: string; role: 'astronaut' | 'flight_surgeon' | 'behavioral_health' | 'admin' | 'service' };
  context: ApiUserContext;
}

export interface ApiSource {
  id: string;
  title: string;
  url: string;
}

export interface ApiIndicator {
  code: string;
  name: string;
  unit: string;
  value_type: string;
  components: { name: string; type: string; role: 'value' | 'context'; required: boolean; unit?: string; values?: string }[];
  hazards: string[];
  body_zone: string;
  input_methods: string[];
  sensitivity: 'standard' | 'confidential';
  rules_version: number;
  sources: ApiSource[];
  /** Campos que el servidor calcula con el historial (derived.js). La app no los calcula sin conexión. */
  derived_fields?: { name: string; type?: string; how?: string }[];
}

export interface ApiIndicatorList {
  catalog_version: number;
  rules_version: number;
  items: ApiIndicator[];
}

export interface ApiEvaluation {
  code: string;
  level: ApiLevel;
  recommendation?: string;
  escalation: ApiEscalationLevel;
  rule_index: number;
  rules_version?: number;
  basis?: string;
  source_ids?: string[];
}

export interface ApiReadingCreated {
  reading: { id: string; client_uuid: string; indicator_code: string; measured_at: string };
  evaluation: ApiEvaluation;
  escalation_id: string | null;
  emergency?: { session_id: string; status: string; trigger_type?: string; deadline_at: string | null };
}

export interface ApiReadingPoint {
  id: string;
  indicator_code: string;
  values: Record<string, unknown>;
  level: ApiLevel;
  measured_at: string;
  received_at: string;
}

export interface ApiReadingPage {
  items: ApiReadingPoint[];
  next_cursor: string | null;
}

export interface ApiIndicatorStatus {
  code: string;
  name: string;
  level: ApiLevel;
  escalation: ApiEscalationLevel;
  recommendation?: string | null;
  last_value?: { reading_id: string; values: Record<string, unknown>; measured_at: string };
}

export interface ApiBodyStatus {
  astronaut_id: string;
  generated_at: string;
  rules_version: number;
  zones: { zone: string; name: string; worst_level: ApiLevel; indicators: ApiIndicatorStatus[]; checkin_completed?: boolean }[];
}

export interface ApiWellbeingAck {
  id: string;
  client_uuid: string;
  received_at: string;
  message: string;
  offer_support: boolean;
  supersedes_id?: string | null;
  streak?: { streak_days: number; checkins_this_week: number; checkins_goal_week: number };
  screening_due?: boolean;
}

export interface ApiPvtResult {
  id: string;
  client_uuid: string;
  received_at: string;
  fitness: 'fit' | 'not_confirmed';
  message: string;
}

export interface ApiSupportRequest {
  id: string;
  client_uuid: string;
  status: 'open' | 'acknowledged' | 'closed';
  urgency: 'later' | 'today' | 'now';
  channel: 'message' | 'session';
  content: string;
  created_at: string;
  received_at: string;
  deliver_at?: string | null;
  suggestions?: { code: 'guided_breathing' | 'talk_to_cmo'; title: string; description: string }[];
}

export interface ApiInstrument {
  code: 'PHQ2' | 'GAD2';
  name: string;
  prompt: string;
  items: { code: string; text: string }[];
  options: { value: number; label: string }[];
  license: string;
  note?: string;
}

export interface ApiEmergencySession {
  id: string;
  client_uuid: string;
  status: 'pending' | 'active' | 'closed' | 'cancelled' | 'merged';
  next_step: 'start_assessments' | 'secure_self';
  started_at: string;
  mission_code?: string;
  protocol?: { id: number; code: string; version: number };
  context?: Record<string, unknown>;
  responder_safe?: boolean | null;
  merged_into?: string | null;
  heartbeat?: { dead_man_switch_seconds?: number; last_heartbeat_at?: string | null; expires_at?: string | null; lapsed_at?: string | null };
}

export type ApiTriageCategory = 'green' | 'yellow' | 'red' | 'black';
export type ApiRadiationFlag = 'none' | 'possible' | 'probable';

/** RosterEntry: a quién evaluar (primero quien tiene un riesgo conocido). */
export interface ApiRosterEntry {
  astronaut_id: string;
  call_sign?: string;
  crew_role?: string | null;
  sequence_no?: number;
  priority_reason?: string | null;
  prefill?: Record<string, unknown>;
}

/** AttentionEntry: orden de atención con su motivo (lo calcula el servidor). */
export interface ApiAttentionEntry {
  position: number;
  astronaut_id: string;
  call_sign: string;
  status: 'assessed' | 'in_progress' | 'unassessed';
  assessment_id?: string | null;
  triage_category?: ApiTriageCategory | null;
  radiation_flag?: ApiRadiationFlag | null;
  matches_device?: boolean | null;
  reason: string;
}

/** Assessment del contrato. */
export interface ApiAssessment {
  id: string;
  client_uuid: string;
  session_id: string;
  astronaut_id: string;
  call_sign?: string;
  status: 'in_progress' | 'completed' | 'unreachable';
  triage_category?: ApiTriageCategory | null;
  radiation_flag?: ApiRadiationFlag | null;
  computed_by?: 'device' | 'server' | null;
  rules_version?: number | null;
  started_at: string;
  completed_at?: string | null;
  matches_device?: boolean | null;
}

/** SessionWithRoster (GET /emergency/sessions/{id} y POST /emergency/sessions). */
export interface ApiSessionWithRoster {
  session: ApiEmergencySession;
  roster?: ApiRosterEntry[];
  assessments?: ApiAssessment[];
  attention_order?: ApiAttentionEntry[];
  joined?: boolean;
}

/** TriageProtocol (GET /emergency/protocol). `definition` se evalúa con evaluateAssessment. */
export interface ApiTriageProtocol {
  id: number;
  code: string;
  version: number;
  name: string;
  is_active: boolean;
  sources: { id: string; title: string; url: string; publisher?: string }[];
  definition: import('@/core/engine/triage').TriageDefinition;
}

/** AssessmentResult (PUT answers → preview; POST complete). */
export interface ApiAssessmentResult {
  status: 'completed' | 'incomplete' | 'stopped';
  triage_category?: ApiTriageCategory | null;
  radiation_flag?: ApiRadiationFlag;
  priority?: string;
  escalations: { level: string; priority: string; escalation_id?: string; deliver_at?: string | null }[];
  path: string[];
  pending?: string;
  reason?: string;
  computed_by: 'server' | 'device';
  rules_version: number;
  matches_device?: boolean | null;
  mismatch_fields?: string[];
  next?: ApiRosterEntry | null;
  attention_order?: ApiAttentionEntry[];
}

/** EmergencyQuestion (POST /emergency/sessions/{id}/questions). */
export interface ApiEmergencyQuestion {
  id: string;
  session_id: string;
  escalation_id: string;
  direction: string;
  body: string;
  created_at: string;
  deliver_at: string | null;
}

export interface ApiHeartbeatResponse {
  session_id: string;
  status: string;
  received_at: string;
  dead_man_switch_seconds: number;
  expires_at: string;
}

/** RulesBundle (GET /rules?since_version=): reglas para evaluar sin conexión con conditions.js. */
export interface ApiRulesBundle {
  catalog_version: number;
  rules_version: number;
  up_to_date: boolean;
  indicators: { code: string; rules_version: number; rules: import('@/core/engine/conditions').IndicatorRule[] }[];
}

export interface ApiSyncItemResult {
  client_uuid: string | null;
  entity: string | null;
  status: 'accepted' | 'duplicate' | 'conflict' | 'rejected';
  server_id?: string | null;
  result?: Record<string, unknown>;
  error?: { code: string; message: string; details?: unknown };
}

export interface ApiSyncPushResponse {
  server_time: string;
  batch_id: string;
  clock_offset_s: number;
  counts: Record<string, number>;
  results: ApiSyncItemResult[];
}

export interface ApiSyncPullResponse {
  cursor: string;
  has_more: boolean;
  server_time: string;
  rules?: { rules_version: number; changed: boolean };
  protocol?: { code: string; version: number; changed: boolean };
  mission: { comm_delay_seconds: number; link: { status: 'up' | 'outage'; outage_ends_at?: string | null } } | null;
  evaluations: {
    reading_id: string;
    client_uuid: string;
    indicator_code: string;
    measured_at: string;
    evaluation: ApiEvaluation;
    escalation_id?: string | null;
  }[];
  escalations: { id: string; level: string; priority: string; status: string; reason: string; created_at: string; deliver_at: string }[];
  messages: {
    id: string;
    channel: 'escalation' | 'support';
    thread_id: string;
    direction: string;
    author_role: string;
    body: string;
    created_at: string;
    deliver_at: string;
  }[];
}

export interface ApiCurrentMission {
  mission: { id: string; code: string; name: string; status: string; starts_at?: string | null; ends_at?: string | null };
  environment: { code: string; name: string; type: string; gravity_g: number; comm_delay_seconds: number };
  crew_role: ApiUserContext['crew_role'];
  comm: { delay_seconds: number; link: 'up' | 'down' };
}

export interface ApiCrewPage {
  items: {
    astronaut_id: string;
    user_id?: string;
    call_sign: string;
    full_name: string;
    crew_role: NonNullable<ApiUserContext['crew_role']>;
  }[];
  next_cursor: string | null;
}

/** GET /api/v1/crew/status (lo agrega el backend; forma acordada). */
export interface ApiCrewStatus {
  mission: { id: string; code: string };
  generated_at: string;
  viewer_crew_role: ApiUserContext['crew_role'];
  crew: {
    astronaut_id: string;
    call_sign: string;
    display_name: string;
    crew_role: NonNullable<ApiUserContext['crew_role']>;
    emergency: { session_id: string; status: string } | null;
    crew_alerts: { escalation_id: string; indicator_code: string; indicator_name: string; level: ApiLevel; created_at: string }[];
    physical: null | {
      zones: { zone: string; worst_level: ApiLevel }[];
      indicators: { code: string; level: ApiLevel; last_value: unknown; measured_at: string | null }[];
    };
  }[];
}
