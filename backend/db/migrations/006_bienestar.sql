-- =====================================================================
-- 006_bienestar.sql
-- Módulo de bienestar (confidencial): check-ins, cuestionarios, PVT,
-- "Quiero hablar con alguien", intervenciones, privacidad y auditoría de
-- accesos. Además: función del equipo en Tierra, categoría y
-- confidencialidad de los escalamientos, y la vista v_readings_standard.
-- Contrato: tags Bienestar, Salud conductual y Auditoría de docs/openapi.yaml.
-- Peligro: Isolation and Confinement.
--
-- Quién ve qué: astronauta = lo suyo; behavioral_health = detalle;
-- flight_surgeon = estado y alertas escaladas; admin = cumplimiento y aptitud;
-- tripulación = nada. La API lo hace cumplir; aquí se marca qué es confidencial.
-- =====================================================================

-- ---------- Función de cada integrante del equipo en Tierra ----------
ALTER TABLE mission_ground_team ADD COLUMN function text;

-- Si no se indica la función, se deriva del rol. La función 'behavioral' es
-- exclusiva del rol behavioral_health (y viceversa). Astronautas y cuentas de
-- servicio no pueden ser parte del equipo en Tierra.
CREATE OR REPLACE FUNCTION check_ground_team_role() RETURNS trigger AS $$
DECLARE
  v_role user_role;
BEGIN
  SELECT role INTO v_role FROM users WHERE id = NEW.user_id;
  IF v_role IN ('astronaut', 'service') THEN
    RAISE EXCEPTION 'El usuario % (rol %) no puede ser parte del equipo en Tierra', NEW.user_id, v_role;
  END IF;
  IF NEW.function IS NULL THEN
    NEW.function := CASE v_role
      WHEN 'flight_surgeon' THEN 'medical'
      WHEN 'behavioral_health' THEN 'behavioral'
      ELSE 'operations'
    END;
  END IF;
  IF (NEW.function = 'behavioral') <> (v_role = 'behavioral_health') THEN
    RAISE EXCEPTION 'La función behavioral es solo para el rol behavioral_health (usuario %)', NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

UPDATE mission_ground_team g
SET function = CASE u.role
  WHEN 'flight_surgeon' THEN 'medical'
  WHEN 'behavioral_health' THEN 'behavioral'
  ELSE 'operations'
END
FROM users u
WHERE u.id = g.user_id;

ALTER TABLE mission_ground_team
  ALTER COLUMN function SET NOT NULL,
  ADD CONSTRAINT mission_ground_team_function_ck CHECK (function IN ('operations', 'medical', 'behavioral'));

-- ---------- Escalamientos: categoría y confidencialidad ----------
-- category se usa para enrutar y para la confidencialidad. La bandeja del
-- contrato (reading|emergency|wellbeing|manual) se traduce desde source_type.
ALTER TABLE escalations
  ADD COLUMN category text,
  ADD COLUMN is_confidential boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION fill_escalation_category() RETURNS trigger AS $$
BEGIN
  IF NEW.category IS NULL THEN
    NEW.category := CASE NEW.source_type
      WHEN 'wellbeing' THEN 'behavioral'
      WHEN 'emergency_assessment' THEN 'emergency'
      WHEN 'emergency_session' THEN 'emergency'
      ELSE 'physical'
    END;
  END IF;
  -- Lo que va a behavioral_health es siempre confidencial.
  IF NEW.level = 'behavioral_health' THEN
    NEW.is_confidential := true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER escalations_fill_category BEFORE INSERT OR UPDATE OF category, level, source_type ON escalations
  FOR EACH ROW EXECUTE FUNCTION fill_escalation_category();

UPDATE escalations SET category = NULL;   -- el trigger la calcula para las filas existentes

ALTER TABLE escalations
  ALTER COLUMN category SET NOT NULL,
  ADD CONSTRAINT escalations_category_ck CHECK (category IN ('physical', 'behavioral', 'emergency')),
  ADD CONSTRAINT escalations_confidential_ck CHECK (level <> 'behavioral_health' OR is_confidential),
  ADD CONSTRAINT escalations_confidential_category_ck CHECK (NOT is_confidential OR category = 'behavioral');

-- La bandeja de Tierra nunca muestra escalamientos confidenciales.
-- (Se recrea porque e.* cambió de columnas.)
DROP VIEW v_ground_inbox;
CREATE VIEW v_ground_inbox AS
SELECT e.*, m.code AS mission_code, a.call_sign,
       GREATEST(EXTRACT(EPOCH FROM (e.deliver_at - now())), 0)::int AS seconds_until_delivery
FROM escalations e
JOIN missions m ON m.id = e.mission_id
LEFT JOIN astronauts a ON a.id = e.astronaut_id
WHERE e.level = 'flight_surgeon'
  AND NOT e.is_confidential
  AND e.deliver_at <= now()
  AND e.status <> 'closed';

