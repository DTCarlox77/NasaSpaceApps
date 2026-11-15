-- =====================================================================
-- 014_acceso.sql
-- Tarea 11: registro y acceso. Emergencia sin sesión con la credencial de
-- una tableta (X-Device-Credential), permisos delegados del comandante y
-- PIN de desbloqueo offline. Las tablas ya existen (007): aquí solo los
-- tipos nuevos de la bitácora y un índice para la auditoría.
-- Peligro: Distance from Earth.
-- =====================================================================

-- ---------- Bitácora de autenticación: eventos de la tableta ----------
-- device_auth_failed: credencial de tableta inválida, revocada o de otra misión
--   (nunca se guarda la credencial: solo la IP y, si se conoce, el id de la tableta).
-- device_emergency_started: emergencia abierta (o unida) desde una tableta sin sesión.
ALTER TABLE auth_events DROP CONSTRAINT auth_events_event_check;
ALTER TABLE auth_events ADD CONSTRAINT auth_events_event_check CHECK (event IN (
  'login_success', 'login_failed', 'account_locked', 'account_unlocked',
  'password_changed', 'password_reset', 'token_refreshed', 'token_reuse_detected', 'logout',
  'offline_pin_set', 'pin_reset', 'device_registered', 'device_revoked', 'delegated_unlock',
  'device_auth_failed', 'device_emergency_started'));

-- ---------- Acciones delegadas: auditoría por misión y hora de recepción ----------
-- delegated_actions es append-only: reported_to_ground_at no se puede actualizar cuando
-- cambia un corte. La entrega a Tierra se DERIVA al leer:
-- deliver_at = compute_deliver_at(mission_id, received_at). La columna queda sin uso.
CREATE INDEX delegated_actions_received_idx ON delegated_actions (mission_id, received_at);
COMMENT ON COLUMN delegated_actions.reported_to_ground_at IS
  'Sin uso desde la tarea 11: la entrega se deriva al leer con compute_deliver_at(mission_id, received_at).';
