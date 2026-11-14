# -*- coding: utf-8 -*-
"""Fuente única de verdad del catálogo de indicadores (v1).
Genera backend/docs/catalogo-indicadores.md y backend/docs/catalogo-indicadores.json
con tools/build_catalog.py. No editar los archivos generados a mano.
"""

# ---------------------------------------------------------------------------
# Fuentes (id -> título, url). Solo URLs verificadas el 14-nov-2026.
# ---------------------------------------------------------------------------
SOURCES = {
    "aha_bp": ("AHA – Understanding Blood Pressure Readings",
               "https://www.heart.org/en/health-topics/high-blood-pressure/understanding-blood-pressure-readings"),
    "ama_bp2025": ("AMA – New BP guideline: 5 things physicians should know (2025 AHA/ACC conserva las categorías de 2017)",
                   "https://www.ama-assn.org/delivering-care/hypertension/new-bp-guideline-5-things-physicians-should-know"),
    "aha_low_bp": ("AHA – Low Blood Pressure: When Blood Pressure Is Too Low",
                   "https://www.heart.org/en/health-topics/high-blood-pressure/the-facts-about-high-blood-pressure/low-blood-pressure-when-blood-pressure-is-too-low"),
    "aha_hr": ("AHA – All About Heart Rate",
               "https://www.heart.org/en/health-topics/high-blood-pressure/the-facts-about-high-blood-pressure/all-about-heart-rate-pulse"),
    "aha_warning": ("AHA – Heart Attack, Stroke and Cardiac Arrest Symptoms",
                    "https://www.heart.org/en/about-us/heart-attack-and-stroke-symptoms"),
    "news2": ("Royal College of Physicians – NEWS2, Chart 1: The NEWS scoring system (reproducido por NHS NWAS)",
              "https://www.nwas.nhs.uk/publications/news2-national-early-warning-score"),
    "statpearls_rr": ("StatPearls (NCBI Bookshelf) – frecuencia respiratoria normal del adulto en reposo",
                      "https://www.ncbi.nlm.nih.gov/books/NBK537306/"),
    "chemm_start": ("HHS CHEMM – START Adult Triage Algorithm",
                    "https://chemm.hhs.gov/startalgotext.htm"),
    "who_pulseox": ("WHO Pulse Oximetry Training Manual (texto literal reproducido por PhenX Toolkit)",
                    "https://dev.phenxtoolkit.org/protocols/view/91102"),
    "cdc_fever": ("CDC – Definitions of Signs, Symptoms, and Conditions of Ill Travelers (fiebre)",
                  "https://www.cdc.gov/quarantine/maritime/definitions-signs-symptoms-conditions-ill-travelers.html"),
    "mayo_hypothermia": ("Mayo Clinic – Hypothermia: First aid",
                         "https://www.mayoclinic.org/first-aid/first-aid-hypothermia/basics/ART-20056624"),
    "adam_fever": ("A.D.A.M. Medical Encyclopedia – Fever (Penn Medicine; mismo texto que MedlinePlus 003090)",
                   "https://www3.pennmedicine.org/for-patients-and-visitors/patient-information/conditions-treated-a-to-z/fever"),
    "ada_dx": ("American Diabetes Association – Diagnosis",
               "https://diabetes.org/about-diabetes/diagnosis"),
    "ada_hypo": ("American Diabetes Association – Hypoglycemia (versión profesional, 2025)",
                 "https://professional.diabetes.org/sites/dpro/files/2025-05/hypoglycemia-hcp-5-27-25.pdf"),
    "aafp_dm": ("AAFP – Diabetes Mellitus: Diagnosis and Screening (glucosa aleatoria 140–180)",
                "https://www.aafp.org/pubs/afp/issues/2010/0401/p863.html"),
    "aasm_sleep": ("AASM/SRS – Recommended Amount of Sleep for a Healthy Adult (consenso)",
                   "https://pmc.ncbi.nlm.nih.gov/articles/PMC4434546/"),
    "aasm_press": ("AASM – Seven or more hours of sleep per night: a health necessity for adults",
                   "https://aasm.org/seven-or-more-hours-of-sleep-per-night-a-health-necessity-for-adults/"),
    "ochmo_sleep": ("NASA OCHMO-TB-041 – Sleep Accommodations (NASA-STD-3001)",
                    "https://www.nasa.gov/wp-content/uploads/2023/03/sleep-accomodations-technical-brief-ochmo.pdf"),
    "ochmo_rad": ("NASA OCHMO-TB-020 – Design for Ionizing Radiation Protection (NASA-STD-3001)",
                  "https://www.nasa.gov/wp-content/uploads/2023/03/radiation-protection-technical-brief-ochmo.pdf"),
    "ntrs_ascend_rad": ("NASA NTRS – Simonsen et al., ASCEND (dosis ISS 0.2–0.5 mSv/día)",
                        "https://ntrs.nasa.gov/api/citations/20250006168/downloads/ASCEND%20Simonsen%20draft%201.pdf"),
    "ntrs_ars_spe": ("NASA HRP – Space Radiation Protection Strategies (ARS por eventos solares)",
                     "https://ntrs.nasa.gov/api/citations/20170001372/downloads/20170001372.pdf"),
    "orau_ars": ("ORAU/REACTS – Triage handout: pródromo de ARS y tiempo hasta el vómito",
                 "https://www.orau.gov/hsc/RadMassCasualties/assets/4_Triage_Handout.pdf"),
    "csa_rad": ("CSA – Monitoring radiation for astronaut health (2026)",
                "https://www.asc-csa.gc.ca/eng/news/articles/2026/2026-02-26-monitoring-radiation-astronaut-health.asp"),
    "ochmo_co2": ("NASA OCHMO-TB-004 – Carbon Dioxide (NASA-STD-3001 Vol. 2 Rev D [V2 6004])",
                  "https://www.nasa.gov/ochmo-tb-004-carbon-dioxide-2/"),
    "ntrs_co2_smac": ("NASA NTRS – Scully et al., Effects of Acute Exposures to CO2 upon Cognitive Functions (SMAC histórico 24 h = 10 mmHg)",
                      "https://ntrs.nasa.gov/api/citations/20150021777/downloads/20150021777.pdf"),
    "jsc20584b": ("NASA JSC 20584 Rev B – SMACs (2022): se eliminan los SMAC de CO2",
                  "https://ntrs.nasa.gov/citations/20230001817"),
    "ochmo_eclss": ("NASA OCHMO-TB-002 – ECLSS: Human-Centered Approach ([V2 6012], [V2 6013])",
                    "https://www.nasa.gov/wp-content/uploads/2023/07/eclss-technical-brief-ochmo.pdf"),
    "ochmo_acoustics": ("NASA OCHMO-TB-035 – Acoustics ([V2 6077], [V2 6078])",
                        "https://www.nasa.gov/sites/default/files/atoms/files/acoustics_technical_brief_ochmo_0.pdf"),
    "ntrs_nc_dba": ("NASA NTRS – Goodman, acústica en naves (NC-50 ≈ 58.1 dBA; NC-40 ≈ 49.0 dBA)",
                    "https://ntrs.nasa.gov/api/citations/20090043801/downloads/20090043801.pdf"),
    "ntrs_body_mass": ("NASA NTRS – Smith, Heer, Zwart: Nutrition SMO (pérdida de 2–5 % de masa el primer mes)",
                       "https://ntrs.nasa.gov/citations/20140013313"),
    "sn_smith": ("Science News – The Zero Gravity Diet (declaraciones de S. M. Smith, NASA JSC)",
                 "https://www.sciencenews.org/?p=40630"),
    "aafp_weight": ("AAFP – Unintentional Weight Loss in Older Adults (>5 % en 6–12 meses)",
                    "https://www.aafp.org/pubs/afp/issues/2014/0501/p718.html"),
    "ochmo_nutrition": ("NASA OCHMO-TB-013 – Food and Nutrition",
                        "https://www.nasa.gov/wp-content/uploads/2023/12/ochmo-tb-013-food-and-nutrition.pdf"),
    "ochmo_exercise": ("NASA OCHMO-TB-031 – Exercise Overview",
                       "https://www.nasa.gov/wp-content/uploads/2023/12/ochmo-tb-031-exercise-overview.pdf"),
    "ntrs_sans_2023": ("NASA NTRS – SANS: 2023 Clinical Update",
                       "https://ntrs.nasa.gov/citations/20220014606"),
    "ntrs_sans_intro": ("NASA NTRS – Brunstetter, Introduction to SANS and its Risk to NASA Astronauts",
                        "https://ntrs.nasa.gov/api/citations/20170009173/downloads/20170009173.pdf"),
    "nasa_hrp_risks": ("NASA HRP – Risks of Human Spaceflight",
                       "https://www.nasa.gov/hrp/risks/"),
    "nasa_hrp_hazards": ("NASA HRP – 5 Hazards of Human Spaceflight",
                         "https://www.nasa.gov/hrp/hazards/"),
    "nasa_bhp_measures": ("NASA NTRS – BHP Laboratory Standard Measures",
                          "https://ntrs.nasa.gov/api/citations/20170005421/downloads/20170005421.pdf"),
    "nasa_bhp_ops": ("NASA NTRS – BHP Operations at JSC (conferencias psicológicas privadas)",
                     "https://ntrs.nasa.gov/api/citations/20170003866/downloads/20170003866.pdf"),
    "phq2_nida": ("NIDA CDE – Patient Health Questionnaire-2 (PHQ-2)",
                  "https://cde.nida.nih.gov/node/22"),
    "gad2_kroenke": ("Kroenke et al. 2007, Ann Intern Med – Anxiety disorders in primary care (validación GAD-2)",
                     "https://pubmed.ncbi.nlm.nih.gov/17339617/"),
    "pvtb_basner": ("Basner, Mollicone, Dinges 2011, Acta Astronautica – Validity and Sensitivity of a Brief PVT (PVT-B)",
                    "https://pmc.ncbi.nlm.nih.gov/articles/PMC3197786"),
    "pvt_fd": ("Basner & Rubinstein 2011, JOEM – Fitness for duty: 3-min PVT (11 y 20 lapsos, umbral 355 ms)",
               "https://pmc.ncbi.nlm.nih.gov/articles/PMC3190077"),
    "psytoolkit_pvtb": ("PsyToolkit – PVT-B (falsos inicios < 100 ms, según Basner 2011)",
                        "https://www.psytoolkit.org/library/pvtb.html"),
    "penn_cognition": ("Penn Medicine – Cognition Test Battery",
                       "https://www.med.upenn.edu/uep/cognition.html"),
}