-- ---------- Cuestionarios versionados (PHQ-2, GAD-2) ----------
CREATE TABLE instruments (
  id              serial PRIMARY KEY,
  code            text NOT NULL CHECK (code ~ '^[A-Z0-9_]+$'),
  version         integer NOT NULL CHECK (version > 0),
  name            text NOT NULL,
  indicator_code  text NOT NULL REFERENCES indicators(code) ON UPDATE CASCADE,
  definition      jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'
                    AND definition ? 'prompt' AND definition ? 'items' AND definition ? 'options'),
  sources         jsonb NOT NULL CHECK (jsonb_typeof(sources) = 'array' AND jsonb_array_length(sources) > 0),
  license         text NOT NULL,
  is_active       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT instruments_version_uq UNIQUE (code, version)
);
CREATE UNIQUE INDEX instruments_one_active_uq ON instruments (code) WHERE is_active;

CREATE TABLE instrument_administrations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_uuid    uuid NOT NULL,
  astronaut_id   uuid NOT NULL REFERENCES astronauts(id) ON DELETE RESTRICT,
  instrument_id  integer NOT NULL REFERENCES instruments(id) ON DELETE RESTRICT,
  answers        jsonb NOT NULL CHECK (jsonb_typeof(answers) = 'object'),   -- { "item_1": 0..3, ... }
  score          integer NOT NULL CHECK (score >= 0),                       -- solo lo ve behavioral_health
  measured_at    timestamptz NOT NULL,
  received_at    timestamptz NOT NULL DEFAULT now(),
  synthetic      boolean NOT NULL DEFAULT true,
  CONSTRAINT instrument_admin_author_uq UNIQUE (astronaut_id, client_uuid)
);
CREATE INDEX instrument_admin_astronaut_idx ON instrument_administrations (astronaut_id, measured_at DESC);

-- ---------- Check-in diario (agrupa las lecturas WB_* y SLEEP_HOURS) ----------
CREATE TABLE wellbeing_checkins (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_uuid   uuid NOT NULL,
  astronaut_id  uuid NOT NULL REFERENCES astronauts(id) ON DELETE RESTRICT,
  measured_at   timestamptz NOT NULL,
  received_at   timestamptz NOT NULL DEFAULT now(),
  sleep_hours   numeric(4,2) CHECK (sleep_hours BETWEEN 0 AND 24),
  private_note  text CHECK (length(private_note) <= 1000),   -- solo la ve el astronauta
  synthetic     boolean NOT NULL DEFAULT true,
  CONSTRAINT wellbeing_checkins_author_uq UNIQUE (astronaut_id, client_uuid)
);
CREATE INDEX wellbeing_checkins_astronaut_idx ON wellbeing_checkins (astronaut_id, measured_at DESC);

-- ---------- Prueba de reacción (agrupa las lecturas PVT_*) ----------
-- La línea base es por dispositivo: device_id es el identificador de la tableta.
CREATE TABLE pvt_runs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_uuid           uuid NOT NULL,
  astronaut_id          uuid NOT NULL REFERENCES astronauts(id) ON DELETE RESTRICT,
  device_id             text NOT NULL,
  before_critical_task  boolean NOT NULL DEFAULT false,
  duration_s            integer CHECK (duration_s > 0),
  trials                integer CHECK (trials > 0),
  fitness               text NOT NULL CHECK (fitness IN ('fit', 'not_confirmed')),   -- lo único que llega a admin
  measured_at           timestamptz NOT NULL,
  received_at           timestamptz NOT NULL DEFAULT now(),
  synthetic             boolean NOT NULL DEFAULT true,
  CONSTRAINT pvt_runs_author_uq UNIQUE (astronaut_id, client_uuid)
);
CREATE INDEX pvt_runs_baseline_idx ON pvt_runs (astronaut_id, device_id, measured_at DESC);

-- Cada lectura pertenece como máximo a un grupo (check-in, PVT o cuestionario).
ALTER TABLE readings
  ADD COLUMN wellbeing_checkin_id uuid REFERENCES wellbeing_checkins(id) ON DELETE RESTRICT,
  ADD COLUMN pvt_run_id uuid REFERENCES pvt_runs(id) ON DELETE RESTRICT,
  ADD COLUMN instrument_administration_id uuid REFERENCES instrument_administrations(id) ON DELETE RESTRICT,
  ADD CONSTRAINT readings_one_group_ck
    CHECK (num_nonnulls(wellbeing_checkin_id, pvt_run_id, instrument_administration_id) <= 1);
CREATE INDEX readings_checkin_idx ON readings (wellbeing_checkin_id) WHERE wellbeing_checkin_id IS NOT NULL;
CREATE INDEX readings_pvt_idx ON readings (pvt_run_id) WHERE pvt_run_id IS NOT NULL;
CREATE INDEX readings_instrument_idx ON readings (instrument_administration_id)
  WHERE instrument_administration_id IS NOT NULL;

