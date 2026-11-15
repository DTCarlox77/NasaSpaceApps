-- =====================================================================
-- 010_sincronizacion.sql
-- Tarea 8: sincronización offline-first (POST /sync/push, GET /sync/pull).
-- Peligro: Distance from Earth (la app trabaja sin enlace y sube lotes al volver).
--
-- sync_batches y sync_items ya existen (005). Aquí se completan como historial:
-- - por lote: conteos por resultado, offset de reloj del dispositivo y duración;
-- - por item: hash del payload (para detectar el mismo client_uuid con otro
--   contenido), si llegó tarde (late_sync) y cuánto tiempo pasó.
-- Nunca se guarda el payload: solo su SHA-256. Un reintento del lote crea otro
-- sync_batches (queda el historial de reintentos) pero ninguna fila de datos nueva.
-- =====================================================================

-- ---------- Lotes: historial ----------
-- item_count: el máximo lo pone la API (SYNC_MAX_BATCH, 500 por defecto).
ALTER TABLE sync_batches DROP CONSTRAINT sync_batches_item_count_check;
ALTER TABLE sync_batches
  ADD CONSTRAINT sync_batches_item_count_ck CHECK (item_count >= 1),
  ADD COLUMN accepted_count   integer NOT NULL DEFAULT 0 CHECK (accepted_count >= 0),
  ADD COLUMN duplicate_count  integer NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
  ADD COLUMN conflict_count   integer NOT NULL DEFAULT 0 CHECK (conflict_count >= 0),
  ADD COLUMN rejected_count   integer NOT NULL DEFAULT 0 CHECK (rejected_count >= 0),
  ADD COLUMN late_count       integer NOT NULL DEFAULT 0 CHECK (late_count >= 0),
  -- received_at − sent_at, en ms (positivo = el reloj del dispositivo va atrasado
  -- o el lote tardó en llegar). Solo se registra: measured_at nunca se corrige.
  ADD COLUMN clock_offset_ms  bigint,
  ADD COLUMN duration_ms      integer CHECK (duration_ms >= 0),
  ADD COLUMN synthetic        boolean NOT NULL DEFAULT true;

-- ---------- Items ----------
-- El registro de tipos es extensible (triage_*, tarea 9): un tipo desconocido
-- queda como rejected con su nombre, sin tumbar el lote.
ALTER TABLE sync_items DROP CONSTRAINT sync_items_entity_check;
ALTER TABLE sync_items ADD CONSTRAINT sync_items_entity_ck CHECK (entity ~ '^[a-z][a-z0-9_]{0,39}$');
-- Un client_uuid puede venir dos veces en el mismo lote (el segundo es duplicate o conflict).
ALTER TABLE sync_items DROP CONSTRAINT sync_items_batch_uq;
CREATE INDEX sync_items_batch_idx ON sync_items (batch_id, id);
ALTER TABLE sync_items
  ADD COLUMN payload_hash  text CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  ADD COLUMN late_sync     boolean NOT NULL DEFAULT false,
  ADD COLUMN lag_s         integer;