# ---------------------------------------------------------------------------
# Catálogos compartidos
# ---------------------------------------------------------------------------
HAZARDS = {
    "space_radiation": "Space Radiation",
    "isolation_confinement": "Isolation and Confinement",
    "distance_from_earth": "Distance from Earth",
    "gravity_fields": "Gravity Fields",
    "hostile_closed_env": "Hostile/Closed Environments",
}

BODY_ZONES = {
    "heart": "Corazón y circulación",
    "lungs": "Pulmones y respiración",
    "immune": "Sistema inmune",
    "metabolism": "Metabolismo y nutrición",
    "muscle": "Músculo",
    "bones": "Huesos",
    "brain": "Cerebro, sueño y ánimo",
    "eyes": "Ojos",
    "environment": "Entorno del módulo (no es zona del cuerpo; tarjeta aparte en la figura)",
    "by_symptom": "Según el síntoma (se toma de la zona de cada síntoma)",
}

# Síntomas: code -> (texto, zona, red_flag)
SYMPTOMS = {
    "chest_pain": ("Dolor o presión en el pecho", "heart", True),
    "shortness_of_breath": ("Falta de aire", "lungs", True),
    "face_drooping": ("Un lado de la cara caído o adormecido", "brain", True),
    "arm_weakness": ("Debilidad o adormecimiento de un brazo o pierna", "brain", True),
    "speech_difficulty": ("Dificultad para hablar o entender", "brain", True),
    "sudden_vision_change": ("Cambio súbito de visión (doble, borrosa o pérdida)", "eyes", True),
    "sudden_balance_loss": ("Pérdida súbita del equilibrio o la coordinación", "brain", True),
    "severe_headache_sudden": ("Dolor de cabeza súbito e intenso sin causa conocida", "brain", True),
    "unresponsive": ("No responde", "brain", True),
    "confusion": ("Confusión nueva", "brain", True),
    "fainting": ("Desmayo o casi desmayo", "heart", False),
    "dizziness": ("Mareo", "heart", False),
    "palpitations": ("Palpitaciones", "heart", False),
    "headache": ("Dolor de cabeza", "brain", False),
    "nausea": ("Náusea", "metabolism", False),
    "vomiting": ("Vómito", "metabolism", False),
    "diarrhea": ("Diarrea", "metabolism", False),
    "fever_feeling": ("Sensación de fiebre o escalofríos", "immune", False),
    "cough": ("Tos", "lungs", False),
    "sore_throat": ("Dolor de garganta", "immune", False),
    "rash": ("Sarpullido o lesiones en la piel", "immune", False),
    "excessive_thirst": ("Sed excesiva", "metabolism", False),
    "frequent_urination": ("Orinar mucho más de lo habitual", "metabolism", False),
    "blurred_vision": ("Visión borrosa", "eyes", False),
    "back_pain": ("Dolor de espalda", "bones", False),
    "muscle_pain": ("Dolor muscular", "muscle", False),
    "bone_pain": ("Dolor óseo o articular", "bones", False),
    "fatigue": ("Cansancio fuera de lo habitual", "brain", False),
}

RED_FLAGS = [k for k, v in SYMPTOMS.items() if v[2]]
INFECTION_LIKE = ["fever_feeling", "cough", "sore_throat", "diarrhea", "vomiting", "rash"]

# ---------------------------------------------------------------------------
# Helpers para escribir reglas
# ---------------------------------------------------------------------------
def C(field, op, value):
    return {"field": field, "op": op, "value": value}

def ANY(*conds):
    return {"any": list(conds)}

def ALL(*conds):
    return {"all": list(conds)}

DEFAULT = {"all": []}  # grupo vacío = siempre verdadero (regla por defecto)

def R(level, when, recommendation, escalation, source_ids, basis="source", note=None):
    r = {"level": level, "when": when, "recommendation": recommendation,
         "escalation": escalation, "source_ids": source_ids, "basis": basis}
    if note:
        r["note"] = note
    return r

def comp(name, type_, unit=None, role="value", required=True, values=None):
    d = {"name": name, "type": type_, "role": role, "required": required}
    if unit:
        d["unit"] = unit
    if values:
        d["values"] = values
    return d

SYMPTOMS_COMP = comp("symptoms", "string[]", role="context", required=False,
                     values="códigos del catálogo de síntomas")

# ---------------------------------------------------------------------------
# Indicadores
# block: 1 = MVP (signos vitales, glucosa, sueño, radiación, CO2)
#        2 = MVP bienestar (confidencial)
#        3 = resto
# ---------------------------------------------------------------------------
INDICATORS = []

# ============================ BLOQUE 1 =====================================
INDICATORS.append({
    "block": 1, "code": "BLOOD_PRESSURE", "name": "Presión arterial", "unit": "mmHg",
    "value_type": "composite",
    "components": [comp("systolic", "number", "mmHg"), comp("diastolic", "number", "mmHg"), SYMPTOMS_COMP],
    "derived_fields": [],
    "hazards": ["gravity_fields"], "body_zone": "heart",
    "input_methods": ["manual", "camera"], "sensitivity": "standard",
    "guide": {
        "measurable": "Sí. Tensiómetro automático de brazo, tras 5 min de reposo, anclado o sentado y con el brazo a la altura del corazón. La foto de la pantalla del tensiómetro queda como respaldo.",
        "why": "La presión muy alta puede dañar corazón, cerebro y riñones; la muy baja puede causar mareo o desmayo.",
        "hazard_effect": "Gravity Fields: la ingravidez altera la circulación y el funcionamiento del corazón y los vasos (riesgo de adaptaciones cardiovasculares de NASA HRP). Al pasar a 0.16 g, 0.38 g o 1 g puede aparecer mareo al incorporarse.",
        "when_to_escalate": "Tripulación + flight surgeon: más de 180/120, o sistólica de 90 o menos con mareo, desmayo o confusión. Flight surgeon de rutina: 140/90 o más.",
        "prevention": "Medir con buena técnica y repetir antes de concluir, cumplir el ejercicio prescrito, hidratarse y dormir lo suficiente.",
    },
    "rules": [
        R("critical", ALL(ANY(C("systolic", "gt", 180), C("diastolic", "gt", 120)),
                          C("symptoms", "has_any", ["chest_pain", "shortness_of_breath", "back_pain", "arm_weakness",
                                                    "face_drooping", "sudden_vision_change", "speech_difficulty"])),
          "Tu presión está muy alta y tienes síntomas de alarma. Avisa ya a tu tripulación y activa el modo emergencia.",
          "flight_surgeon", ["aha_bp"]),
        R("critical", ANY(C("systolic", "gt", 180), C("diastolic", "gt", 120)),
          "Tu presión está muy alta. Quédate en reposo 5 minutos y vuelve a medir. Si sigue igual, se avisa a tu tripulación y al flight surgeon.",
          "flight_surgeon", ["aha_bp"]),
        R("critical", ALL(C("systolic", "lte", 90), C("symptoms", "has_any", ["dizziness", "fainting", "confusion"])),
          "Tu presión está baja y tienes mareo o confusión. Quédate quieto y sujeto, y avisa a tu tripulación.",
          "flight_surgeon", ["aha_low_bp", "news2"], "source_adapted",
          "Sistólica ≤90 = puntaje 3 de NEWS2; AHA: la presión baja preocupa cuando hay síntomas."),
        R("caution", ANY(C("systolic", "gte", 140), C("diastolic", "gte", 90)),
          "Tu presión está alta. Repite la medición mañana a la misma hora; si sigue así, el flight surgeon la revisará.",
          "flight_surgeon", ["aha_bp", "ama_bp2025"]),
        R("caution", ANY(C("systolic", "gte", 130), C("diastolic", "gte", 80)),
          "Tu presión está un poco alta. Repite la medición en reposo y cumple tu ejercicio y tu hidratación.",
          "self_care", ["aha_bp", "ama_bp2025"]),
        R("caution", ANY(C("systolic", "lt", 90), C("diastolic", "lt", 60)),
          "Tu presión está baja. Bebe agua y muévete despacio. Si te mareas, regístralo como síntoma.",
          "self_care", ["aha_low_bp"]),
        R("caution", C("systolic", "gte", 120),
          "Tu presión está ligeramente elevada. No es urgente: mantén tus hábitos y vuelve a medir en tu próxima rutina.",
          "self_care", ["aha_bp"]),
        R("normal", DEFAULT, "Tu presión está en rango normal.", "self_care", ["aha_bp"]),
    ],
})

