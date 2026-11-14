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
-- Texto OFICIAL de Pfizer Inc. (phqscreeners.com). En `definition`, el primer nivel tiene el
-- idioma por defecto (es) y `translations` los demás; cada idioma dice si es oficial y de qué
-- versión de idioma sale.
-- · PHQ-2 es: ítems 1 y 2 del PHQ-9 "Spanish for Mexico" (oficial). NO se copia ningún otro
--   ítem del PHQ-9: el 9 (autolesión) exige un protocolo de crisis que este módulo no tiene.
-- · PHQ-2 en y GAD-2 en: PHQ-4 "English" (ítems 3–4 = PHQ-2; ítems 1–2 = GAD-2), oficial.
-- · GAD-2 es: ítems 1 y 2 del GAD-7 "Spanish for Mexico" (oficial), con su propio encabezado y
--   sus opciones ("Nunca"…), que difieren de las del PHQ-9. NO se copian los ítems 3–7.
-- Puntaje = item_1 + item_2 (0–6); corte en 3 (reglas de PHQ2_SCORE y GAD2_SCORE).
INSERT INTO instruments (code, version, name, indicator_code, definition, sources, license, is_active) VALUES
  ('PHQ2', 1, 'PHQ-2', 'PHQ2_SCORE',
   $json${
     "lang": "es",
     "official": true,
     "language_version": "Spanish for Mexico",
     "source_url": "https://www.phqscreeners.com/images/sites/g/files/g10060481/f/201412/PHQ9_Spanish%20for%20Mexico.pdf",
     "prompt": "Durante las últimas 2 semanas, ¿qué tan seguido le han afectado cualquiera de los siguientes problemas?",
     "items": [
       {"code": "item_1", "text": "Poco interés o placer en hacer las cosas"},
       {"code": "item_2", "text": "Se ha sentido decaído(a), deprimido(a), o sin esperanzas"}
     ],
     "options": [
       {"value": 0, "label": "Para nada"},
       {"value": 1, "label": "Varios días"},
       {"value": 2, "label": "Más de la mitad de los días"},
       {"value": 3, "label": "Casi todos los días"}
     ],
     "translations": {
       "en": {
         "official": true,
         "language_version": "English",
         "source_url": "https://www.phqscreeners.com/select-screener",
         "prompt": "Over the last 2 weeks, how often have you been bothered by the following problems?",
         "items": [
           {"code": "item_1", "text": "Little interest or pleasure in doing things"},
           {"code": "item_2", "text": "Feeling down, depressed, or hopeless"}
         ],
         "options": [
           {"value": 0, "label": "Not at all"},
           {"value": 1, "label": "Several days"},
           {"value": 2, "label": "More than half the days"},
           {"value": 3, "label": "Nearly every day"}
         ]
       }
     },
     "scoring": {"method": "sum", "items": ["item_1", "item_2"], "min": 0, "max": 6, "cutoff": 3}
   }$json$::jsonb,
   $json$[
     {"id": "pfizer_phq9_es_mx", "title": "Pfizer Inc. · phqscreeners.com · PHQ-9 (Spanish for Mexico), ítems 1 y 2", "url": "https://www.phqscreeners.com/images/sites/g/files/g10060481/f/201412/PHQ9_Spanish%20for%20Mexico.pdf", "language_version": "Spanish for Mexico"},
     {"id": "pfizer_phq4_en", "title": "Pfizer Inc. · phqscreeners.com · PHQ-4 (English), ítems 3 y 4", "url": "https://www.phqscreeners.com/select-screener", "language_version": "English"},
     {"id": "phq2_nida", "title": "NIDA CDE – Patient Health Questionnaire-2 (PHQ-2)", "url": "https://cde.nida.nih.gov/node/22"},
     {"id": "nasa_bhp_ops", "title": "NASA NTRS – BHP Operations at JSC (conferencias psicológicas privadas)", "url": "https://ntrs.nasa.gov/api/citations/20170003866/downloads/20170003866.pdf"}
   ]$json$::jsonb,
   'Pfizer Inc. · phqscreeners.com · Developed by Drs. Robert L. Spitzer, Janet B.W. Williams, Kurt Kroenke and colleagues, with an educational grant from Pfizer Inc. No permission required to reproduce, translate, display or distribute. Versiones: English (PHQ-4, ítems 3 y 4; https://www.phqscreeners.com/select-screener) y Spanish for Mexico (PHQ-9, ítems 1 y 2; https://www.phqscreeners.com/images/sites/g/files/g10060481/f/201412/PHQ9_Spanish%20for%20Mexico.pdf).',
   true),
  ('GAD2', 1, 'GAD-2', 'GAD2_SCORE',
   $json${
     "lang": "es",
     "official": true,
     "language_version": "Spanish for Mexico",
     "source_url": "https://www.phqscreeners.com/images/sites/g/files/g10060481/f/201412/GAD7_Spanish%20for%20Mexico.pdf",
     "prompt": "Durante las últimas 2 semanas, ¿con qué frecuencia ha sentido molestias por los siguientes problemas?",
     "items": [
       {"code": "item_1", "text": "Sentirse nervioso/a, intranquilo/a o con los nervios de punta"},
       {"code": "item_2", "text": "No poder dejar de preocuparse o no poder controlar la preocupación"}
     ],
     "options": [
       {"value": 0, "label": "Nunca"},
       {"value": 1, "label": "Varios días"},
       {"value": 2, "label": "Más de la mitad de los días"},
       {"value": 3, "label": "Casi todos los días"}
     ],
     "translations": {
       "en": {
         "official": true,
         "language_version": "English",
         "source_url": "https://www.phqscreeners.com/select-screener",
         "prompt": "Over the last 2 weeks, how often have you been bothered by the following problems?",
         "items": [
           {"code": "item_1", "text": "Feeling nervous, anxious or on edge"},
           {"code": "item_2", "text": "Not being able to stop or control worrying"}
         ],
         "options": [
           {"value": 0, "label": "Not at all"},
           {"value": 1, "label": "Several days"},
           {"value": 2, "label": "More than half the days"},
           {"value": 3, "label": "Nearly every day"}
         ]
       }
     },
     "scoring": {"method": "sum", "items": ["item_1", "item_2"], "min": 0, "max": 6, "cutoff": 3}
   }$json$::jsonb,
   $json$[
     {"id": "pfizer_gad7_es_mx", "title": "Pfizer Inc. · phqscreeners.com · GAD-7 (Spanish for Mexico), ítems 1 y 2", "url": "https://www.phqscreeners.com/images/sites/g/files/g10060481/f/201412/GAD7_Spanish%20for%20Mexico.pdf", "language_version": "Spanish for Mexico"},
     {"id": "pfizer_phq4_en", "title": "Pfizer Inc. · phqscreeners.com · PHQ-4 (English), ítems 1 y 2", "url": "https://www.phqscreeners.com/select-screener", "language_version": "English"},
     {"id": "gad2_kroenke", "title": "Kroenke et al. 2007, Ann Intern Med – Anxiety disorders in primary care (validación GAD-2)", "url": "https://pubmed.ncbi.nlm.nih.gov/17339617/"},
     {"id": "nasa_bhp_ops", "title": "NASA NTRS – BHP Operations at JSC (conferencias psicológicas privadas)", "url": "https://ntrs.nasa.gov/api/citations/20170003866/downloads/20170003866.pdf"}
   ]$json$::jsonb,
   'Pfizer Inc. · phqscreeners.com · Developed by Drs. Robert L. Spitzer, Janet B.W. Williams, Kurt Kroenke and colleagues, with an educational grant from Pfizer Inc. No permission required to reproduce, translate, display or distribute. Versiones: English (PHQ-4, ítems 1 y 2; https://www.phqscreeners.com/select-screener) y Spanish for Mexico (GAD-7, ítems 1 y 2; https://www.phqscreeners.com/images/sites/g/files/g10060481/f/201412/GAD7_Spanish%20for%20Mexico.pdf).',
   true)
ON CONFLICT DO NOTHING;