-- ---------- "Quiero hablar con alguien" ----------
-- Solo para behavioral_health: nunca llega a la tripulación ni a admin.
CREATE TABLE support_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_uuid      uuid NOT NULL,
  astronaut_id     uuid NOT NULL REFERENCES astronauts(id) ON DELETE RESTRICT,
  mission_id       uuid NOT NULL REFERENCES missions(id) ON DELETE RESTRICT,
  urgency          text NOT NULL CHECK (urgency IN ('later', 'today', 'now')),
  channel          text NOT NULL CHECK (channel IN ('message', 'session')),
  content          text NOT NULL CHECK (length(content) BETWEEN 1 AND 2000),
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'closed')),
  created_at       timestamptz NOT NULL,                  -- hora del dispositivo
  received_at      timestamptz NOT NULL DEFAULT now(),
  deliver_at       timestamptz,                           -- llegada a Tierra; NULL = en cola esperando enlace
  acknowledged_at  timestamptz,
  acknowledged_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  closed_at        timestamptz,
  synthetic        boolean NOT NULL DEFAULT true,
  CONSTRAINT support_requests_author_uq UNIQUE (astronaut_id, client_uuid),
  CONSTRAINT support_requests_deliver_ck CHECK (deliver_at IS NULL OR deliver_at >= received_at),
  CONSTRAINT support_requests_ack_ck CHECK (acknowledged_by IS NULL OR acknowledged_at IS NOT NULL),
  CONSTRAINT support_requests_closed_ck CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);
CREATE INDEX support_requests_inbox_idx ON support_requests (mission_id, deliver_at) WHERE status <> 'closed';

CREATE TABLE support_messages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_uuid  uuid UNIQUE,                               -- mensajes del astronauta enviados offline
  request_id   uuid NOT NULL REFERENCES support_requests(id) ON DELETE CASCADE,
  direction    message_direction NOT NULL,
  author_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  author_role  text NOT NULL CHECK (author_role IN ('astronaut', 'behavioral_health')),
  body         text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at   timestamptz NOT NULL DEFAULT now(),
  deliver_at   timestamptz,                               -- NULL = en cola esperando enlace
  CONSTRAINT support_messages_deliver_ck CHECK (deliver_at IS NULL OR deliver_at >= created_at),
  CONSTRAINT support_messages_direction_ck CHECK ((direction = 'to_earth') = (author_role = 'astronaut'))
);
CREATE INDEX support_messages_thread_idx ON support_messages (request_id, created_at);

-- ---------- Intervenciones de behavioral_health ----------
CREATE TABLE interventions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  astronaut_id        uuid NOT NULL REFERENCES astronauts(id) ON DELETE RESTRICT,
  created_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  kind                text NOT NULL CHECK (kind IN ('message', 'session', 'recommendation', 'referral')),
  support_request_id  uuid REFERENCES support_requests(id) ON DELETE SET NULL,
  escalation_id       uuid REFERENCES escalations(id) ON DELETE SET NULL,
  notes               text CHECK (length(notes) <= 4000),
  scheduled_at        timestamptz,
  completed_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  synthetic           boolean NOT NULL DEFAULT true
);
CREATE INDEX interventions_astronaut_idx ON interventions (astronaut_id, created_at DESC);

-- ---------- Preferencias de privacidad ----------
-- Sin fila = valores por defecto (no compartir nada con el CMO).
CREATE TABLE privacy_preferences (
  astronaut_id    uuid PRIMARY KEY REFERENCES astronauts(id) ON DELETE CASCADE,
  share_with_cmo  boolean NOT NULL DEFAULT false,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid REFERENCES users(id) ON DELETE SET NULL
);
CREATE TRIGGER privacy_preferences_updated_at BEFORE UPDATE ON privacy_preferences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- Auditoría de accesos a datos confidenciales (append-only) ----------
-- Sin el contenido: quién, de quién, qué recurso y cuándo.
CREATE TABLE confidential_access_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id   uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  actor_username  text NOT NULL,
  actor_role      user_role NOT NULL,
  astronaut_id    uuid NOT NULL REFERENCES astronauts(id) ON DELETE RESTRICT,
  resource        text NOT NULL,                          -- método y ruta consultados
  action          text NOT NULL DEFAULT 'read' CHECK (action IN ('read', 'export')),
  accessed_at     timestamptz NOT NULL DEFAULT now(),
  ip              inet
);
CREATE INDEX confidential_access_astronaut_idx ON confidential_access_log (astronaut_id, accessed_at DESC);
CREATE INDEX confidential_access_actor_idx ON confidential_access_log (actor_user_id, accessed_at DESC);
CREATE TRIGGER confidential_access_append_only BEFORE UPDATE OR DELETE ON confidential_access_log
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

-- ---------- Lecturas no confidenciales ----------
-- El dashboard y las consultas del panel usan ESTA vista, nunca readings directo:
-- así los indicadores confidenciales (bienestar) no pueden filtrarse por error.
CREATE VIEW v_readings_standard AS
SELECT r.*, i.name AS indicator_name, i.unit, i.body_zone
FROM readings r
JOIN indicators i ON i.code = r.indicator_code
WHERE i.sensitivity = 'standard';
