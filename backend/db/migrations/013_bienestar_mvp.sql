-- =====================================================================
-- 013_bienestar_mvp.sql
-- Tarea 10: módulo Bienestar (MVP). Endpoints /wellbeing/*, /me/wellbeing,
-- /admin/behavioral/* y /admin/compliance de docs/openapi.yaml.
-- Peligro: Isolation and Confinement.
--
-- - Un check-in por día de misión (día UTC): uno nuevo el mismo día es una
--   corrección (append-only). La fila nueva apunta a la que corrige con
--   supersedes_id y sus lecturas llevan supersedes_uuid. Una sola
--   corrección por check-in (una tercera del día corrige a la segunda).
-- - behavioral_health cierra escalamientos y solicitudes de apoyo: queda
--   quién (closed_by) además de cuándo (closed_at).
-- =====================================================================

-- ---------- Check-in: corrección del mismo día ----------
ALTER TABLE wellbeing_checkins
  ADD COLUMN supersedes_id uuid REFERENCES wellbeing_checkins(id) ON DELETE RESTRICT,
  ADD CONSTRAINT wellbeing_checkins_supersedes_self_ck CHECK (supersedes_id IS DISTINCT FROM id);
CREATE UNIQUE INDEX wellbeing_checkins_supersedes_once_uq ON wellbeing_checkins (supersedes_id)
  WHERE supersedes_id IS NOT NULL;

-- ---------- Cierre por behavioral_health ----------
ALTER TABLE escalations ADD COLUMN closed_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE support_requests ADD COLUMN closed_by uuid REFERENCES users(id) ON DELETE SET NULL;

-- ---------- Bandeja de behavioral_health ----------
-- Escalamientos conductuales abiertos por astronauta (bandeja y regla de uno abierto por
-- indicador, escalation.service.js).
CREATE INDEX escalations_behavioral_open_idx ON escalations (mission_id, astronaut_id, created_at)
  WHERE level = 'behavioral_health' AND status <> 'closed';
