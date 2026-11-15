-- =====================================================================
-- 012_triaje.sql
-- Tarea 9: Triaje Autónomo de Tripulación (MVP).
-- Peligros: Distance from Earth (autonomía + retraso), Space Radiation,
--           Hostile/Closed Environments.
--
-- - Una sola sesión ABIERTA (pending o active) por misión; una segunda
--   activación se une a ella (fila merged con merged_into).
-- - Reevaluación append-only: un tripulante puede tener varias evaluaciones en
--   la misma sesión (reassessment_of apunta a la anterior); manda la última.
-- - El servidor recalcula con la versión del protocolo de la evaluación y
--   guarda también lo que calculó el dispositivo (device_result, matches_device).
-- - Interruptor de hombre muerto por tripulante afectado (emergency_deadman).
-- - Línea de tiempo (emergency_events) con deliver_at hacia Tierra (cortes).
-- - Reporte al cerrar (emergency_reports): Tierra lo ve cuando llega el evento
--   de cierre.
-- - system_markers: p. ej. la última carga de la historia del simulador (desde
--   ahí cuenta el check-in perdido).
-- =====================================================================

-- ---------- Sesiones ----------
ALTER TABLE emergency_sessions DROP CONSTRAINT emergency_closed_ck;
ALTER TABLE emergency_sessions
  ADD CONSTRAINT emergency_closed_ck CHECK ((status IN ('pending', 'active')) = (closed_at IS NULL));

DROP INDEX emergency_one_active_per_mission_uq;
CREATE UNIQUE INDEX emergency_one_open_per_mission_uq ON emergency_sessions (mission_id)
  WHERE status IN ('pending', 'active');

ALTER TABLE emergency_sessions
  ADD COLUMN merged_into         uuid REFERENCES emergency_sessions(id) ON DELETE RESTRICT,
  ADD COLUMN responder_safe      boolean,
  ADD COLUMN activated_at        timestamptz,          -- cuándo pasó a active
  ADD COLUMN last_heartbeat_at   timestamptz,
  ADD COLUMN heartbeat_lapsed_at timestamptz,          -- latido vencido (ya escaló)
  ADD COLUMN closed_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN close_notes         text CHECK (length(close_notes) <= 2000),
  ADD CONSTRAINT emergency_merged_ck CHECK ((status = 'merged') = (merged_into IS NOT NULL)),
  ADD CONSTRAINT emergency_not_self_merge_ck CHECK (merged_into IS DISTINCT FROM id);
CREATE INDEX emergency_sessions_merged_idx ON emergency_sessions (merged_into)
  WHERE merged_into IS NOT NULL;

-- ---------- Evaluaciones (reevaluación append-only) ----------
-- sequence_no es el orden en que la tableta las inició; el orden de atención lo
-- calcula el servidor. Dos tabletas sin conexión pueden repetirlo.
ALTER TABLE emergency_assessments
  DROP CONSTRAINT emergency_assessments_session_id_astronaut_id_key,
  DROP CONSTRAINT emergency_assessments_session_id_sequence_no_key;
ALTER TABLE emergency_assessments
  ADD COLUMN protocol_id      integer REFERENCES triage_protocols(id),
  ADD COLUMN reassessment_of  uuid REFERENCES emergency_assessments(id) ON DELETE RESTRICT,
  ADD COLUMN result           jsonb,      -- resultado de evaluateAssessment en el servidor
  ADD COLUMN device_result    jsonb,      -- lo que calculó el dispositivo (si lo mandó)
  ADD COLUMN matches_device   boolean,    -- null = el dispositivo no mandó resultado
  ADD COLUMN received_at      timestamptz NOT NULL DEFAULT now();
CREATE INDEX emergency_assessments_session_idx
  ON emergency_assessments (session_id, astronaut_id, started_at DESC);

