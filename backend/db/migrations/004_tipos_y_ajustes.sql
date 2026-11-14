-- =====================================================================
-- 004_tipos_y_ajustes.sql
-- Valores nuevos de enum y ajustes de la revisión de 001–003.
--
-- scripts/migrate.js corre cada archivo en una transacción: un valor
-- nuevo de enum (ALTER TYPE ... ADD VALUE) no se puede USAR en la misma
-- transacción. Por eso aquí solo se agregan; se usan desde la 005.
-- Ningún ajuste de este archivo usa los valores nuevos.
-- =====================================================================

-- ---------- Valores nuevos de enum ----------
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'behavioral_health';
-- Cuenta de servicio de los sensores del hábitat: solo POST /habitat/readings.
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'service';
ALTER TYPE escalation_level ADD VALUE IF NOT EXISTS 'behavioral_health';
-- Activación por un evento de la tripulación (p. ej. un tripulante avisa por voz).
ALTER TYPE emergency_trigger ADD VALUE IF NOT EXISTS 'crew_event';

-- ---------- Origen de escalamientos: wellbeing ----------
-- source_type es un CHECK de texto (no un enum), así que se puede cambiar aquí.
ALTER TABLE escalations DROP CONSTRAINT escalations_source_type_check;
ALTER TABLE escalations ADD CONSTRAINT escalations_source_type_check CHECK (
  source_type IN ('reading', 'emergency_assessment', 'emergency_session', 'wellbeing', 'manual'));

-- ---------- Índices ----------
-- Búsquedas "¿de qué misiones es parte este usuario de Tierra?".
CREATE INDEX mission_ground_team_user_idx ON mission_ground_team (user_id);

-- Alineado con v_ground_inbox, que muestra todo lo que no está cerrado
-- (el índice anterior dejaba fuera 'responded').
DROP INDEX escalations_inbox_idx;
CREATE INDEX escalations_inbox_idx ON escalations (mission_id, deliver_at)
  WHERE status <> 'closed';

-- ---------- Reconocimiento de escalamientos ----------
-- El CHECK anterior exigía acknowledged_at y acknowledged_by juntos, pero
-- acknowledged_by es ON DELETE SET NULL: borrar al usuario violaba el CHECK
-- y el borrado fallaba. Ahora: si hay quién, hay cuándo (el cuándo se conserva).
ALTER TABLE escalations DROP CONSTRAINT escalations_ack_ck;
ALTER TABLE escalations ADD CONSTRAINT escalations_ack_ck
  CHECK (acknowledged_by IS NULL OR acknowledged_at IS NOT NULL);

-- ---------- Tripulación vigente con vigencia real ----------
-- Antes "vigente" era solo assigned_to IS NULL: una fecha de fin futura sacaba
-- al astronauta de la tripulación de inmediato y una asignación futura ya
-- contaba como vigente. Ahora vigente = assigned_from <= now() < assigned_to.
CREATE OR REPLACE VIEW v_current_crew AS
SELECT ca.id AS assignment_id, m.id AS mission_id, m.code AS mission_code, m.status AS mission_status,
       e.code AS environment_code, e.gravity_g, e.comm_delay_seconds,
       a.id AS astronaut_id, a.call_sign, u.id AS user_id, u.full_name, ca.crew_role, ca.assigned_from
FROM crew_assignments ca
JOIN missions m     ON m.id = ca.mission_id
JOIN environments e ON e.code = m.environment_code
JOIN astronauts a   ON a.id = ca.astronaut_id
JOIN users u        ON u.id = a.user_id
WHERE ca.assigned_from <= now()
  AND (ca.assigned_to IS NULL OR ca.assigned_to > now());

-- "Un comandante y un CMO por misión" pasa de índices parciales sobre
-- assigned_to IS NULL (que no admiten now()) a exclusión por rango de fechas:
-- nunca dos comandantes (o dos CMO) con periodos que se solapen.
DROP INDEX crew_one_commander_uq;
DROP INDEX crew_one_cmo_uq;
ALTER TABLE crew_assignments ADD CONSTRAINT crew_one_commander_ex EXCLUDE USING gist (
  mission_id WITH =,
  tstzrange(assigned_from, COALESCE(assigned_to, 'infinity'::timestamptz), '[)') WITH &&
) WHERE (crew_role = 'commander');
ALTER TABLE crew_assignments ADD CONSTRAINT crew_one_cmo_ex EXCLUDE USING gist (
  mission_id WITH =,
  tstzrange(assigned_from, COALESCE(assigned_to, 'infinity'::timestamptz), '[)') WITH &&
) WHERE (crew_role = 'crew_medical_officer');

-- ---------- synthetic: mismo valor por defecto en todas las tablas ----------
-- Todo dato de demo es sintético (astronauts ya tenía true; las tablas nuevas también).
ALTER TABLE emergency_sessions ALTER COLUMN synthetic SET DEFAULT true;