INDICATORS.append({
    "block": 1, "code": "HEART_RATE", "name": "Frecuencia cardíaca en reposo", "unit": "lpm",
    "value_type": "simple",
    "components": [comp("value", "number", "lpm"),
                   comp("at_rest", "boolean", role="context", required=False),
                   SYMPTOMS_COMP],
    "derived_fields": [],
    "hazards": ["gravity_fields"], "body_zone": "heart",
    "input_methods": ["manual", "wearable"], "sensitivity": "standard",
    "guide": {
        "measurable": "Sí. Pulsera o pulsioxímetro, o contando el pulso 30 s y multiplicando por 2. Se evalúa solo en reposo.",
        "why": "Un pulso en reposo muy rápido o muy lento puede indicar deshidratación, fiebre, problemas del ritmo o desacondicionamiento.",
        "hazard_effect": "Gravity Fields: la ingravidez cambia la circulación y el trabajo del corazón; los cambios de gravedad pueden causar mareo y pulso acelerado al incorporarse.",
        "when_to_escalate": "Tripulación + flight surgeon: 40 lpm o menos, o 131 lpm o más, en reposo. Tripulación: 111–130 lpm, o pulso lento con mareo.",
        "prevention": "Hidratación, sueño, ejercicio prescrito y medir siempre en las mismas condiciones.",
    },
    "rules": [
        R("unrated", C("at_rest", "eq", False),
          "Esta medición se hizo en actividad; los rangos de reposo no aplican.", "self_care", ["aha_hr"],
          "source_adapted", "La AHA define el rango normal para personas sentadas o acostadas, en calma."),
        R("critical", ANY(C("value", "lte", 40), C("value", "gte", 131)),
          "Tu pulso en reposo está fuera de un rango seguro. Quédate en reposo, vuelve a medir en 5 minutos y avisa a tu tripulación.",
          "flight_surgeon", ["news2"], "source_adapted", "Puntaje 3 de NEWS2 (≤40 o ≥131)."),
        R("caution", ALL(C("value", "lt", 60), C("symptoms", "has_any", ["dizziness", "fainting", "confusion"])),
          "Tu pulso está lento y tienes mareo. Quédate sujeto y avisa a tu tripulación.",
          "crew", ["aha_hr"], "source_adapted"),
        R("caution", C("value", "gte", 111),
          "Tu pulso en reposo está alto. Descansa, bebe agua y vuelve a medir en 15 minutos.",
          "crew", ["aha_hr", "news2"], "source_adapted", "NEWS2 puntaje 2 en 111–130."),
        R("caution", C("value", "gt", 100),
          "Tu pulso en reposo está algo alto. Descansa, hidrátate y vuelve a medir más tarde.",
          "self_care", ["aha_hr"]),
        R("caution", C("value", "lt", 60),
          "Tu pulso está por debajo de 60. En personas muy entrenadas puede ser normal; si te sientes mareado, regístralo como síntoma.",
          "self_care", ["aha_hr"]),
        R("normal", DEFAULT, "Tu pulso en reposo está en rango normal.", "self_care", ["aha_hr"]),
    ],
})

INDICATORS.append({
    "block": 1, "code": "RESP_RATE", "name": "Frecuencia respiratoria", "unit": "rpm",
    "value_type": "simple",
    "components": [comp("value", "number", "rpm")],
    "derived_fields": [],
    "hazards": ["hostile_closed_env"], "body_zone": "lungs",
    "input_methods": ["wearable", "manual"], "sensitivity": "standard",
    "guide": {
        "measurable": "Sí. Contando respiraciones durante 60 s en reposo, o estimada por la pulsera.",
        "why": "Respirar muy rápido o muy lento es una de las primeras señales de que algo va mal (falta de oxígeno, CO₂ alto, infección).",
        "hazard_effect": "Hostile/Closed: un CO₂ alto en la cabina o una infección hacen respirar más rápido. El triaje usa este mismo dato (START: más de 30 rpm = atención inmediata).",
        "when_to_escalate": "Tripulación + flight surgeon: 8 rpm o menos, o 25 rpm o más. Tripulación: 21–24 rpm.",
        "prevention": "Vigilar el CO₂ del módulo, reportar tos o fiebre temprano y medir en reposo.",
    },
    "rules": [
        R("critical", ANY(C("value", "lte", 8), C("value", "gte", 25)),
          "Tu respiración está fuera de un rango seguro. Avisa ya a tu tripulación y revisa el CO₂ del módulo.",
          "flight_surgeon", ["news2", "chemm_start"], "source_adapted", "Puntaje 3 de NEWS2; START: >30 rpm = inmediato."),
        R("caution", C("value", "gte", 21),
          "Respiras más rápido de lo normal. Descansa 5 minutos y vuelve a medir; revisa el CO₂ del módulo.",
          "crew", ["statpearls_rr", "news2"], "source_adapted"),
        R("caution", C("value", "lte", 11),
          "Respiras más lento de lo normal. Vuelve a medir en reposo, contando 60 segundos.",
          "self_care", ["statpearls_rr", "news2"], "source_adapted"),
        R("normal", DEFAULT, "Tu respiración está en rango normal (12–20 rpm).", "self_care", ["statpearls_rr"]),
    ],
})

INDICATORS.append({
    "block": 1, "code": "SPO2", "name": "Saturación de oxígeno", "unit": "%",
    "value_type": "simple",
    "components": [comp("value", "number", "%")],
    "derived_fields": [],
    "hazards": ["hostile_closed_env"], "body_zone": "lungs",
    "input_methods": ["manual", "wearable"], "sensitivity": "standard",
    "guide": {
        "measurable": "Sí. Pulsioxímetro de dedo o pulsera; dedo tibio y quieto durante la lectura.",
        "why": "Indica cuánto oxígeno lleva la sangre. Un valor bajo puede significar que el cuerpo no recibe suficiente oxígeno.",
        "hazard_effect": "Hostile/Closed: depende de la atmósfera de la cabina (presión, O₂) y de la salud pulmonar; NASA HRP estudia el riesgo de hipoxia en atmósferas de exploración.",
        "when_to_escalate": "Tripulación + flight surgeon: 91 % o menos. Tripulación: 92–93 %.",
        "prevention": "Revisar la atmósfera del módulo, repetir con buena técnica y reportar falta de aire de inmediato.",
    },
    "rules": [
        R("critical", C("value", "lte", 91),
          "Tu oxígeno en sangre está bajo. Avisa ya a tu tripulación; revisen la atmósfera del módulo y el protocolo de oxígeno.",
          "flight_surgeon", ["who_pulseox", "news2"], "source_adapted",
          "OMS: SpO₂ < 90 % es una emergencia clínica; NEWS2: ≤91 % = puntaje 3."),
        R("caution", C("value", "lte", 93),
          "Tu oxígeno está por debajo de lo normal. Vuelve a medir con el dedo tibio; si se repite, avisa a tu tripulación.",
          "crew", ["who_pulseox", "news2"], "source_adapted"),
        R("caution", C("value", "lte", 94),
          "Tu oxígeno está ligeramente bajo. Repite la medición con el dedo tibio y quieto.",
          "self_care", ["who_pulseox"]),
        R("normal", DEFAULT, "Tu oxígeno está en rango normal (95 % o más).", "self_care", ["who_pulseox"]),
    ],
    "notes": ["Los cortes valen para atmósfera a nivel del mar. En atmósferas de exploración con menor presión parcial de O₂, el admin debe poder ajustar los cortes por entorno (pendiente de fuente)."],
})

