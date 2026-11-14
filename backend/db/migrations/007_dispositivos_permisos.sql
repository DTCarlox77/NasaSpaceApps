-- =====================================================================
-- 007_dispositivos_permisos.sql
-- Tabletas registradas por misión, PIN de desbloqueo offline, cuentas de
-- servicio (sensores del hábitat), acciones delegadas del comandante y
-- tipos nuevos de la bitácora de autenticación.
-- Contrato: tags Admin-Cuentas y Auditoría de docs/openapi.yaml.
-- Peligro: Distance from Earth (autonomía cuando Tierra no responde a tiempo).
-- =====================================================================

-- ---------- Tabletas registradas ----------
-- La credencial se muestra una sola vez; solo se guarda su SHA-256 (es un
-- valor aleatorio de alta entropía, no una contraseña). Va en X-Device-Credential
-- y solo sirve para los endpoints de emergencia.
CREATE TABLE devices (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label            text NOT NULL CHECK (length(label) BETWEEN 1 AND 40),
  kind             text NOT NULL DEFAULT 'tablet' CHECK (kind IN ('tablet')),
  mission_id       uuid NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  module_id        text,
  credential_hash  text NOT NULL UNIQUE CHECK (credential_hash ~ '^[0-9a-f]{64}$'),
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  registered_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  registered_via   text NOT NULL CHECK (registered_via IN ('admin', 'commander')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz,
  revoked_at       timestamptz,
  synthetic        boolean NOT NULL DEFAULT true,
  CONSTRAINT devices_revoked_ck CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);
CREATE UNIQUE INDEX devices_label_uq ON devices (mission_id, lower(label));

-- Sesión de emergencia abierta desde una tableta sin sesión de usuario.
ALTER TABLE emergency_sessions
  ADD COLUMN device_id uuid REFERENCES devices(id) ON DELETE SET NULL;

-- ---------- PIN de desbloqueo offline (PUT /me/offline-pin) ----------
-- Por usuario y dispositivo (device_id es el mismo texto que en refresh_tokens).
-- Un reset del comandante borra el PIN (pin_hash NULL) y el tripulante define
-- uno nuevo en su próximo login en línea.
CREATE TABLE offline_pins (
  user_id               uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id             text NOT NULL,
  pin_hash              text CHECK (pin_hash ~ '^\$2[aby]\$\d{2}\$.{53}$'),   -- bcrypt
  offline_unlock_until  timestamptz,
  failed_attempts       smallint NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  reset_at              timestamptz,
  reset_by              uuid REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, device_id),
  CONSTRAINT offline_pins_unlock_ck CHECK ((pin_hash IS NULL) = (offline_unlock_until IS NULL)),
  CONSTRAINT offline_pins_reset_ck CHECK (reset_by IS NULL OR reset_at IS NOT NULL)
);
CREATE TRIGGER offline_pins_updated_at BEFORE UPDATE ON offline_pins
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- Cuentas de servicio (rol service) ----------
-- Vinculan la cuenta de los sensores con su misión: el body de
-- POST /habitat/readings no trae la misión. El rol service solo puede
-- registrar lecturas del hábitat (lo hace cumplir la API).
CREATE TABLE service_accounts (
  user_id      uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  mission_id   uuid NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  description  text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION check_service_account_role() RETURNS trigger AS $$
BEGIN
  IF (SELECT role FROM users WHERE id = NEW.user_id) <> 'service' THEN
    RAISE EXCEPTION 'El usuario % no tiene rol service', NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER service_accounts_role_check BEFORE INSERT OR UPDATE OF user_id ON service_accounts
  FOR EACH ROW EXECUTE FUNCTION check_service_account_role();

-- ---------- Acciones delegadas del comandante (append-only) ----------
-- Auditadas y reportadas a Tierra: reported_to_ground_at es el deliver_at
-- (compute_deliver_at); NULL = en cola esperando enlace.
CREATE TABLE delegated_actions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id             uuid NOT NULL REFERENCES missions(id) ON DELETE RESTRICT,
  actor_user_id          uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  crew_role              crew_role NOT NULL CHECK (crew_role = 'commander'),
  action                 text NOT NULL CHECK (action IN ('unlock_user', 'reset_offline_pin', 'register_device')),
  target_type            text NOT NULL CHECK (target_type IN ('user', 'device')),
  target_id              uuid NOT NULL,
  details                jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  performed_at           timestamptz NOT NULL,              -- hora del dispositivo
  received_at            timestamptz NOT NULL DEFAULT now(),
  reported_to_ground_at  timestamptz,
  CONSTRAINT delegated_actions_target_ck CHECK ((action = 'register_device') = (target_type = 'device'))
);
CREATE INDEX delegated_actions_mission_idx ON delegated_actions (mission_id, performed_at DESC);
CREATE TRIGGER delegated_actions_append_only BEFORE UPDATE OR DELETE ON delegated_actions
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

-- ---------- Bitácora de autenticación: tipos nuevos ----------
-- 'account_locked' ya cubre el bloqueo (lockout) y 'token_reuse_detected' ya existía.
ALTER TABLE auth_events DROP CONSTRAINT auth_events_event_check;
ALTER TABLE auth_events ADD CONSTRAINT auth_events_event_check CHECK (event IN (
  'login_success', 'login_failed', 'account_locked', 'account_unlocked',
  'password_changed', 'password_reset', 'token_refreshed', 'token_reuse_detected', 'logout',
  'offline_pin_set', 'pin_reset', 'device_registered', 'device_revoked', 'delegated_unlock'));
