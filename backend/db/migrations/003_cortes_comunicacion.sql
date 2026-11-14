-- =====================================================================
-- 003_cortes_comunicacion.sql
-- Hallazgo del escenario ARES-1: un retraso fijo no basta. Si el enlace
-- con Tierra está caído (conjunción solar, antena, maniobra), un mensaje
-- no puede "llegar" hasta que el enlace vuelva.
-- Peligro: Distance from Earth.
-- =====================================================================

CREATE TABLE mission_comm_outages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id  uuid NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz,                          -- NULL = corte en curso
  reason      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outage_dates_ck CHECK (ends_at IS NULL OR ends_at > starts_at),
  CONSTRAINT outage_no_overlap EXCLUDE USING gist (
    mission_id WITH =,
    tstzrange(starts_at, COALESCE(ends_at, 'infinity'::timestamptz), '[)') WITH &&
  )
);

-- Momento en que un mensaje enviado en p_sent_at llega al otro extremo:
-- si el envío cae dentro de un corte, sale cuando el enlace vuelve; luego
-- se suma el retraso del entorno. Si el corte sigue abierto, devuelve NULL
-- (el mensaje queda en cola sin hora de entrega conocida).
CREATE OR REPLACE FUNCTION compute_deliver_at(p_mission_id uuid, p_sent_at timestamptz)
RETURNS timestamptz LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_delay   integer;
  v_depart  timestamptz := p_sent_at;
  v_outage  record;
BEGIN
  SELECT e.comm_delay_seconds INTO v_delay
  FROM missions m JOIN environments e ON e.code = m.environment_code
  WHERE m.id = p_mission_id;

  SELECT starts_at, ends_at INTO v_outage
  FROM mission_comm_outages
  WHERE mission_id = p_mission_id
    AND tstzrange(starts_at, COALESCE(ends_at, 'infinity'::timestamptz), '[)') @> p_sent_at;

  IF FOUND THEN
    IF v_outage.ends_at IS NULL THEN
      RETURN NULL;
    END IF;
    v_depart := v_outage.ends_at;
  END IF;

  RETURN v_depart + make_interval(secs => v_delay);
END;
$$;

-- deliver_at pasa a ser opcional: NULL = en cola esperando enlace.
ALTER TABLE escalations ALTER COLUMN deliver_at DROP NOT NULL;
ALTER TABLE escalation_messages ALTER COLUMN deliver_at DROP NOT NULL;