INDICATORS.append({
    "block": 1, "code": "BODY_TEMP", "name": "Temperatura corporal", "unit": "°C",
    "value_type": "simple",
    "components": [comp("value", "number", "°C")],
    "derived_fields": [],
    "hazards": ["hostile_closed_env"], "body_zone": "immune",
    "input_methods": ["manual"], "sensitivity": "standard",
    "guide": {
        "measurable": "Sí. Termómetro digital oral o de oído; siempre con el mismo método.",
        "why": "La fiebre es una señal temprana de infección; la temperatura muy baja también es peligrosa.",
        "hazard_effect": "Hostile/Closed: en un espacio cerrado una infección pasa fácil a toda la tripulación; NASA HRP describe cambios del sistema inmune y del microbioma que aumentan el riesgo de enfermar.",
        "when_to_escalate": "Flight surgeon: 35.0 °C o menos, o 39.4 °C o más. Tripulación: fiebre de 38.0 °C o más (riesgo de contagio).",
        "prevention": "Higiene de manos y superficies, reportar síntomas temprano, hidratación y descanso.",
    },
    "rules": [
        R("critical", C("value", "lte", 35.0),
          "Tu temperatura está demasiado baja. Abrígate, avisa a tu tripulación y vuelve a medir.",
          "flight_surgeon", ["mayo_hypothermia", "news2"], "source_adapted",
          "Hipotermia: < 35 °C (Mayo Clinic, citando a CDC); NEWS2: ≤35.0 = puntaje 3."),
        R("critical", C("value", "gte", 39.4),
          "Tienes fiebre alta. Avisa a tu tripulación, bebe líquidos y se consultará al flight surgeon.",
          "flight_surgeon", ["adam_fever"], "source_adapted",
          "A.D.A.M.: un adulto debe contactar a su médico si la fiebre se mantiene en 39.4 °C (103 °F) o más."),
        R("caution", C("value", "gte", 38.0),
          "Tienes fiebre. Descansa, bebe líquidos, usa medidas de higiene para no contagiar y vuelve a medir en 4 horas.",
          "crew", ["cdc_fever"], "source_adapted",
          "Escalamiento a tripulación por contagio en espacio cerrado; reevaluar en 4 h es regla de diseño."),
        R("caution", C("value", "lte", 36.0),
          "Tu temperatura está algo baja. Abrígate y vuelve a medir en 30 minutos.",
          "self_care", ["news2"], "source_adapted", "NEWS2: 35.1–36.0 = puntaje 1."),
        R("normal", DEFAULT, "Tu temperatura está en rango normal.", "self_care", ["cdc_fever", "news2"]),
    ],
})

INDICATORS.append({
    "block": 1, "code": "GLUCOSE", "name": "Glucosa en sangre", "unit": "mg/dL",
    "value_type": "simple",
    "components": [comp("value", "number", "mg/dL"),
                   comp("fasting", "boolean", role="context", required=True),
                   SYMPTOMS_COMP],
    "derived_fields": [],
    "hazards": ["distance_from_earth", "gravity_fields"], "body_zone": "metabolism",
    "input_methods": ["manual", "camera"], "sensitivity": "standard",
    "guide": {
        "measurable": "Sí. Glucómetro con gota de sangre del dedo; la foto de la pantalla queda como respaldo. Indicar si estás en ayunas (8 h sin comer).",
        "why": "La glucosa es la energía del cuerpo. Muy baja puede causar confusión o desmayo; alta de forma repetida debe revisarla un médico.",
        "hazard_effect": "Distance from Earth: los alimentos son limitados y la ingesta suele ser menor (riesgo de nutrición inadecuada de NASA HRP); Gravity Fields: menos actividad y cambios metabólicos en ingravidez.",
        "when_to_escalate": "Tripulación + flight surgeon: menos de 54 mg/dL, menos de 70 con confusión o desmayo, o 200 o más con síntomas. Flight surgeon de rutina: 126 o más en ayunas, o 200 o más sin síntomas.",
        "prevention": "Comer las raciones completas, no saltarse comidas antes de una EVA o del ejercicio, y medir en ayunas cuando la rutina lo pida.",
    },
    "rules": [
        R("critical", ALL(C("value", "lt", 70), C("symptoms", "has_any", ["confusion", "fainting", "unresponsive"])),
          "Glucosa baja con confusión. La tripulación debe ayudarte a tomar azúcar de absorción rápida ahora.",
          "flight_surgeon", ["ada_hypo"], "source", "ADA nivel 3: alteración mental o física que requiere ayuda."),
        R("critical", C("value", "lt", 54),
          "Tu glucosa está muy baja. Toma ya 15 g de azúcar de absorción rápida, vuelve a medir en 15 minutos y avisa a tu tripulación.",
          "flight_surgeon", ["ada_hypo"], "source", "ADA nivel 2: < 54 mg/dL. Regla 15-15."),
        R("critical", ALL(C("value", "gte", 200),
                          C("symptoms", "has_any", ["excessive_thirst", "frequent_urination", "blurred_vision",
                                                    "nausea", "vomiting", "confusion"])),
          "Tu glucosa está muy alta y tienes síntomas. Avisa a tu tripulación; se consultará al flight surgeon.",
          "flight_surgeon", ["ada_dx"], "source_adapted",
          "ADA: glucosa aleatoria ≥200 con síntomas cumple un criterio diagnóstico. Clasificarla como crítica es decisión de diseño."),
        R("caution", C("value", "lt", 70),
          "Tu glucosa está baja. Toma 15 g de azúcar de absorción rápida y vuelve a medir en 15 minutos.",
          "self_care", ["ada_hypo"], "source", "ADA nivel 1: 54–69 mg/dL."),
        R("caution", C("value", "gte", 200),
          "Tu glucosa está alta. Vuelve a medir mañana en ayunas; el flight surgeon revisará el resultado.",
          "flight_surgeon", ["ada_dx"], "source_adapted"),
        R("caution", ALL(C("fasting", "eq", True), C("value", "gte", 126)),
          "Tu glucosa en ayunas está alta. Hace falta confirmarla otro día; el flight surgeon la revisará.",
          "flight_surgeon", ["ada_dx"], "source", "ADA: ≥126 en ayunas requiere confirmación."),
        R("caution", ALL(C("fasting", "eq", True), C("value", "gte", 100)),
          "Tu glucosa en ayunas está algo alta. Repite la medición en ayunas otro día.",
          "self_care", ["ada_dx"], "source", "ADA: 100–125 en ayunas."),
        R("caution", ALL(C("fasting", "eq", False), C("value", "gte", 140)),
          "Tu glucosa después de comer está algo alta. Mide mañana en ayunas para comparar.",
          "self_care", ["aafp_dm", "ada_dx"], "source_adapted",
          "AAFP: valores aleatorios de 140–180 ameritan una prueba más definitiva; ADA: 2 h post-carga normal < 140."),
        R("normal", DEFAULT, "Tu glucosa está en rango normal.", "self_care", ["ada_dx"]),
    ],
})

INDICATORS.append({
    "block": 1, "code": "SLEEP_HOURS", "name": "Horas de sueño", "unit": "h",
    "value_type": "simple",
    "components": [comp("value", "number", "h")],
    "derived_fields": [{"name": "consecutive_nights_le_6h", "type": "integer",
                        "how": "noches seguidas (incluida la actual) con ≤ 6 h"}],
    "hazards": ["isolation_confinement"], "body_zone": "brain",
    "input_methods": ["wearable", "manual"], "sensitivity": "standard",
    "guide": {
        "measurable": "Sí. Actigrafía con la pulsera (NASA la usa en vuelo) o registro manual.",
        "why": "Dormir poco reduce la atención y aumenta los errores; en una misión, un error puede ser grave.",
        "hazard_effect": "Isolation and Confinement: ruido, luz, horarios cambiantes y confinamiento reducen el sueño; en vuelo los astronautas duermen en promedio 6–6.5 h (NASA OCHMO).",
        "when_to_escalate": "Flight surgeon: 7 noches seguidas con 6 h o menos. Tripulación (para ajustar horarios): 3 noches seguidas con 6 h o menos.",
        "prevention": "Respetar el periodo de sueño, oscuridad y tapones contra el ruido, y hacer la prueba de reacción antes de una tarea crítica si dormiste poco.",
    },
    "rules": [
        R("critical", C("consecutive_nights_le_6h", "gte", 7),
          "Llevas una semana durmiendo 6 horas o menos. Tu atención puede estar tan afectada como si no hubieras dormido un día entero. Se avisa al flight surgeon y se recomienda la prueba de reacción antes de tareas críticas.",
          "flight_surgeon", ["ochmo_sleep", "aasm_press"], "source_adapted",
          "NASA OCHMO-TB-041: tras 7 días de 6 h de sueño, el desempeño equivale a 24–36 h sin dormir."),
        R("caution", C("consecutive_nights_le_6h", "gte", 3),
          "Llevas varias noches durmiendo poco. Habla con tu tripulación para proteger tu próximo periodo de sueño.",
          "crew", ["aasm_press"], "design_rule", "El umbral de 3 noches es regla de diseño (pendiente de validar con el flight surgeon)."),
        R("caution", C("value", "lte", 6),
          "Dormiste 6 horas o menos. Si hoy tienes una tarea crítica, haz antes la prueba de reacción.",
          "self_care", ["aasm_press"], "source", "AASM: 6 h o menos es insuficiente para sostener salud y seguridad."),
        R("caution", C("value", "lt", 7),
          "Dormiste menos de 7 horas. Intenta proteger tu próximo periodo de sueño.",
          "self_care", ["aasm_sleep"]),
        R("normal", DEFAULT, "Dormiste 7 horas o más.", "self_care", ["aasm_sleep"]),
    ],
})

