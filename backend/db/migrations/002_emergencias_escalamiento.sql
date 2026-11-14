-- =====================================================================
-- 002_emergencias_escalamiento.sql
-- Modo emergencia (triaje guiado por reglas) y escalamiento con retraso.
-- Peligros: Distance from Earth (autonomía + retraso), Space Radiation
--           (síntomas agudos tras evento solar), Hostile/Closed Environments.
-- =====================================================================

CREATE TYPE triage_category AS ENUM ('green', 'yellow', 'red', 'black');
CREATE TYPE emergency_trigger AS ENUM ('manual_button', 'missed_checkin', 'critical_reading', 'environment_alarm');
CREATE TYPE emergency_status AS ENUM ('active', 'closed', 'cancelled');
CREATE TYPE assessment_status AS ENUM ('in_progress', 'completed', 'unreachable');
CREATE TYPE answer_source AS ENUM ('tap', 'voice', 'prefill', 'auto');
CREATE TYPE escalation_level AS ENUM ('self_care', 'crew', 'flight_surgeon');
CREATE TYPE escalation_priority AS ENUM ('routine', 'urgent', 'emergency');
CREATE TYPE escalation_status AS ENUM ('queued', 'delivered', 'acknowledged', 'responded', 'closed');
CREATE TYPE message_direction AS ENUM ('to_earth', 'to_crew');

-- ---------- Protocolo de triaje versionado (reglas como datos) ----------
CREATE TABLE triage_protocols (
  id           serial PRIMARY KEY,
  code         text NOT NULL,
  version      integer NOT NULL CHECK (version > 0),
  name         text NOT NULL,
  definition   jsonb NOT NULL,          -- preguntas, ramas y reglas de clasificación
  sources      jsonb NOT NULL DEFAULT '[]'::jsonb,  -- citas obligatorias
  is_active    boolean NOT NULL DEFAULT false,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code, version),
  CONSTRAINT triage_definition_has_questions CHECK (definition ? 'questions')
);
CREATE UNIQUE INDEX triage_protocols_one_active_uq ON triage_protocols (code) WHERE is_active;

-- ---------- Sesión de emergencia (una por incidente, cubre a la tripulación) ----------
CREATE TABLE emergency_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_uuid   uuid NOT NULL UNIQUE,                 -- idempotencia offline-first
  mission_id    uuid NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  protocol_id   integer NOT NULL REFERENCES triage_protocols(id),
  trigger_type  emergency_trigger NOT NULL,
  started_by    uuid REFERENCES users(id) ON DELETE SET NULL,  -- NULL si la disparó el sistema
  status        emergency_status NOT NULL DEFAULT 'active',
  context       jsonb NOT NULL DEFAULT '{}'::jsonb,   -- p. ej. evento solar activo, alarma de CO2
  started_at    timestamptz NOT NULL,                 -- hora del dispositivo
  closed_at     timestamptz,
  received_at   timestamptz NOT NULL DEFAULT now(),   -- hora del servidor
  synthetic     boolean NOT NULL DEFAULT false,
  CONSTRAINT emergency_closed_ck CHECK (
    (status = 'active' AND closed_at IS NULL) OR (status <> 'active' AND closed_at IS NOT NULL))
);
CREATE INDEX emergency_sessions_mission_idx ON emergency_sessions (mission_id, started_at DESC);
CREATE UNIQUE INDEX emergency_one_active_per_mission_uq ON emergency_sessions (mission_id)
  WHERE status = 'active';

-- ---------- Evaluación por tripulante dentro de la sesión ----------
CREATE TABLE emergency_assessments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_uuid         uuid NOT NULL UNIQUE,
  session_id          uuid NOT NULL REFERENCES emergency_sessions(id) ON DELETE CASCADE,
  astronaut_id        uuid NOT NULL REFERENCES astronauts(id) ON DELETE RESTRICT,
  assessed_by         uuid REFERENCES users(id) ON DELETE SET NULL, -- quién responde por él
  is_self_assessment  boolean NOT NULL DEFAULT false,
  sequence_no         smallint NOT NULL CHECK (sequence_no > 0),   -- orden de atención
  status              assessment_status NOT NULL DEFAULT 'in_progress',
  triage_category     triage_category,                             -- resultado START adaptado
  radiation_flag      text CHECK (radiation_flag IN ('none', 'possible', 'probable')),
  computed_by         text CHECK (computed_by IN ('device', 'server')),
  rules_version       integer,
  started_at          timestamptz NOT NULL,
  completed_at        timestamptz,
  notes               text,
  UNIQUE (session_id, astronaut_id),
  UNIQUE (session_id, sequence_no),
  CONSTRAINT assessment_completed_ck CHECK (
    status <> 'completed' OR (completed_at IS NOT NULL AND triage_category IS NOT NULL))
);
CREATE INDEX emergency_assessments_astronaut_idx ON emergency_assessments (astronaut_id, started_at DESC);

