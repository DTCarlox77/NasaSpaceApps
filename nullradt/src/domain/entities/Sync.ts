/** Tipos de registro de la cola de sincronización (`entity` de POST /sync/push). */
export type SyncEntity =
  | 'reading'
  | 'wellbeing_checkin'
  | 'pvt_run'
  | 'wellbeing_screening'
  | 'support_request'
  | 'emergency_session'
  | 'emergency_confirm'
  | 'emergency_assessment'
  | 'emergency_answer'
  | 'emergency_complete'
  | 'emergency_heartbeat'
  | 'emergency_question'
  | 'emergency_close';

export type SyncPriority = 'emergency' | 'normal';

/**
 * Registro creado en el dispositivo y pendiente de subir. `clientUuid` se genera UNA vez, al crearlo,
 * y se manda igual en cada reintento (clave de idempotencia del servidor).
 */
export interface OutboxItem {
  clientUuid: string;
  entity: SyncEntity;
  priority: SyncPriority;
  createdAt: string;
  /** Mismo body que el endpoint en línea, sin `client_uuid`. */
  payload: Record<string, unknown>;
  /** Dueño (usuario de la sesión) para no mezclar colas si se cambia de cuenta. */
  ownerId: string;
  attempts: number;
  lastError?: string;
}

/** Resultado de cada item del push (en el orden de `items`). */
export interface PushItemResult {
  item: OutboxItem;
  status: 'accepted' | 'duplicate' | 'conflict' | 'rejected';
  serverId: string | null;
  /** Lo mismo que devolvería el endpoint en línea. */
  result: Record<string, unknown> | null;
  errorCode?: string;
}

export interface PushSummary {
  results: PushItemResult[];
  /** Items que siguen en la cola (sin red, error del lote o ENTITY_NOT_SUPPORTED). */
  remaining: number;
  /** true = no se pudo hablar con el servidor (se reintenta luego). */
  offline: boolean;
}

/** Mensaje entregado desde Tierra (`messages` del pull). */
export interface DeliveredMessage {
  id: string;
  channel: 'escalation' | 'support';
  threadId: string;
  authorRole: string;
  body: string;
  createdAt: string;
  deliverAt: string;
}

/** Evaluación del servidor de una lectura (reemplaza lo que la app tenía como "sin evaluar"). */
export interface PulledEvaluation {
  clientUuid: string;
  indicatorCode: string;
  level: 'normal' | 'caution' | 'critical' | 'unrated';
  recommendation: string | null;
  escalationId: string | null;
  measuredAt: string;
}

export interface PulledEscalation {
  id: string;
  level: string;
  priority: string;
  status: string;
  reason: string;
  createdAt: string;
  deliverAt: string;
}

export interface PullSummary {
  evaluations: PulledEvaluation[];
  escalations: PulledEscalation[];
  messages: DeliveredMessage[];
  /** Estado del enlace con Tierra (null si el servidor no lo informa). */
  link: { status: 'up' | 'outage'; outageEndsAt: string | null; commDelaySeconds: number } | null;
  /** Versiones de reglas y protocolo: `changed` = hay que volver a bajarlas (GET /rules, GET /emergency/protocol). */
  versions: { rulesVersion: number; rulesChanged: boolean; protocolVersion: number; protocolChanged: boolean } | null;
  serverTime: string;
}