INDICATORS.append({
    "block": 1, "code": "RAD_DOSE_DAILY", "name": "Dosis de radiación diaria", "unit": "mSv/día",
    "value_type": "simple",
    "components": [comp("value", "number", "mSv"),
                   comp("event_active", "boolean", role="context", required=False),
                   SYMPTOMS_COMP],
    "derived_fields": [
        {"name": "ratio_to_baseline", "type": "number",
         "how": "valor / mediana de los últimos 7 días del mismo tripulante (sin días de evento)"},
        {"name": "event_dose_msv", "type": "number",
         "how": "suma de dosis desde que se activó la alerta de evento solar (null si no hay evento)"},
    ],
    "hazards": ["space_radiation"], "body_zone": "immune",
    "input_methods": ["sensor"], "sensitivity": "standard",
    "guide": {
        "measurable": "Sí. Dosímetros personales y de área; la CSA desarrolla un espectrómetro de neutrones autónomo (CANS) porque los neutrones aportan cerca del 30 % de la radiación en la ISS. En la demo, dosímetro simulado.",
        "why": "La radiación acumulada aumenta el riesgo de cáncer; una dosis alta en poco tiempo (evento solar) puede causar síntomas agudos.",
        "hazard_effect": "Space Radiation: fuera de la protección de la Tierra, los rayos cósmicos y los eventos solares aumentan la dosis. Como referencia, en la ISS se acumulan 0.2–0.5 mSv por día.",
        "when_to_escalate": "Flight surgeon: dosis del evento de 125 mSv o más, o náusea o vómito durante un evento. Crítico: 250 mSv en un evento (límite de NASA). Tripulación: dosis del día al doble de lo habitual.",
        "prevention": "Ir al refugio de tormenta en cuanto haya alerta solar, reducir el tiempo fuera del refugio y llevar siempre el dosímetro.",
    },
    "rules": [
        R("critical", ALL(C("event_active", "eq", True), C("symptoms", "has_any", ["nausea", "vomiting"])),
          "Tienes náusea o vómito durante un evento solar. Activa el modo emergencia: el triaje te guiará con el módulo de radiación.",
          "flight_surgeon", ["orau_ars", "ntrs_ars_spe"], "source_adapted",
          "El vómito es parte del pródromo del síndrome agudo por radiación; en vuelo también puede deberse al mareo espacial, por eso pasa al triaje."),
        R("critical", C("event_dose_msv", "gte", 250),
          "La dosis de este evento alcanzó el límite de NASA para eventos solares. Permanece en el refugio; se avisa al flight surgeon.",
          "flight_surgeon", ["ochmo_rad"], "source", "NASA-STD-3001 Vol. 1 [V1 4031]: 250 mSv por evento solar."),
        R("caution", C("event_dose_msv", "gte", 125),
          "La dosis del evento ya es la mitad del límite. Permanece en el refugio; se avisa al flight surgeon.",
          "flight_surgeon", ["ochmo_rad"], "design_rule", "50 % del límite de 250 mSv: margen de diseño."),
        R("caution", C("ratio_to_baseline", "gte", 2),
          "Tu dosis de hoy es al menos el doble de lo habitual. Revisa las alertas de clima espacial y sigue el protocolo del refugio.",
          "crew", ["ntrs_ascend_rad"], "design_rule", "Factor 2 sobre la línea base: regla de diseño (pendiente de fuente)."),
        R("normal", DEFAULT, "Tu dosis de hoy está dentro de lo habitual para esta misión.", "self_care", ["ntrs_ascend_rad"]),
    ],
})

INDICATORS.append({
    "block": 1, "code": "RAD_DOSE_CUM", "name": "Dosis de radiación acumulada (carrera)", "unit": "mSv",
    "value_type": "simple",
    "components": [comp("value", "number", "mSv")],
    "derived_fields": [
        {"name": "pct_of_career_limit", "type": "number", "how": "valor / 600 × 100"},
        {"name": "projected_end_msv", "type": "number",
         "how": "valor + mediana diaria × días restantes de misión"},
    ],
    "hazards": ["space_radiation"], "body_zone": "immune",
    "input_methods": ["sensor"], "sensitivity": "standard",
    "guide": {
        "measurable": "Sí. Se calcula sumando las dosis diarias del dosímetro a la dosis de carrera previa.",
        "why": "Cuanta más dosis se acumula, mayor es el riesgo de cáncer a largo plazo.",
        "hazard_effect": "Space Radiation: NASA limita la dosis efectiva de carrera a 600 mSv para todas las edades y sexos (riesgo de cánceres inducidos por radiación).",
        "when_to_escalate": "Flight surgeon: proyección de 600 mSv o más al final de la misión, o 80 % del límite alcanzado. Crítico: 600 mSv alcanzados.",
        "prevention": "Planear las EVA y el tiempo fuera del refugio según la proyección, y aplicar el principio ALARA (tan bajo como sea razonablemente posible).",
    },
    "rules": [
        R("critical", C("value", "gte", 600),
          "Alcanzaste el límite de dosis de carrera de NASA. El flight surgeon definirá los siguientes pasos.",
          "flight_surgeon", ["ochmo_rad"], "source", "NASA-STD-3001 Vol. 1 [V1 4030]: < 600 mSv de carrera."),
        R("caution", C("projected_end_msv", "gte", 600),
          "Con el ritmo actual superarías el límite de carrera antes de terminar la misión. El flight surgeon revisará el plan.",
          "flight_surgeon", ["ochmo_rad"], "source_adapted"),
        R("caution", C("pct_of_career_limit", "gte", 80),
          "Ya usaste el 80 % de tu límite de dosis de carrera.",
          "flight_surgeon", ["ochmo_rad"], "design_rule", "Corte del 80 %: regla de diseño."),
        R("normal", DEFAULT, "Tu dosis acumulada está por debajo del 80 % del límite.", "self_care", ["ochmo_rad"]),
    ],
})

INDICATORS.append({
    "block": 1, "code": "HAB_CO2", "name": "CO₂ del módulo (promedio de 1 h)", "unit": "mmHg",
    "value_type": "simple",
    "components": [comp("value", "number", "mmHg"), comp("module_id", "string", role="context", required=True)],
    "derived_fields": [{"name": "avg_7d", "type": "number", "how": "promedio de 7 días del mismo módulo"}],
    "hazards": ["hostile_closed_env"], "body_zone": "environment",
    "input_methods": ["sensor"], "sensitivity": "standard",
    "guide": {
        "measurable": "Sí. Sensores de presión parcial de CO₂ del sistema de soporte vital. En la demo, sensor simulado.",
        "why": "El CO₂ alto causa dolor de cabeza, fatiga y menor rendimiento; los dolores de cabeza en vuelo se asocian con el CO₂.",
        "hazard_effect": "Hostile/Closed: la tripulación produce CO₂ y sin convección natural se acumula; en la ISS se han medido 1–9 mmHg.",
        "when_to_escalate": "Tripulación: más de 3 mmHg (promedio de 1 h) o 2.5 mmHg o más (promedio de 7 días). Flight surgeon: 10 mmHg o más.",
        "prevention": "Revisar el sistema de remoción de CO₂, mejorar la ventilación del módulo y planear el ejercicio en módulos bien ventilados.",
    },
    "rules": [
        R("critical", C("value", "gte", 10),
          "El CO₂ del módulo está muy alto. Sigan el protocolo de CO₂ alto y revisen ya el sistema de remoción.",
          "flight_surgeon", ["ntrs_co2_smac", "jsc20584b"], "source_adapted",
          "10 mmHg era el SMAC de 24 h; JSC 20584 Rev B (2022) eliminó los SMAC de CO₂, por eso se usa como referencia histórica."),
        R("caution", C("value", "gt", 4.5),
          "El CO₂ está alto: puede causar fatiga, malestar y náusea. Revisen la ventilación y el sistema de remoción.",
          "crew", ["ochmo_co2"], "source_adapted", "Síntomas reportados en vuelo por encima de 4.5 mmHg (dato anecdótico de NASA)."),
        R("caution", C("value", "gt", 3.0),
          "El CO₂ supera el límite de NASA para el promedio de 1 hora. Revisen la ventilación del módulo.",
          "crew", ["ochmo_co2"], "source", "NASA-STD-3001 Vol. 2 Rev D [V2 6004]: ≤ 3 mmHg (promedio de 1 h)."),
        R("caution", C("avg_7d", "gte", 2.5),
          "El CO₂ promedio de la semana está alto; aumenta el riesgo de dolor de cabeza.",
          "crew", ["ochmo_co2"], "source", "NASA: mantener el promedio de 7 días < 2.5 mmHg para que el riesgo de dolor de cabeza sea < 1 %."),
        R("normal", DEFAULT, "El CO₂ del módulo está dentro del límite de NASA.", "self_care", ["ochmo_co2"]),
    ],
    "notes": ["Indicador de entorno: se evalúa por módulo y genera la alerta para todos los tripulantes de ese módulo."],
})