-- ---------- Respuestas (solo inserción; la más reciente por pregunta manda) ----------
CREATE TABLE emergency_answers (
  id               bigserial PRIMARY KEY,
  client_uuid      uuid NOT NULL UNIQUE,
  assessment_id    uuid NOT NULL REFERENCES emergency_assessments(id) ON DELETE CASCADE,
  question_code    text NOT NULL,
  answer           jsonb NOT NULL,           -- {"value": true} | {"value": 24} | {"choice": "1_2h"}
  source           answer_source NOT NULL,
  source_reading_id uuid,                    -- lectura usada para prellenar (FK al crear readings)
  answered_at      timestamptz NOT NULL,
  received_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX emergency_answers_lookup_idx ON emergency_answers (assessment_id, question_code, answered_at DESC);

-- ---------- Escalamientos (genérico: lecturas, emergencias, manual) ----------
-- El retraso con Tierra se simula con deliver_at: el panel solo ve deliver_at <= now().
CREATE TABLE escalations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_uuid      uuid UNIQUE,
  mission_id       uuid NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  astronaut_id     uuid REFERENCES astronauts(id) ON DELETE SET NULL,
  source_type      text NOT NULL CHECK (source_type IN ('reading', 'emergency_assessment', 'emergency_session', 'manual')),
  source_id        uuid,                       -- polimórfico: se valida en el servicio
  level            escalation_level NOT NULL,
  priority         escalation_priority NOT NULL DEFAULT 'routine',
  status           escalation_status NOT NULL DEFAULT 'queued',
  reason           text NOT NULL,              -- explicación legible del porqué
  created_at       timestamptz NOT NULL DEFAULT now(),
  deliver_at       timestamptz NOT NULL,       -- created_at + comm_delay_seconds del entorno
  acknowledged_at  timestamptz,
  acknowledged_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  closed_at        timestamptz,
  CONSTRAINT escalations_deliver_ck CHECK (deliver_at >= created_at),
  CONSTRAINT escalations_ack_ck CHECK (
    (acknowledged_at IS NULL) = (acknowledged_by IS NULL))
);
CREATE INDEX escalations_inbox_idx ON escalations (mission_id, deliver_at)
  WHERE status IN ('queued', 'delivered', 'acknowledged');
CREATE INDEX escalations_source_idx ON escalations (source_type, source_id);

-- ---------- Mensajes en el hilo del escalamiento (también con retraso) ----------
CREATE TABLE escalation_messages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escalation_id  uuid NOT NULL REFERENCES escalations(id) ON DELETE CASCADE,
  direction      message_direction NOT NULL,
  author_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  body           text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at     timestamptz NOT NULL DEFAULT now(),
  deliver_at     timestamptz NOT NULL,
  CONSTRAINT escalation_messages_deliver_ck CHECK (deliver_at >= created_at)
);
CREATE INDEX escalation_messages_thread_idx ON escalation_messages (escalation_id, created_at);

-- ---------- Vista: bandeja del panel (solo lo que ya "llegó" a Tierra) ----------
CREATE VIEW v_ground_inbox AS
SELECT e.*, m.code AS mission_code, a.call_sign,
       GREATEST(EXTRACT(EPOCH FROM (e.deliver_at - now())), 0)::int AS seconds_until_delivery
FROM escalations e
JOIN missions m ON m.id = e.mission_id
LEFT JOIN astronauts a ON a.id = e.astronaut_id
WHERE e.level = 'flight_surgeon'
  AND e.deliver_at <= now()
  AND e.status <> 'closed';
