-- =====================================================================
-- 004_protocolo_triaje_v2.sql
-- Protocolo de triaje crew_emergency v2 (la v1 queda igual, inactiva).
-- Cambios frente a la v1:
-- - Si el tripulante NO responde, el módulo de radiación solo pregunta signos
--   OBSERVABLES por quien lo atiende: si alguien lo vio vomitar, cuánto tiempo
--   después del evento (si se vio) y su estado de conciencia (escala ACVPU de
--   NEWS2). Nunca síntomas que deba reportar el paciente (náusea, fatiga...).
--   Rojo por "no obedece órdenes" o "solo respira tras abrir la vía aérea" va
--   directo a esas preguntas; el resto de los rojos pregunta antes si puede
--   contestar por sí mismo.
-- - auto_activation: qué lecturas críticas abren la emergencia sola (regla de
--   diseño, sin fuente clínica). Los tiempos y el on/off van en TRIAGE_AUTO_*.
-- - attention_order: orden de atención (START: rojo, amarillo, verde, negro).
-- Umbrales: ninguno nuevo. Las categorías y el módulo de radiación son los de la v1.
-- Idempotente: no pisa una versión posterior activada desde el panel.
-- =====================================================================

-- Solo la primera vez (si la v2 todavía no existe): la v1 deja de ser la activa y la v2
-- lo pasa a ser. Después no se toca nada (el panel puede activar otra versión).
UPDATE triage_protocols SET is_active = false
WHERE code = 'crew_emergency' AND is_active AND version < 2
  AND NOT EXISTS (SELECT 1 FROM triage_protocols WHERE code = 'crew_emergency' AND version >= 2);

