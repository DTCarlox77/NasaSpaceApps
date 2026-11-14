-- =====================================================================
-- 005_salud.sql
-- Catálogo de indicadores y reglas versionadas, lecturas append-only con su
-- evaluación, adjuntos (foto del dispositivo de medición), sincronización
-- offline y tablas de los extras (rutinas, recordatorios y gamificación).
-- Contrato: docs/openapi.yaml (tags Salud, Hábitat y Sync).
-- Peligros: los cinco RIDGE (cada indicador declara los suyos).
-- =====================================================================

-- ---------- Función genérica: tablas append-only ----------
CREATE OR REPLACE FUNCTION forbid_update_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'La tabla % es append-only: % no está permitido', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

-- ---------- Catálogos compartidos (seed: 002_catalogo_indicadores.sql) ----------
CREATE TABLE hazards (
  code  text PRIMARY KEY CHECK (code ~ '^[a-z_]+$'),
  name  text NOT NULL
);

CREATE TABLE body_zones (
  code  text PRIMARY KEY CHECK (code ~ '^[a-z_]+$'),
  name  text NOT NULL
);

CREATE TABLE symptoms (
  code       text PRIMARY KEY CHECK (code ~ '^[a-z_]+$'),
  label      text NOT NULL,
  body_zone  text NOT NULL REFERENCES body_zones(code) ON UPDATE CASCADE,
  red_flag   boolean NOT NULL DEFAULT false        -- señal de alarma
);

-- ---------- Indicadores ----------
CREATE TABLE indicators (
  code            text PRIMARY KEY CHECK (code ~ '^[A-Z0-9_]+$'),
  name            text NOT NULL,
  unit            text NOT NULL,
  value_type      text NOT NULL CHECK (value_type IN ('simple', 'composite', 'boolean', 'scale', 'catalog')),
  sensitivity     text NOT NULL CHECK (sensitivity IN ('standard', 'confidential')),
  body_zone       text NOT NULL REFERENCES body_zones(code) ON UPDATE CASCADE,
  hazards         text[] NOT NULL CHECK (cardinality(hazards) > 0),   -- validado contra hazards (trigger)
  input_methods   text[] NOT NULL DEFAULT '{}' CHECK (input_methods <@ ARRAY[
                    'manual', 'camera', 'wearable', 'sensor', 'slider', 'questionnaire', 'minigame', 'clicks']::text[]),
  direction       text CHECK (direction IN ('high', 'low')),           -- dirección "mejor" en escalas de bienestar
  components      jsonb NOT NULL CHECK (jsonb_typeof(components) = 'array'),
  derived_fields  jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(derived_fields) = 'array'),
  guide           jsonb NOT NULL CHECK (jsonb_typeof(guide) = 'object'),        -- las 5 preguntas del reto
  sources         jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(sources) = 'array'),
  notes           jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(notes) = 'array'),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX indicators_body_zone_idx ON indicators (body_zone);
CREATE TRIGGER indicators_updated_at BEFORE UPDATE ON indicators
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Un arreglo no admite FK: este trigger valida cada peligro contra hazards.
CREATE OR REPLACE FUNCTION check_indicator_hazards() RETURNS trigger AS $$
DECLARE
  v_missing text;
BEGIN
  SELECT h INTO v_missing
  FROM unnest(NEW.hazards) AS h
  WHERE NOT EXISTS (SELECT 1 FROM hazards hz WHERE hz.code = h)
  LIMIT 1;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Peligro desconocido en el indicador %: %', NEW.code, v_missing;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER indicators_hazards_check BEFORE INSERT OR UPDATE OF hazards ON indicators
  FOR EACH ROW EXECUTE FUNCTION check_indicator_hazards();

