-- =====================================================================
-- 001_identidad_misiones.sql
-- Identidad, roles, misiones, entornos y asignación de tripulación.
-- Peligros: Distance from Earth (autonomía, equipo en Tierra) y
--           Isolation and Confinement (tripulación como unidad).
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS btree_gist; -- EXCLUDE con uuid + rangos

-- ---------- Tipos ----------
CREATE TYPE user_role AS ENUM ('admin', 'flight_surgeon', 'astronaut');

CREATE TYPE crew_role AS ENUM (
  'commander', 'pilot', 'crew_medical_officer',
  'flight_engineer', 'mission_specialist'
);

CREATE TYPE mission_status AS ENUM ('planned', 'active', 'completed', 'aborted');

CREATE TYPE environment_type AS ENUM (
  'spacecraft', 'space_station', 'rover', 'lunar_base', 'mars_base'
);

-- ---------- Función genérica para updated_at ----------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------- Usuarios (credenciales + rol global) ----------
CREATE TABLE users (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username              text        NOT NULL,
  email                 text,
  full_name             text        NOT NULL,
  password_hash         text        NOT NULL,          -- bcrypt, nunca texto plano
  role                  user_role   NOT NULL,
  must_change_password  boolean     NOT NULL DEFAULT true,
  is_active             boolean     NOT NULL DEFAULT true,
  failed_login_attempts smallint    NOT NULL DEFAULT 0 CHECK (failed_login_attempts >= 0),
  locked_until          timestamptz,
  last_login_at         timestamptz,
  password_changed_at   timestamptz,
  created_by            uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_username_format CHECK (username ~ '^[a-z0-9._-]{3,40}$'),
  CONSTRAINT users_password_hash_bcrypt CHECK (password_hash ~ '^\$2[aby]\$\d{2}\$.{53}$')
);
CREATE UNIQUE INDEX users_username_uq ON users (lower(username));
CREATE UNIQUE INDEX users_email_uq    ON users (lower(email)) WHERE email IS NOT NULL;
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- Perfil de astronauta (1:1 con users de rol astronaut) ----------
CREATE TABLE astronauts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  call_sign   text NOT NULL,
  agency      text,
  synthetic   boolean NOT NULL DEFAULT true,  -- todo dato de demo es sintético
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX astronauts_call_sign_uq ON astronauts (lower(call_sign));
CREATE TRIGGER astronauts_updated_at BEFORE UPDATE ON astronauts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Garantiza que solo usuarios con rol 'astronaut' tengan perfil de astronauta.
CREATE OR REPLACE FUNCTION check_astronaut_role() RETURNS trigger AS $$
BEGIN
  IF (SELECT role FROM users WHERE id = NEW.user_id) <> 'astronaut' THEN
    RAISE EXCEPTION 'El usuario % no tiene rol astronaut', NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER astronauts_role_check BEFORE INSERT OR UPDATE OF user_id ON astronauts
  FOR EACH ROW EXECUTE FUNCTION check_astronaut_role();

