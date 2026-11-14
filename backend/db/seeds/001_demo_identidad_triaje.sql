-- =====================================================================
-- 001_demo_identidad_triaje.sql  ·  DATOS SINTÉTICOS PARA DEMO
-- Contraseña de todos los usuarios demo: Demo2026!  (bcrypt, cost 10)
-- =====================================================================

-- ---------- Entornos ----------
-- comm_delay_seconds está ACELERADO para la demo (los jueces deben ver la
-- respuesta en minutos). Es configurable desde el panel.
INSERT INTO environments (code, name, type, gravity_g, comm_delay_seconds, description) VALUES
  ('leo_station',  'Estación en órbita baja', 'space_station', 0.00,   0, 'Comunicación casi continua con Tierra'),
  ('lunar_base',   'Base lunar',              'lunar_base',    0.16,   5, 'Retraso corto; demo acelerada'),
  ('mars_transit', 'Tránsito a Marte',        'spacecraft',    0.00,  90, 'Retraso de minutos; demo acelerada'),
  ('mars_base',    'Base marciana',           'mars_base',     0.38,  90, 'Retraso de minutos; demo acelerada'),
  ('mars_rover',   'Rover presurizado',       'rover',         0.38,  90, 'Hábitat pequeño y cerrado');

-- ---------- Usuarios ----------
INSERT INTO users (id, username, email, full_name, password_hash, role, must_change_password, password_changed_at) VALUES
  ('00000000-0000-4000-8000-000000000001', 'mission.control', 'control@demo.local', 'Control de Misión (demo)',
   '$2a$10$qWUas2xzbAY8b45XyEZnCuFCs2w6bdgkViGcpFKgcKcgj605Pa7vi', 'admin', false, now()),
  ('00000000-0000-4000-8000-000000000002', 'dr.reyes', 'surgeon@demo.local', 'Dra. Elena Reyes (sintética)',
   '$2a$10$qWUas2xzbAY8b45XyEZnCuFCs2w6bdgkViGcpFKgcKcgj605Pa7vi', 'flight_surgeon', false, now()),
  ('00000000-0000-4000-8000-000000000011', 'a.ortega', NULL, 'Ana Ortega (sintética)',
   '$2a$10$qWUas2xzbAY8b45XyEZnCuFCs2w6bdgkViGcpFKgcKcgj605Pa7vi', 'astronaut', false, now()),
  ('00000000-0000-4000-8000-000000000012', 'k.mensah', NULL, 'Kofi Mensah (sintético)',
   '$2a$10$qWUas2xzbAY8b45XyEZnCuFCs2w6bdgkViGcpFKgcKcgj605Pa7vi', 'astronaut', false, now()),
  ('00000000-0000-4000-8000-000000000013', 'l.tanaka', NULL, 'Lin Tanaka (sintética)',
   '$2a$10$qWUas2xzbAY8b45XyEZnCuFCs2w6bdgkViGcpFKgcKcgj605Pa7vi', 'astronaut', false, now()),
  -- Este usuario demuestra el flujo de "cambiar contraseña en el primer inicio"
  ('00000000-0000-4000-8000-000000000014', 'm.silva', NULL, 'Marco Silva (sintético)',
   '$2a$10$qWUas2xzbAY8b45XyEZnCuFCs2w6bdgkViGcpFKgcKcgj605Pa7vi', 'astronaut', true, NULL);

INSERT INTO astronauts (id, user_id, call_sign, agency, synthetic) VALUES
  ('10000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000011', 'ORION', 'Demo Agency', true),
  ('10000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000012', 'VEGA',  'Demo Agency', true),
  ('10000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000013', 'LYRA',  'Demo Agency', true),
  ('10000000-0000-4000-8000-000000000014', '00000000-0000-4000-8000-000000000014', 'ATLAS', 'Demo Agency', true);

-- ---------- Misión y tripulación ----------
INSERT INTO missions (id, code, name, environment_code, status, starts_at, created_by) VALUES
  ('20000000-0000-4000-8000-000000000001', 'ARES-1', 'Ares 1 · Tránsito a Marte (demo)', 'mars_transit', 'active',
   now() - interval '45 days', '00000000-0000-4000-8000-000000000001');