-- ---------- Reglas versionadas (GET /rules, PUT /admin/indicators/{code}/rules) ----------
-- Cada cambio crea una versión nueva; la fila es la auditoría del cambio
-- (su id es el audit_id del contrato). Una sola versión activa por indicador.
CREATE TABLE indicator_rule_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  indicator_code  text NOT NULL REFERENCES indicators(code) ON UPDATE CASCADE ON DELETE CASCADE,
  version         integer NOT NULL CHECK (version > 0),
  rules           jsonb NOT NULL CHECK (jsonb_typeof(rules) = 'array' AND jsonb_array_length(rules) > 0),
  is_active       boolean NOT NULL DEFAULT false,
  change_reason   text,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT indicator_rules_version_uq UNIQUE (indicator_code, version),
  -- La última regla es la regla por defecto: { "all": [] } (siempre verdadera).
  CONSTRAINT indicator_rules_default_last_ck CHECK (rules -> -1 -> 'when' = '{"all": []}'::jsonb)
);
CREATE UNIQUE INDEX indicator_rules_one_active_uq ON indicator_rule_versions (indicator_code)
  WHERE is_active;

-- ---------- Adjuntos: foto del dispositivo de medición ----------
-- El archivo se guarda en la base (bytea, máx. 5 MB): en Render/Railway el
-- disco se borra en cada deploy. Selecciona `data` solo para descargarlo.
CREATE TABLE attachments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_uuid     uuid NOT NULL,
  uploaded_by     uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  kind            text NOT NULL DEFAULT 'measurement_photo' CHECK (kind IN ('measurement_photo')),
  indicator_code  text REFERENCES indicators(code) ON UPDATE CASCADE,
  content_type    text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png')),
  size_bytes      integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
  sha256          text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  data            bytea NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  synthetic       boolean NOT NULL DEFAULT true,
  CONSTRAINT attachments_author_uq UNIQUE (uploaded_by, client_uuid),
  CONSTRAINT attachments_size_ck CHECK (octet_length(data) = size_bytes),
  CONSTRAINT attachments_sha256_ck CHECK (encode(sha256(data), 'hex') = sha256)
);

-- ---------- Lecturas (append-only) ----------
-- Una lectura es de un astronauta O de un módulo del hábitat (nunca ambos).
-- Nunca se edita ni se borra: una corrección es una lectura nueva con
-- supersedes_uuid = client_uuid de la anterior (del mismo autor).
-- `components` = `values` del contrato; `source` = `input_method` del contrato
-- (o `source` de /habitat/readings: sensor | simulator | manual).
CREATE TABLE readings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_uuid      uuid NOT NULL,
  recorded_by      uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,   -- autor (astronauta o cuenta de servicio)
  mission_id       uuid NOT NULL REFERENCES missions(id) ON DELETE RESTRICT,
  astronaut_id     uuid REFERENCES astronauts(id) ON DELETE RESTRICT,
  module_id        text,
  indicator_code   text NOT NULL REFERENCES indicators(code) ON UPDATE CASCADE,
  components       jsonb NOT NULL CHECK (jsonb_typeof(components) = 'object'),
  source           text NOT NULL CHECK (source IN (
                     'manual', 'camera', 'wearable', 'sensor', 'simulator',
                     'slider', 'questionnaire', 'minigame', 'clicks')),
  device_id        text,
  attachment_id    uuid REFERENCES attachments(id) ON DELETE RESTRICT,
  note             text CHECK (length(note) <= 500),
  supersedes_uuid  uuid,
  measured_at      timestamptz NOT NULL,                  -- hora del dispositivo
  received_at      timestamptz NOT NULL DEFAULT now(),    -- hora del servidor
  synthetic        boolean NOT NULL DEFAULT true,
  CONSTRAINT readings_subject_ck CHECK ((astronaut_id IS NULL) <> (module_id IS NULL)),
  CONSTRAINT readings_not_self_ck CHECK (supersedes_uuid IS NULL OR supersedes_uuid <> client_uuid),
  CONSTRAINT readings_author_uq UNIQUE (recorded_by, client_uuid),     -- idempotencia por autor
  CONSTRAINT readings_id_indicator_uq UNIQUE (id, indicator_code),     -- para la FK de reading_evaluations
  CONSTRAINT readings_supersedes_fk FOREIGN KEY (recorded_by, supersedes_uuid)
    REFERENCES readings (recorded_by, client_uuid)
);
-- Una lectura solo se puede corregir una vez (una segunda corrección → 409).
CREATE UNIQUE INDEX readings_supersedes_once_uq ON readings (recorded_by, supersedes_uuid)
  WHERE supersedes_uuid IS NOT NULL;
