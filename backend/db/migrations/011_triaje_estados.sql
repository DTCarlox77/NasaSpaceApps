-- =====================================================================
-- 011_triaje_estados.sql
-- Tarea 9: estados nuevos de la sesión de emergencia. Va sola porque un valor
-- nuevo de un enum no se puede usar en la misma transacción en que se agrega
-- (la 012 los usa en índices y CHECK).
-- - pending: activación automática esperando "estoy bien" del tripulante
--   afectado (interruptor de hombre muerto, TRIAGE_DEADMAN_S).
-- - merged:  activación que llegó cuando ya había otra sesión abierta en la
--   misión; se une a ella (merged_into) y no se descarta nada.
-- =====================================================================

ALTER TYPE emergency_status ADD VALUE IF NOT EXISTS 'pending';
ALTER TYPE emergency_status ADD VALUE IF NOT EXISTS 'merged';