# ============================ BLOQUE 2 (bienestar) ==========================
def slider(code, name, better, guide_extra):
    adverse_txt = "más bajo" if better == "high" else "más alto"
    return {
        "block": 2, "code": code, "name": name, "unit": "0–100",
        "value_type": "scale",
        "components": [comp("value", "number", "0–100")],
        "derived_fields": [
            {"name": "baseline_ready", "type": "boolean",
             "how": "hay al menos 7 check-ins en la ventana de línea base (14 días, excluye los últimos 3)"},
            {"name": "adverse_z_3d", "type": "number",
             "how": ("z del promedio de los últimos 3 check-ins contra la línea base personal, orientado para que "
                     "positivo = peor (" + ("se invierte el signo: más bajo es peor" if better == "high" else "más alto es peor") + ")")},
            {"name": "adverse_sustained_days", "type": "integer",
             "how": "check-ins seguidos con adverse_z_3d ≥ 1.5"},
        ],
        "hazards": ["isolation_confinement"], "body_zone": "brain",
        "input_methods": ["slider"], "sensitivity": "confidential",
        "direction": better,
        "guide": {
            "measurable": "Sí. Deslizador sin números en el check-in diario (20 s). NASA BHP usa escalas analógicas visuales (VAS) como medida estándar.",
            "why": guide_extra,
            "hazard_effect": "Isolation and Confinement: el aislamiento, la distancia de la Tierra y el estrés de la misión afectan la salud mental (riesgo de cambios conductuales y de trabajo en equipo de NASA HRP).",
            "when_to_escalate": "Salud conductual (confidencial): 5 check-ins seguidos claramente " + adverse_txt + " que tu rango habitual. Nunca se avisa a la tripulación.",
            "prevention": "Mantener rutinas, contacto con la familia, ejercicio y sueño; usar \"Quiero hablar con alguien\" en cualquier momento.",
        },
        "rules": [
            R("unrated", C("baseline_ready", "eq", False),
              "Estamos aprendiendo tu rango habitual. Sigue con tus check-ins.", "self_care", ["nasa_bhp_measures"],
              "design_rule", "Línea base mínima de 7 check-ins: regla de diseño."),
            R("caution", C("adverse_sustained_days", "gte", 5),
              "Llevas varios días distinto de lo habitual. Tu equipo de apoyo en Tierra lo sabrá de forma confidencial. Si quieres, usa \"Quiero hablar con alguien\".",
              "behavioral_health", ["nasa_bhp_measures"], "design_rule",
              "z ≥ 1.5 sostenido 5 días: regla de diseño, pendiente de validación por salud conductual. NASA BHP no publica un corte clínico para las VAS."),
            R("caution", C("adverse_sustained_days", "gte", 3),
              "Llevas unos días distinto de lo habitual. Puede ayudar dormir, moverte o hablar con alguien de confianza.",
              "self_care", ["nasa_bhp_measures"], "design_rule"),
            R("normal", DEFAULT, "Gracias por tu check-in.", "self_care", ["nasa_bhp_measures"]),
        ],
        "notes": ["El astronauta no ve un semáforo rojo en bienestar: la app muestra mensajes neutros. La racha premia completar el check-in, nunca el resultado."],
    }

INDICATORS.append(slider("WB_MOOD", "Ánimo (check-in)", "high",
                         "El ánimo bajo sostenido afecta el sueño, la concentración y la convivencia."))
INDICATORS.append(slider("WB_FATIGUE", "Fatiga (check-in)", "low",
                         "La fatiga sostenida aumenta el riesgo de errores y puede reflejar mal sueño o carga excesiva."))
INDICATORS.append(slider("WB_STRESS", "Estrés (check-in)", "low",
                         "El estrés sostenido afecta el sueño, el ánimo y el desempeño."))
_conf = slider("WB_CREW_CONFLICT", "Roces con la tripulación (check-in)", "low",
               "Los conflictos sostenidos afectan la cohesión del equipo, clave para la seguridad de la misión.")
_conf["notes"].append("Con 4 tripulantes este dato nunca es anónimo: solo lo ve el astronauta y salud conductual.")
INDICATORS.append(_conf)

def screen(code, name, instrument, src):
    return {
        "block": 2, "code": code, "name": name, "unit": "puntos (0–6)",
        "value_type": "scale",
        "components": [comp("value", "integer", "puntos"),
                       comp("item_1", "integer", role="context", required=True, values="0–3"),
                       comp("item_2", "integer", role="context", required=True, values="0–3")],
        "derived_fields": [],
        "hazards": ["isolation_confinement"], "body_zone": "brain",
        "input_methods": ["questionnaire"], "sensitivity": "confidential",
        "guide": {
            "measurable": f"Sí. {instrument}: 2 preguntas sobre las últimas 2 semanas, cada 2 semanas, un día antes de la conferencia psicológica privada.",
            "why": "Es un tamizaje breve: no diagnostica, solo indica si conviene que salud conductual converse contigo.",
            "hazard_effect": "Isolation and Confinement: NASA HRP incluye el riesgo de cambios conductuales y trastornos psiquiátricos por aislamiento, radiación y distancia de la Tierra.",
            "when_to_escalate": "Salud conductual (confidencial): 3 puntos o más. Nunca se avisa a la tripulación ni a control de misión.",
            "prevention": "Conferencias psicológicas privadas, rutinas, contacto con la familia y \"Quiero hablar con alguien\".",
        },
        "rules": [
            R("caution", C("value", "gte", 3),
              "Gracias por responder. Tu equipo de apoyo en Tierra revisará tus respuestas antes de tu conferencia privada. Si quieres hablar antes, usa \"Quiero hablar con alguien\".",
              "behavioral_health", [src, "nasa_bhp_ops"], "source", "Punto de corte 3."),
            R("normal", DEFAULT, "Gracias por responder.", "self_care", [src]),
        ],
        "notes": ["Al astronauta nunca se le muestra el puntaje ni un diagnóstico. No se usa PHQ-9 (exige protocolo de crisis)."],
    }

INDICATORS.append(screen("PHQ2_SCORE", "Tamizaje de ánimo (PHQ-2)", "PHQ-2", "phq2_nida"))
INDICATORS.append(screen("GAD2_SCORE", "Tamizaje de ansiedad (GAD-2)", "GAD-2", "gad2_kroenke"))

PVT_DERIVED = [
    {"name": "baseline_ready", "type": "boolean",
     "how": "al menos 3 corridas previas en el mismo dispositivo y en condiciones de descanso"},
    {"name": "z_device_baseline", "type": "number",
     "how": "z contra la línea base personal del mismo dispositivo (positivo = peor)"},
]
PVT_GUIDE = {
    "measurable": "Sí. Minijuego de 3 min inspirado en la PVT-B: tocar el círculo en cuanto aparece. La PVT forma parte de la Cognition Test Battery usada por NASA.",
    "why": "Mide la atención sostenida, que cae con la falta de sueño y la fatiga. Es obligatoria antes de tareas críticas (EVA, maniobras).",
    "hazard_effect": "Isolation and Confinement: el sueño corto y los horarios irregulares (riesgo de sueño inadecuado de NASA HRP) reducen la atención.",
    "when_to_escalate": "Flight surgeon (confidencial): 20 lapsos o más. A control de misión solo llega \"apto: sí / no confirmado\".",
    "prevention": "Proteger el sueño antes de tareas críticas y repetir la prueba tras descansar.",
}

INDICATORS.append({
    "block": 2, "code": "PVT_LAPSES", "name": "Prueba de reacción: lapsos", "unit": "conteo",
    "value_type": "simple",
    "components": [comp("value", "integer", "lapsos (TR ≥ 355 ms)"),
                   comp("device_id", "string", role="context", required=True)],
    "derived_fields": PVT_DERIVED, "hazards": ["isolation_confinement"], "body_zone": "brain",
    "input_methods": ["minigame"], "sensitivity": "confidential",
    "guide": PVT_GUIDE,
    "rules": [
        R("critical", C("value", "gte", 20),
          "Tu atención hoy está muy por debajo de lo normal. Descansa antes de cualquier tarea crítica; tu aptitud queda como \"no confirmada\".",
          "flight_surgeon", ["pvt_fd", "pvtb_basner"], "source_adapted",
          "Basner & Rubinstein 2011: 11 y 20 lapsos (umbral 355 ms) separan desempeño alto, medio y bajo en una tarea de vigilancia. Se aplica fuera de ese contexto."),
        R("caution", C("value", "gte", 11),
          "Tu atención hoy está por debajo de lo ideal. Si puedes, descansa y repite la prueba antes de una tarea crítica.",
          "self_care", ["pvt_fd", "pvtb_basner"], "source_adapted"),
        R("caution", C("z_device_baseline", "gte", 2),
          "Tu resultado está peor que tu rango habitual. Repite la prueba después de descansar.",
          "self_care", ["pvtb_basner"], "design_rule", "z ≥ 2 contra la línea base del dispositivo: regla de diseño."),
        R("unrated", C("baseline_ready", "eq", False),
          "Aún estamos construyendo tu línea base en este dispositivo.", "self_care", ["pvtb_basner"], "design_rule"),
        R("normal", DEFAULT, "Tu atención está en tu rango habitual.", "self_care", ["pvtb_basner"]),
    ],
    "notes": ["Lapso = respuesta ≥ 355 ms (umbral de la PVT-B; 500 ms es el de la PVT de 10 min).",
              "Aptitud para tarea crítica = \"no confirmado\" si cualquiera de los 3 indicadores PVT no está en normal."],
})

INDICATORS.append({
    "block": 2, "code": "PVT_MEAN_RT", "name": "Prueba de reacción: tiempo medio", "unit": "ms",
    "value_type": "simple",
    "components": [comp("value", "number", "ms"), comp("device_id", "string", role="context", required=True)],
    "derived_fields": PVT_DERIVED, "hazards": ["isolation_confinement"], "body_zone": "brain",
    "input_methods": ["minigame"], "sensitivity": "confidential",
    "guide": PVT_GUIDE,
    "rules": [
        R("caution", C("z_device_baseline", "gte", 2),
          "Hoy reaccionas más lento que de costumbre. Descansa y repite la prueba antes de una tarea crítica.",
          "self_care", ["pvtb_basner"], "design_rule",
          "No hay corte absoluto publicado para el tiempo medio; se compara contra la línea base."),
        R("unrated", C("baseline_ready", "eq", False),
          "Aún estamos construyendo tu línea base en este dispositivo.", "self_care", ["pvtb_basner"], "design_rule"),
        R("normal", DEFAULT, "Tu tiempo de reacción está en tu rango habitual.", "self_care", ["pvtb_basner"]),
    ],
})