CREATE INDEX readings_astronaut_idx ON readings (astronaut_id, indicator_code, measured_at DESC)
  WHERE astronaut_id IS NOT NULL;
CREATE INDEX readings_module_idx ON readings (mission_id, module_id, indicator_code, measured_at DESC)
  WHERE module_id IS NOT NULL;
CREATE TRIGGER readings_append_only BEFORE UPDATE OR DELETE ON readings
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

-- Las lecturas de módulo son solo de indicadores del entorno (zona 'environment').
CREATE OR REPLACE FUNCTION check_reading_subject() RETURNS trigger AS $$
DECLARE
  v_zone text;
BEGIN
  SELECT body_zone INTO v_zone FROM indicators WHERE code = NEW.indicator_code;
  IF (NEW.module_id IS NOT NULL) <> (v_zone = 'environment') THEN
    RAISE EXCEPTION 'El indicador % no corresponde a una lectura de %', NEW.indicator_code,
      CASE WHEN NEW.module_id IS NOT NULL THEN 'módulo' ELSE 'astronauta' END;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER readings_subject_check BEFORE INSERT ON readings
  FOR EACH ROW EXECUTE FUNCTION check_reading_subject();

-- ---------- Evaluación de cada lectura (forma de evaluateIndicator) ----------
CREATE TABLE reading_evaluations (
  reading_id      uuid PRIMARY KEY,
  indicator_code  text NOT NULL,
  level           text NOT NULL CHECK (level IN ('normal', 'caution', 'critical', 'unrated')),
  rule_index      integer NOT NULL CHECK (rule_index >= -1),
  rules_version   integer,
  recommendation  text,
  escalation      escalation_level NOT NULL,
  basis           text CHECK (basis IN ('source', 'source_adapted', 'design_rule', 'pending_source')),
  source_ids      text[] NOT NULL DEFAULT '{}',
  derived         jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(derived) = 'object'),  -- campos derivados usados
  escalation_id   uuid REFERENCES escalations(id) ON DELETE SET NULL,
  computed_by     text NOT NULL DEFAULT 'server' CHECK (computed_by IN ('server', 'device')),
  evaluated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reading_eval_reading_fk FOREIGN KEY (reading_id, indicator_code)
    REFERENCES readings (id, indicator_code) ON DELETE CASCADE,
  CONSTRAINT reading_eval_rules_fk FOREIGN KEY (indicator_code, rules_version)
    REFERENCES indicator_rule_versions (indicator_code, version),
  -- rule_index -1 = ninguna regla aplicó → unrated
  CONSTRAINT reading_eval_unrated_ck CHECK (rule_index <> -1 OR level = 'unrated')
);
CREATE INDEX reading_evaluations_level_idx ON reading_evaluations (indicator_code, level);

-- ---------- Prellenado del triaje desde una lectura ----------
ALTER TABLE emergency_answers ADD CONSTRAINT emergency_answers_source_reading_fk
  FOREIGN KEY (source_reading_id) REFERENCES readings(id) ON DELETE SET NULL;

-- ---------- Sincronización offline (POST /sync/push) ----------
CREATE TABLE sync_batches (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  device_id    text NOT NULL,
  sent_at      timestamptz NOT NULL,                 -- hora del dispositivo
  received_at  timestamptz NOT NULL DEFAULT now(),
  item_count   integer NOT NULL CHECK (item_count BETWEEN 1 AND 500)
);
CREATE INDEX sync_batches_user_idx ON sync_batches (user_id, received_at DESC);