-- ---------- Interruptor de hombre muerto (activación automática) ----------
CREATE TABLE emergency_deadman (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id         uuid NOT NULL REFERENCES emergency_sessions(id) ON DELETE CASCADE,
  astronaut_id       uuid NOT NULL REFERENCES astronauts(id) ON DELETE RESTRICT,
  trigger_type       emergency_trigger NOT NULL,
  source_reading_id  uuid REFERENCES readings(id) ON DELETE RESTRICT,
  deadline_at        timestamptz NOT NULL,
  confirmed_at       timestamptz,          -- respondió "estoy bien"
  confirmed_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  expired_at         timestamptz,          -- venció sin respuesta (= deadline_at)
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT emergency_deadman_once_uq UNIQUE (session_id, astronaut_id),
  CONSTRAINT emergency_deadman_outcome_ck CHECK (confirmed_at IS NULL OR expired_at IS NULL)
);
CREATE INDEX emergency_deadman_pending_idx ON emergency_deadman (deadline_at)
  WHERE confirmed_at IS NULL AND expired_at IS NULL;

-- ---------- Línea de tiempo ----------
-- Solo inserción, salvo deliver_at (lo recalculan los cortes de enlace).
CREATE TABLE emergency_events (
  id             bigserial PRIMARY KEY,
  session_id     uuid NOT NULL REFERENCES emergency_sessions(id) ON DELETE CASCADE,
  event_type     text NOT NULL CHECK (event_type IN (
                   'opened', 'joined', 'merged', 'deadman_started', 'deadman_confirmed',
                   'deadman_expired', 'activated', 'cancelled', 'assessment_started',
                   'assessment_completed', 'device_mismatch', 'heartbeat_lost',
                   'question_to_earth', 'closed')),
  clinical       boolean NOT NULL DEFAULT false,     -- admin no ve los detalles clínicos
  actor_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_device   text,
  astronaut_id   uuid REFERENCES astronauts(id) ON DELETE SET NULL,
  assessment_id  uuid REFERENCES emergency_assessments(id) ON DELETE SET NULL,
  client_uuid    uuid UNIQUE,                         -- idempotencia
  details        jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  device_at      timestamptz,                         -- hora del dispositivo, si la hay
  created_at     timestamptz NOT NULL DEFAULT now(),
  deliver_at     timestamptz,                         -- llegada a Tierra; NULL = en cola
  CONSTRAINT emergency_events_deliver_ck CHECK (deliver_at IS NULL OR deliver_at >= created_at)
);
CREATE INDEX emergency_events_session_idx ON emergency_events (session_id, id);

CREATE OR REPLACE FUNCTION emergency_events_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'emergency_events es append-only: DELETE no está permitido';
  END IF;
  IF (NEW.session_id, NEW.event_type, NEW.clinical, NEW.actor_user_id, NEW.astronaut_id,
      NEW.assessment_id, NEW.client_uuid, NEW.details, NEW.device_at, NEW.created_at)
     IS DISTINCT FROM
     (OLD.session_id, OLD.event_type, OLD.clinical, OLD.actor_user_id, OLD.astronaut_id,
      OLD.assessment_id, OLD.client_uuid, OLD.details, OLD.device_at, OLD.created_at) THEN
    RAISE EXCEPTION 'emergency_events es append-only: solo deliver_at puede cambiar';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER emergency_events_append_only BEFORE UPDATE OR DELETE ON emergency_events
  FOR EACH ROW EXECUTE FUNCTION emergency_events_guard();

-- ---------- Reporte al cerrar ----------
CREATE TABLE emergency_reports (
  session_id    uuid PRIMARY KEY REFERENCES emergency_sessions(id) ON DELETE CASCADE,
  report        jsonb NOT NULL CHECK (jsonb_typeof(report) = 'object'),
  generated_at  timestamptz NOT NULL DEFAULT now(),
  synthetic     boolean NOT NULL DEFAULT true
);

-- ---------- Preguntas a Tierra (idempotentes por client_uuid) ----------
ALTER TABLE escalation_messages ADD COLUMN client_uuid uuid UNIQUE;

-- ---------- Marcas del sistema ----------
CREATE TABLE system_markers (
  key         text PRIMARY KEY CHECK (key ~ '^[a-z_]+$'),
  at          timestamptz NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