INDICATORS.append({
    "block": 2, "code": "PVT_FALSE_STARTS", "name": "Prueba de reacción: falsos inicios", "unit": "conteo",
    "value_type": "simple",
    "components": [comp("value", "integer", "respuestas < 100 ms o sin estímulo"),
                   comp("device_id", "string", role="context", required=True)],
    "derived_fields": PVT_DERIVED, "hazards": ["isolation_confinement"], "body_zone": "brain",
    "input_methods": ["minigame"], "sensitivity": "confidential",
    "guide": PVT_GUIDE,
    "rules": [
        R("caution", C("z_device_baseline", "gte", 2),
          "Hoy tocaste antes de tiempo más de lo habitual. Puede ser señal de cansancio; repite la prueba tras descansar.",
          "self_care", ["pvtb_basner", "psytoolkit_pvtb"], "design_rule"),
        R("unrated", C("baseline_ready", "eq", False),
          "Aún estamos construyendo tu línea base en este dispositivo.", "self_care", ["pvtb_basner"], "design_rule"),
        R("normal", DEFAULT, "Sin cambios respecto a tu rango habitual.", "self_care", ["pvtb_basner"]),
    ],
    "notes": ["Falso inicio < 100 ms: se toma de PsyToolkit, que lo atribuye a Basner 2011; confirmar en el texto original (pendiente)."],
})

# ============================ BLOQUE 3 =====================================
INDICATORS.append({
    "block": 3, "code": "BODY_MASS", "name": "Masa corporal", "unit": "kg",
    "value_type": "simple",
    "components": [comp("value", "number", "kg")],
    "derived_fields": [{"name": "pct_change_from_preflight", "type": "number",
                        "how": "(valor − masa preflight) / masa preflight × 100"}],
    "hazards": ["gravity_fields", "distance_from_earth"], "body_zone": "muscle",
    "input_methods": ["manual"], "sensitivity": "standard",
    "guide": {
        "measurable": "Sí, pero no con báscula: en ingravidez se mide la masa con dispositivos de aceleración (SLAMMD o BMMD en la ISS).",
        "why": "Perder masa suele indicar que se come menos de lo necesario y se pierde músculo y hueso.",
        "hazard_effect": "Gravity Fields y Distance from Earth: los astronautas suelen comer menos de lo recomendado; pierden 2–5 % de masa el primer mes y la mantienen baja durante el vuelo.",
        "when_to_escalate": "Flight surgeon: pérdida del 5 % o más respecto a la masa preflight (rutina); 10 % o más (crítico).",
        "prevention": "Comer las raciones completas, ejercicio de resistencia y medir la masa con la frecuencia de la rutina.",
    },
    "rules": [
        R("critical", C("pct_change_from_preflight", "lte", -10),
          "Has perdido el 10 % o más de tu masa inicial. El flight surgeon revisará tu alimentación.",
          "flight_surgeon", ["sn_smith"], "source_adapted",
          "Declaración de S. M. Smith (nutrición, NASA JSC): más de 10 % es crítico. No es una norma publicada."),
        R("caution", C("pct_change_from_preflight", "lte", -5),
          "Has perdido el 5 % o más de tu masa inicial. Intenta completar todas tus raciones; el flight surgeon lo revisará.",
          "flight_surgeon", ["sn_smith", "aafp_weight"], "source_adapted",
          "Smith: 5–10 % es preocupante. AAFP: > 5 % en 6–12 meses es clínicamente relevante (en adultos mayores)."),
        R("normal", DEFAULT, "Tu masa corporal está cerca de tu valor inicial.", "self_care", ["ntrs_body_mass"]),
    ],
})

INDICATORS.append({
    "block": 3, "code": "EXERCISE_MIN", "name": "Ejercicio", "unit": "min/día",
    "value_type": "simple",
    "components": [comp("value", "number", "min"),
                   comp("type", "string", role="context", required=False, values="aerobic | resistive")],
    "derived_fields": [{"name": "rolling_7d_pct_of_prescription", "type": "number",
                        "how": "minutos de los últimos 7 días / prescripción semanal × 100 (prescripción por defecto: 600 min/semana)"}],
    "hazards": ["gravity_fields"], "body_zone": "bones",
    "input_methods": ["manual", "wearable"], "sensitivity": "standard",
    "guide": {
        "measurable": "Sí. Registro de sesiones en cinta (T2), cicloergómetro (CEVIS) y equipo de resistencia (ARED).",
        "why": "El ejercicio es la principal contramedida contra la pérdida de hueso, músculo y capacidad aeróbica.",
        "hazard_effect": "Gravity Fields: sin carga, hueso y músculo se pierden; NASA exige mantener la capacidad aeróbica y la fuerza en 80 % o más de la previa. En la ISS el promedio es de 600 min por semana.",
        "when_to_escalate": "Flight surgeon: menos del 50 % de la prescripción semanal.",
        "prevention": "Seguir la prescripción diaria (unos 30 min aeróbicos + 30–60 min de resistencia) y reprogramar las sesiones perdidas.",
    },
    "rules": [
        R("caution", C("rolling_7d_pct_of_prescription", "lt", 50),
          "Esta semana hiciste menos de la mitad de tu ejercicio prescrito. El flight surgeon revisará tu plan.",
          "flight_surgeon", ["ochmo_exercise"], "design_rule", "Cortes de 50 % y 80 % de cumplimiento: regla de diseño."),
        R("caution", C("rolling_7d_pct_of_prescription", "lt", 80),
          "Vas por debajo de tu ejercicio prescrito esta semana. Intenta recuperar sesiones.",
          "self_care", ["ochmo_exercise"], "design_rule"),
        R("normal", DEFAULT, "Vas al día con tu ejercicio prescrito.", "self_care", ["ochmo_exercise"]),
    ],
    "notes": ["Sin nivel crítico: el déficit de ejercicio no es una emergencia aguda."],
})

INDICATORS.append({
    "block": 3, "code": "VISION_CHECK", "name": "Síntomas visuales (SANS)", "unit": "sí/no",
    "value_type": "boolean",
    "components": [comp(n, "boolean", role="value", required=True) for n in
                   ["near_blur", "far_blur", "amsler_distortion", "blind_spot_or_field_loss",
                    "double_vision", "transient_vision_loss", "severe_headache"]],
    "derived_fields": [],
    "hazards": ["gravity_fields"], "body_zone": "eyes",
    "input_methods": ["clicks"], "sensitivity": "standard",
    "guide": {
        "measurable": "Sí. Autoevaluación con carta de agudeza visual y rejilla de Amsler; en la ISS también hay fondo de ojo y OCT.",
        "why": "El SANS puede cambiar la visión durante misiones largas; detectarlo temprano protege la vista y la misión.",
        "hazard_effect": "Gravity Fields: en ingravidez la estructura del ojo y del cerebro puede cambiar (edema del disco óptico, pliegues coroideos, aplanamiento del globo, cambio de graduación).",
        "when_to_escalate": "Flight surgeon (prioritario): distorsión en la rejilla de Amsler, punto ciego o pérdida de campo, visión doble o pérdidas breves de visión. Flight surgeon (rutina): visión borrosa nueva o dolor de cabeza intenso.",
        "prevention": "Autoevaluación semanal, usar las gafas de anticipación espacial si cambia la graduación y reportar cualquier cambio.",
    },
    "rules": [
        R("critical", ANY(C("amsler_distortion", "eq", True), C("blind_spot_or_field_loss", "eq", True),
                          C("double_vision", "eq", True), C("transient_vision_loss", "eq", True)),
          "Reportaste un cambio en tu visión que el flight surgeon debe revisar pronto. Evita tareas que dependan de la vista fina hasta recibir indicaciones.",
          "flight_surgeon", ["ntrs_sans_2023", "ntrs_sans_intro"], "source_adapted",
          "NASA: SANS con impacto funcional agudo = pérdida de campo visual o visión central distorsionada; visión doble y oscurecimientos transitorios son síntomas clásicos de hipertensión intracraneal."),
        R("caution", C("severe_headache", "eq", True),
          "Reportaste dolor de cabeza intenso. Revisa también el CO₂ del módulo; el flight surgeon lo revisará.",
          "flight_surgeon", ["ntrs_sans_intro", "ochmo_co2"], "source_adapted"),
        R("caution", ANY(C("near_blur", "eq", True), C("far_blur", "eq", True)),
          "Reportaste visión borrosa. Prueba tus gafas de anticipación espacial; el flight surgeon lo revisará en la próxima consulta.",
          "flight_surgeon", ["ntrs_sans_2023"], "source_adapted", "El cambio de graduación (hipermetropía) es un signo de SANS."),
        R("normal", DEFAULT, "Sin cambios visuales reportados.", "self_care", ["ntrs_sans_2023"]),
    ],
})

