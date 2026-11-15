-- =====================================================================
-- 009_sexo_astronauta.sql
-- Sexo biológico del astronauta para referencias clínicas futuras.
-- Ninguna regla actual lo usa; el motor lo pone en el contexto de evaluación
-- ({"field": "sex", "op": "eq", "value": "female"}).
-- El límite de radiación NO depende del sexo: 600 mSv de carrera, "universal
-- for all ages and sexes" (NASA-STD-3001 Vol. 1 [V1 4030]).
-- Quién lo ve (lo hace cumplir la API, accessPolicy vista clinical_profile):
-- el propio astronauta, flight_surgeon y behavioral_health de su misión.
-- admin lo escribe pero no lo recibe; nunca otro astronauta ni el dashboard.
-- Acepta nulos: no rompe los perfiles existentes.
-- =====================================================================

ALTER TABLE astronauts
  ADD COLUMN sex text
  CONSTRAINT astronauts_sex_ck CHECK (sex IN ('female', 'male'));

COMMENT ON COLUMN astronauts.sex IS
  'Sexo biológico para referencias clínicas. No es identidad de género. Datos sintéticos en la demo.';