INSERT INTO triage_protocols (code, version, name, is_active, created_by, sources, definition)
SELECT 'crew_emergency', 2, 'Triaje de emergencia de tripulación (START adaptado, v2: signos observables)',
       NOT EXISTS (SELECT 1 FROM triage_protocols WHERE code = 'crew_emergency' AND is_active),
       '00000000-0000-4000-8000-000000000001',
 $json$[
   {"id": "START", "title": "START Adult Triage Algorithm", "publisher": "HHS CHEMM", "url": "https://chemm.hhs.gov/startalgotext.htm"},
   {"id": "START_STEPS", "title": "Mass casualty incident triage (START)", "publisher": "WikEM", "url": "https://www.wikem.org/wiki/Start_triage"},
   {"id": "ARS_TRIAGE", "title": "Triage handout: ARS prodrome and time to emesis", "publisher": "ORAU / REACTS", "url": "https://www.orau.gov/hsc/RadMassCasualties/assets/4_Triage_Handout.pdf"},
   {"id": "NASA_ARS", "title": "Space Radiation Protection Strategies (ARS from SPE)", "publisher": "NASA HRP Space Radiation Element", "url": "https://ntrs.nasa.gov/api/citations/20170001372/downloads/20170001372.pdf"},
   {"id": "NASA_RISKS", "title": "Risks of Human Spaceflight", "publisher": "NASA HRP", "url": "https://www.nasa.gov/hrp/risks/"},
   {"id": "ACVPU", "title": "NEWS2, Chart 1: consciousness (ACVPU)", "publisher": "Royal College of Physicians (reproducido por NHS NWAS)", "url": "https://www.nwas.nhs.uk/publications/news2-national-early-warning-score"}
 ]$json$::jsonb,
 $json${
   "disclaimer": "Apoyo a la decisión. No diagnostica ni receta: lo que no cubre el protocolo se consulta con el flight surgeon.",
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
      "next": {"true": "RESULT_RED_UNRESPONSIVE", "false": "RESULT_BLACK"}, "source": "START_STEPS"},

     {"code": "resp_rate_over_30", "scope": "assessment", "type": "boolean",
      "prompt": "¿Respira más de 30 veces por minuto?",
      "prefill": {"from": "reading", "indicator": "RESP_RATE", "max_age_minutes": 10, "rule": "value > 30"},
      "next": {"true": "RESULT_RED", "false": "perfusion_ok"}, "source": "START_STEPS"},

     {"code": "perfusion_ok", "scope": "assessment", "type": "boolean",
      "prompt": "¿Tiene pulso en la muñeca, o al presionar una uña el color vuelve en 2 segundos o menos?",
      "next": {"true": "follows_commands", "false": "RESULT_RED"}, "source": "START_STEPS"},

     {"code": "follows_commands", "scope": "assessment", "type": "boolean",
      "prompt": "Pídele: 'aprieta mi mano'. ¿Obedece órdenes simples?",
      "next": {"true": "RESULT_YELLOW", "false": "RESULT_RED_UNRESPONSIVE"}, "source": "START"},

     {"code": "can_self_report", "scope": "assessment", "type": "boolean", "module": "radiation",
      "condition": {"any": [{"ctx": "solar_event_active", "op": "eq", "value": true}]},
      "prompt": "¿{call_sign} puede contestarte por sí mismo?",
      "note": "Si no puede, solo se preguntan signos que tú puedas observar.",
      "next": {"true": "vomiting", "false": "vomiting_observed"}, "source": "ARS_TRIAGE"},

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
      "next": {"*": "END_ASSESSMENT"}, "source": "ARS_TRIAGE"},

     {"code": "vomiting_observed", "scope": "assessment", "type": "boolean", "module": "radiation",
      "condition": {"any": [{"ctx": "solar_event_active", "op": "eq", "value": true}]},
      "observable": true,
      "prompt": "¿Alguien vio a {call_sign} vomitar desde el evento de radiación?",
      "next": {"true": "time_to_vomiting_observed", "false": "consciousness_level"}, "source": "ARS_TRIAGE"},

     {"code": "time_to_vomiting_observed", "scope": "assessment", "type": "choice", "module": "radiation",
      "observable": true,
      "prompt": "Según quien lo vio, ¿cuánto tiempo después del evento vomitó?",
      "choices": ["lt_1h", "1_2h", "gt_2h", "unknown"],
      "note": "Si nadie sabe la hora, responde 'unknown'. Lo interpreta el flight surgeon.",
      "next": {"*": "consciousness_level"}, "source": "ARS_TRIAGE"},

     {"code": "consciousness_level", "scope": "assessment", "type": "choice", "module": "radiation",
      "observable": true,
      "prompt": "¿Cómo responde {call_sign}? Alerta, responde a la voz, solo al dolor, o no responde.",
      "choices": ["alert", "voice", "pain", "unresponsive"],
      "note": "Escala ACVPU de NEWS2 (sin la 'C' de confusión nueva, que requiere conversar con el paciente). Solo informa: no cambia la categoría.",
      "next": {"*": "END_ASSESSMENT"}, "source": "ACVPU"}
   ],
   "results": {
     "RESULT_GREEN_THEN_RADIATION": {"category": "green", "then": "vomiting"},
     "RESULT_YELLOW": {"category": "yellow", "then": "vomiting"},
     "RESULT_RED":    {"category": "red",    "then": "can_self_report"},
     "RESULT_RED_UNRESPONSIVE": {"category": "red", "then": "vomiting_observed"},
     "RESULT_BLACK":  {"category": "black",  "then": "END_ASSESSMENT"}
   },
   "radiation_flag_rules": [
     {"when": {"any": [{"q": "vomiting", "op": "eq", "value": true}, {"q": "vomiting_observed", "op": "eq", "value": true}]}, "flag": "probable", "source": "ARS_TRIAGE"},
     {"when": {"any": [{"q": "prodromal_symptoms", "op": "has_any", "value": ["nausea", "diarrhea", "fatigue", "headache", "fever", "skin_erythema"]}]}, "flag": "possible", "source": "ARS_TRIAGE"}
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
   "attention_order": {
     "categories": ["red", "yellow", "green", "black"],
     "categories_source": "START",
     "radiation_flags": ["probable", "possible", "none"],
     "unassessed": "after_red",
     "basis": "design_rule",
     "note": "Categorías en el orden de START (inmediato, diferido, leve, expectante). Dentro de una categoría, radiación probable antes que posible (regla de diseño). Quien todavía no tiene evaluación va después de los rojos: puede ser rojo (regla de diseño)."
   },
   "auto_activation": {
     "critical_reading_indicators": ["SPO2", "HEART_RATE", "RESP_RATE", "BLOOD_PRESSURE", "BODY_TEMP", "GLUCOSE", "RAD_DOSE_DAILY", "SYMPTOM"],
     "missed_checkin": true,
     "basis": "design_rule",
     "note": "Indicadores cuyo nivel critical (reglas del catálogo, con sus fuentes) abre la emergencia sola. La lista es una regla de diseño; los tiempos y el on/off van en TRIAGE_AUTO_*."
   },
   "roster_order": "Primero quien tenga lecturas críticas recientes, check-ins perdidos o no confirmó que está bien; luego el resto.",
   "dead_man_switch_seconds": 120
 }$json$::jsonb
WHERE NOT EXISTS (SELECT 1 FROM triage_protocols WHERE code = 'crew_emergency' AND version = 2);