INDICATORS.append({
    "block": 3, "code": "SYMPTOM", "name": "Síntoma por zona del cuerpo", "unit": "catálogo",
    "value_type": "catalog",
    "components": [comp("symptoms", "string[]", role="value", required=True, values="códigos del catálogo de síntomas"),
                   comp("severity", "integer", role="context", required=False, values="1–3")],
    "derived_fields": [],
    "hazards": ["gravity_fields", "hostile_closed_env", "space_radiation", "isolation_confinement"],
    "body_zone": "by_symptom",
    "input_methods": ["clicks"], "sensitivity": "standard",
    "guide": {
        "measurable": "Sí. El astronauta toca la zona del cuerpo en la figura y elige el síntoma.",
        "why": "Algunos síntomas son señales de alarma que no pueden esperar a la siguiente medición.",
        "hazard_effect": "Varios peligros: mareo y desorientación al cambiar de gravedad, infecciones en espacio cerrado, náusea tras un evento solar y dolor de cabeza por CO₂.",
        "when_to_escalate": "Tripulación + flight surgeon: cualquier señal de alarma de infarto o ACV (dolor en el pecho, falta de aire, cara caída, debilidad de un brazo, dificultad para hablar, cambio súbito de visión o de equilibrio, dolor de cabeza súbito e intenso) o confusión nueva. Tripulación: síntomas de posible infección.",
        "prevention": "Reportar temprano, higiene y revisar el entorno (CO₂, temperatura) cuando hay dolor de cabeza o mareo.",
    },
    "rules": [
        R("critical", C("symptoms", "has_any", RED_FLAGS),
          "Reportaste un síntoma de alarma. Avisa ya a tu tripulación y activa el modo emergencia si empeora.",
          "flight_surgeon", ["aha_warning", "news2"], "source_adapted",
          "Señales de alarma de infarto y ACV de la AHA; confusión nueva = puntaje 3 en NEWS2."),
        R("caution", C("symptoms", "has_any", ["fainting"]),
          "Reportaste un desmayo o casi desmayo. Quédate sujeto, mide tu presión y pulso, y avisa a tu tripulación.",
          "crew", ["aha_low_bp"], "source_adapted"),
        R("caution", C("symptoms", "has_any", INFECTION_LIKE),
          "Tus síntomas podrían ser de una infección. Mide tu temperatura, refuerza la higiene y avisa a tu tripulación para evitar contagios.",
          "crew", ["nasa_hrp_risks", "nasa_hrp_hazards"], "source_adapted",
          "NASA HRP: cambios inmunes y del microbioma aumentan el riesgo de enfermar en espacio cerrado."),
        R("caution", C("symptoms", "has_any", [k for k in SYMPTOMS if k not in RED_FLAGS + INFECTION_LIKE + ["fainting"]]),
          "Gracias por reportarlo. Sigue la guía de autocuidado y vuelve a registrarlo si continúa o empeora.",
          "self_care", ["nasa_hrp_risks"], "design_rule"),
        R("normal", DEFAULT, "Sin síntomas reportados.", "self_care", ["nasa_hrp_risks"]),
    ],
})

INDICATORS.append({
    "block": 3, "code": "HAB_TEMP", "name": "Temperatura del módulo", "unit": "°C",
    "value_type": "simple",
    "components": [comp("value", "number", "°C"), comp("module_id", "string", role="context", required=True)],
    "derived_fields": [],
    "hazards": ["hostile_closed_env"], "body_zone": "environment",
    "input_methods": ["sensor"], "sensitivity": "standard",
    "guide": {
        "measurable": "Sí. Sensores del sistema de control ambiental. En la demo, sensor simulado.",
        "why": "Fuera del rango cómodo baja el rendimiento y se duerme peor; los extremos dañan la salud.",
        "hazard_effect": "Hostile/Closed: el soporte vital debe mantener la temperatura; el ejercicio y los equipos generan calor.",
        "when_to_escalate": "Tripulación: fuera de 20–25 °C. Flight surgeon: fuera de 18–27 °C.",
        "prevention": "Ajustar el control térmico del módulo y la ropa, y planear el ejercicio en módulos ventilados.",
    },
    "rules": [
        R("critical", ANY(C("value", "lt", 18), C("value", "gt", 27)),
          "La temperatura del módulo está fuera de los límites de salud de NASA. Ajusten el control térmico o cambien de módulo.",
          "flight_surgeon", ["ochmo_eclss"], "source_adapted",
          "[V2 6012] límites de salud: envolvente de 18 °C/75 % HR a 27 °C/25 % HR (aquí simplificada a 18–27 °C)."),
        R("caution", ANY(C("value", "lt", 20), C("value", "gt", 25)),
          "La temperatura del módulo está fuera de la zona de rendimiento. Ajusten el control térmico.",
          "crew", ["ochmo_eclss"], "source", "[V2 6013] zona de rendimiento: 20–25 °C."),
        R("normal", DEFAULT, "Temperatura del módulo en la zona de rendimiento.", "self_care", ["ochmo_eclss"]),
    ],
})

INDICATORS.append({
    "block": 3, "code": "HAB_HUMIDITY", "name": "Humedad relativa del módulo", "unit": "%",
    "value_type": "simple",
    "components": [comp("value", "number", "% HR"), comp("module_id", "string", role="context", required=True)],
    "derived_fields": [],
    "hazards": ["hostile_closed_env"], "body_zone": "environment",
    "input_methods": ["sensor"], "sensitivity": "standard",
    "guide": {
        "measurable": "Sí. Sensores del sistema de control ambiental. En la demo, sensor simulado.",
        "why": "El aire muy seco irrita ojos y vías respiratorias; el muy húmedo favorece el moho y la condensación.",
        "hazard_effect": "Hostile/Closed: la respiración y el sudor agregan humedad que el soporte vital debe retirar; la humedad influye en la carga microbiana.",
        "when_to_escalate": "Tripulación: fuera de 30–60 %. Flight surgeon: fuera de 25–75 %.",
        "prevention": "Ajustar el control de humedad y revisar la condensación.",
    },
    "rules": [
        R("critical", ANY(C("value", "lt", 25), C("value", "gt", 75)),
          "La humedad del módulo está fuera de los límites de salud de NASA. Ajusten el control de humedad.",
          "flight_surgeon", ["ochmo_eclss"], "source_adapted", "[V2 6012] envolvente simplificada a 25–75 % HR."),
        R("caution", ANY(C("value", "lt", 30), C("value", "gt", 60)),
          "La humedad del módulo está fuera de la zona de rendimiento.",
          "crew", ["ochmo_eclss"], "source", "[V2 6013] zona de rendimiento: 30–60 % HR."),
        R("normal", DEFAULT, "Humedad del módulo en la zona de rendimiento.", "self_care", ["ochmo_eclss"]),
    ],
})

INDICATORS.append({
    "block": 3, "code": "HAB_NOISE", "name": "Ruido del módulo", "unit": "dBA",
    "value_type": "simple",
    "components": [comp("value", "number", "dBA"),
                   comp("period", "string", role="context", required=True, values="work | sleep"),
                   comp("module_id", "string", role="context", required=True)],
    "derived_fields": [],
    "hazards": ["hostile_closed_env"], "body_zone": "environment",
    "input_methods": ["sensor"], "sensitivity": "standard",
    "guide": {
        "measurable": "Sí. Sonómetros y dosímetros acústicos. En la demo, sensor simulado.",
        "why": "El ruido continuo causa dolor de cabeza, fatiga, mal sueño y puede impedir oír alarmas; el muy alto daña el oído.",
        "hazard_effect": "Hostile/Closed: ventiladores, bombas y equipos de ejercicio funcionan todo el día en un espacio pequeño.",
        "when_to_escalate": "Tripulación: más de ~58 dBA en trabajo o ~49 dBA en sueño. Flight surgeon: 85 dBA o más.",
        "prevention": "Usar protección auditiva, alejarse de las fuentes de ruido y apagar equipos innecesarios en el periodo de sueño.",
    },
    "rules": [
        R("critical", C("value", "gte", 85),
          "El ruido está en nivel peligroso para el oído. Usa protección auditiva ya y aléjate de la fuente.",
          "flight_surgeon", ["ochmo_acoustics"], "source", "[V2 6077]: < 85 dBA sin importar la duración."),
        R("caution", ALL(C("period", "eq", "sleep"), C("value", "gt", 49)),
          "Hay demasiado ruido para dormir bien. Usa tapones y avisa a la tripulación para reducir fuentes.",
          "crew", ["ochmo_sleep", "ntrs_nc_dba"], "source_adapted",
          "Límite de sueño NC-40 (≈ 49 dBA). La equivalencia NC → dBA es aproximada."),
        R("caution", C("value", "gt", 58),
          "El ruido del módulo supera el límite continuo para áreas de trabajo. Considera protección auditiva.",
          "crew", ["ochmo_acoustics", "ntrs_nc_dba"], "source_adapted",
          "[V2 6078] NC-50 en áreas de trabajo (≈ 58 dBA). La equivalencia NC → dBA es aproximada."),
        R("normal", DEFAULT, "El ruido del módulo está dentro de los límites.", "self_care", ["ochmo_acoustics"]),
    ],
})