INSERT INTO crew_assignments (mission_id, astronaut_id, crew_role, assigned_from, created_by) VALUES
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000011', 'commander',            now() - interval '45 days', '00000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000012', 'crew_medical_officer', now() - interval '45 days', '00000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000013', 'flight_engineer',      now() - interval '45 days', '00000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000014', 'mission_specialist',   now() - interval '45 days', '00000000-0000-4000-8000-000000000001');

INSERT INTO mission_ground_team (mission_id, user_id) VALUES
  ('20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002');

-- ---------- Protocolo de triaje v1 (START adaptado + módulo de radiación) ----------
INSERT INTO triage_protocols (code, version, name, is_active, created_by, sources, definition) VALUES
('crew_emergency', 1, 'Triaje de emergencia de tripulación (START adaptado)', true,
 '00000000-0000-4000-8000-000000000001',
 $json$[
   {"id": "START", "title": "START Adult Triage Algorithm", "publisher": "HHS CHEMM", "url": "https://chemm.hhs.gov/startalgotext.htm"},
   {"id": "START_STEPS", "title": "Mass casualty incident triage (START)", "publisher": "WikEM", "url": "https://www.wikem.org/wiki/Start_triage"},
   {"id": "ARS_TRIAGE", "title": "Triage handout: ARS prodrome and time to emesis", "publisher": "ORAU / REACTS", "url": "https://www.orau.gov/hsc/RadMassCasualties/assets/4_Triage_Handout.pdf"},
   {"id": "NASA_ARS", "title": "Space Radiation Protection Strategies (ARS from SPE)", "publisher": "NASA HRP Space Radiation Element", "url": "https://ntrs.nasa.gov/api/citations/20170001372/downloads/20170001372.pdf"},
   {"id": "NASA_RISKS", "title": "Risks of Human Spaceflight", "publisher": "NASA HRP", "url": "https://www.nasa.gov/hrp/risks/"}
 ]$json$::jsonb,
 $json${
   "disclaimer": "Apoyo a la decisión. No reemplaza el juicio del oficial médico de la tripulación ni del flight surgeon.",
   "start_question": "responder_safe",
   "questions": [
     {"code": "responder_safe", "scope": "session", "type": "boolean",
      "prompt": "Antes de ayudar: ¿estás en un lugar seguro? Si hay alarma de radiación o del hábitat, primero ve al refugio.",
      "prefill": {"from": "context", "keys": ["solar_event_active", "environment_alarm"]},
      "next": {"true": "responsive_and_mobile", "false": "STOP_SECURE_SELF"}, "source": "START_STEPS"},

     {"code": "responsive_and_mobile", "scope": "assessment", "type": "boolean",
      "prompt": "¿{call_sign} responde y puede desplazarse por sí mismo hasta el punto de reunión?",
      "note": "En microgravedad no aplica 'caminar' de START: se adapta a desplazarse por sí mismo.",
      "next": {"true": "RESULT_GREEN_THEN_RADIATION", "false": "breathing"}, "source": "START"},

     {"code": "breathing", "scope": "assessment", "type": "boolean",
      "prompt": "¿{call_sign} está respirando?",
      "next": {"true": "resp_rate_over_30", "false": "breathing_after_airway"}, "source": "START_STEPS"},

     {"code": "breathing_after_airway", "scope": "assessment", "type": "boolean",
      "prompt": "Reposiciona la vía aérea (inclina la cabeza hacia atrás). ¿Respira ahora?",
      "next": {"true": "RESULT_RED", "false": "RESULT_BLACK"}, "source": "START_STEPS"},

     {"code": "resp_rate_over_30", "scope": "assessment", "type": "boolean",
      "prompt": "¿Respira más de 30 veces por minuto?",
      "prefill": {"from": "reading", "indicator": "RESP_RATE", "max_age_minutes": 10, "rule": "value > 30"},
      "next": {"true": "RESULT_RED", "false": "perfusion_ok"}, "source": "START_STEPS"},

     {"code": "perfusion_ok", "scope": "assessment", "type": "boolean",
      "prompt": "¿Tiene pulso en la muñeca, o al presionar una uña el color vuelve en 2 segundos o menos?",
      "next": {"true": "follows_commands", "false": "RESULT_RED"}, "source": "START_STEPS"},

     {"code": "follows_commands", "scope": "assessment", "type": "boolean",
      "prompt": "Pídele: 'aprieta mi mano'. ¿Obedece órdenes simples?",
      "next": {"true": "RESULT_YELLOW", "false": "RESULT_RED"}, "source": "START"},

     {"code": "vomiting", "scope": "assessment", "type": "boolean", "module": "radiation",
      "condition": {"any": [{"ctx": "solar_event_active", "op": "eq", "value": true}]},
      "prompt": "¿{call_sign} ha vomitado desde el evento de radiación?",
      "next": {"true": "time_to_vomiting", "false": "prodromal_symptoms"}, "source": "ARS_TRIAGE"},

     {"code": "time_to_vomiting", "scope": "assessment", "type": "choice", "module": "radiation",
      "prompt": "¿Cuánto tiempo después del evento empezó a vomitar?",
      "choices": ["lt_1h", "1_2h", "gt_2h", "unknown"],
      "note": "El tiempo hasta el vómito es un indicador orientativo de gravedad; lo interpreta el flight surgeon.",
      "next": {"*": "prodromal_symptoms"}, "source": "ARS_TRIAGE"},

     {"code": "prodromal_symptoms", "scope": "assessment", "type": "multi_choice", "module": "radiation",
      "prompt": "¿Tiene alguno de estos síntomas? Náusea, diarrea, fatiga, dolor de cabeza, fiebre, piel enrojecida.",
      "choices": ["nausea", "diarrhea", "fatigue", "headache", "fever", "skin_erythema", "none"],
      "prefill": {"from": "reading", "indicator": "BODY_TEMP", "max_age_minutes": 30, "maps_to": "fever"},
      "next": {"*": "END_ASSESSMENT"}, "source": "ARS_TRIAGE"}
   ],
   "results": {
     "RESULT_GREEN_THEN_RADIATION": {"category": "green", "then": "vomiting"},
     "RESULT_YELLOW": {"category": "yellow", "then": "vomiting"},
     "RESULT_RED":    {"category": "red",    "then": "vomiting"},
     "RESULT_BLACK":  {"category": "black",  "then": "END_ASSESSMENT"}
   },
   "radiation_flag_rules": [
     {"when": {"any": [{"q": "vomiting", "op": "eq", "value": true}]}, "flag": "probable"},
     {"when": {"any": [{"q": "prodromal_symptoms", "op": "has_any", "value": ["nausea", "diarrhea", "fatigue", "headache", "fever", "skin_erythema"]}]}, "flag": "possible"}
   ],
   "radiation_flag_default": "none",
   "escalation_rules": [
     {"when": {"any": [{"field": "category", "op": "in", "value": ["red", "black"]}, {"field": "radiation_flag", "op": "eq", "value": "probable"}]},
      "actions": [{"level": "crew", "priority": "emergency"}, {"level": "flight_surgeon", "priority": "emergency"}]},
     {"when": {"any": [{"field": "category", "op": "eq", "value": "yellow"}, {"field": "radiation_flag", "op": "eq", "value": "possible"}]},
      "actions": [{"level": "crew", "priority": "urgent"}, {"level": "flight_surgeon", "priority": "urgent"}]},
     {"when": {"any": [{"field": "category", "op": "eq", "value": "green"}]},
      "actions": [{"level": "self_care", "priority": "routine"}, {"level": "crew", "priority": "routine"}]}
   ],
   "roster_order": "Primero quien tenga lecturas críticas recientes o check-ins perdidos; luego el resto.",
   "dead_man_switch_seconds": 120
 }$json$::jsonb);