-- ---------- Entornos (catálogo configurable desde el panel) ----------
CREATE TABLE environments (
  code                text PRIMARY KEY,
  name                text NOT NULL,
  type                environment_type NOT NULL,
  gravity_g           numeric(4,2) NOT NULL CHECK (gravity_g BETWEEN 0 AND 1.5),
  comm_delay_seconds  integer NOT NULL DEFAULT 0 CHECK (comm_delay_seconds >= 0), -- retraso en un sentido
  description         text,
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER environments_updated_at BEFORE UPDATE ON environments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- Misiones ----------
CREATE TABLE missions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code              text NOT NULL UNIQUE,
  name              text NOT NULL,
  environment_code  text NOT NULL REFERENCES environments(code) ON UPDATE CASCADE,
  status            mission_status NOT NULL DEFAULT 'planned',
  starts_at         timestamptz NOT NULL,
  ends_at           timestamptz,
  created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT missions_dates_ck CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX missions_status_idx ON missions (status);
CREATE TRIGGER missions_updated_at BEFORE UPDATE ON missions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- Asignación de tripulación (historial en el tiempo) ----------
-- Un astronauta puede estar en varias misiones a lo largo del tiempo,
-- pero nunca en dos asignaciones que se solapen.
CREATE TABLE crew_assignments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id     uuid NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  astronaut_id   uuid NOT NULL REFERENCES astronauts(id) ON DELETE RESTRICT,
  crew_role      crew_role NOT NULL DEFAULT 'mission_specialist',
  assigned_from  timestamptz NOT NULL DEFAULT now(),
  assigned_to    timestamptz,                       -- NULL = asignación vigente
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crew_assignments_dates_ck CHECK (assigned_to IS NULL OR assigned_to > assigned_from),
  CONSTRAINT crew_assignments_no_overlap EXCLUDE USING gist (
    astronaut_id WITH =,
    tstzrange(assigned_from, COALESCE(assigned_to, 'infinity'::timestamptz), '[)') WITH &&
  )
);
CREATE INDEX crew_assignments_mission_idx ON crew_assignments (mission_id) WHERE assigned_to IS NULL;
-- Un solo comandante y un solo oficial médico vigentes por misión.
CREATE UNIQUE INDEX crew_one_commander_uq ON crew_assignments (mission_id)
  WHERE crew_role = 'commander' AND assigned_to IS NULL;
CREATE UNIQUE INDEX crew_one_cmo_uq ON crew_assignments (mission_id)
  WHERE crew_role = 'crew_medical_officer' AND assigned_to IS NULL;

-- ---------- Equipo en Tierra por misión (flight surgeons / admins) ----------
CREATE TABLE mission_ground_team (
  mission_id  uuid NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mission_id, user_id)
);

CREATE OR REPLACE FUNCTION check_ground_team_role() RETURNS trigger AS $$
BEGIN
  IF (SELECT role FROM users WHERE id = NEW.user_id) = 'astronaut' THEN
    RAISE EXCEPTION 'Un astronauta no puede ser parte del equipo en Tierra';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER ground_team_role_check BEFORE INSERT OR UPDATE ON mission_ground_team
  FOR EACH ROW EXECUTE FUNCTION check_ground_team_role();

-- ---------- Refresh tokens (rotación + revocación por dispositivo) ----------
CREATE TABLE refresh_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,              -- SHA-256 del token, nunca el token
  device_id    text NOT NULL,
  issued_at    timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  replaced_by  uuid REFERENCES refresh_tokens(id) ON DELETE SET NULL,
  CONSTRAINT refresh_tokens_exp_ck CHECK (expires_at > issued_at)
);
CREATE INDEX refresh_tokens_user_active_idx ON refresh_tokens (user_id) WHERE revoked_at IS NULL;

-- ---------- Bitácora de autenticación ----------
CREATE TABLE auth_events (
  id          bigserial PRIMARY KEY,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  username    text,
  event       text NOT NULL CHECK (event IN (
                'login_success', 'login_failed', 'account_locked', 'password_changed',
                'password_reset', 'token_refreshed', 'token_reuse_detected', 'logout')),
  device_id   text,
  ip          inet,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_events_user_idx ON auth_events (user_id, created_at DESC);

-- ---------- Vista: tripulación vigente con su misión ----------
CREATE VIEW v_current_crew AS
SELECT ca.id AS assignment_id, m.id AS mission_id, m.code AS mission_code, m.status AS mission_status,
       e.code AS environment_code, e.gravity_g, e.comm_delay_seconds,
       a.id AS astronaut_id, a.call_sign, u.id AS user_id, u.full_name, ca.crew_role, ca.assigned_from
FROM crew_assignments ca
JOIN missions m     ON m.id = ca.mission_id
JOIN environments e ON e.code = m.environment_code
JOIN astronauts a   ON a.id = ca.astronaut_id
JOIN users u        ON u.id = a.user_id
WHERE ca.assigned_to IS NULL;
