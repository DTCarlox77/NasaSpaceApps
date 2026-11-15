-- =====================================================================
-- 008_escalamiento_entrega.sql
-- Tarea 6: escalamiento con retraso, bandeja de Tierra y cortes de enlace.
-- Peligro: Distance from Earth.
--
-- La base calcula deliver_at con compute_deliver_at (003); la API recalcula
-- lo que quedó en cola (deliver_at NULL o futuro) cuando se crea, corrige o
-- cierra un corte (src/services/escalationDelivery.service.js).
-- =====================================================================

-- ---------- Idempotencia: un escalamiento por lectura y destino ----------
-- La lectura ya es idempotente por client_uuid; esto evita además dos filas
-- iguales si dos peticiones evalúan la misma lectura a la vez.
CREATE UNIQUE INDEX escalations_reading_level_uq ON escalations (source_id, level)
  WHERE source_type IN ('reading', 'wellbeing') AND source_id IS NOT NULL;

-- ---------- Lo que espera enlace (deliver_at NULL) por misión ----------
-- Recalcular al cerrar un corte y promover queued → delivered.
CREATE INDEX escalations_pending_idx ON escalations (mission_id, created_at)
  WHERE status = 'queued';
CREATE INDEX escalation_messages_pending_idx ON escalation_messages (escalation_id, created_at)
  WHERE deliver_at IS NULL;
