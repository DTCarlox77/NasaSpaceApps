-- =====================================================================
-- 003_demo_bienestar_dispositivos.sql  ·  DATOS SINTÉTICOS PARA DEMO
-- Requiere 001 (usuarios y misión ARES-1) y 002 (indicadores PHQ2/GAD2).
--
-- Contraseña de bh.salas y svc.habitat: Demo2026! (mismo hash bcrypt del seed 001).
-- Credenciales de las tabletas demo (SINTÉTICAS, solo para la demo local;
-- van en el header X-Device-Credential de los endpoints de emergencia):
--   TAB-1  dc_demo_tab1_sintetica
--   TAB-2  dc_demo_tab2_sintetica
-- En la base solo se guarda su SHA-256.
-- =====================================================================

-- ---------- Usuarios: salud conductual y cuenta de servicio ----------
INSERT INTO users (id, username, email, full_name, password_hash, role, must_change_password, password_changed_at) VALUES
  ('00000000-0000-4000-8000-000000000003', 'bh.salas', 'bh@demo.local', 'Dra. Inés Salas (sintética)',
   '$2a$10$qWUas2xzbAY8b45XyEZnCuFCs2w6bdgkViGcpFKgcKcgj605Pa7vi', 'behavioral_health', false, now()),
  -- Solo puede registrar lecturas del hábitat (POST /habitat/readings).
  ('00000000-0000-4000-8000-000000000004', 'svc.habitat', NULL, 'Sensores del hábitat (cuenta de servicio)',
   '$2a$10$qWUas2xzbAY8b45XyEZnCuFCs2w6bdgkViGcpFKgcKcgj605Pa7vi', 'service', false, now())
ON CONFLICT DO NOTHING;

-- bh.salas en el equipo de Tierra de ARES-1 con función behavioral.
INSERT INTO mission_ground_team (mission_id, user_id, function) VALUES
  ('20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'behavioral')
ON CONFLICT DO NOTHING;

-- La cuenta de servicio registra lecturas de los módulos de ARES-1.
INSERT INTO service_accounts (user_id, mission_id, description) VALUES
  ('00000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001',
   'Sensores y simulador del hábitat de ARES-1 (HAB-1 y HAB-2)')
ON CONFLICT DO NOTHING;

-- ---------- Tabletas registradas en ARES-1 ----------
INSERT INTO devices (id, label, kind, mission_id, module_id, credential_hash, registered_by, registered_via, created_at, synthetic) VALUES
  ('80000000-0000-4000-8000-000000000001', 'TAB-1', 'tablet', '20000000-0000-4000-8000-000000000001', 'HAB-1',
   encode(sha256(convert_to('dc_demo_tab1_sintetica', 'UTF8')), 'hex'),
   '00000000-0000-4000-8000-000000000001', 'admin', now() - interval '45 days', true),
  ('80000000-0000-4000-8000-000000000002', 'TAB-2', 'tablet', '20000000-0000-4000-8000-000000000001', 'HAB-2',
   encode(sha256(convert_to('dc_demo_tab2_sintetica', 'UTF8')), 'hex'),
   '00000000-0000-4000-8000-000000000001', 'admin', now() - interval '45 days', true)
ON CONFLICT DO NOTHING;

-- ---------- Cuestionarios PHQ-2 y GAD-2 (v1, activos) ----------
-- Redacción en español adaptada para la demo: validar contra la versión
-- oficial en español antes de cualquier uso real. Puntaje = item_1 + item_2 (0–6).
INSERT INTO instruments (code, version, name, indicator_code, definition, sources, license, is_active) VALUES
  ('PHQ2', 1, 'PHQ-2', 'PHQ2_SCORE',
   $json${
     "prompt": "Durante las últimas 2 semanas, ¿con qué frecuencia te han molestado estos problemas?",
     "items": [
       {"code": "item_1", "text": "Poco interés o placer en hacer cosas"},
       {"code": "item_2", "text": "Sentirte decaído, deprimido o sin esperanza"}
     ],
     "options": [
       {"value": 0, "label": "Ningún día"},
       {"value": 1, "label": "Varios días"},
       {"value": 2, "label": "Más de la mitad de los días"},
       {"value": 3, "label": "Casi todos los días"}
     ],
     "scoring": "Suma de item_1 + item_2 (0–6)"
   }$json$::jsonb,
   $json$[
     {"id": "phq2_nida", "title": "NIDA CDE – Patient Health Questionnaire-2 (PHQ-2)", "url": "https://cde.nida.nih.gov/node/22"},
     {"id": "nasa_bhp_ops", "title": "NASA NTRS – BHP Operations at JSC (conferencias psicológicas privadas)", "url": "https://ntrs.nasa.gov/api/citations/20170003866/downloads/20170003866.pdf"}
   ]$json$::jsonb,
   'Titular: Pfizer Inc. Según el titular, uso libre sin permiso (pendiente de verificar antes de uso real). Redacción en español adaptada para la demo.',
   true),
  ('GAD2', 1, 'GAD-2', 'GAD2_SCORE',
   $json${
     "prompt": "Durante las últimas 2 semanas, ¿con qué frecuencia te han molestado estos problemas?",
     "items": [
       {"code": "item_1", "text": "Sentirte nervioso, ansioso o con los nervios de punta"},
       {"code": "item_2", "text": "No poder dejar de preocuparte o no poder controlar la preocupación"}
     ],
     "options": [
       {"value": 0, "label": "Ningún día"},
       {"value": 1, "label": "Varios días"},
       {"value": 2, "label": "Más de la mitad de los días"},
       {"value": 3, "label": "Casi todos los días"}
     ],
     "scoring": "Suma de item_1 + item_2 (0–6)"
   }$json$::jsonb,
   $json$[
     {"id": "gad2_kroenke", "title": "Kroenke et al. 2007, Ann Intern Med – Anxiety disorders in primary care (validación GAD-2)", "url": "https://pubmed.ncbi.nlm.nih.gov/17339617/"},
     {"id": "nasa_bhp_ops", "title": "NASA NTRS – BHP Operations at JSC (conferencias psicológicas privadas)", "url": "https://ntrs.nasa.gov/api/citations/20170003866/downloads/20170003866.pdf"}
   ]$json$::jsonb,
   'Titular: Pfizer Inc. Según el titular, uso libre sin permiso (pendiente de verificar antes de uso real). Redacción en español adaptada para la demo.',
   true)
ON CONFLICT DO NOTHING;