CREATE TABLE sync_items (
  id               bigserial PRIMARY KEY,
  batch_id         uuid NOT NULL REFERENCES sync_batches(id) ON DELETE CASCADE,
  client_uuid      uuid NOT NULL,
  entity           text NOT NULL CHECK (entity IN (
                     'reading', 'habitat_reading', 'emergency_session', 'emergency_assessment',
                     'emergency_answer', 'emergency_heartbeat', 'wellbeing_checkin',
                     'wellbeing_screening', 'pvt_run', 'support_request')),
  priority         text NOT NULL CHECK (priority IN ('emergency', 'normal')),
  created_at       timestamptz NOT NULL,             -- hora del dispositivo
  status           text NOT NULL CHECK (status IN ('accepted', 'duplicate', 'conflict', 'rejected')),
  server_id        uuid,                             -- registro creado o existente
  error_code       text,
  conflict_detail  jsonb,
  processed_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sync_items_batch_uq UNIQUE (batch_id, client_uuid),
  CONSTRAINT sync_items_error_ck CHECK ((status IN ('conflict', 'rejected')) = (error_code IS NOT NULL))
);
CREATE INDEX sync_items_client_idx ON sync_items (client_uuid);

-- ---------- Extras (x-status: extra). Solo las tablas; se llenan después ----------
CREATE TABLE routines (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  astronaut_id     uuid NOT NULL REFERENCES astronauts(id) ON DELETE CASCADE,
  code             text NOT NULL,
  title            text NOT NULL,
  indicator_codes  text[] NOT NULL DEFAULT '{}',
  schedule         text NOT NULL,                    -- legible, p. ej. "Diario 07:00 UTC"
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  synthetic        boolean NOT NULL DEFAULT true,
  CONSTRAINT routines_code_uq UNIQUE (astronaut_id, code)
);
CREATE TRIGGER routines_updated_at BEFORE UPDATE ON routines
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE reminders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  astronaut_id    uuid NOT NULL REFERENCES astronauts(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('checkin', 'pvt', 'reading', 'routine')),
  title           text NOT NULL,
  due_at          timestamptz NOT NULL,
  indicator_code  text REFERENCES indicators(code) ON UPDATE CASCADE,
  routine_id      uuid REFERENCES routines(id) ON DELETE SET NULL,
  delivered_at    timestamptz,                       -- llegó a la app por /sync/pull
  done_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  synthetic       boolean NOT NULL DEFAULT true
);
CREATE INDEX reminders_due_idx ON reminders (astronaut_id, due_at) WHERE done_at IS NULL;

-- Gamificación: la racha premia completar el check-in, nunca el resultado.
CREATE TABLE points_ledger (
  id            bigserial PRIMARY KEY,
  astronaut_id  uuid NOT NULL REFERENCES astronauts(id) ON DELETE CASCADE,
  points        integer NOT NULL CHECK (points <> 0),
  reason        text NOT NULL,
  source_type   text,
  source_id     uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  synthetic     boolean NOT NULL DEFAULT true
);
CREATE INDEX points_ledger_astronaut_idx ON points_ledger (astronaut_id, created_at DESC);

CREATE TABLE streaks (
  astronaut_id       uuid NOT NULL REFERENCES astronauts(id) ON DELETE CASCADE,
  kind               text NOT NULL CHECK (kind IN ('checkin')),
  current_days       integer NOT NULL DEFAULT 0 CHECK (current_days >= 0),
  best_days          integer NOT NULL DEFAULT 0,
  last_completed_at  timestamptz,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (astronaut_id, kind),
  CONSTRAINT streaks_best_ck CHECK (best_days >= current_days)
);
CREATE TRIGGER streaks_updated_at BEFORE UPDATE ON streaks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE achievements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  astronaut_id  uuid NOT NULL REFERENCES astronauts(id) ON DELETE CASCADE,
  code          text NOT NULL,
  title         text NOT NULL,
  earned_at     timestamptz NOT NULL DEFAULT now(),
  synthetic     boolean NOT NULL DEFAULT true,
  CONSTRAINT achievements_code_uq UNIQUE (astronaut_id, code)
);
