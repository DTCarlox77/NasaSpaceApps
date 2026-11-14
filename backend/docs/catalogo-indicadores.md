# Catálogo de indicadores · umbrales, reglas y fuentes

> Versión de reglas **v1** · 2026-11-14 · Autor: persona B (rama `backend`).  
> Archivo **generado** por `backend/tools/build_catalog.py` desde `backend/tools/catalog_data.py`. No editar a mano: cambiar los datos y regenerar.  
> **Apoyo a la decisión, no diagnóstico.** Los textos al astronauta describen el valor y la acción; nunca nombran una enfermedad.  
> Datos de demo: sintéticos (`synthetic = true`).

Bloques incluidos en esta versión: 1, 2, 3.

## 1. Cómo leer este catálogo

**Niveles del semáforo:** `normal`, `caution` (precaución), `critical` y `unrated` (sin evaluar: medición no válida o sin línea base todavía).

**Orden de reglas:** cada indicador tiene una lista ordenada de la más grave a la menos grave. El motor evalúa en orden y **gana la primera que se cumple**. La última regla tiene `when: {"all": []}` (grupo vacío = siempre verdadero) y actúa como valor por defecto.

**Campo ausente:** si una condición usa un campo que no viene en la lectura (por ejemplo, `avg_7d` sin historial), esa condición es **falsa**. Así una regla nunca se dispara por falta de datos.

**Escalamiento** (de menor a mayor):

| Valor | Significado |
|---|---|
| `self_care` | Solo el astronauta: guía de autocuidado. |
| `crew` | Se notifica al oficial médico de a bordo (físico, no confidencial). |
| `flight_surgeon` | Se envía a Tierra con `compute_deliver_at`. Si el nivel es `critical`, **también** se notifica a la tripulación a bordo, porque Tierra llega con retraso. |
| `behavioral_health` | Solo para indicadores confidenciales. Va únicamente a `behavioral_health`, **nunca** a la tripulación ni a `admin`. |

**Base de cada regla (`basis`):**

| Valor | Significado |
|---|---|
| `source` | El número sale tal cual de la fuente citada. |
| `source_adapted` | El número sale de la fuente, pero el nivel, la población o el contexto los adaptamos nosotros (se explica en la nota). |
| `design_rule` | Regla de diseño **sin fuente directa**: configurable desde el panel y pendiente de validar con el flight surgeon o con salud conductual. |
| `pending_source` | Falta fuente. No se carga como activa. |

## 2. Cambios necesarios en el evaluador (`src/engine`)

`src/engine/triage.js` hoy soporta `eq`, `in` y `has_any`. El catálogo necesita además **`lt`, `lte`, `gt`, `gte` y `between`**, y grupos **anidados** `any`/`all`. Se agrega `src/engine/conditions.js` (incluido junto a este documento) con todos los operadores; `triage.js` puede importar `evalCondition` de ahí para que el triaje y el semáforo usen **el mismo evaluador** en el dispositivo y en el servidor.

| Operador | Tipo de `value` | Ejemplo |
|---|---|---|
| `eq` | cualquiera | `{"field":"fasting","op":"eq","value":true}` |
| `in` | lista | `{"field":"period","op":"in","value":["sleep"]}` |
| `has_any` | lista (el campo también es lista) | `{"field":"symptoms","op":"has_any","value":["chest_pain"]}` |
| `lt` / `lte` / `gt` / `gte` | número | `{"field":"systolic","op":"gt","value":180}` |
| `between` | `[min, max]` inclusivo | `{"field":"value","op":"between","value":[36.1,37.9]}` |

**Campos derivados:** algunas reglas usan campos que no vienen del dispositivo (`ratio_to_baseline`, `adverse_z_3d`, `consecutive_nights_le_6h`, etc.). Los calcula el motor (persona B) a partir del historial antes de evaluar las reglas. Cada ficha dice cómo se calcula cada uno.

## 3. Catálogos compartidos (para los seeds)

**Peligros (`hazards`)**

| Código | RIDGE |
|---|---|
| `space_radiation` | Space Radiation |
| `isolation_confinement` | Isolation and Confinement |
| `distance_from_earth` | Distance from Earth |
| `gravity_fields` | Gravity Fields |
| `hostile_closed_env` | Hostile/Closed Environments |

**Zonas del cuerpo (`body_zones`)**

| Código | Zona |
|---|---|
| `heart` | Corazón y circulación |
| `lungs` | Pulmones y respiración |
| `immune` | Sistema inmune |
| `metabolism` | Metabolismo y nutrición |
| `muscle` | Músculo |
| `bones` | Huesos |
| `brain` | Cerebro, sueño y ánimo |
| `eyes` | Ojos |
| `environment` | Entorno del módulo (no es zona del cuerpo; tarjeta aparte en la figura) |
| `by_symptom` | Según el síntoma (se toma de la zona de cada síntoma) |

**Síntomas (`symptoms`)** — se usan en `SYMPTOM` y como contexto en otros indicadores.

| Código | Texto | Zona | Señal de alarma |
|---|---|---|---|
| `chest_pain` | Dolor o presión en el pecho | `heart` | sí |
| `shortness_of_breath` | Falta de aire | `lungs` | sí |
| `face_drooping` | Un lado de la cara caído o adormecido | `brain` | sí |
| `arm_weakness` | Debilidad o adormecimiento de un brazo o pierna | `brain` | sí |
| `speech_difficulty` | Dificultad para hablar o entender | `brain` | sí |
| `sudden_vision_change` | Cambio súbito de visión (doble, borrosa o pérdida) | `eyes` | sí |
| `sudden_balance_loss` | Pérdida súbita del equilibrio o la coordinación | `brain` | sí |
| `severe_headache_sudden` | Dolor de cabeza súbito e intenso sin causa conocida | `brain` | sí |
| `unresponsive` | No responde | `brain` | sí |
| `confusion` | Confusión nueva | `brain` | sí |
| `fainting` | Desmayo o casi desmayo | `heart` |  |
| `dizziness` | Mareo | `heart` |  |
| `palpitations` | Palpitaciones | `heart` |  |
| `headache` | Dolor de cabeza | `brain` |  |
| `nausea` | Náusea | `metabolism` |  |
| `vomiting` | Vómito | `metabolism` |  |
| `diarrhea` | Diarrea | `metabolism` |  |
| `fever_feeling` | Sensación de fiebre o escalofríos | `immune` |  |
| `cough` | Tos | `lungs` |  |
| `sore_throat` | Dolor de garganta | `immune` |  |
| `rash` | Sarpullido o lesiones en la piel | `immune` |  |
| `excessive_thirst` | Sed excesiva | `metabolism` |  |
| `frequent_urination` | Orinar mucho más de lo habitual | `metabolism` |  |
| `blurred_vision` | Visión borrosa | `eyes` |  |
| `back_pain` | Dolor de espalda | `bones` |  |
| `muscle_pain` | Dolor muscular | `muscle` |  |
| `bone_pain` | Dolor óseo o articular | `bones` |  |
| `fatigue` | Cansancio fuera de lo habitual | `brain` |  |

## 4. Resumen

| Bloque | Código | Indicador | Unidad | Peligro | Zona | Sensibilidad | Reglas sin fuente directa |
|---|---|---|---|---|---|---|---|
| 1 | `BLOOD_PRESSURE` | Presión arterial | mmHg | Gravity Fields | `heart` | Estándar | 0 |
| 1 | `HEART_RATE` | Frecuencia cardíaca en reposo | lpm | Gravity Fields | `heart` | Estándar | 0 |
| 1 | `RESP_RATE` | Frecuencia respiratoria | rpm | Hostile/Closed Environments | `lungs` | Estándar | 0 |
| 1 | `SPO2` | Saturación de oxígeno | % | Hostile/Closed Environments | `lungs` | Estándar | 0 |
| 1 | `BODY_TEMP` | Temperatura corporal | °C | Hostile/Closed Environments | `immune` | Estándar | 0 |
| 1 | `GLUCOSE` | Glucosa en sangre | mg/dL | Distance from Earth, Gravity Fields | `metabolism` | Estándar | 0 |
| 1 | `SLEEP_HOURS` | Horas de sueño | h | Isolation and Confinement | `brain` | Estándar | 1 |
| 1 | `RAD_DOSE_DAILY` | Dosis de radiación diaria | mSv/día | Space Radiation | `immune` | Estándar | 2 |
| 1 | `RAD_DOSE_CUM` | Dosis de radiación acumulada (carrera) | mSv | Space Radiation | `immune` | Estándar | 1 |
| 1 | `HAB_CO2` | CO₂ del módulo (promedio de 1 h) | mmHg | Hostile/Closed Environments | `environment` | Estándar | 0 |
| 2 | `WB_MOOD` | Ánimo (check-in) | 0–100 | Isolation and Confinement | `brain` | **Confidencial** | 3 |
| 2 | `WB_FATIGUE` | Fatiga (check-in) | 0–100 | Isolation and Confinement | `brain` | **Confidencial** | 3 |
| 2 | `WB_STRESS` | Estrés (check-in) | 0–100 | Isolation and Confinement | `brain` | **Confidencial** | 3 |
| 2 | `WB_CREW_CONFLICT` | Roces con la tripulación (check-in) | 0–100 | Isolation and Confinement | `brain` | **Confidencial** | 3 |
| 2 | `PHQ2_SCORE` | Tamizaje de ánimo (PHQ-2) | puntos (0–6) | Isolation and Confinement | `brain` | **Confidencial** | 0 |
| 2 | `GAD2_SCORE` | Tamizaje de ansiedad (GAD-2) | puntos (0–6) | Isolation and Confinement | `brain` | **Confidencial** | 0 |
| 2 | `PVT_LAPSES` | Prueba de reacción: lapsos | conteo | Isolation and Confinement | `brain` | **Confidencial** | 2 |
| 2 | `PVT_MEAN_RT` | Prueba de reacción: tiempo medio | ms | Isolation and Confinement | `brain` | **Confidencial** | 2 |
| 2 | `PVT_FALSE_STARTS` | Prueba de reacción: falsos inicios | conteo | Isolation and Confinement | `brain` | **Confidencial** | 2 |
| 3 | `BODY_MASS` | Masa corporal | kg | Gravity Fields, Distance from Earth | `muscle` | Estándar | 0 |
| 3 | `EXERCISE_MIN` | Ejercicio | min/día | Gravity Fields | `bones` | Estándar | 2 |
| 3 | `VISION_CHECK` | Síntomas visuales (SANS) | sí/no | Gravity Fields | `eyes` | Estándar | 0 |
| 3 | `SYMPTOM` | Síntoma por zona del cuerpo | catálogo | Gravity Fields, Hostile/Closed Environments, Space Radiation, Isolation and Confinement | `by_symptom` | Estándar | 1 |
| 3 | `HAB_TEMP` | Temperatura del módulo | °C | Hostile/Closed Environments | `environment` | Estándar | 0 |
| 3 | `HAB_HUMIDITY` | Humedad relativa del módulo | % | Hostile/Closed Environments | `environment` | Estándar | 0 |
| 3 | `HAB_NOISE` | Ruido del módulo | dBA | Hostile/Closed Environments | `environment` | Estándar | 0 |

## 5. Fichas

## Bloque 1 · MVP: signos vitales, glucosa, sueño, radiación y CO₂

### `BLOOD_PRESSURE` · Presión arterial

| Campo | Valor |
|---|---|
| Unidad · tipo | mmHg · compuesto |
| Componentes | `systolic` (mmHg), `diastolic` (mmHg), `symptoms` *contexto* |
| Peligro(s) RIDGE | Gravity Fields |
| Zona del cuerpo | `heart` (Corazón y circulación) |
| Entrada | manual, foto (cámara) |
| Sensibilidad | Estándar |

**Las 5 preguntas del reto**

1. **¿Se puede medir en el espacio? ¿Cómo?** Sí. Tensiómetro automático de brazo, tras 5 min de reposo, anclado o sentado y con el brazo a la altura del corazón. La foto de la pantalla del tensiómetro queda como respaldo.
2. **¿Por qué es necesario?** La presión muy alta puede dañar corazón, cerebro y riñones; la muy baja puede causar mareo o desmayo.
3. **¿Cómo lo afectan los peligros?** Gravity Fields: la ingravidez altera la circulación y el funcionamiento del corazón y los vasos (riesgo de adaptaciones cardiovasculares de NASA HRP). Al pasar a 0.16 g, 0.38 g o 1 g puede aparecer mareo al incorporarse.
4. **¿Cuándo requiere a la tripulación o al flight surgeon?** Tripulación + flight surgeon: más de 180/120, o sistólica de 90 o menos con mareo, desmayo o confusión. Flight surgeon de rutina: 140/90 o más.
5. **¿Qué acciones previenen lo crítico?** Medir con buena técnica y repetir antes de concluir, cumplir el ejercicio prescrito, hidratarse y dormir lo suficiente.

**Umbrales** (se evalúan en orden; gana la primera regla que se cumple)

| # | Nivel | Condición | Recomendación al astronauta | Escalamiento | Base | Fuentes |
|---|---|---|---|---|---|---|
| 1 | 🔴 Crítico | (`systolic` > 180 o `diastolic` > 120) y `symptoms` incluye `chest_pain`, `shortness_of_breath`, `back_pain`, `arm_weakness`, `face_drooping`, `sudden_vision_change`, `speech_difficulty` | Tu presión está muy alta y tienes síntomas de alarma. Avisa ya a tu tripulación y activa el modo emergencia. | Flight surgeon | Fuente | [aha_bp](https://www.heart.org/en/health-topics/high-blood-pressure/understanding-blood-pressure-readings) |
| 2 | 🔴 Crítico | `systolic` > 180 o `diastolic` > 120 | Tu presión está muy alta. Quédate en reposo 5 minutos y vuelve a medir. Si sigue igual, se avisa a tu tripulación y al flight surgeon. | Flight surgeon | Fuente | [aha_bp](https://www.heart.org/en/health-topics/high-blood-pressure/understanding-blood-pressure-readings) |
| 3 | 🔴 Crítico | `systolic` ≤ 90 y `symptoms` incluye `dizziness`, `fainting`, `confusion` | Tu presión está baja y tienes mareo o confusión. Quédate quieto y sujeto, y avisa a tu tripulación. | Flight surgeon | Fuente adaptada — Sistólica ≤90 = puntaje 3 de NEWS2; AHA: la presión baja preocupa cuando hay síntomas. | [aha_low_bp](https://www.heart.org/en/health-topics/high-blood-pressure/the-facts-about-high-blood-pressure/low-blood-pressure-when-blood-pressure-is-too-low), [news2](https://www.nwas.nhs.uk/publications/news2-national-early-warning-score) |
| 4 | 🟡 Precaución | `systolic` ≥ 140 o `diastolic` ≥ 90 | Tu presión está alta. Repite la medición mañana a la misma hora; si sigue así, el flight surgeon la revisará. | Flight surgeon | Fuente | [aha_bp](https://www.heart.org/en/health-topics/high-blood-pressure/understanding-blood-pressure-readings), [ama_bp2025](https://www.ama-assn.org/delivering-care/hypertension/new-bp-guideline-5-things-physicians-should-know) |
| 5 | 🟡 Precaución | `systolic` ≥ 130 o `diastolic` ≥ 80 | Tu presión está un poco alta. Repite la medición en reposo y cumple tu ejercicio y tu hidratación. | Autocuidado | Fuente | [aha_bp](https://www.heart.org/en/health-topics/high-blood-pressure/understanding-blood-pressure-readings), [ama_bp2025](https://www.ama-assn.org/delivering-care/hypertension/new-bp-guideline-5-things-physicians-should-know) |
| 6 | 🟡 Precaución | `systolic` < 90 o `diastolic` < 60 | Tu presión está baja. Bebe agua y muévete despacio. Si te mareas, regístralo como síntoma. | Autocuidado | Fuente | [aha_low_bp](https://www.heart.org/en/health-topics/high-blood-pressure/the-facts-about-high-blood-pressure/low-blood-pressure-when-blood-pressure-is-too-low) |
| 7 | 🟡 Precaución | `systolic` ≥ 120 | Tu presión está ligeramente elevada. No es urgente: mantén tus hábitos y vuelve a medir en tu próxima rutina. | Autocuidado | Fuente | [aha_bp](https://www.heart.org/en/health-topics/high-blood-pressure/understanding-blood-pressure-readings) |
| 8 | 🟢 Normal | en otro caso | Tu presión está en rango normal. | Autocuidado | Fuente | [aha_bp](https://www.heart.org/en/health-topics/high-blood-pressure/understanding-blood-pressure-readings) |

### `HEART_RATE` · Frecuencia cardíaca en reposo

| Campo | Valor |
|---|---|
| Unidad · tipo | lpm · simple |
| Componentes | `value` (lpm), `at_rest` *contexto*, `symptoms` *contexto* |
| Peligro(s) RIDGE | Gravity Fields |
| Zona del cuerpo | `heart` (Corazón y circulación) |
| Entrada | manual, pulsera |
| Sensibilidad | Estándar |

**Las 5 preguntas del reto**

1. **¿Se puede medir en el espacio? ¿Cómo?** Sí. Pulsera o pulsioxímetro, o contando el pulso 30 s y multiplicando por 2. Se evalúa solo en reposo.
2. **¿Por qué es necesario?** Un pulso en reposo muy rápido o muy lento puede indicar deshidratación, fiebre, problemas del ritmo o desacondicionamiento.
3. **¿Cómo lo afectan los peligros?** Gravity Fields: la ingravidez cambia la circulación y el trabajo del corazón; los cambios de gravedad pueden causar mareo y pulso acelerado al incorporarse.
4. **¿Cuándo requiere a la tripulación o al flight surgeon?** Tripulación + flight surgeon: 40 lpm o menos, o 131 lpm o más, en reposo. Tripulación: 111–130 lpm, o pulso lento con mareo.
5. **¿Qué acciones previenen lo crítico?** Hidratación, sueño, ejercicio prescrito y medir siempre en las mismas condiciones.

**Umbrales** (se evalúan en orden; gana la primera regla que se cumple)

| # | Nivel | Condición | Recomendación al astronauta | Escalamiento | Base | Fuentes |
|---|---|---|---|---|---|---|
| 1 | ⚪ Sin evaluar | `at_rest` = no | Esta medición se hizo en actividad; los rangos de reposo no aplican. | Autocuidado | Fuente adaptada — La AHA define el rango normal para personas sentadas o acostadas, en calma. | [aha_hr](https://www.heart.org/en/health-topics/high-blood-pressure/the-facts-about-high-blood-pressure/all-about-heart-rate-pulse) |
| 2 | 🔴 Crítico | `value` ≤ 40 o `value` ≥ 131 | Tu pulso en reposo está fuera de un rango seguro. Quédate en reposo, vuelve a medir en 5 minutos y avisa a tu tripulación. | Flight surgeon | Fuente adaptada — Puntaje 3 de NEWS2 (≤40 o ≥131). | [news2](https://www.nwas.nhs.uk/publications/news2-national-early-warning-score) |
| 3 | 🟡 Precaución | `value` < 60 y `symptoms` incluye `dizziness`, `fainting`, `confusion` | Tu pulso está lento y tienes mareo. Quédate sujeto y avisa a tu tripulación. | Tripulación | Fuente adaptada | [aha_hr](https://www.heart.org/en/health-topics/high-blood-pressure/the-facts-about-high-blood-pressure/all-about-heart-rate-pulse) |
| 4 | 🟡 Precaución | `value` ≥ 111 | Tu pulso en reposo está alto. Descansa, bebe agua y vuelve a medir en 15 minutos. | Tripulación | Fuente adaptada — NEWS2 puntaje 2 en 111–130. | [aha_hr](https://www.heart.org/en/health-topics/high-blood-pressure/the-facts-about-high-blood-pressure/all-about-heart-rate-pulse), [news2](https://www.nwas.nhs.uk/publications/news2-national-early-warning-score) |
| 5 | 🟡 Precaución | `value` > 100 | Tu pulso en reposo está algo alto. Descansa, hidrátate y vuelve a medir más tarde. | Autocuidado | Fuente | [aha_hr](https://www.heart.org/en/health-topics/high-blood-pressure/the-facts-about-high-blood-pressure/all-about-heart-rate-pulse) |
| 6 | 🟡 Precaución | `value` < 60 | Tu pulso está por debajo de 60. En personas muy entrenadas puede ser normal; si te sientes mareado, regístralo como síntoma. | Autocuidado | Fuente | [aha_hr](https://www.heart.org/en/health-topics/high-blood-pressure/the-facts-about-high-blood-pressure/all-about-heart-rate-pulse) |
| 7 | 🟢 Normal | en otro caso | Tu pulso en reposo está en rango normal. | Autocuidado | Fuente | [aha_hr](https://www.heart.org/en/health-topics/high-blood-pressure/the-facts-about-high-blood-pressure/all-about-heart-rate-pulse) |

### `RESP_RATE` · Frecuencia respiratoria

| Campo | Valor |
|---|---|
| Unidad · tipo | rpm · simple |
| Componentes | `value` (rpm) |
| Peligro(s) RIDGE | Hostile/Closed Environments |
| Zona del cuerpo | `lungs` (Pulmones y respiración) |
| Entrada | pulsera, manual |
| Sensibilidad | Estándar |

**Las 5 preguntas del reto**

1. **¿Se puede medir en el espacio? ¿Cómo?** Sí. Contando respiraciones durante 60 s en reposo, o estimada por la pulsera.
2. **¿Por qué es necesario?** Respirar muy rápido o muy lento es una de las primeras señales de que algo va mal (falta de oxígeno, CO₂ alto, infección).
3. **¿Cómo lo afectan los peligros?** Hostile/Closed: un CO₂ alto en la cabina o una infección hacen respirar más rápido. El triaje usa este mismo dato (START: más de 30 rpm = atención inmediata).
4. **¿Cuándo requiere a la tripulación o al flight surgeon?** Tripulación + flight surgeon: 8 rpm o menos, o 25 rpm o más. Tripulación: 21–24 rpm.
5. **¿Qué acciones previenen lo crítico?** Vigilar el CO₂ del módulo, reportar tos o fiebre temprano y medir en reposo.

**Umbrales** (se evalúan en orden; gana la primera regla que se cumple)

| # | Nivel | Condición | Recomendación al astronauta | Escalamiento | Base | Fuentes |
|---|---|---|---|---|---|---|
| 1 | 🔴 Crítico | `value` ≤ 8 o `value` ≥ 25 | Tu respiración está fuera de un rango seguro. Avisa ya a tu tripulación y revisa el CO₂ del módulo. | Flight surgeon | Fuente adaptada — Puntaje 3 de NEWS2; START: >30 rpm = inmediato. | [news2](https://www.nwas.nhs.uk/publications/news2-national-early-warning-score), [chemm_start](https://chemm.hhs.gov/startalgotext.htm) |
| 2 | 🟡 Precaución | `value` ≥ 21 | Respiras más rápido de lo normal. Descansa 5 minutos y vuelve a medir; revisa el CO₂ del módulo. | Tripulación | Fuente adaptada | [statpearls_rr](https://www.ncbi.nlm.nih.gov/books/NBK537306/), [news2](https://www.nwas.nhs.uk/publications/news2-national-early-warning-score) |
| 3 | 🟡 Precaución | `value` ≤ 11 | Respiras más lento de lo normal. Vuelve a medir en reposo, contando 60 segundos. | Autocuidado | Fuente adaptada | [statpearls_rr](https://www.ncbi.nlm.nih.gov/books/NBK537306/), [news2](https://www.nwas.nhs.uk/publications/news2-national-early-warning-score) |
| 4 | 🟢 Normal | en otro caso | Tu respiración está en rango normal (12–20 rpm). | Autocuidado | Fuente | [statpearls_rr](https://www.ncbi.nlm.nih.gov/books/NBK537306/) |

### `SPO2` · Saturación de oxígeno

| Campo | Valor |
|---|---|
| Unidad · tipo | % · simple |
| Componentes | `value` (%) |
| Peligro(s) RIDGE | Hostile/Closed Environments |
| Zona del cuerpo | `lungs` (Pulmones y respiración) |
| Entrada | manual, pulsera |
| Sensibilidad | Estándar |

**Las 5 preguntas del reto**

1. **¿Se puede medir en el espacio? ¿Cómo?** Sí. Pulsioxímetro de dedo o pulsera; dedo tibio y quieto durante la lectura.
2. **¿Por qué es necesario?** Indica cuánto oxígeno lleva la sangre. Un valor bajo puede significar que el cuerpo no recibe suficiente oxígeno.
3. **¿Cómo lo afectan los peligros?** Hostile/Closed: depende de la atmósfera de la cabina (presión, O₂) y de la salud pulmonar; NASA HRP estudia el riesgo de hipoxia en atmósferas de exploración.
4. **¿Cuándo requiere a la tripulación o al flight surgeon?** Tripulación + flight surgeon: 91 % o menos. Tripulación: 92–93 %.
5. **¿Qué acciones previenen lo crítico?** Revisar la atmósfera del módulo, repetir con buena técnica y reportar falta de aire de inmediato.

**Umbrales** (se evalúan en orden; gana la primera regla que se cumple)

| # | Nivel | Condición | Recomendación al astronauta | Escalamiento | Base | Fuentes |
|---|---|---|---|---|---|---|
| 1 | 🔴 Crítico | `value` ≤ 91 | Tu oxígeno en sangre está bajo. Avisa ya a tu tripulación; revisen la atmósfera del módulo y el protocolo de oxígeno. | Flight surgeon | Fuente adaptada — OMS: SpO₂ < 90 % es una emergencia clínica; NEWS2: ≤91 % = puntaje 3. | [who_pulseox](https://dev.phenxtoolkit.org/protocols/view/91102), [news2](https://www.nwas.nhs.uk/publications/news2-national-early-warning-score) |
| 2 | 🟡 Precaución | `value` ≤ 93 | Tu oxígeno está por debajo de lo normal. Vuelve a medir con el dedo tibio; si se repite, avisa a tu tripulación. | Tripulación | Fuente adaptada | [who_pulseox](https://dev.phenxtoolkit.org/protocols/view/91102), [news2](https://www.nwas.nhs.uk/publications/news2-national-early-warning-score) |
| 3 | 🟡 Precaución | `value` ≤ 94 | Tu oxígeno está ligeramente bajo. Repite la medición con el dedo tibio y quieto. | Autocuidado | Fuente | [who_pulseox](https://dev.phenxtoolkit.org/protocols/view/91102) |
| 4 | 🟢 Normal | en otro caso | Tu oxígeno está en rango normal (95 % o más). | Autocuidado | Fuente | [who_pulseox](https://dev.phenxtoolkit.org/protocols/view/91102) |

> Los cortes valen para atmósfera a nivel del mar. En atmósferas de exploración con menor presión parcial de O₂, el admin debe poder ajustar los cortes por entorno (pendiente de fuente).

### `BODY_TEMP` · Temperatura corporal

| Campo | Valor |
|---|---|
| Unidad · tipo | °C · simple |
| Componentes | `value` (°C) |
| Peligro(s) RIDGE | Hostile/Closed Environments |
| Zona del cuerpo | `immune` (Sistema inmune) |
| Entrada | manual |
| Sensibilidad | Estándar |

**Las 5 preguntas del reto**

1. **¿Se puede medir en el espacio? ¿Cómo?** Sí. Termómetro digital oral o de oído; siempre con el mismo método.
2. **¿Por qué es necesario?** La fiebre es una señal temprana de infección; la temperatura muy baja también es peligrosa.
3. **¿Cómo lo afectan los peligros?** Hostile/Closed: en un espacio cerrado una infección pasa fácil a toda la tripulación; NASA HRP describe cambios del sistema inmune y del microbioma que aumentan el riesgo de enfermar.
4. **¿Cuándo requiere a la tripulación o al flight surgeon?** Flight surgeon: 35.0 °C o menos, o 39.4 °C o más. Tripulación: fiebre de 38.0 °C o más (riesgo de contagio).
5. **¿Qué acciones previenen lo crítico?** Higiene de manos y superficies, reportar síntomas temprano, hidratación y descanso.

**Umbrales** (se evalúan en orden; gana la primera regla que se cumple)

| # | Nivel | Condición | Recomendación al astronauta | Escalamiento | Base | Fuentes |
|---|---|---|---|---|---|---|
| 1 | 🔴 Crítico | `value` ≤ 35.0 | Tu temperatura está demasiado baja. Abrígate, avisa a tu tripulación y vuelve a medir. | Flight surgeon | Fuente adaptada — Hipotermia: < 35 °C (Mayo Clinic, citando a CDC); NEWS2: ≤35.0 = puntaje 3. | [mayo_hypothermia](https://www.mayoclinic.org/first-aid/first-aid-hypothermia/basics/ART-20056624), [news2](https://www.nwas.nhs.uk/publications/news2-national-early-warning-score) |
| 2 | 🔴 Crítico | `value` ≥ 39.4 | Tienes fiebre alta. Avisa a tu tripulación, bebe líquidos y se consultará al flight surgeon. | Flight surgeon | Fuente adaptada — A.D.A.M.: un adulto debe contactar a su médico si la fiebre se mantiene en 39.4 °C (103 °F) o más. | [adam_fever](https://www3.pennmedicine.org/for-patients-and-visitors/patient-information/conditions-treated-a-to-z/fever) |
| 3 | 🟡 Precaución | `value` ≥ 38.0 | Tienes fiebre. Descansa, bebe líquidos, usa medidas de higiene para no contagiar y vuelve a medir en 4 horas. | Tripulación | Fuente adaptada — Escalamiento a tripulación por contagio en espacio cerrado; reevaluar en 4 h es regla de diseño. | [cdc_fever](https://www.cdc.gov/quarantine/maritime/definitions-signs-symptoms-conditions-ill-travelers.html) |
| 4 | 🟡 Precaución | `value` ≤ 36.0 | Tu temperatura está algo baja. Abrígate y vuelve a medir en 30 minutos. | Autocuidado | Fuente adaptada — NEWS2: 35.1–36.0 = puntaje 1. | [news2](https://www.nwas.nhs.uk/publications/news2-national-early-warning-score) |
| 5 | 🟢 Normal | en otro caso | Tu temperatura está en rango normal. | Autocuidado | Fuente | [cdc_fever](https://www.cdc.gov/quarantine/maritime/definitions-signs-symptoms-conditions-ill-travelers.html), [news2](https://www.nwas.nhs.uk/publications/news2-national-early-warning-score) |

### `GLUCOSE` · Glucosa en sangre

| Campo | Valor |
|---|---|
| Unidad · tipo | mg/dL · simple |
| Componentes | `value` (mg/dL), `fasting` *contexto*, `symptoms` *contexto* |
| Peligro(s) RIDGE | Distance from Earth, Gravity Fields |
| Zona del cuerpo | `metabolism` (Metabolismo y nutrición) |
| Entrada | manual, foto (cámara) |
| Sensibilidad | Estándar |

**Las 5 preguntas del reto**

1. **¿Se puede medir en el espacio? ¿Cómo?** Sí. Glucómetro con gota de sangre del dedo; la foto de la pantalla queda como respaldo. Indicar si estás en ayunas (8 h sin comer).
2. **¿Por qué es necesario?** La glucosa es la energía del cuerpo. Muy baja puede causar confusión o desmayo; alta de forma repetida debe revisarla un médico.
3. **¿Cómo lo afectan los peligros?** Distance from Earth: los alimentos son limitados y la ingesta suele ser menor (riesgo de nutrición inadecuada de NASA HRP); Gravity Fields: menos actividad y cambios metabólicos en ingravidez.
4. **¿Cuándo requiere a la tripulación o al flight surgeon?** Tripulación + flight surgeon: menos de 54 mg/dL, menos de 70 con confusión o desmayo, o 200 o más con síntomas. Flight surgeon de rutina: 126 o más en ayunas, o 200 o más sin síntomas.
5. **¿Qué acciones previenen lo crítico?** Comer las raciones completas, no saltarse comidas antes de una EVA o del ejercicio, y medir en ayunas cuando la rutina lo pida.

**Umbrales** (se evalúan en orden; gana la primera regla que se cumple)

| # | Nivel | Condición | Recomendación al astronauta | Escalamiento | Base | Fuentes |
|---|---|---|---|---|---|---|
| 1 | 🔴 Crítico | `value` < 70 y `symptoms` incluye `confusion`, `fainting`, `unresponsive` | Glucosa baja con confusión. La tripulación debe ayudarte a tomar azúcar de absorción rápida ahora. | Flight surgeon | Fuente — ADA nivel 3: alteración mental o física que requiere ayuda. | [ada_hypo](https://professional.diabetes.org/sites/dpro/files/2025-05/hypoglycemia-hcp-5-27-25.pdf) |
| 2 | 🔴 Crítico | `value` < 54 | Tu glucosa está muy baja. Toma ya 15 g de azúcar de absorción rápida, vuelve a medir en 15 minutos y avisa a tu tripulación. | Flight surgeon | Fuente — ADA nivel 2: < 54 mg/dL. Regla 15-15. | [ada_hypo](https://professional.diabetes.org/sites/dpro/files/2025-05/hypoglycemia-hcp-5-27-25.pdf) |
| 3 | 🔴 Crítico | `value` ≥ 200 y `symptoms` incluye `excessive_thirst`, `frequent_urination`, `blurred_vision`, `nausea`, `vomiting`, `confusion` | Tu glucosa está muy alta y tienes síntomas. Avisa a tu tripulación; se consultará al flight surgeon. | Flight surgeon | Fuente adaptada — ADA: glucosa aleatoria ≥200 con síntomas cumple un criterio diagnóstico. Clasificarla como crítica es decisión de diseño. | [ada_dx](https://diabetes.org/about-diabetes/diagnosis) |
| 4 | 🟡 Precaución | `value` < 70 | Tu glucosa está baja. Toma 15 g de azúcar de absorción rápida y vuelve a medir en 15 minutos. | Autocuidado | Fuente — ADA nivel 1: 54–69 mg/dL. | [ada_hypo](https://professional.diabetes.org/sites/dpro/files/2025-05/hypoglycemia-hcp-5-27-25.pdf) |
| 5 | 🟡 Precaución | `value` ≥ 200 | Tu glucosa está alta. Vuelve a medir mañana en ayunas; el flight surgeon revisará el resultado. | Flight surgeon | Fuente adaptada | [ada_dx](https://diabetes.org/about-diabetes/diagnosis) |
| 6 | 🟡 Precaución | `fasting` = sí y `value` ≥ 126 | Tu glucosa en ayunas está alta. Hace falta confirmarla otro día; el flight surgeon la revisará. | Flight surgeon | Fuente — ADA: ≥126 en ayunas requiere confirmación. | [ada_dx](https://diabetes.org/about-diabetes/diagnosis) |
| 7 | 🟡 Precaución | `fasting` = sí y `value` ≥ 100 | Tu glucosa en ayunas está algo alta. Repite la medición en ayunas otro día. | Autocuidado | Fuente — ADA: 100–125 en ayunas. | [ada_dx](https://diabetes.org/about-diabetes/diagnosis) |
| 8 | 🟡 Precaución | `fasting` = no y `value` ≥ 140 | Tu glucosa después de comer está algo alta. Mide mañana en ayunas para comparar. | Autocuidado | Fuente adaptada — AAFP: valores aleatorios de 140–180 ameritan una prueba más definitiva; ADA: 2 h post-carga normal < 140. | [aafp_dm](https://www.aafp.org/pubs/afp/issues/2010/0401/p863.html), [ada_dx](https://diabetes.org/about-diabetes/diagnosis) |
| 9 | 🟢 Normal | en otro caso | Tu glucosa está en rango normal. | Autocuidado | Fuente | [ada_dx](https://diabetes.org/about-diabetes/diagnosis) |

### `SLEEP_HOURS` · Horas de sueño

| Campo | Valor |
|---|---|
| Unidad · tipo | h · simple |
| Componentes | `value` (h) |
| Campos derivados (los calcula el motor) | `consecutive_nights_le_6h`: noches seguidas (incluida la actual) con ≤ 6 h |
| Peligro(s) RIDGE | Isolation and Confinement |
| Zona del cuerpo | `brain` (Cerebro, sueño y ánimo) |
| Entrada | pulsera, manual |
| Sensibilidad | Estándar |

**Las 5 preguntas del reto**

1. **¿Se puede medir en el espacio? ¿Cómo?** Sí. Actigrafía con la pulsera (NASA la usa en vuelo) o registro manual.
2. **¿Por qué es necesario?** Dormir poco reduce la atención y aumenta los errores; en una misión, un error puede ser grave.
3. **¿Cómo lo afectan los peligros?** Isolation and Confinement: ruido, luz, horarios cambiantes y confinamiento reducen el sueño; en vuelo los astronautas duermen en promedio 6–6.5 h (NASA OCHMO).
4. **¿Cuándo requiere a la tripulación o al flight surgeon?** Flight surgeon: 7 noches seguidas con 6 h o menos. Tripulación (para ajustar horarios): 3 noches seguidas con 6 h o menos.
5. **¿Qué acciones previenen lo crítico?** Respetar el periodo de sueño, oscuridad y tapones contra el ruido, y hacer la prueba de reacción antes de una tarea crítica si dormiste poco.

**Umbrales** (se evalúan en orden; gana la primera regla que se cumple)

| # | Nivel | Condición | Recomendación al astronauta | Escalamiento | Base | Fuentes |
|---|---|---|---|---|---|---|
| 1 | 🔴 Crítico | `consecutive_nights_le_6h` ≥ 7 | Llevas una semana durmiendo 6 horas o menos. Tu atención puede estar tan afectada como si no hubieras dormido un día entero. Se avisa al flight surgeon y se recomienda la prueba de reacción antes de tareas críticas. | Flight surgeon | Fuente adaptada — NASA OCHMO-TB-041: tras 7 días de 6 h de sueño, el desempeño equivale a 24–36 h sin dormir. | [ochmo_sleep](https://www.nasa.gov/wp-content/uploads/2023/03/sleep-accomodations-technical-brief-ochmo.pdf), [aasm_press](https://aasm.org/seven-or-more-hours-of-sleep-per-night-a-health-necessity-for-adults/) |
| 2 | 🟡 Precaución | `consecutive_nights_le_6h` ≥ 3 | Llevas varias noches durmiendo poco. Habla con tu tripulación para proteger tu próximo periodo de sueño. | Tripulación | Regla de diseño — El umbral de 3 noches es regla de diseño (pendiente de validar con el flight surgeon). | [aasm_press](https://aasm.org/seven-or-more-hours-of-sleep-per-night-a-health-necessity-for-adults/) |
| 3 | 🟡 Precaución | `value` ≤ 6 | Dormiste 6 horas o menos. Si hoy tienes una tarea crítica, haz antes la prueba de reacción. | Autocuidado | Fuente — AASM: 6 h o menos es insuficiente para sostener salud y seguridad. | [aasm_press](https://aasm.org/seven-or-more-hours-of-sleep-per-night-a-health-necessity-for-adults/) |
| 4 | 🟡 Precaución | `value` < 7 | Dormiste menos de 7 horas. Intenta proteger tu próximo periodo de sueño. | Autocuidado | Fuente | [aasm_sleep](https://pmc.ncbi.nlm.nih.gov/articles/PMC4434546/) |
| 5 | 🟢 Normal | en otro caso | Dormiste 7 horas o más. | Autocuidado | Fuente | [aasm_sleep](https://pmc.ncbi.nlm.nih.gov/articles/PMC4434546/) |

### `RAD_DOSE_DAILY` · Dosis de radiación diaria

| Campo | Valor |
|---|---|
| Unidad · tipo | mSv/día · simple |
| Componentes | `value` (mSv), `event_active` *contexto*, `symptoms` *contexto* |
| Campos derivados (los calcula el motor) | `ratio_to_baseline`: valor / mediana de los últimos 7 días del mismo tripulante (sin días de evento)<br>`event_dose_msv`: suma de dosis desde que se activó la alerta de evento solar (null si no hay evento) |
| Peligro(s) RIDGE | Space Radiation |
| Zona del cuerpo | `immune` (Sistema inmune) |
| Entrada | sensor (simulado) |
| Sensibilidad | Estándar |

**Las 5 preguntas del reto**

1. **¿Se puede medir en el espacio? ¿Cómo?** Sí. Dosímetros personales y de área; la CSA desarrolla un espectrómetro de neutrones autónomo (CANS) porque los neutrones aportan cerca del 30 % de la radiación en la ISS. En la demo, dosímetro simulado.
2. **¿Por qué es necesario?** La radiación acumulada aumenta el riesgo de cáncer; una dosis alta en poco tiempo (evento solar) puede causar síntomas agudos.
3. **¿Cómo lo afectan los peligros?** Space Radiation: fuera de la protección de la Tierra, los rayos cósmicos y los eventos solares aumentan la dosis. Como referencia, en la ISS se acumulan 0.2–0.5 mSv por día.
4. **¿Cuándo requiere a la tripulación o al flight surgeon?** Flight surgeon: dosis del evento de 125 mSv o más, o náusea o vómito durante un evento. Crítico: 250 mSv en un evento (límite de NASA). Tripulación: dosis del día al doble de lo habitual.
5. **¿Qué acciones previenen lo crítico?** Ir al refugio de tormenta en cuanto haya alerta solar, reducir el tiempo fuera del refugio y llevar siempre el dosímetro.

**Umbrales** (se evalúan en orden; gana la primera regla que se cumple)

| # | Nivel | Condición | Recomendación al astronauta | Escalamiento | Base | Fuentes |
|---|---|---|---|---|---|---|
| 1 | 🔴 Crítico | `event_active` = sí y `symptoms` incluye `nausea`, `vomiting` | Tienes náusea o vómito durante un evento solar. Activa el modo emergencia: el triaje te guiará con el módulo de radiación. | Flight surgeon | Fuente adaptada — El vómito es parte del pródromo del síndrome agudo por radiación; en vuelo también puede deberse al mareo espacial, por eso pasa al triaje. | [orau_ars](https://www.orau.gov/hsc/RadMassCasualties/assets/4_Triage_Handout.pdf), [ntrs_ars_spe](https://ntrs.nasa.gov/api/citations/20170001372/downloads/20170001372.pdf) |
| 2 | 🔴 Crítico | `event_dose_msv` ≥ 250 | La dosis de este evento alcanzó el límite de NASA para eventos solares. Permanece en el refugio; se avisa al flight surgeon. | Flight surgeon | Fuente — NASA-STD-3001 Vol. 1 [V1 4031]: 250 mSv por evento solar. | [ochmo_rad](https://www.nasa.gov/wp-content/uploads/2023/03/radiation-protection-technical-brief-ochmo.pdf) |
| 3 | 🟡 Precaución | `event_dose_msv` ≥ 125 | La dosis del evento ya es la mitad del límite. Permanece en el refugio; se avisa al flight surgeon. | Flight surgeon | Regla de diseño — 50 % del límite de 250 mSv: margen de diseño. | [ochmo_rad](https://www.nasa.gov/wp-content/uploads/2023/03/radiation-protection-technical-brief-ochmo.pdf) |
| 4 | 🟡 Precaución | `ratio_to_baseline` ≥ 2 | Tu dosis de hoy es al menos el doble de lo habitual. Revisa las alertas de clima espacial y sigue el protocolo del refugio. | Tripulación | Regla de diseño — Factor 2 sobre la línea base: regla de diseño (pendiente de fuente). | [ntrs_ascend_rad](https://ntrs.nasa.gov/api/citations/20250006168/downloads/ASCEND%20Simonsen%20draft%201.pdf) |
| 5 | 🟢 Normal | en otro caso | Tu dosis de hoy está dentro de lo habitual para esta misión. | Autocuidado | Fuente | [ntrs_ascend_rad](https://ntrs.nasa.gov/api/citations/20250006168/downloads/ASCEND%20Simonsen%20draft%201.pdf) |

### `RAD_DOSE_CUM` · Dosis de radiación acumulada (carrera)

| Campo | Valor |
|---|---|
| Unidad · tipo | mSv · simple |
| Componentes | `value` (mSv) |
| Campos derivados (los calcula el motor) | `pct_of_career_limit`: valor / 600 × 100<br>`projected_end_msv`: valor + mediana diaria × días restantes de misión |
| Peligro(s) RIDGE | Space Radiation |
| Zona del cuerpo | `immune` (Sistema inmune) |
| Entrada | sensor (simulado) |
| Sensibilidad | Estándar |

**Las 5 preguntas del reto**

1. **¿Se puede medir en el espacio? ¿Cómo?** Sí. Se calcula sumando las dosis diarias del dosímetro a la dosis de carrera previa.
2. **¿Por qué es necesario?** Cuanta más dosis se acumula, mayor es el riesgo de cáncer a largo plazo.
3. **¿Cómo lo afectan los peligros?** Space Radiation: NASA limita la dosis efectiva de carrera a 600 mSv para todas las edades y sexos (riesgo de cánceres inducidos por radiación).
4. **¿Cuándo requiere a la tripulación o al flight surgeon?** Flight surgeon: proyección de 600 mSv o más al final de la misión, o 80 % del límite alcanzado. Crítico: 600 mSv alcanzados.
5. **¿Qué acciones previenen lo crítico?** Planear las EVA y el tiempo fuera del refugio según la proyección, y aplicar el principio ALARA (tan bajo como sea razonablemente posible).

**Umbrales** (se evalúan en orden; gana la primera regla que se cumple)

| # | Nivel | Condición | Recomendación al astronauta | Escalamiento | Base | Fuentes |
|---|---|---|---|---|---|---|
| 1 | 🔴 Crítico | `value` ≥ 600 | Alcanzaste el límite de dosis de carrera de NASA. El flight surgeon definirá los siguientes pasos. | Flight surgeon | Fuente — NASA-STD-3001 Vol. 1 [V1 4030]: < 600 mSv de carrera. | [ochmo_rad](https://www.nasa.gov/wp-content/uploads/2023/03/radiation-protection-technical-brief-ochmo.pdf) |
| 2 | 🟡 Precaución | `projected_end_msv` ≥ 600 | Con el ritmo actual superarías el límite de carrera antes de terminar la misión. El flight surgeon revisará el plan. | Flight surgeon | Fuente adaptada | [ochmo_rad](https://www.nasa.gov/wp-content/uploads/2023/03/radiation-protection-technical-brief-ochmo.pdf) |
| 3 | 🟡 Precaución | `pct_of_career_limit` ≥ 80 | Ya usaste el 80 % de tu límite de dosis de carrera. | Flight surgeon | Regla de diseño — Corte del 80 %: regla de diseño. | [ochmo_rad](https://www.nasa.gov/wp-content/uploads/2023/03/radiation-protection-technical-brief-ochmo.pdf) |
| 4 | 🟢 Normal | en otro caso | Tu dosis acumulada está por debajo del 80 % del límite. | Autocuidado | Fuente | [ochmo_rad](https://www.nasa.gov/wp-content/uploads/2023/03/radiation-protection-technical-brief-ochmo.pdf) |

### `HAB_CO2` · CO₂ del módulo (promedio de 1 h)

| Campo | Valor |
|---|---|
| Unidad · tipo | mmHg · simple |
| Componentes | `value` (mmHg), `module_id` *contexto* |
| Campos derivados (los calcula el motor) | `avg_7d`: promedio de 7 días del mismo módulo |
| Peligro(s) RIDGE | Hostile/Closed Environments |
| Zona del cuerpo | `environment` (Entorno del módulo (no es zona del cuerpo; tarjeta aparte en la figura)) |
| Entrada | sensor (simulado) |
| Sensibilidad | Estándar |

**Las 5 preguntas del reto**

1. **¿Se puede medir en el espacio? ¿Cómo?** Sí. Sensores de presión parcial de CO₂ del sistema de soporte vital. En la demo, sensor simulado.
2. **¿Por qué es necesario?** El CO₂ alto causa dolor de cabeza, fatiga y menor rendimiento; los dolores de cabeza en vuelo se asocian con el CO₂.
3. **¿Cómo lo afectan los peligros?** Hostile/Closed: la tripulación produce CO₂ y sin convección natural se acumula; en la ISS se han medido 1–9 mmHg.
4. **¿Cuándo requiere a la tripulación o al flight surgeon?** Tripulación: más de 3 mmHg (promedio de 1 h) o 2.5 mmHg o más (promedio de 7 días). Flight surgeon: 10 mmHg o más.
5. **¿Qué acciones previenen lo crítico?** Revisar el sistema de remoción de CO₂, mejorar la ventilación del módulo y planear el ejercicio en módulos bien ventilados.

**Umbrales** (se evalúan en orden; gana la primera regla que se cumple)

| # | Nivel | Condición | Recomendación al astronauta | Escalamiento | Base | Fuentes |
|---|---|---|---|---|---|---|
| 1 | 🔴 Crítico | `value` ≥ 10 | El CO₂ del módulo está muy alto. Sigan el protocolo de CO₂ alto y revisen ya el sistema de remoción. | Flight surgeon | Fuente adaptada — 10 mmHg era el SMAC de 24 h; JSC 20584 Rev B (2022) eliminó los SMAC de CO₂, por eso se usa como referencia histórica. | [ntrs_co2_smac](https://ntrs.nasa.gov/api/citations/20150021777/downloads/20150021777.pdf), [jsc20584b](https://ntrs.nasa.gov/citations/20230001817) |
| 2 | 🟡 Precaución | `value` > 4.5 | El CO₂ está alto: puede causar fatiga, malestar y náusea. Revisen la ventilación y el sistema de remoción. | Tripulación | Fuente adaptada — Síntomas reportados en vuelo por encima de 4.5 mmHg (dato anecdótico de NASA). | [ochmo_co2](https://www.nasa.gov/ochmo-tb-004-carbon-dioxide-2/) |
| 3 | 🟡 Precaución | `value` > 3.0 | El CO₂ supera el límite de NASA para el promedio de 1 hora. Revisen la ventilación del módulo. | Tripulación | Fuente — NASA-STD-3001 Vol. 2 Rev D [V2 6004]: ≤ 3 mmHg (promedio de 1 h). | [ochmo_co2](https://www.nasa.gov/ochmo-tb-004-carbon-dioxide-2/) |
| 4 | 🟡 Precaución | `avg_7d` ≥ 2.5 | El CO₂ promedio de la semana está alto; aumenta el riesgo de dolor de cabeza. | Tripulación | Fuente — NASA: mantener el promedio de 7 días < 2.5 mmHg para que el riesgo de dolor de cabeza sea < 1 %. | [ochmo_co2](https://www.nasa.gov/ochmo-tb-004-carbon-dioxide-2/) |
| 5 | 🟢 Normal | en otro caso | El CO₂ del módulo está dentro del límite de NASA. | Autocuidado | Fuente | [ochmo_co2](https://www.nasa.gov/ochmo-tb-004-carbon-dioxide-2/) |

> Indicador de entorno: se evalúa por módulo y genera la alerta para todos los tripulantes de ese módulo.

## Bloque 2 · MVP: bienestar (confidencial)

### `WB_MOOD` · Ánimo (check-in)

| Campo | Valor |
|---|---|
| Unidad · tipo | 0–100 · escala |
| Componentes | `value` (0–100) |
| Campos derivados (los calcula el motor) | `baseline_ready`: hay al menos 7 check-ins en la ventana de línea base (14 días, excluye los últimos 3)<br>`adverse_z_3d`: z del promedio de los últimos 3 check-ins contra la línea base personal, orientado para que positivo = peor (se invierte el signo: más bajo es peor)<br>`adverse_sustained_days`: check-ins seguidos con adverse_z_3d ≥ 1.5 |
| Peligro(s) RIDGE | Isolation and Confinement |
| Zona del cuerpo | `brain` (Cerebro, sueño y ánimo) |
| Entrada | deslizador |
| Sensibilidad | **Confidencial** |

**Las 5 preguntas del reto**

1. **¿Se puede medir en el espacio? ¿Cómo?** Sí. Deslizador sin números en el check-in diario (20 s). NASA BHP usa escalas analógicas visuales (VAS) como medida estándar.
2. **¿Por qué es necesario?** El ánimo bajo sostenido afecta el sueño, la concentración y la convivencia.
3. **¿Cómo lo afectan los peligros?** Isolation and Confinement: el aislamiento, la distancia de la Tierra y el estrés de la misión afectan la salud mental (riesgo de cambios conductuales y de trabajo en equipo de NASA HRP).
4. **¿Cuándo requiere a la tripulación o al flight surgeon?** Salud conductual (confidencial): 5 check-ins seguidos claramente más bajo que tu rango habitual. Nunca se avisa a la tripulación.
5. **¿Qué acciones previenen lo crítico?** Mantener rutinas, contacto con la familia, ejercicio y sueño; usar "Quiero hablar con alguien" en cualquier momento.

**Umbrales** (se evalúan en orden; gana la primera regla que se cumple)

| # | Nivel | Condición | Recomendación al astronauta | Escalamiento | Base | Fuentes |
|---|---|---|---|---|---|---|
| 1 | ⚪ Sin evaluar | `baseline_ready` = no | Estamos aprendiendo tu rango habitual. Sigue con tus check-ins. | Autocuidado | Regla de diseño — Línea base mínima de 7 check-ins: regla de diseño. | [nasa_bhp_measures](https://ntrs.nasa.gov/api/citations/20170005421/downloads/20170005421.pdf) |
| 2 | 🟡 Precaución | `adverse_sustained_days` ≥ 5 | Llevas varios días distinto de lo habitual. Tu equipo de apoyo en Tierra lo sabrá de forma confidencial. Si quieres, usa "Quiero hablar con alguien". | Salud conductual (confidencial) | Regla de diseño — z ≥ 1.5 sostenido 5 días: regla de diseño, pendiente de validación por salud conductual. NASA BHP no publica un corte clínico para las VAS. | [nasa_bhp_measures](https://ntrs.nasa.gov/api/citations/20170005421/downloads/20170005421.pdf) |
| 3 | 🟡 Precaución | `adverse_sustained_days` ≥ 3 | Llevas unos días distinto de lo habitual. Puede ayudar dormir, moverte o hablar con alguien de confianza. | Autocuidado | Regla de diseño | [nasa_bhp_measures](https://ntrs.nasa.gov/api/citations/20170005421/downloads/20170005421.pdf) |
| 4 | 🟢 Normal | en otro caso | Gracias por tu check-in. | Autocuidado | Fuente | [nasa_bhp_measures](https://ntrs.nasa.gov/api/citations/20170005421/downloads/20170005421.pdf) |

> El astronauta no ve un semáforo rojo en bienestar: la app muestra mensajes neutros. La racha premia completar el check-in, nunca el resultado.

### `WB_FATIGUE` · Fatiga (check-in)

| Campo | Valor |
|---|---|
| Unidad · tipo | 0–100 · escala |
| Componentes | `value` (0–100) |
| Campos derivados (los calcula el motor) | `baseline_ready`: hay al menos 7 check-ins en la ventana de línea base (14 días, excluye los últimos 3)<br>`adverse_z_3d`: z del promedio de los últimos 3 check-ins contra la línea base personal, orientado para que positivo = peor (más alto es peor)<br>`adverse_sustained_days`: check-ins seguidos con adverse_z_3d ≥ 1.5 |
| Peligro(s) RIDGE | Isolation and Confinement |
| Zona del cuerpo | `brain` (Cerebro, sueño y ánimo) |
| Entrada | deslizador |
| Sensibilidad | **Confidencial** |

**Las 5 preguntas del reto**

1. **¿Se puede medir en el espacio? ¿Cómo?** Sí. Deslizador sin números en el check-in diario (20 s). NASA BHP usa escalas analógicas visuales (VAS) como medida estándar.
2. **¿Por qué es necesario?** La fatiga sostenida aumenta el riesgo de errores y puede reflejar mal sueño o carga excesiva.
3. **¿Cómo lo afectan los peligros?** Isolation and Confinement: el aislamiento, la distancia de la Tierra y el estrés de la misión afectan la salud mental (riesgo de cambios conductuales y de trabajo en equipo de NASA HRP).
4. **¿Cuándo requiere a la tripulación o al flight surgeon?** Salud conductual (confidencial): 5 check-ins seguidos claramente más alto que tu rango habitual. Nunca se avisa a la tripulación.
5. **¿Qué acciones previenen lo crítico?** Mantener rutinas, contacto con la familia, ejercicio y sueño; usar "Quiero hablar con alguien" en cualquier momento.

**Umbrales** (se evalúan en orden; gana la primera regla que se cumple)

| # | Nivel | Condición | Recomendación al astronauta | Escalamiento | Base | Fuentes |
|---|---|---|---|---|---|---|
| 1 | ⚪ Sin evaluar | `baseline_ready` = no | Estamos aprendiendo tu rango habitual. Sigue con tus check-ins. | Autocuidado | Regla de diseño — Línea base mínima de 7 check-ins: regla de diseño. | [nasa_bhp_measures](https://ntrs.nasa.gov/api/citations/20170005421/downloads/20170005421.pdf) |
| 2 | 🟡 Precaución | `adverse_sustained_days` ≥ 5 | Llevas varios días distinto de lo habitual. Tu equipo de apoyo en Tierra lo sabrá de forma confidencial. Si quieres, usa "Quiero hablar con alguien". | Salud conductual (confidencial) | Regla de diseño — z ≥ 1.5 sostenido 5 días: regla de diseño, pendiente de validación por salud conductual. NASA BHP no publica un corte clínico para las VAS. | [nasa_bhp_measures](https://ntrs.nasa.gov/api/citations/20170005421/downloads/20170005421.pdf) |
| 3 | 🟡 Precaución | `adverse_sustained_days` ≥ 3 | Llevas unos días distinto de lo habitual. Puede ayudar dormir, moverte o hablar con alguien de confianza. | Autocuidado | Regla de diseño | [nasa_bhp_measures](https://ntrs.nasa.gov/api/citations/20170005421/downloads/20170005421.pdf) |
| 4 | 🟢 Normal | en otro caso | Gracias por tu check-in. | Autocuidado | Fuente | [nasa_bhp_measures](https://ntrs.nasa.gov/api/citations/20170005421/downloads/20170005421.pdf) |

> El astronauta no ve un semáforo rojo en bienestar: la app muestra mensajes neutros. La racha premia completar el check-in, nunca el resultado.

### `WB_STRESS` · Estrés (check-in)

| Campo | Valor |
|---|---|
| Unidad · tipo | 0–100 · escala |
| Componentes | `value` (0–100) |
| Campos derivados (los calcula el motor) | `baseline_ready`: hay al menos 7 check-ins en la ventana de línea base (14 días, excluye los últimos 3)<br>`adverse_z_3d`: z del promedio de los últimos 3 check-ins contra la línea base personal, orientado para que positivo = peor (más alto es peor)<br>`adverse_sustained_days`: check-ins seguidos con adverse_z_3d ≥ 1.5 |
| Peligro(s) RIDGE | Isolation and Confinement |
| Zona del cuerpo | `brain` (Cerebro, sueño y ánimo) |
| Entrada | deslizador |
| Sensibilidad | **Confidencial** |

**Las 5 preguntas del reto**

1. **¿Se puede medir en el espacio? ¿Cómo?** Sí. Deslizador sin números en el check-in diario (20 s). NASA BHP usa escalas analógicas visuales (VAS) como medida estándar.
2. **¿Por qué es necesario?** El estrés sostenido afecta el sueño, el ánimo y el desempeño.
3. **¿Cómo lo afectan los peligros?** Isolation and Confinement: el aislamiento, la distancia de la Tierra y el estrés de la misión afectan la salud mental (riesgo de cambios conductuales y de trabajo en equipo de NASA HRP).
4. **¿Cuándo requiere a la tripulación o al flight surgeon?** Salud conductual (confidencial): 5 check-ins seguidos claramente más alto que tu rango habitual. Nunca se avisa a la tripulación.
5. **¿Qué acciones previenen lo crítico?** Mantener rutinas, contacto con la familia, ejercicio y sueño; usar "Quiero hablar con alguien" en cualquier momento.

**Umbrales** (se evalúan en orden; gana la primera regla que se cumple)

| # | Nivel | Condición | Recomendación al astronauta | Escalamiento | Base | Fuentes |
|---|---|---|---|---|---|---|
| 1 | ⚪ Sin evaluar | `baseline_ready` = no | Estamos aprendiendo tu rango habitual. Sigue con tus check-ins. | Autocuidado | Regla de diseño — Línea base mínima de 7 check-ins: regla de diseño. | [nasa_bhp_measures](https://ntrs.nasa.gov/api/citations/20170005421/downloads/20170005421.pdf) |
| 2 | 🟡 Precaución | `adverse_sustained_days` ≥ 5 | Llevas varios días distinto de lo habitual. Tu equipo de apoyo en Tierra lo sabrá de forma confidencial. Si quieres, usa "Quiero hablar con alguien". | Salud conductual (confidencial) | Regla de diseño — z ≥ 1.5 sostenido 5 días: regla de diseño, pendiente de validación por salud conductual. NASA BHP no publica un corte clínico para las VAS. | [nasa_bhp_measures](https://ntrs.nasa.gov/api/citations/20170005421/downloads/20170005421.pdf) |
| 3 | 🟡 Precaución | `adverse_sustained_days` ≥ 3 | Llevas unos días distinto de lo habitual. Puede ayudar dormir, moverte o hablar con alguien de confianza. | Autocuidado | Regla de diseño | [nasa_bhp_measures](https://ntrs.nasa.gov/api/citations/20170005421/downloads/20170005421.pdf) |
| 4 | 🟢 Normal | en otro caso | Gracias por tu check-in. | Autocuidado | Fuente | [nasa_bhp_measures](https://ntrs.nasa.gov/api/citations/20170005421/downloads/20170005421.pdf) |

> El astronauta no ve un semáforo rojo en bienestar: la app muestra mensajes neutros. La racha premia completar el check-in, nunca el resultado.

### `WB_CREW_CONFLICT` · Roces con la tripulación (check-in)

| Campo | Valor |
|---|---|
| Unidad · tipo | 0–100 · escala |
| Componentes | `value` (0–100) |
| Campos derivados (los calcula el motor) | `baseline_ready`: hay al menos 7 check-ins en la ventana de línea base (14 días, excluye los últimos 3)<br>`adverse_z_3d`: z del promedio de los últimos 3 check-ins contra la línea base personal, orientado para que positivo = peor (más alto es peor)<br>`adverse_sustained_days`: check-ins seguidos con adverse_z_3d ≥ 1.5 |
| Peligro(s) RIDGE | Isolation and Confinement |
| Zona del cuerpo | `brain` (Cerebro, sueño y ánimo) |
| Entrada | deslizador |
| Sensibilidad | **Confidencial** |

**Las 5 preguntas del reto**

1. **¿Se puede medir en el espacio? ¿Cómo?** Sí. Deslizador sin números en el check-in diario (20 s). NASA BHP usa escalas analógicas visuales (VAS) como medida estándar.
2. **¿Por qué es necesario?** Los conflictos sostenidos afectan la cohesión del equipo, clave para la seguridad de la misión.
3. **¿Cómo lo afectan los peligros?** Isolation and Confinement: el aislamiento, la distancia de la Tierra y el estrés de la misión afectan la salud mental (riesgo de cambios conductuales y de trabajo en equipo de NASA HRP).
4. **¿Cuándo requiere a la tripulación o al flight surgeon?** Salud conductual (confidencial): 5 check-ins seguidos claramente más alto que tu rango habitual. Nunca se avisa a la tripulación.
5. **¿Qué acciones previenen lo crítico?** Mantener rutinas, contacto con la familia, ejercicio y sueño; usar "Quiero hablar con alguien" en cualquier momento.

**Umbrales** (se evalúan en orden; gana la primera regla que se cumple)

| # | Nivel | Condición | Recomendación al astronauta | Escalamiento | Base | Fuentes |
|---|---|---|---|---|---|---|
| 1 | ⚪ Sin evaluar | `baseline_ready` = no | Estamos aprendiendo tu rango habitual. Sigue con tus check-ins. | Autocuidado | Regla de diseño — Línea base mínima de 7 check-ins: regla de diseño. | [nasa_bhp_measures](https://ntrs.nasa.gov/api/citations/20170005421/downloads/20170005421.pdf) |
| 2 | 🟡 Precaución | `adverse_sustained_days` ≥ 5 | Llevas varios días distinto de lo habitual. Tu equipo de apoyo en Tierra lo sabrá de forma confidencial. Si quieres, usa "Quiero hablar con alguien". | Salud conductual (confidencial) | Regla de diseño — z ≥ 1.5 sostenido 5 días: regla de diseño, pendiente de validación por salud conductual. NASA BHP no publica un corte clínico para las VAS. | [nasa_bhp_measures](https://ntrs.nasa.gov/api/citations/20170005421/downloads/20170005421.pdf) |
| 3 | 🟡 Precaución | `adverse_sustained_days` ≥ 3 | Llevas unos días distinto de lo habitual. Puede ayudar dormir, moverte o hablar con alguien de confianza. | Autocuidado | Regla de diseño | [nasa_bhp_measures](https://ntrs.nasa.gov/api/citations/20170005421/downloads/20170005421.pdf) |
| 4 | 🟢 Normal | en otro caso | Gracias por tu check-in. | Autocuidado | Fuente | [nasa_bhp_measures](https://ntrs.nasa.gov/api/citations/20170005421/downloads/20170005421.pdf) |

> El astronauta no ve un semáforo rojo en bienestar: la app muestra mensajes neutros. La racha premia completar el check-in, nunca el resultado.
> Con 4 tripulantes este dato nunca es anónimo: solo lo ve el astronauta y salud conductual.

### `PHQ2_SCORE` · Tamizaje de ánimo (PHQ-2)

| Campo | Valor |
|---|---|
| Unidad · tipo | puntos (0–6) · escala |
| Componentes | `value` (puntos), `item_1` *contexto*, `item_2` *contexto* |
| Peligro(s) RIDGE | Isolation and Confinement |
| Zona del cuerpo | `brain` (Cerebro, sueño y ánimo) |
| Entrada | cuestionario |
| Sensibilidad | **Confidencial** |

**Las 5 preguntas del reto**

1. **¿Se puede medir en el espacio? ¿Cómo?** Sí. PHQ-2: 2 preguntas sobre las últimas 2 semanas, cada 2 semanas, un día antes de la conferencia psicológica privada.
2. **¿Por qué es necesario?** Es un tamizaje breve: no diagnostica, solo indica si conviene que salud conductual converse contigo.
3. **¿Cómo lo afectan los peligros?** Isolation and Confinement: NASA HRP incluye el riesgo de cambios conductuales y trastornos psiquiátricos por aislamiento, radiación y distancia de la Tierra.
4. **¿Cuándo requiere a la tripulación o al flight surgeon?** Salud conductual (confidencial): 3 puntos o más. Nunca se avisa a la tripulación ni a control de misión.
5. **¿Qué acciones previenen lo crítico?** Conferencias psicológicas privadas, rutinas, contacto con la familia y "Quiero hablar con alguien".

**Umbrales** (se evalúan en orden; gana la primera regla que se cumple)

| # | Nivel | Condición | Recomendación al astronauta | Escalamiento | Base | Fuentes |
|---|---|---|---|---|---|---|
| 1 | 🟡 Precaución | `value` ≥ 3 | Gracias por responder. Tu equipo de apoyo en Tierra revisará tus respuestas antes de tu conferencia privada. Si quieres hablar antes, usa "Quiero hablar con alguien". | Salud conductual (confidencial) | Fuente — Punto de corte 3. | [phq2_nida](https://cde.nida.nih.gov/node/22), [nasa_bhp_ops](https://ntrs.nasa.gov/api/citations/20170003866/downloads/20170003866.pdf) |
| 2 | 🟢 Normal | en otro caso | Gracias por responder. | Autocuidado | Fuente | [phq2_nida](https://cde.nida.nih.gov/node/22) |

> Al astronauta nunca se le muestra el puntaje ni un diagnóstico. No se usa PHQ-9 (exige protocolo de crisis).

### `GAD2_SCORE` · Tamizaje de ansiedad (GAD-2)

| Campo | Valor |
|---|---|
| Unidad · tipo | puntos (0–6) · escala |
| Componentes | `value` (puntos), `item_1` *contexto*, `item_2` *contexto* |
| Peligro(s) RIDGE | Isolation and Confinement |
| Zona del cuerpo | `brain` (Cerebro, sueño y ánimo) |
| Entrada | cuestionario |
| Sensibilidad | **Confidencial** |

**Las 5 preguntas del reto**

1. **¿Se puede medir en el espacio? ¿Cómo?** Sí. GAD-2: 2 preguntas sobre las últimas 2 semanas, cada 2 semanas, un día antes de la conferencia psicológica privada.
2. **¿Por qué es necesario?** Es un tamizaje breve: no diagnostica, solo indica si conviene que salud conductual converse contigo.
3. **¿Cómo lo afectan los peligros?** Isolation and Confinement: NASA HRP incluye el riesgo de cambios conductuales y trastornos psiquiátricos por aislamiento, radiación y distancia de la Tierra.
4. **¿Cuándo requiere a la tripulación o al flight surgeon?** Salud conductual (confidencial): 3 puntos o más. Nunca se avisa a la tripulación ni a control de misión.
5. **¿Qué acciones previenen lo crítico?** Conferencias psicológicas privadas, rutinas, contacto con la familia y "Quiero hablar con alguien".

**Umbrales** (se evalúan en orden; gana la primera regla que se cumple)

| # | Nivel | Condición | Recomendación al astronauta | Escalamiento | Base | Fuentes |
|---|---|---|---|---|---|---|
| 1 | 🟡 Precaución | `value` ≥ 3 | Gracias por responder. Tu equipo de apoyo en Tierra revisará tus respuestas antes de tu conferencia privada. Si quieres hablar antes, usa "Quiero hablar con alguien". | Salud conductual (confidencial) | Fuente — Punto de corte 3. | [gad2_kroenke](https://pubmed.ncbi.nlm.nih.gov/17339617/), [nasa_bhp_ops](https://ntrs.nasa.gov/api/citations/20170003866/downloads/20170003866.pdf) |
| 2 | 🟢 Normal | en otro caso | Gracias por responder. | Autocuidado | Fuente | [gad2_kroenke](https://pubmed.ncbi.nlm.nih.gov/17339617/) |

> Al astronauta nunca se le muestra el puntaje ni un diagnóstico. No se usa PHQ-9 (exige protocolo de crisis).

### `PVT_LAPSES` · Prueba de reacción: lapsos

| Campo | Valor |
|---|---|
| Unidad · tipo | conteo · simple |
| Componentes | `value` (lapsos (TR ≥ 355 ms)), `device_id` *contexto* |
| Campos derivados (los calcula el motor) | `baseline_ready`: al menos 3 corridas previas en el mismo dispositivo y en condiciones de descanso<br>`z_device_baseline`: z contra la línea base personal del mismo dispositivo (positivo = peor) |
| Peligro(s) RIDGE | Isolation and Confinement |
| Zona del cuerpo | `brain` (Cerebro, sueño y ánimo) |
| Entrada | minijuego |
| Sensibilidad | **Confidencial** |

**Las 5 preguntas del reto**

1. **¿Se puede medir en el espacio? ¿Cómo?** Sí. Minijuego de 3 min inspirado en la PVT-B: tocar el círculo en cuanto aparece. La PVT forma parte de la Cognition Test Battery usada por NASA.
2. **¿Por qué es necesario?** Mide la atención sostenida, que cae con la falta de sueño y la fatiga. Es obligatoria antes de tareas críticas (EVA, maniobras).
3. **¿Cómo lo afectan los peligros?** Isolation and Confinement: el sueño corto y los horarios irregulares (riesgo de sueño inadecuado de NASA HRP) reducen la atención.
4. **¿Cuándo requiere a la tripulación o al flight surgeon?** Flight surgeon (confidencial): 20 lapsos o más. A control de misión solo llega "apto: sí / no confirmado".
5. **¿Qué acciones previenen lo crítico?** Proteger el sueño antes de tareas críticas y repetir la prueba tras descansar.

**Umbrales** (se evalúan en orden; gana la primera regla que se cumple)

| # | Nivel | Condición | Recomendación al astronauta | Escalamiento | Base | Fuentes |
|---|---|---|---|---|---|---|
| 1 | 🔴 Crítico | `value` ≥ 20 | Tu atención hoy está muy por debajo de lo normal. Descansa antes de cualquier tarea crítica; tu aptitud queda como "no confirmada". | Flight surgeon | Fuente adaptada — Basner & Rubinstein 2011: 11 y 20 lapsos (umbral 355 ms) separan desempeño alto, medio y bajo en una tarea de vigilancia. Se aplica fuera de ese contexto. | [pvt_fd](https://pmc.ncbi.nlm.nih.gov/articles/PMC3190077), [pvtb_basner](https://pmc.ncbi.nlm.nih.gov/articles/PMC3197786) |
| 2 | 🟡 Precaución | `value` ≥ 11 | Tu atención hoy está por debajo de lo ideal. Si puedes, descansa y repite la prueba antes de una tarea crítica. | Autocuidado | Fuente adaptada | [pvt_fd](https://pmc.ncbi.nlm.nih.gov/articles/PMC3190077), [pvtb_basner](https://pmc.ncbi.nlm.nih.gov/articles/PMC3197786) |
| 3 | 🟡 Precaución | `z_device_baseline` ≥ 2 | Tu resultado está peor que tu rango habitual. Repite la prueba después de descansar. | Autocuidado | Regla de diseño — z ≥ 2 contra la línea base del dispositivo: regla de diseño. | [pvtb_basner](https://pmc.ncbi.nlm.nih.gov/articles/PMC3197786) |
| 4 | ⚪ Sin evaluar | `baseline_ready` = no | Aún estamos construyendo tu línea base en este dispositivo. | Autocuidado | Regla de diseño | [pvtb_basner](https://pmc.ncbi.nlm.nih.gov/articles/PMC3197786) |
| 5 | 🟢 Normal | en otro caso | Tu atención está en tu rango habitual. | Autocuidado | Fuente | [pvtb_basner](https://pmc.ncbi.nlm.nih.gov/articles/PMC3197786) |

> Lapso = respuesta ≥ 355 ms (umbral de la PVT-B; 500 ms es el de la PVT de 10 min).
> Aptitud para tarea crítica = "no confirmado" si cualquiera de los 3 indicadores PVT no está en normal.

### `PVT_MEAN_RT` · Prueba de reacción: tiempo medio

| Campo | Valor |
|---|---|
| Unidad · tipo | ms · simple |
| Componentes | `value` (ms), `device_id` *contexto* |
| Campos derivados (los calcula el motor) | `baseline_ready`: al menos 3 corridas previas en el mismo dispositivo y en condiciones de descanso<br>`z_device_baseline`: z contra la línea base personal del mismo dispositivo (positivo = peor) |
| Peligro(s) RIDGE | Isolation and Confinement |
| Zona del cuerpo | `brain` (Cerebro, sueño y ánimo) |
| Entrada | minijuego |
| Sensibilidad | **Confidencial** |

**Las 5 preguntas del reto**

1. **¿Se puede medir en el espacio? ¿Cómo?** Sí. Minijuego de 3 min inspirado en la PVT-B: tocar el círculo en cuanto aparece. La PVT forma parte de la Cognition Test Battery usada por NASA.
2. **¿Por qué es necesario?** Mide la atención sostenida, que cae con la falta de sueño y la fatiga. Es obligatoria antes de tareas críticas (EVA, maniobras).
3. **¿Cómo lo afectan los peligros?** Isolation and Confinement: el sueño corto y los horarios irregulares (riesgo de sueño inadecuado de NASA HRP) reducen la atención.
4. **¿Cuándo requiere a la tripulación o al flight surgeon?** Flight surgeon (confidencial): 20 lapsos o más. A control de misión solo llega "apto: sí / no confirmado".
5. **¿Qué acciones previenen lo crítico?** Proteger el sueño antes de tareas críticas y repetir la prueba tras descansar.

**Umbrales** (se evalúan en orden; gana la primera regla que se cumple)

| # | Nivel | Condición | Recomendación al astronauta | Escalamiento | Base | Fuentes |
|---|---|---|---|---|---|---|
| 1 | 🟡 Precaución | `z_device_baseline` ≥ 2 | Hoy reaccionas más lento que de costumbre. Descansa y repite la prueba antes de una tarea crítica. | Autocuidado | Regla de diseño — No hay corte absoluto publicado para el tiempo medio; se compara contra la línea base. | [pvtb_basner](https://pmc.ncbi.nlm.nih.gov/articles/PMC3197786) |
| 2 | ⚪ Sin evaluar | `baseline_ready` = no | Aún estamos construyendo tu línea base en este dispositivo. | Autocuidado | Regla de diseño | [pvtb_basner](https://pmc.ncbi.nlm.nih.gov/articles/PMC3197786) |
| 3 | 🟢 Normal | en otro caso | Tu tiempo de reacción está en tu rango habitual. | Autocuidado | Fuente | [pvtb_basner](https://pmc.ncbi.nlm.nih.gov/articles/PMC3197786) |

### `PVT_FALSE_STARTS` · Prueba de reacción: falsos inicios

| Campo | Valor |
|---|---|
| Unidad · tipo | conteo · simple |
| Componentes | `value` (respuestas < 100 ms o sin estímulo), `device_id` *contexto* |
| Campos derivados (los calcula el motor) | `baseline_ready`: al menos 3 corridas previas en el mismo dispositivo y en condiciones de descanso<br>`z_device_baseline`: z contra la línea base personal del mismo dispositivo (positivo = peor) |
| Peligro(s) RIDGE | Isolation and Confinement |
| Zona del cuerpo | `brain` (Cerebro, sueño y ánimo) |
| Entrada | minijuego |
| Sensibilidad | **Confidencial** |

**Las 5 preguntas del reto**

1. **¿Se puede medir en el espacio? ¿Cómo?** Sí. Minijuego de 3 min inspirado en la PVT-B: tocar el círculo en cuanto aparece. La PVT forma parte de la Cognition Test Battery usada por NASA.
2. **¿Por qué es necesario?** Mide la atención sostenida, que cae con la falta de sueño y la fatiga. Es obligatoria antes de tareas críticas (EVA, maniobras).
3. **¿Cómo lo afectan los peligros?** Isolation and Confinement: el sueño corto y los horarios irregulares (riesgo de sueño inadecuado de NASA HRP) reducen la atención.
4. **¿Cuándo requiere a la tripulación o al flight surgeon?** Flight surgeon (confidencial): 20 lapsos o más. A control de misión solo llega "apto: sí / no confirmado".
5. **¿Qué acciones previenen lo crítico?** Proteger el sueño antes de tareas críticas y repetir la prueba tras descansar.

**Umbrales** (se evalúan en orden; gana la primera regla que se cumple)

| # | Nivel | Condición | Recomendación al astronauta | Escalamiento | Base | Fuentes |
|---|---|---|---|---|---|---|
| 1 | 🟡 Precaución | `z_device_baseline` ≥ 2 | Hoy tocaste antes de tiempo más de lo habitual. Puede ser señal de cansancio; repite la prueba tras descansar. | Autocuidado | Regla de diseño | [pvtb_basner](https://pmc.ncbi.nlm.nih.gov/articles/PMC3197786), [psytoolkit_pvtb](https://www.psytoolkit.org/library/pvtb.html) |
| 2 | ⚪ Sin evaluar | `baseline_ready` = no | Aún estamos construyendo tu línea base en este dispositivo. | Autocuidado | Regla de diseño | [pvtb_basner](https://pmc.ncbi.nlm.nih.gov/articles/PMC3197786) |
| 3 | 🟢 Normal | en otro caso | Sin cambios respecto a tu rango habitual. | Autocuidado | Fuente | [pvtb_basner](https://pmc.ncbi.nlm.nih.gov/articles/PMC3197786) |

> Falso inicio < 100 ms: se toma de PsyToolkit, que lo atribuye a Basner 2011; confirmar en el texto original (pendiente).

## Bloque 3 · Resto: masa, ejercicio, visión, síntomas y hábitat

### `BODY_MASS` · Masa corporal

| Campo | Valor |
|---|---|
| Unidad · tipo | kg · simple |
| Componentes | `value` (kg) |
| Campos derivados (los calcula el motor) | `pct_change_from_preflight`: (valor − masa preflight) / masa preflight × 100 |
| Peligro(s) RIDGE | Gravity Fields, Distance from Earth |
| Zona del cuerpo | `muscle` (Músculo) |
| Entrada | manual |
| Sensibilidad | Estándar |

**Las 5 preguntas del reto**

1. **¿Se puede medir en el espacio? ¿Cómo?** Sí, pero no con báscula: en ingravidez se mide la masa con dispositivos de aceleración (SLAMMD o BMMD en la ISS).
2. **¿Por qué es necesario?** Perder masa suele indicar que se come menos de lo necesario y se pierde músculo y hueso.
3. **¿Cómo lo afectan los peligros?** Gravity Fields y Distance from Earth: los astronautas suelen comer menos de lo recomendado; pierden 2–5 % de masa el primer mes y la mantienen baja durante el vuelo.
4. **¿Cuándo requiere a la tripulación o al flight surgeon?** Flight surgeon: pérdida del 5 % o más respecto a la masa preflight (rutina); 10 % o más (crítico).
5. **¿Qué acciones previenen lo crítico?** Comer las raciones completas, ejercicio de resistencia y medir la masa con la frecuencia de la rutina.

**Umbrales** (se evalúan en orden; gana la primera regla que se cumple)

| # | Nivel | Condición | Recomendación al astronauta | Escalamiento | Base | Fuentes |
|---|---|---|---|---|---|---|
| 1 | 🔴 Crítico | `pct_change_from_preflight` ≤ -10 | Has perdido el 10 % o más de tu masa inicial. El flight surgeon revisará tu alimentación. | Flight surgeon | Fuente adaptada — Declaración de S. M. Smith (nutrición, NASA JSC): más de 10 % es crítico. No es una norma publicada. | [sn_smith](https://www.sciencenews.org/?p=40630) |
| 2 | 🟡 Precaución | `pct_change_from_preflight` ≤ -5 | Has perdido el 5 % o más de tu masa inicial. Intenta completar todas tus raciones; el flight surgeon lo revisará. | Flight surgeon | Fuente adaptada — Smith: 5–10 % es preocupante. AAFP: > 5 % en 6–12 meses es clínicamente relevante (en adultos mayores). | [sn_smith](https://www.sciencenews.org/?p=40630), [aafp_weight](https://www.aafp.org/pubs/afp/issues/2014/0501/p718.html) |
| 3 | 🟢 Normal | en otro caso | Tu masa corporal está cerca de tu valor inicial. | Autocuidado | Fuente | [ntrs_body_mass](https://ntrs.nasa.gov/citations/20140013313) |

### `EXERCISE_MIN` · Ejercicio

| Campo | Valor |
|---|---|
| Unidad · tipo | min/día · simple |
| Componentes | `value` (min), `type` *contexto* |
| Campos derivados (los calcula el motor) | `rolling_7d_pct_of_prescription`: minutos de los últimos 7 días / prescripción semanal × 100 (prescripción por defecto: 600 min/semana) |
| Peligro(s) RIDGE | Gravity Fields |
| Zona del cuerpo | `bones` (Huesos) |
| Entrada | manual, pulsera |
| Sensibilidad | Estándar |

**Las 5 preguntas del reto**

1. **¿Se puede medir en el espacio? ¿Cómo?** Sí. Registro de sesiones en cinta (T2), cicloergómetro (CEVIS) y equipo de resistencia (ARED).
2. **¿Por qué es necesario?** El ejercicio es la principal contramedida contra la pérdida de hueso, músculo y capacidad aeróbica.
3. **¿Cómo lo afectan los peligros?** Gravity Fields: sin carga, hueso y músculo se pierden; NASA exige mantener la capacidad aeróbica y la fuerza en 80 % o más de la previa. En la ISS el promedio es de 600 min por semana.
4. **¿Cuándo requiere a la tripulación o al flight surgeon?** Flight surgeon: menos del 50 % de la prescripción semanal.
5. **¿Qué acciones previenen lo crítico?** Seguir la prescripción diaria (unos 30 min aeróbicos + 30–60 min de resistencia) y reprogramar las sesiones perdidas.

**Umbrales** (se evalúan en orden; gana la primera regla que se cumple)

| # | Nivel | Condición | Recomendación al astronauta | Escalamiento | Base | Fuentes |
|---|---|---|---|---|---|---|
| 1 | 🟡 Precaución | `rolling_7d_pct_of_prescription` < 50 | Esta semana hiciste menos de la mitad de tu ejercicio prescrito. El flight surgeon revisará tu plan. | Flight surgeon | Regla de diseño — Cortes de 50 % y 80 % de cumplimiento: regla de diseño. | [ochmo_exercise](https://www.nasa.gov/wp-content/uploads/2023/12/ochmo-tb-031-exercise-overview.pdf) |
| 2 | 🟡 Precaución | `rolling_7d_pct_of_prescription` < 80 | Vas por debajo de tu ejercicio prescrito esta semana. Intenta recuperar sesiones. | Autocuidado | Regla de diseño | [ochmo_exercise](https://www.nasa.gov/wp-content/uploads/2023/12/ochmo-tb-031-exercise-overview.pdf) |
| 3 | 🟢 Normal | en otro caso | Vas al día con tu ejercicio prescrito. | Autocuidado | Fuente | [ochmo_exercise](https://www.nasa.gov/wp-content/uploads/2023/12/ochmo-tb-031-exercise-overview.pdf) |

> Sin nivel crítico: el déficit de ejercicio no es una emergencia aguda.

### `VISION_CHECK` · Síntomas visuales (SANS)

| Campo | Valor |
|---|---|
| Unidad · tipo | sí/no · sí/no |
| Componentes | `near_blur`, `far_blur`, `amsler_distortion`, `blind_spot_or_field_loss`, `double_vision`, `transient_vision_loss`, `severe_headache` |
| Peligro(s) RIDGE | Gravity Fields |
| Zona del cuerpo | `eyes` (Ojos) |
| Entrada | clics |
| Sensibilidad | Estándar |

**Las 5 preguntas del reto**

1. **¿Se puede medir en el espacio? ¿Cómo?** Sí. Autoevaluación con carta de agudeza visual y rejilla de Amsler; en la ISS también hay fondo de ojo y OCT.
2. **¿Por qué es necesario?** El SANS puede cambiar la visión durante misiones largas; detectarlo temprano protege la vista y la misión.
3. **¿Cómo lo afectan los peligros?** Gravity Fields: en ingravidez la estructura del ojo y del cerebro puede cambiar (edema del disco óptico, pliegues coroideos, aplanamiento del globo, cambio de graduación).
4. **¿Cuándo requiere a la tripulación o al flight surgeon?** Flight surgeon (prioritario): distorsión en la rejilla de Amsler, punto ciego o pérdida de campo, visión doble o pérdidas breves de visión. Flight surgeon (rutina): visión borrosa nueva o dolor de cabeza intenso.
5. **¿Qué acciones previenen lo crítico?** Autoevaluación semanal, usar las gafas de anticipación espacial si cambia la graduación y reportar cualquier cambio.

**Umbrales** (se evalúan en orden; gana la primera regla que se cumple)

| # | Nivel | Condición | Recomendación al astronauta | Escalamiento | Base | Fuentes |
|---|---|---|---|---|---|---|
| 1 | 🔴 Crítico | `amsler_distortion` = sí o `blind_spot_or_field_loss` = sí o `double_vision` = sí o `transient_vision_loss` = sí | Reportaste un cambio en tu visión que el flight surgeon debe revisar pronto. Evita tareas que dependan de la vista fina hasta recibir indicaciones. | Flight surgeon | Fuente adaptada — NASA: SANS con impacto funcional agudo = pérdida de campo visual o visión central distorsionada; visión doble y oscurecimientos transitorios son síntomas clásicos de hipertensión intracraneal. | [ntrs_sans_2023](https://ntrs.nasa.gov/citations/20220014606), [ntrs_sans_intro](https://ntrs.nasa.gov/api/citations/20170009173/downloads/20170009173.pdf) |
| 2 | 🟡 Precaución | `severe_headache` = sí | Reportaste dolor de cabeza intenso. Revisa también el CO₂ del módulo; el flight surgeon lo revisará. | Flight surgeon | Fuente adaptada | [ntrs_sans_intro](https://ntrs.nasa.gov/api/citations/20170009173/downloads/20170009173.pdf), [ochmo_co2](https://www.nasa.gov/ochmo-tb-004-carbon-dioxide-2/) |
| 3 | 🟡 Precaución | `near_blur` = sí o `far_blur` = sí | Reportaste visión borrosa. Prueba tus gafas de anticipación espacial; el flight surgeon lo revisará en la próxima consulta. | Flight surgeon | Fuente adaptada — El cambio de graduación (hipermetropía) es un signo de SANS. | [ntrs_sans_2023](https://ntrs.nasa.gov/citations/20220014606) |
| 4 | 🟢 Normal | en otro caso | Sin cambios visuales reportados. | Autocuidado | Fuente | [ntrs_sans_2023](https://ntrs.nasa.gov/citations/20220014606) |

### `SYMPTOM` · Síntoma por zona del cuerpo

| Campo | Valor |
|---|---|
| Unidad · tipo | catálogo · catálogo |
| Componentes | `symptoms`, `severity` *contexto* |
| Peligro(s) RIDGE | Gravity Fields, Hostile/Closed Environments, Space Radiation, Isolation and Confinement |
| Zona del cuerpo | `by_symptom` (Según el síntoma (se toma de la zona de cada síntoma)) |
| Entrada | clics |
| Sensibilidad | Estándar |

**Las 5 preguntas del reto**

1. **¿Se puede medir en el espacio? ¿Cómo?** Sí. El astronauta toca la zona del cuerpo en la figura y elige el síntoma.
2. **¿Por qué es necesario?** Algunos síntomas son señales de alarma que no pueden esperar a la siguiente medición.
3. **¿Cómo lo afectan los peligros?** Varios peligros: mareo y desorientación al cambiar de gravedad, infecciones en espacio cerrado, náusea tras un evento solar y dolor de cabeza por CO₂.
4. **¿Cuándo requiere a la tripulación o al flight surgeon?** Tripulación + flight surgeon: cualquier señal de alarma de infarto o ACV (dolor en el pecho, falta de aire, cara caída, debilidad de un brazo, dificultad para hablar, cambio súbito de visión o de equilibrio, dolor de cabeza súbito e intenso) o confusión nueva. Tripulación: síntomas de posible infección.
5. **¿Qué acciones previenen lo crítico?** Reportar temprano, higiene y revisar el entorno (CO₂, temperatura) cuando hay dolor de cabeza o mareo.

**Umbrales** (se evalúan en orden; gana la primera regla que se cumple)

| # | Nivel | Condición | Recomendación al astronauta | Escalamiento | Base | Fuentes |
|---|---|---|---|---|---|---|
| 1 | 🔴 Crítico | `symptoms` incluye alguna señal de alarma (`red_flag`) | Reportaste un síntoma de alarma. Avisa ya a tu tripulación y activa el modo emergencia si empeora. | Flight surgeon | Fuente adaptada — Señales de alarma de infarto y ACV de la AHA; confusión nueva = puntaje 3 en NEWS2. | [aha_warning](https://www.heart.org/en/about-us/heart-attack-and-stroke-symptoms), [news2](https://www.nwas.nhs.uk/publications/news2-national-early-warning-score) |
| 2 | 🟡 Precaución | `symptoms` incluye `fainting` | Reportaste un desmayo o casi desmayo. Quédate sujeto, mide tu presión y pulso, y avisa a tu tripulación. | Tripulación | Fuente adaptada | [aha_low_bp](https://www.heart.org/en/health-topics/high-blood-pressure/the-facts-about-high-blood-pressure/low-blood-pressure-when-blood-pressure-is-too-low) |
| 3 | 🟡 Precaución | `symptoms` incluye algún síntoma tipo infección | Tus síntomas podrían ser de una infección. Mide tu temperatura, refuerza la higiene y avisa a tu tripulación para evitar contagios. | Tripulación | Fuente adaptada — NASA HRP: cambios inmunes y del microbioma aumentan el riesgo de enfermar en espacio cerrado. | [nasa_hrp_risks](https://www.nasa.gov/hrp/risks/), [nasa_hrp_hazards](https://www.nasa.gov/hrp/hazards/) |
| 4 | 🟡 Precaución | `symptoms` incluye otro síntoma del catálogo (lista completa en el JSON) | Gracias por reportarlo. Sigue la guía de autocuidado y vuelve a registrarlo si continúa o empeora. | Autocuidado | Regla de diseño | [nasa_hrp_risks](https://www.nasa.gov/hrp/risks/) |
| 5 | 🟢 Normal | en otro caso | Sin síntomas reportados. | Autocuidado | Fuente | [nasa_hrp_risks](https://www.nasa.gov/hrp/risks/) |

### `HAB_TEMP` · Temperatura del módulo

| Campo | Valor |
|---|---|
| Unidad · tipo | °C · simple |
| Componentes | `value` (°C), `module_id` *contexto* |
| Peligro(s) RIDGE | Hostile/Closed Environments |
| Zona del cuerpo | `environment` (Entorno del módulo (no es zona del cuerpo; tarjeta aparte en la figura)) |
| Entrada | sensor (simulado) |
| Sensibilidad | Estándar |

**Las 5 preguntas del reto**

1. **¿Se puede medir en el espacio? ¿Cómo?** Sí. Sensores del sistema de control ambiental. En la demo, sensor simulado.
2. **¿Por qué es necesario?** Fuera del rango cómodo baja el rendimiento y se duerme peor; los extremos dañan la salud.
3. **¿Cómo lo afectan los peligros?** Hostile/Closed: el soporte vital debe mantener la temperatura; el ejercicio y los equipos generan calor.
4. **¿Cuándo requiere a la tripulación o al flight surgeon?** Tripulación: fuera de 20–25 °C. Flight surgeon: fuera de 18–27 °C.
5. **¿Qué acciones previenen lo crítico?** Ajustar el control térmico del módulo y la ropa, y planear el ejercicio en módulos ventilados.

**Umbrales** (se evalúan en orden; gana la primera regla que se cumple)

| # | Nivel | Condición | Recomendación al astronauta | Escalamiento | Base | Fuentes |
|---|---|---|---|---|---|---|
| 1 | 🔴 Crítico | `value` < 18 o `value` > 27 | La temperatura del módulo está fuera de los límites de salud de NASA. Ajusten el control térmico o cambien de módulo. | Flight surgeon | Fuente adaptada — [V2 6012] límites de salud: envolvente de 18 °C/75 % HR a 27 °C/25 % HR (aquí simplificada a 18–27 °C). | [ochmo_eclss](https://www.nasa.gov/wp-content/uploads/2023/07/eclss-technical-brief-ochmo.pdf) |
| 2 | 🟡 Precaución | `value` < 20 o `value` > 25 | La temperatura del módulo está fuera de la zona de rendimiento. Ajusten el control térmico. | Tripulación | Fuente — [V2 6013] zona de rendimiento: 20–25 °C. | [ochmo_eclss](https://www.nasa.gov/wp-content/uploads/2023/07/eclss-technical-brief-ochmo.pdf) |
| 3 | 🟢 Normal | en otro caso | Temperatura del módulo en la zona de rendimiento. | Autocuidado | Fuente | [ochmo_eclss](https://www.nasa.gov/wp-content/uploads/2023/07/eclss-technical-brief-ochmo.pdf) |

### `HAB_HUMIDITY` · Humedad relativa del módulo

| Campo | Valor |
|---|---|
| Unidad · tipo | % · simple |
| Componentes | `value` (% HR), `module_id` *contexto* |
| Peligro(s) RIDGE | Hostile/Closed Environments |
| Zona del cuerpo | `environment` (Entorno del módulo (no es zona del cuerpo; tarjeta aparte en la figura)) |
| Entrada | sensor (simulado) |
| Sensibilidad | Estándar |

**Las 5 preguntas del reto**

1. **¿Se puede medir en el espacio? ¿Cómo?** Sí. Sensores del sistema de control ambiental. En la demo, sensor simulado.
2. **¿Por qué es necesario?** El aire muy seco irrita ojos y vías respiratorias; el muy húmedo favorece el moho y la condensación.
3. **¿Cómo lo afectan los peligros?** Hostile/Closed: la respiración y el sudor agregan humedad que el soporte vital debe retirar; la humedad influye en la carga microbiana.
4. **¿Cuándo requiere a la tripulación o al flight surgeon?** Tripulación: fuera de 30–60 %. Flight surgeon: fuera de 25–75 %.
5. **¿Qué acciones previenen lo crítico?** Ajustar el control de humedad y revisar la condensación.

**Umbrales** (se evalúan en orden; gana la primera regla que se cumple)

| # | Nivel | Condición | Recomendación al astronauta | Escalamiento | Base | Fuentes |
|---|---|---|---|---|---|---|
| 1 | 🔴 Crítico | `value` < 25 o `value` > 75 | La humedad del módulo está fuera de los límites de salud de NASA. Ajusten el control de humedad. | Flight surgeon | Fuente adaptada — [V2 6012] envolvente simplificada a 25–75 % HR. | [ochmo_eclss](https://www.nasa.gov/wp-content/uploads/2023/07/eclss-technical-brief-ochmo.pdf) |
| 2 | 🟡 Precaución | `value` < 30 o `value` > 60 | La humedad del módulo está fuera de la zona de rendimiento. | Tripulación | Fuente — [V2 6013] zona de rendimiento: 30–60 % HR. | [ochmo_eclss](https://www.nasa.gov/wp-content/uploads/2023/07/eclss-technical-brief-ochmo.pdf) |
| 3 | 🟢 Normal | en otro caso | Humedad del módulo en la zona de rendimiento. | Autocuidado | Fuente | [ochmo_eclss](https://www.nasa.gov/wp-content/uploads/2023/07/eclss-technical-brief-ochmo.pdf) |

### `HAB_NOISE` · Ruido del módulo

| Campo | Valor |
|---|---|
| Unidad · tipo | dBA · simple |
| Componentes | `value` (dBA), `period` *contexto*, `module_id` *contexto* |
| Peligro(s) RIDGE | Hostile/Closed Environments |
| Zona del cuerpo | `environment` (Entorno del módulo (no es zona del cuerpo; tarjeta aparte en la figura)) |
| Entrada | sensor (simulado) |
| Sensibilidad | Estándar |

**Las 5 preguntas del reto**

1. **¿Se puede medir en el espacio? ¿Cómo?** Sí. Sonómetros y dosímetros acústicos. En la demo, sensor simulado.
2. **¿Por qué es necesario?** El ruido continuo causa dolor de cabeza, fatiga, mal sueño y puede impedir oír alarmas; el muy alto daña el oído.
3. **¿Cómo lo afectan los peligros?** Hostile/Closed: ventiladores, bombas y equipos de ejercicio funcionan todo el día en un espacio pequeño.
4. **¿Cuándo requiere a la tripulación o al flight surgeon?** Tripulación: más de ~58 dBA en trabajo o ~49 dBA en sueño. Flight surgeon: 85 dBA o más.
5. **¿Qué acciones previenen lo crítico?** Usar protección auditiva, alejarse de las fuentes de ruido y apagar equipos innecesarios en el periodo de sueño.

**Umbrales** (se evalúan en orden; gana la primera regla que se cumple)

| # | Nivel | Condición | Recomendación al astronauta | Escalamiento | Base | Fuentes |
|---|---|---|---|---|---|---|
| 1 | 🔴 Crítico | `value` ≥ 85 | El ruido está en nivel peligroso para el oído. Usa protección auditiva ya y aléjate de la fuente. | Flight surgeon | Fuente — [V2 6077]: < 85 dBA sin importar la duración. | [ochmo_acoustics](https://www.nasa.gov/sites/default/files/atoms/files/acoustics_technical_brief_ochmo_0.pdf) |
| 2 | 🟡 Precaución | `period` = sleep y `value` > 49 | Hay demasiado ruido para dormir bien. Usa tapones y avisa a la tripulación para reducir fuentes. | Tripulación | Fuente adaptada — Límite de sueño NC-40 (≈ 49 dBA). La equivalencia NC → dBA es aproximada. | [ochmo_sleep](https://www.nasa.gov/wp-content/uploads/2023/03/sleep-accomodations-technical-brief-ochmo.pdf), [ntrs_nc_dba](https://ntrs.nasa.gov/api/citations/20090043801/downloads/20090043801.pdf) |
| 3 | 🟡 Precaución | `value` > 58 | El ruido del módulo supera el límite continuo para áreas de trabajo. Considera protección auditiva. | Tripulación | Fuente adaptada — [V2 6078] NC-50 en áreas de trabajo (≈ 58 dBA). La equivalencia NC → dBA es aproximada. | [ochmo_acoustics](https://www.nasa.gov/sites/default/files/atoms/files/acoustics_technical_brief_ochmo_0.pdf), [ntrs_nc_dba](https://ntrs.nasa.gov/api/citations/20090043801/downloads/20090043801.pdf) |
| 4 | 🟢 Normal | en otro caso | El ruido del módulo está dentro de los límites. | Autocuidado | Fuente | [ochmo_acoustics](https://www.nasa.gov/sites/default/files/atoms/files/acoustics_technical_brief_ochmo_0.pdf) |

## 6. Reglas de diseño y pendientes de fuente

Estas reglas no tienen un número publicado detrás. Quedan configurables desde el panel (con auditoría) y deben revisarse con un profesional antes de usarse fuera de la demo.

| Indicador | Regla | Condición | Nota |
|---|---|---|---|
| `SLEEP_HOURS` | #2 | `consecutive_nights_le_6h` ≥ 3 | El umbral de 3 noches es regla de diseño (pendiente de validar con el flight surgeon). |
| `RAD_DOSE_DAILY` | #3 | `event_dose_msv` ≥ 125 | 50 % del límite de 250 mSv: margen de diseño. |
| `RAD_DOSE_DAILY` | #4 | `ratio_to_baseline` ≥ 2 | Factor 2 sobre la línea base: regla de diseño (pendiente de fuente). |
| `RAD_DOSE_CUM` | #3 | `pct_of_career_limit` ≥ 80 | Corte del 80 %: regla de diseño. |
| `WB_MOOD` | #1 | `baseline_ready` = no | Línea base mínima de 7 check-ins: regla de diseño. |
| `WB_MOOD` | #2 | `adverse_sustained_days` ≥ 5 | z ≥ 1.5 sostenido 5 días: regla de diseño, pendiente de validación por salud conductual. NASA BHP no publica un corte clínico para las VAS. |
| `WB_MOOD` | #3 | `adverse_sustained_days` ≥ 3 |  |
| `WB_FATIGUE` | #1 | `baseline_ready` = no | Línea base mínima de 7 check-ins: regla de diseño. |
| `WB_FATIGUE` | #2 | `adverse_sustained_days` ≥ 5 | z ≥ 1.5 sostenido 5 días: regla de diseño, pendiente de validación por salud conductual. NASA BHP no publica un corte clínico para las VAS. |
| `WB_FATIGUE` | #3 | `adverse_sustained_days` ≥ 3 |  |
| `WB_STRESS` | #1 | `baseline_ready` = no | Línea base mínima de 7 check-ins: regla de diseño. |
| `WB_STRESS` | #2 | `adverse_sustained_days` ≥ 5 | z ≥ 1.5 sostenido 5 días: regla de diseño, pendiente de validación por salud conductual. NASA BHP no publica un corte clínico para las VAS. |
| `WB_STRESS` | #3 | `adverse_sustained_days` ≥ 3 |  |
| `WB_CREW_CONFLICT` | #1 | `baseline_ready` = no | Línea base mínima de 7 check-ins: regla de diseño. |
| `WB_CREW_CONFLICT` | #2 | `adverse_sustained_days` ≥ 5 | z ≥ 1.5 sostenido 5 días: regla de diseño, pendiente de validación por salud conductual. NASA BHP no publica un corte clínico para las VAS. |
| `WB_CREW_CONFLICT` | #3 | `adverse_sustained_days` ≥ 3 |  |
| `PVT_LAPSES` | #3 | `z_device_baseline` ≥ 2 | z ≥ 2 contra la línea base del dispositivo: regla de diseño. |
| `PVT_LAPSES` | #4 | `baseline_ready` = no |  |
| `PVT_MEAN_RT` | #1 | `z_device_baseline` ≥ 2 | No hay corte absoluto publicado para el tiempo medio; se compara contra la línea base. |
| `PVT_MEAN_RT` | #2 | `baseline_ready` = no |  |
| `PVT_FALSE_STARTS` | #1 | `z_device_baseline` ≥ 2 |  |
| `PVT_FALSE_STARTS` | #2 | `baseline_ready` = no |  |
| `EXERCISE_MIN` | #1 | `rolling_7d_pct_of_prescription` < 50 | Cortes de 50 % y 80 % de cumplimiento: regla de diseño. |
| `EXERCISE_MIN` | #2 | `rolling_7d_pct_of_prescription` < 80 |  |
| `SYMPTOM` | #4 | `symptoms` incluye otro síntoma del catálogo (lista completa en el JSON) |  |

**Otros pendientes**

- `SPO2`: Los cortes valen para atmósfera a nivel del mar. En atmósferas de exploración con menor presión parcial de O₂, el admin debe poder ajustar los cortes por entorno (pendiente de fuente).
- `PVT_FALSE_STARTS`: Falso inicio < 100 ms: se toma de PsyToolkit, que lo atribuye a Basner 2011; confirmar en el texto original (pendiente).

## 7. Fuentes

Todas las URL se verificaron el 14-nov-2026. NASA no respalda entidades que no son del gobierno de EE. UU.; las fuentes no gubernamentales se citan como referencia clínica.

- `aha_bp` — [AHA – Understanding Blood Pressure Readings](https://www.heart.org/en/health-topics/high-blood-pressure/understanding-blood-pressure-readings)
- `aha_low_bp` — [AHA – Low Blood Pressure: When Blood Pressure Is Too Low](https://www.heart.org/en/health-topics/high-blood-pressure/the-facts-about-high-blood-pressure/low-blood-pressure-when-blood-pressure-is-too-low)
- `news2` — [Royal College of Physicians – NEWS2, Chart 1: The NEWS scoring system (reproducido por NHS NWAS)](https://www.nwas.nhs.uk/publications/news2-national-early-warning-score)
- `ama_bp2025` — [AMA – New BP guideline: 5 things physicians should know (2025 AHA/ACC conserva las categorías de 2017)](https://www.ama-assn.org/delivering-care/hypertension/new-bp-guideline-5-things-physicians-should-know)
- `aha_hr` — [AHA – All About Heart Rate](https://www.heart.org/en/health-topics/high-blood-pressure/the-facts-about-high-blood-pressure/all-about-heart-rate-pulse)
- `chemm_start` — [HHS CHEMM – START Adult Triage Algorithm](https://chemm.hhs.gov/startalgotext.htm)
- `statpearls_rr` — [StatPearls (NCBI Bookshelf) – frecuencia respiratoria normal del adulto en reposo](https://www.ncbi.nlm.nih.gov/books/NBK537306/)
- `who_pulseox` — [WHO Pulse Oximetry Training Manual (texto literal reproducido por PhenX Toolkit)](https://dev.phenxtoolkit.org/protocols/view/91102)
- `mayo_hypothermia` — [Mayo Clinic – Hypothermia: First aid](https://www.mayoclinic.org/first-aid/first-aid-hypothermia/basics/ART-20056624)
- `adam_fever` — [A.D.A.M. Medical Encyclopedia – Fever (Penn Medicine; mismo texto que MedlinePlus 003090)](https://www3.pennmedicine.org/for-patients-and-visitors/patient-information/conditions-treated-a-to-z/fever)
- `cdc_fever` — [CDC – Definitions of Signs, Symptoms, and Conditions of Ill Travelers (fiebre)](https://www.cdc.gov/quarantine/maritime/definitions-signs-symptoms-conditions-ill-travelers.html)
- `ada_hypo` — [American Diabetes Association – Hypoglycemia (versión profesional, 2025)](https://professional.diabetes.org/sites/dpro/files/2025-05/hypoglycemia-hcp-5-27-25.pdf)
- `ada_dx` — [American Diabetes Association – Diagnosis](https://diabetes.org/about-diabetes/diagnosis)
- `aafp_dm` — [AAFP – Diabetes Mellitus: Diagnosis and Screening (glucosa aleatoria 140–180)](https://www.aafp.org/pubs/afp/issues/2010/0401/p863.html)
- `ochmo_sleep` — [NASA OCHMO-TB-041 – Sleep Accommodations (NASA-STD-3001)](https://www.nasa.gov/wp-content/uploads/2023/03/sleep-accomodations-technical-brief-ochmo.pdf)
- `aasm_press` — [AASM – Seven or more hours of sleep per night: a health necessity for adults](https://aasm.org/seven-or-more-hours-of-sleep-per-night-a-health-necessity-for-adults/)
- `aasm_sleep` — [AASM/SRS – Recommended Amount of Sleep for a Healthy Adult (consenso)](https://pmc.ncbi.nlm.nih.gov/articles/PMC4434546/)
- `orau_ars` — [ORAU/REACTS – Triage handout: pródromo de ARS y tiempo hasta el vómito](https://www.orau.gov/hsc/RadMassCasualties/assets/4_Triage_Handout.pdf)
- `ntrs_ars_spe` — [NASA HRP – Space Radiation Protection Strategies (ARS por eventos solares)](https://ntrs.nasa.gov/api/citations/20170001372/downloads/20170001372.pdf)
- `ochmo_rad` — [NASA OCHMO-TB-020 – Design for Ionizing Radiation Protection (NASA-STD-3001)](https://www.nasa.gov/wp-content/uploads/2023/03/radiation-protection-technical-brief-ochmo.pdf)
- `ntrs_ascend_rad` — [NASA NTRS – Simonsen et al., ASCEND (dosis ISS 0.2–0.5 mSv/día)](https://ntrs.nasa.gov/api/citations/20250006168/downloads/ASCEND%20Simonsen%20draft%201.pdf)
- `ntrs_co2_smac` — [NASA NTRS – Scully et al., Effects of Acute Exposures to CO2 upon Cognitive Functions (SMAC histórico 24 h = 10 mmHg)](https://ntrs.nasa.gov/api/citations/20150021777/downloads/20150021777.pdf)
- `jsc20584b` — [NASA JSC 20584 Rev B – SMACs (2022): se eliminan los SMAC de CO2](https://ntrs.nasa.gov/citations/20230001817)
- `ochmo_co2` — [NASA OCHMO-TB-004 – Carbon Dioxide (NASA-STD-3001 Vol. 2 Rev D [V2 6004])](https://www.nasa.gov/ochmo-tb-004-carbon-dioxide-2/)
- `nasa_bhp_measures` — [NASA NTRS – BHP Laboratory Standard Measures](https://ntrs.nasa.gov/api/citations/20170005421/downloads/20170005421.pdf)
- `phq2_nida` — [NIDA CDE – Patient Health Questionnaire-2 (PHQ-2)](https://cde.nida.nih.gov/node/22)
- `nasa_bhp_ops` — [NASA NTRS – BHP Operations at JSC (conferencias psicológicas privadas)](https://ntrs.nasa.gov/api/citations/20170003866/downloads/20170003866.pdf)
- `gad2_kroenke` — [Kroenke et al. 2007, Ann Intern Med – Anxiety disorders in primary care (validación GAD-2)](https://pubmed.ncbi.nlm.nih.gov/17339617/)
- `pvt_fd` — [Basner & Rubinstein 2011, JOEM – Fitness for duty: 3-min PVT (11 y 20 lapsos, umbral 355 ms)](https://pmc.ncbi.nlm.nih.gov/articles/PMC3190077)
- `pvtb_basner` — [Basner, Mollicone, Dinges 2011, Acta Astronautica – Validity and Sensitivity of a Brief PVT (PVT-B)](https://pmc.ncbi.nlm.nih.gov/articles/PMC3197786)
- `psytoolkit_pvtb` — [PsyToolkit – PVT-B (falsos inicios < 100 ms, según Basner 2011)](https://www.psytoolkit.org/library/pvtb.html)
- `sn_smith` — [Science News – The Zero Gravity Diet (declaraciones de S. M. Smith, NASA JSC)](https://www.sciencenews.org/?p=40630)
- `aafp_weight` — [AAFP – Unintentional Weight Loss in Older Adults (>5 % en 6–12 meses)](https://www.aafp.org/pubs/afp/issues/2014/0501/p718.html)
- `ntrs_body_mass` — [NASA NTRS – Smith, Heer, Zwart: Nutrition SMO (pérdida de 2–5 % de masa el primer mes)](https://ntrs.nasa.gov/citations/20140013313)
- `ochmo_exercise` — [NASA OCHMO-TB-031 – Exercise Overview](https://www.nasa.gov/wp-content/uploads/2023/12/ochmo-tb-031-exercise-overview.pdf)
- `ntrs_sans_2023` — [NASA NTRS – SANS: 2023 Clinical Update](https://ntrs.nasa.gov/citations/20220014606)
- `ntrs_sans_intro` — [NASA NTRS – Brunstetter, Introduction to SANS and its Risk to NASA Astronauts](https://ntrs.nasa.gov/api/citations/20170009173/downloads/20170009173.pdf)
- `aha_warning` — [AHA – Heart Attack, Stroke and Cardiac Arrest Symptoms](https://www.heart.org/en/about-us/heart-attack-and-stroke-symptoms)
- `nasa_hrp_risks` — [NASA HRP – Risks of Human Spaceflight](https://www.nasa.gov/hrp/risks/)
- `nasa_hrp_hazards` — [NASA HRP – 5 Hazards of Human Spaceflight](https://www.nasa.gov/hrp/hazards/)
- `ochmo_eclss` — [NASA OCHMO-TB-002 – ECLSS: Human-Centered Approach ([V2 6012], [V2 6013])](https://www.nasa.gov/wp-content/uploads/2023/07/eclss-technical-brief-ochmo.pdf)
- `ochmo_acoustics` — [NASA OCHMO-TB-035 – Acoustics ([V2 6077], [V2 6078])](https://www.nasa.gov/sites/default/files/atoms/files/acoustics_technical_brief_ochmo_0.pdf)
- `ntrs_nc_dba` — [NASA NTRS – Goodman, acústica en naves (NC-50 ≈ 58.1 dBA; NC-40 ≈ 49.0 dBA)](https://ntrs.nasa.gov/api/citations/20090043801/downloads/20090043801.pdf)

## 8. Reglas como datos (JSON por indicador)

Mismo contenido que `backend/docs/catalogo-indicadores.json` (que además trae los catálogos de peligros, zonas y síntomas). Forma acordada + campos agregados: `basis`, `note`, `guide` (las 5 preguntas), `derived_fields`, `rules_version` y `notes`.

### `BLOOD_PRESSURE`

```json
{
  "code": "BLOOD_PRESSURE",
  "name": "Presión arterial",
  "unit": "mmHg",
  "value_type": "composite",
  "components": [
    {
      "name": "systolic",
      "type": "number",
      "role": "value",
      "required": true,
      "unit": "mmHg"
    },
    {
      "name": "diastolic",
      "type": "number",
      "role": "value",
      "required": true,
      "unit": "mmHg"
    },
    {
      "name": "symptoms",
      "type": "string[]",
      "role": "context",
      "required": false,
      "values": "códigos del catálogo de síntomas"
    }
  ],
  "derived_fields": [],
  "hazards": [
    "gravity_fields"
  ],
  "body_zone": "heart",
  "input_methods": [
    "manual",
    "camera"
  ],
  "sensitivity": "standard",
  "rules_version": 1,
  "guide": {
    "measurable": "Sí. Tensiómetro automático de brazo, tras 5 min de reposo, anclado o sentado y con el brazo a la altura del corazón. La foto de la pantalla del tensiómetro queda como respaldo.",
    "why": "La presión muy alta puede dañar corazón, cerebro y riñones; la muy baja puede causar mareo o desmayo.",
    "hazard_effect": "Gravity Fields: la ingravidez altera la circulación y el funcionamiento del corazón y los vasos (riesgo de adaptaciones cardiovasculares de NASA HRP). Al pasar a 0.16 g, 0.38 g o 1 g puede aparecer mareo al incorporarse.",
    "when_to_escalate": "Tripulación + flight surgeon: más de 180/120, o sistólica de 90 o menos con mareo, desmayo o confusión. Flight surgeon de rutina: 140/90 o más.",
    "prevention": "Medir con buena técnica y repetir antes de concluir, cumplir el ejercicio prescrito, hidratarse y dormir lo suficiente."
  },
  "rules": [
    {
      "level": "critical",
      "when": {
        "all": [
          {
            "any": [
              {
                "field": "systolic",
                "op": "gt",
                "value": 180
              },
              {
                "field": "diastolic",
                "op": "gt",
                "value": 120
              }
            ]
          },
          {
            "field": "symptoms",
            "op": "has_any",
            "value": [
              "chest_pain",
              "shortness_of_breath",
              "back_pain",
              "arm_weakness",
              "face_drooping",
              "sudden_vision_change",
              "speech_difficulty"
            ]
          }
        ]
      },
      "recommendation": "Tu presión está muy alta y tienes síntomas de alarma. Avisa ya a tu tripulación y activa el modo emergencia.",
      "escalation": "flight_surgeon",
      "source_ids": [
        "aha_bp"
      ],
      "basis": "source"
    },
    {
      "level": "critical",
      "when": {
        "any": [
          {
            "field": "systolic",
            "op": "gt",
            "value": 180
          },
          {
            "field": "diastolic",
            "op": "gt",
            "value": 120
          }
        ]
      },
      "recommendation": "Tu presión está muy alta. Quédate en reposo 5 minutos y vuelve a medir. Si sigue igual, se avisa a tu tripulación y al flight surgeon.",
      "escalation": "flight_surgeon",
      "source_ids": [
        "aha_bp"
      ],
      "basis": "source"
    },
    {
      "level": "critical",
      "when": {
        "all": [
          {
            "field": "systolic",
            "op": "lte",
            "value": 90
          },
          {
            "field": "symptoms",
            "op": "has_any",
            "value": [
              "dizziness",
              "fainting",
              "confusion"
            ]
          }
        ]
      },
      "recommendation": "Tu presión está baja y tienes mareo o confusión. Quédate quieto y sujeto, y avisa a tu tripulación.",
      "escalation": "flight_surgeon",
      "source_ids": [
        "aha_low_bp",
        "news2"
      ],
      "basis": "source_adapted",
      "note": "Sistólica ≤90 = puntaje 3 de NEWS2; AHA: la presión baja preocupa cuando hay síntomas."
    },
    {
      "level": "caution",
      "when": {
        "any": [
          {
            "field": "systolic",
            "op": "gte",
            "value": 140
          },
          {
            "field": "diastolic",
            "op": "gte",
            "value": 90
          }
        ]
      },
      "recommendation": "Tu presión está alta. Repite la medición mañana a la misma hora; si sigue así, el flight surgeon la revisará.",
      "escalation": "flight_surgeon",
      "source_ids": [
        "aha_bp",
        "ama_bp2025"
      ],
      "basis": "source"
    },
    {
      "level": "caution",
      "when": {
        "any": [
          {
            "field": "systolic",
            "op": "gte",
            "value": 130
          },
          {
            "field": "diastolic",
            "op": "gte",
            "value": 80
          }
        ]
      },
      "recommendation": "Tu presión está un poco alta. Repite la medición en reposo y cumple tu ejercicio y tu hidratación.",
      "escalation": "self_care",
      "source_ids": [
        "aha_bp",
        "ama_bp2025"
      ],
      "basis": "source"
    },
    {
      "level": "caution",
      "when": {
        "any": [
          {
            "field": "systolic",
            "op": "lt",
            "value": 90
          },
          {
            "field": "diastolic",
            "op": "lt",
            "value": 60
          }
        ]
      },
      "recommendation": "Tu presión está baja. Bebe agua y muévete despacio. Si te mareas, regístralo como síntoma.",
      "escalation": "self_care",
      "source_ids": [
        "aha_low_bp"
      ],
      "basis": "source"
    },
    {
      "level": "caution",
      "when": {
        "field": "systolic",
        "op": "gte",
        "value": 120
      },
      "recommendation": "Tu presión está ligeramente elevada. No es urgente: mantén tus hábitos y vuelve a medir en tu próxima rutina.",
      "escalation": "self_care",
      "source_ids": [
        "aha_bp"
      ],
      "basis": "source"
    },
    {
      "level": "normal",
      "when": {
        "all": []
      },
      "recommendation": "Tu presión está en rango normal.",
      "escalation": "self_care",
      "source_ids": [
        "aha_bp"
      ],
      "basis": "source"
    }
  ],
  "sources": [
    {
      "id": "aha_bp",
      "title": "AHA – Understanding Blood Pressure Readings",
      "url": "https://www.heart.org/en/health-topics/high-blood-pressure/understanding-blood-pressure-readings"
    },
    {
      "id": "aha_low_bp",
      "title": "AHA – Low Blood Pressure: When Blood Pressure Is Too Low",
      "url": "https://www.heart.org/en/health-topics/high-blood-pressure/the-facts-about-high-blood-pressure/low-blood-pressure-when-blood-pressure-is-too-low"
    },
    {
      "id": "news2",
      "title": "Royal College of Physicians – NEWS2, Chart 1: The NEWS scoring system (reproducido por NHS NWAS)",
      "url": "https://www.nwas.nhs.uk/publications/news2-national-early-warning-score"
    },
    {
      "id": "ama_bp2025",
      "title": "AMA – New BP guideline: 5 things physicians should know (2025 AHA/ACC conserva las categorías de 2017)",
      "url": "https://www.ama-assn.org/delivering-care/hypertension/new-bp-guideline-5-things-physicians-should-know"
    }
  ]
}
```

### `HEART_RATE`

```json
{
  "code": "HEART_RATE",
  "name": "Frecuencia cardíaca en reposo",
  "unit": "lpm",
  "value_type": "simple",
  "components": [
    {
      "name": "value",
      "type": "number",
      "role": "value",
      "required": true,
      "unit": "lpm"
    },
    {
      "name": "at_rest",
      "type": "boolean",
      "role": "context",
      "required": false
    },
    {
      "name": "symptoms",
      "type": "string[]",
      "role": "context",
      "required": false,
      "values": "códigos del catálogo de síntomas"
    }
  ],
  "derived_fields": [],
  "hazards": [
    "gravity_fields"
  ],
  "body_zone": "heart",
  "input_methods": [
    "manual",
    "wearable"
  ],
  "sensitivity": "standard",
  "rules_version": 1,
  "guide": {
    "measurable": "Sí. Pulsera o pulsioxímetro, o contando el pulso 30 s y multiplicando por 2. Se evalúa solo en reposo.",
    "why": "Un pulso en reposo muy rápido o muy lento puede indicar deshidratación, fiebre, problemas del ritmo o desacondicionamiento.",
    "hazard_effect": "Gravity Fields: la ingravidez cambia la circulación y el trabajo del corazón; los cambios de gravedad pueden causar mareo y pulso acelerado al incorporarse.",
    "when_to_escalate": "Tripulación + flight surgeon: 40 lpm o menos, o 131 lpm o más, en reposo. Tripulación: 111–130 lpm, o pulso lento con mareo.",
    "prevention": "Hidratación, sueño, ejercicio prescrito y medir siempre en las mismas condiciones."
  },
  "rules": [
    {
      "level": "unrated",
      "when": {
        "field": "at_rest",
        "op": "eq",
        "value": false
      },
      "recommendation": "Esta medición se hizo en actividad; los rangos de reposo no aplican.",
      "escalation": "self_care",
      "source_ids": [
        "aha_hr"
      ],
      "basis": "source_adapted",
      "note": "La AHA define el rango normal para personas sentadas o acostadas, en calma."
    },
    {
      "level": "critical",
      "when": {
        "any": [
          {
            "field": "value",
            "op": "lte",
            "value": 40
          },
          {
            "field": "value",
            "op": "gte",
            "value": 131
          }
        ]
      },
      "recommendation": "Tu pulso en reposo está fuera de un rango seguro. Quédate en reposo, vuelve a medir en 5 minutos y avisa a tu tripulación.",
      "escalation": "flight_surgeon",
      "source_ids": [
        "news2"
      ],
      "basis": "source_adapted",
      "note": "Puntaje 3 de NEWS2 (≤40 o ≥131)."
    },
    {
      "level": "caution",
      "when": {
        "all": [
          {
            "field": "value",
            "op": "lt",
            "value": 60
          },
          {
            "field": "symptoms",
            "op": "has_any",
            "value": [
              "dizziness",
              "fainting",
              "confusion"
            ]
          }
        ]
      },
      "recommendation": "Tu pulso está lento y tienes mareo. Quédate sujeto y avisa a tu tripulación.",
      "escalation": "crew",
      "source_ids": [
        "aha_hr"
      ],
      "basis": "source_adapted"
    },
    {
      "level": "caution",
      "when": {
        "field": "value",
        "op": "gte",
        "value": 111
      },
      "recommendation": "Tu pulso en reposo está alto. Descansa, bebe agua y vuelve a medir en 15 minutos.",
      "escalation": "crew",
      "source_ids": [
        "aha_hr",
        "news2"
      ],
      "basis": "source_adapted",
      "note": "NEWS2 puntaje 2 en 111–130."
    },
    {
      "level": "caution",
      "when": {
        "field": "value",
        "op": "gt",
        "value": 100
      },
      "recommendation": "Tu pulso en reposo está algo alto. Descansa, hidrátate y vuelve a medir más tarde.",
      "escalation": "self_care",
      "source_ids": [
        "aha_hr"
      ],
      "basis": "source"
    },
    {
      "level": "caution",
      "when": {
        "field": "value",
        "op": "lt",
        "value": 60
      },
      "recommendation": "Tu pulso está por debajo de 60. En personas muy entrenadas puede ser normal; si te sientes mareado, regístralo como síntoma.",
      "escalation": "self_care",
      "source_ids": [
        "aha_hr"
      ],
      "basis": "source"
    },
    {
      "level": "normal",
      "when": {
        "all": []
      },
      "recommendation": "Tu pulso en reposo está en rango normal.",
      "escalation": "self_care",
      "source_ids": [
        "aha_hr"
      ],
      "basis": "source"
    }
  ],
  "sources": [
    {
      "id": "aha_hr",
      "title": "AHA – All About Heart Rate",
      "url": "https://www.heart.org/en/health-topics/high-blood-pressure/the-facts-about-high-blood-pressure/all-about-heart-rate-pulse"
    },
    {
      "id": "news2",
      "title": "Royal College of Physicians – NEWS2, Chart 1: The NEWS scoring system (reproducido por NHS NWAS)",
      "url": "https://www.nwas.nhs.uk/publications/news2-national-early-warning-score"
    }
  ]
}
```

### `RESP_RATE`

```json
{
  "code": "RESP_RATE",
  "name": "Frecuencia respiratoria",
  "unit": "rpm",
  "value_type": "simple",
  "components": [
    {
      "name": "value",
      "type": "number",
      "role": "value",
      "required": true,
      "unit": "rpm"
    }
  ],
  "derived_fields": [],
  "hazards": [
    "hostile_closed_env"
  ],
  "body_zone": "lungs",
  "input_methods": [
    "wearable",
    "manual"
  ],
  "sensitivity": "standard",
  "rules_version": 1,
  "guide": {
    "measurable": "Sí. Contando respiraciones durante 60 s en reposo, o estimada por la pulsera.",
    "why": "Respirar muy rápido o muy lento es una de las primeras señales de que algo va mal (falta de oxígeno, CO₂ alto, infección).",
    "hazard_effect": "Hostile/Closed: un CO₂ alto en la cabina o una infección hacen respirar más rápido. El triaje usa este mismo dato (START: más de 30 rpm = atención inmediata).",
    "when_to_escalate": "Tripulación + flight surgeon: 8 rpm o menos, o 25 rpm o más. Tripulación: 21–24 rpm.",
    "prevention": "Vigilar el CO₂ del módulo, reportar tos o fiebre temprano y medir en reposo."
  },
  "rules": [
    {
      "level": "critical",
      "when": {
        "any": [
          {
            "field": "value",
            "op": "lte",
            "value": 8
          },
          {
            "field": "value",
            "op": "gte",
            "value": 25
          }
        ]
      },
      "recommendation": "Tu respiración está fuera de un rango seguro. Avisa ya a tu tripulación y revisa el CO₂ del módulo.",
      "escalation": "flight_surgeon",
      "source_ids": [
        "news2",
        "chemm_start"
      ],
      "basis": "source_adapted",
      "note": "Puntaje 3 de NEWS2; START: >30 rpm = inmediato."
    },
    {
      "level": "caution",
      "when": {
        "field": "value",
        "op": "gte",
        "value": 21
      },
      "recommendation": "Respiras más rápido de lo normal. Descansa 5 minutos y vuelve a medir; revisa el CO₂ del módulo.",
      "escalation": "crew",
      "source_ids": [
        "statpearls_rr",
        "news2"
      ],
      "basis": "source_adapted"
    },
    {
      "level": "caution",
      "when": {
        "field": "value",
        "op": "lte",
        "value": 11
      },
      "recommendation": "Respiras más lento de lo normal. Vuelve a medir en reposo, contando 60 segundos.",
      "escalation": "self_care",
      "source_ids": [
        "statpearls_rr",
        "news2"
      ],
      "basis": "source_adapted"
    },
    {
      "level": "normal",
      "when": {
        "all": []
      },
      "recommendation": "Tu respiración está en rango normal (12–20 rpm).",
      "escalation": "self_care",
      "source_ids": [
        "statpearls_rr"
      ],
      "basis": "source"
    }
  ],
  "sources": [
    {
      "id": "news2",
      "title": "Royal College of Physicians – NEWS2, Chart 1: The NEWS scoring system (reproducido por NHS NWAS)",
      "url": "https://www.nwas.nhs.uk/publications/news2-national-early-warning-score"
    },
    {
      "id": "chemm_start",
      "title": "HHS CHEMM – START Adult Triage Algorithm",
      "url": "https://chemm.hhs.gov/startalgotext.htm"
    },
    {
      "id": "statpearls_rr",
      "title": "StatPearls (NCBI Bookshelf) – frecuencia respiratoria normal del adulto en reposo",
      "url": "https://www.ncbi.nlm.nih.gov/books/NBK537306/"
    }
  ]
}
```

### `SPO2`

```json
{
  "code": "SPO2",
  "name": "Saturación de oxígeno",
  "unit": "%",
  "value_type": "simple",
  "components": [
    {
      "name": "value",
      "type": "number",
      "role": "value",
      "required": true,
      "unit": "%"
    }
  ],
  "derived_fields": [],
  "hazards": [
    "hostile_closed_env"
  ],
  "body_zone": "lungs",
  "input_methods": [
    "manual",
    "wearable"
  ],
  "sensitivity": "standard",
  "rules_version": 1,
  "guide": {
    "measurable": "Sí. Pulsioxímetro de dedo o pulsera; dedo tibio y quieto durante la lectura.",
    "why": "Indica cuánto oxígeno lleva la sangre. Un valor bajo puede significar que el cuerpo no recibe suficiente oxígeno.",
    "hazard_effect": "Hostile/Closed: depende de la atmósfera de la cabina (presión, O₂) y de la salud pulmonar; NASA HRP estudia el riesgo de hipoxia en atmósferas de exploración.",
    "when_to_escalate": "Tripulación + flight surgeon: 91 % o menos. Tripulación: 92–93 %.",
    "prevention": "Revisar la atmósfera del módulo, repetir con buena técnica y reportar falta de aire de inmediato."
  },
  "rules": [
    {
      "level": "critical",
      "when": {
        "field": "value",
        "op": "lte",
        "value": 91
      },
      "recommendation": "Tu oxígeno en sangre está bajo. Avisa ya a tu tripulación; revisen la atmósfera del módulo y el protocolo de oxígeno.",
      "escalation": "flight_surgeon",
      "source_ids": [
        "who_pulseox",
        "news2"
      ],
      "basis": "source_adapted",
      "note": "OMS: SpO₂ < 90 % es una emergencia clínica; NEWS2: ≤91 % = puntaje 3."
    },
    {
      "level": "caution",
      "when": {
        "field": "value",
        "op": "lte",
        "value": 93
      },
      "recommendation": "Tu oxígeno está por debajo de lo normal. Vuelve a medir con el dedo tibio; si se repite, avisa a tu tripulación.",
      "escalation": "crew",
      "source_ids": [
        "who_pulseox",
        "news2"
      ],
      "basis": "source_adapted"
    },
    {
      "level": "caution",
      "when": {
        "field": "value",
        "op": "lte",
        "value": 94
      },
      "recommendation": "Tu oxígeno está ligeramente bajo. Repite la medición con el dedo tibio y quieto.",
      "escalation": "self_care",
      "source_ids": [
        "who_pulseox"
      ],
      "basis": "source"
    },
    {
      "level": "normal",
      "when": {
        "all": []
      },
      "recommendation": "Tu oxígeno está en rango normal (95 % o más).",
      "escalation": "self_care",
      "source_ids": [
        "who_pulseox"
      ],
      "basis": "source"
    }
  ],
  "sources": [
    {
      "id": "who_pulseox",
      "title": "WHO Pulse Oximetry Training Manual (texto literal reproducido por PhenX Toolkit)",
      "url": "https://dev.phenxtoolkit.org/protocols/view/91102"
    },
    {
      "id": "news2",
      "title": "Royal College of Physicians – NEWS2, Chart 1: The NEWS scoring system (reproducido por NHS NWAS)",
      "url": "https://www.nwas.nhs.uk/publications/news2-national-early-warning-score"
    }
  ],
  "notes": [
    "Los cortes valen para atmósfera a nivel del mar. En atmósferas de exploración con menor presión parcial de O₂, el admin debe poder ajustar los cortes por entorno (pendiente de fuente)."
  ]
}
```

### `BODY_TEMP`

```json
{
  "code": "BODY_TEMP",
  "name": "Temperatura corporal",
  "unit": "°C",
  "value_type": "simple",
  "components": [
    {
      "name": "value",
      "type": "number",
      "role": "value",
      "required": true,
      "unit": "°C"
    }
  ],
  "derived_fields": [],
  "hazards": [
    "hostile_closed_env"
  ],
  "body_zone": "immune",
  "input_methods": [
    "manual"
  ],
  "sensitivity": "standard",
  "rules_version": 1,
  "guide": {
    "measurable": "Sí. Termómetro digital oral o de oído; siempre con el mismo método.",
    "why": "La fiebre es una señal temprana de infección; la temperatura muy baja también es peligrosa.",
    "hazard_effect": "Hostile/Closed: en un espacio cerrado una infección pasa fácil a toda la tripulación; NASA HRP describe cambios del sistema inmune y del microbioma que aumentan el riesgo de enfermar.",
    "when_to_escalate": "Flight surgeon: 35.0 °C o menos, o 39.4 °C o más. Tripulación: fiebre de 38.0 °C o más (riesgo de contagio).",
    "prevention": "Higiene de manos y superficies, reportar síntomas temprano, hidratación y descanso."
  },
  "rules": [
    {
      "level": "critical",
      "when": {
        "field": "value",
        "op": "lte",
        "value": 35.0
      },
      "recommendation": "Tu temperatura está demasiado baja. Abrígate, avisa a tu tripulación y vuelve a medir.",
      "escalation": "flight_surgeon",
      "source_ids": [
        "mayo_hypothermia",
        "news2"
      ],
      "basis": "source_adapted",
      "note": "Hipotermia: < 35 °C (Mayo Clinic, citando a CDC); NEWS2: ≤35.0 = puntaje 3."
    },
    {
      "level": "critical",
      "when": {
        "field": "value",
        "op": "gte",
        "value": 39.4
      },
      "recommendation": "Tienes fiebre alta. Avisa a tu tripulación, bebe líquidos y se consultará al flight surgeon.",
      "escalation": "flight_surgeon",
      "source_ids": [
        "adam_fever"
      ],
      "basis": "source_adapted",
      "note": "A.D.A.M.: un adulto debe contactar a su médico si la fiebre se mantiene en 39.4 °C (103 °F) o más."
    },
    {
      "level": "caution",
      "when": {
        "field": "value",
        "op": "gte",
        "value": 38.0
      },
      "recommendation": "Tienes fiebre. Descansa, bebe líquidos, usa medidas de higiene para no contagiar y vuelve a medir en 4 horas.",
      "escalation": "crew",
      "source_ids": [
        "cdc_fever"
      ],
      "basis": "source_adapted",
      "note": "Escalamiento a tripulación por contagio en espacio cerrado; reevaluar en 4 h es regla de diseño."
    },
    {
      "level": "caution",
      "when": {
        "field": "value",
        "op": "lte",
        "value": 36.0
      },
      "recommendation": "Tu temperatura está algo baja. Abrígate y vuelve a medir en 30 minutos.",
      "escalation": "self_care",
      "source_ids": [
        "news2"
      ],
      "basis": "source_adapted",
      "note": "NEWS2: 35.1–36.0 = puntaje 1."
    },
    {
      "level": "normal",
      "when": {
        "all": []
      },
      "recommendation": "Tu temperatura está en rango normal.",
      "escalation": "self_care",
      "source_ids": [
        "cdc_fever",
        "news2"
      ],
      "basis": "source"
    }
  ],
  "sources": [
    {
      "id": "mayo_hypothermia",
      "title": "Mayo Clinic – Hypothermia: First aid",
      "url": "https://www.mayoclinic.org/first-aid/first-aid-hypothermia/basics/ART-20056624"
    },
    {
      "id": "news2",
      "title": "Royal College of Physicians – NEWS2, Chart 1: The NEWS scoring system (reproducido por NHS NWAS)",
      "url": "https://www.nwas.nhs.uk/publications/news2-national-early-warning-score"
    },
    {
      "id": "adam_fever",
      "title": "A.D.A.M. Medical Encyclopedia – Fever (Penn Medicine; mismo texto que MedlinePlus 003090)",
      "url": "https://www3.pennmedicine.org/for-patients-and-visitors/patient-information/conditions-treated-a-to-z/fever"
    },
    {
      "id": "cdc_fever",
      "title": "CDC – Definitions of Signs, Symptoms, and Conditions of Ill Travelers (fiebre)",
      "url": "https://www.cdc.gov/quarantine/maritime/definitions-signs-symptoms-conditions-ill-travelers.html"
    }
  ]
}
```

### `GLUCOSE`

```json
{
  "code": "GLUCOSE",
  "name": "Glucosa en sangre",
  "unit": "mg/dL",
  "value_type": "simple",
  "components": [
    {
      "name": "value",
      "type": "number",
      "role": "value",
      "required": true,
      "unit": "mg/dL"
    },
    {
      "name": "fasting",
      "type": "boolean",
      "role": "context",
      "required": true
    },
    {
      "name": "symptoms",
      "type": "string[]",
      "role": "context",
      "required": false,
      "values": "códigos del catálogo de síntomas"
    }
  ],
  "derived_fields": [],
  "hazards": [
    "distance_from_earth",
    "gravity_fields"
  ],
  "body_zone": "metabolism",
  "input_methods": [
    "manual",
    "camera"
  ],
  "sensitivity": "standard",
  "rules_version": 1,
  "guide": {
    "measurable": "Sí. Glucómetro con gota de sangre del dedo; la foto de la pantalla queda como respaldo. Indicar si estás en ayunas (8 h sin comer).",
    "why": "La glucosa es la energía del cuerpo. Muy baja puede causar confusión o desmayo; alta de forma repetida debe revisarla un médico.",
    "hazard_effect": "Distance from Earth: los alimentos son limitados y la ingesta suele ser menor (riesgo de nutrición inadecuada de NASA HRP); Gravity Fields: menos actividad y cambios metabólicos en ingravidez.",
    "when_to_escalate": "Tripulación + flight surgeon: menos de 54 mg/dL, menos de 70 con confusión o desmayo, o 200 o más con síntomas. Flight surgeon de rutina: 126 o más en ayunas, o 200 o más sin síntomas.",
    "prevention": "Comer las raciones completas, no saltarse comidas antes de una EVA o del ejercicio, y medir en ayunas cuando la rutina lo pida."
  },
  "rules": [
    {
      "level": "critical",
      "when": {
        "all": [
          {
            "field": "value",
            "op": "lt",
            "value": 70
          },
          {
            "field": "symptoms",
            "op": "has_any",
            "value": [
              "confusion",
              "fainting",
              "unresponsive"
            ]
          }
        ]
      },
      "recommendation": "Glucosa baja con confusión. La tripulación debe ayudarte a tomar azúcar de absorción rápida ahora.",
      "escalation": "flight_surgeon",
      "source_ids": [
        "ada_hypo"
      ],
      "basis": "source",
      "note": "ADA nivel 3: alteración mental o física que requiere ayuda."
    },
    {
      "level": "critical",
      "when": {
        "field": "value",
        "op": "lt",
        "value": 54
      },
      "recommendation": "Tu glucosa está muy baja. Toma ya 15 g de azúcar de absorción rápida, vuelve a medir en 15 minutos y avisa a tu tripulación.",
      "escalation": "flight_surgeon",
      "source_ids": [
        "ada_hypo"
      ],
      "basis": "source",
      "note": "ADA nivel 2: < 54 mg/dL. Regla 15-15."
    },
    {
      "level": "critical",
      "when": {
        "all": [
          {
            "field": "value",
            "op": "gte",
            "value": 200
          },
          {
            "field": "symptoms",
            "op": "has_any",
            "value": [
              "excessive_thirst",
              "frequent_urination",
              "blurred_vision",
              "nausea",
              "vomiting",
              "confusion"
            ]
          }
        ]
      },
      "recommendation": "Tu glucosa está muy alta y tienes síntomas. Avisa a tu tripulación; se consultará al flight surgeon.",
      "escalation": "flight_surgeon",
      "source_ids": [
        "ada_dx"
      ],
      "basis": "source_adapted",
      "note": "ADA: glucosa aleatoria ≥200 con síntomas cumple un criterio diagnóstico. Clasificarla como crítica es decisión de diseño."
    },
    {
      "level": "caution",
      "when": {
        "field": "value",
        "op": "lt",
        "value": 70
      },
      "recommendation": "Tu glucosa está baja. Toma 15 g de azúcar de absorción rápida y vuelve a medir en 15 minutos.",
      "escalation": "self_care",
      "source_ids": [
        "ada_hypo"
      ],
      "basis": "source",
      "note": "ADA nivel 1: 54–69 mg/dL."
    },
    {
      "level": "caution",
      "when": {
        "field": "value",
        "op": "gte",
        "value": 200
      },
      "recommendation": "Tu glucosa está alta. Vuelve a medir mañana en ayunas; el flight surgeon revisará el resultado.",
      "escalation": "flight_surgeon",
      "source_ids": [
        "ada_dx"
      ],
      "basis": "source_adapted"
    },
    {
      "level": "caution",
      "when": {
        "all": [
          {
            "field": "fasting",
            "op": "eq",
            "value": true
          },
          {
            "field": "value",
            "op": "gte",
            "value": 126
          }
        ]
      },
      "recommendation": "Tu glucosa en ayunas está alta. Hace falta confirmarla otro día; el flight surgeon la revisará.",
      "escalation": "flight_surgeon",
      "source_ids": [
        "ada_dx"
      ],
      "basis": "source",
      "note": "ADA: ≥126 en ayunas requiere confirmación."
    },
    {
      "level": "caution",
      "when": {
        "all": [
          {
            "field": "fasting",
            "op": "eq",
            "value": true
          },
          {
            "field": "value",
            "op": "gte",
            "value": 100
          }
        ]
      },
      "recommendation": "Tu glucosa en ayunas está algo alta. Repite la medición en ayunas otro día.",
      "escalation": "self_care",
      "source_ids": [
        "ada_dx"
      ],
      "basis": "source",
      "note": "ADA: 100–125 en ayunas."
    },
    {
      "level": "caution",
      "when": {
        "all": [
          {
            "field": "fasting",
            "op": "eq",
            "value": false
          },
          {
            "field": "value",
            "op": "gte",
            "value": 140
          }
        ]
      },
      "recommendation": "Tu glucosa después de comer está algo alta. Mide mañana en ayunas para comparar.",
      "escalation": "self_care",
      "source_ids": [
        "aafp_dm",
        "ada_dx"
      ],
      "basis": "source_adapted",
      "note": "AAFP: valores aleatorios de 140–180 ameritan una prueba más definitiva; ADA: 2 h post-carga normal < 140."
    },
    {
      "level": "normal",
      "when": {
        "all": []
      },
      "recommendation": "Tu glucosa está en rango normal.",
      "escalation": "self_care",
      "source_ids": [
        "ada_dx"
      ],
      "basis": "source"
    }
  ],
  "sources": [
    {
      "id": "ada_hypo",
      "title": "American Diabetes Association – Hypoglycemia (versión profesional, 2025)",
      "url": "https://professional.diabetes.org/sites/dpro/files/2025-05/hypoglycemia-hcp-5-27-25.pdf"
    },
    {
      "id": "ada_dx",
      "title": "American Diabetes Association – Diagnosis",
      "url": "https://diabetes.org/about-diabetes/diagnosis"
    },
    {
      "id": "aafp_dm",
      "title": "AAFP – Diabetes Mellitus: Diagnosis and Screening (glucosa aleatoria 140–180)",
      "url": "https://www.aafp.org/pubs/afp/issues/2010/0401/p863.html"
    }
  ]
}
```

### `SLEEP_HOURS`

```json
{
  "code": "SLEEP_HOURS",
  "name": "Horas de sueño",
  "unit": "h",
  "value_type": "simple",
  "components": [
    {
      "name": "value",
      "type": "number",
      "role": "value",
      "required": true,
      "unit": "h"
    }
  ],
  "derived_fields": [
    {
      "name": "consecutive_nights_le_6h",
      "type": "integer",
      "how": "noches seguidas (incluida la actual) con ≤ 6 h"
    }
  ],
  "hazards": [
    "isolation_confinement"
  ],
  "body_zone": "brain",
  "input_methods": [
    "wearable",
    "manual"
  ],
  "sensitivity": "standard",
  "rules_version": 1,
  "guide": {
    "measurable": "Sí. Actigrafía con la pulsera (NASA la usa en vuelo) o registro manual.",
    "why": "Dormir poco reduce la atención y aumenta los errores; en una misión, un error puede ser grave.",
    "hazard_effect": "Isolation and Confinement: ruido, luz, horarios cambiantes y confinamiento reducen el sueño; en vuelo los astronautas duermen en promedio 6–6.5 h (NASA OCHMO).",
    "when_to_escalate": "Flight surgeon: 7 noches seguidas con 6 h o menos. Tripulación (para ajustar horarios): 3 noches seguidas con 6 h o menos.",
    "prevention": "Respetar el periodo de sueño, oscuridad y tapones contra el ruido, y hacer la prueba de reacción antes de una tarea crítica si dormiste poco."
  },
  "rules": [
    {
      "level": "critical",
      "when": {
        "field": "consecutive_nights_le_6h",
        "op": "gte",
        "value": 7
      },
      "recommendation": "Llevas una semana durmiendo 6 horas o menos. Tu atención puede estar tan afectada como si no hubieras dormido un día entero. Se avisa al flight surgeon y se recomienda la prueba de reacción antes de tareas críticas.",
      "escalation": "flight_surgeon",
      "source_ids": [
        "ochmo_sleep",
        "aasm_press"
      ],
      "basis": "source_adapted",
      "note": "NASA OCHMO-TB-041: tras 7 días de 6 h de sueño, el desempeño equivale a 24–36 h sin dormir."
    },
    {
      "level": "caution",
      "when": {
        "field": "consecutive_nights_le_6h",
        "op": "gte",
        "value": 3
      },
      "recommendation": "Llevas varias noches durmiendo poco. Habla con tu tripulación para proteger tu próximo periodo de sueño.",
      "escalation": "crew",
      "source_ids": [
        "aasm_press"
      ],
      "basis": "design_rule",
      "note": "El umbral de 3 noches es regla de diseño (pendiente de validar con el flight surgeon)."
    },
    {
      "level": "caution",
      "when": {
        "field": "value",
        "op": "lte",
        "value": 6
      },
      "recommendation": "Dormiste 6 horas o menos. Si hoy tienes una tarea crítica, haz antes la prueba de reacción.",
      "escalation": "self_care",
      "source_ids": [
        "aasm_press"
      ],
      "basis": "source",
      "note": "AASM: 6 h o menos es insuficiente para sostener salud y seguridad."
    },
    {
      "level": "caution",
      "when": {
        "field": "value",
        "op": "lt",
        "value": 7
      },
      "recommendation": "Dormiste menos de 7 horas. Intenta proteger tu próximo periodo de sueño.",
      "escalation": "self_care",
      "source_ids": [
        "aasm_sleep"
      ],
      "basis": "source"
    },
    {
      "level": "normal",
      "when": {
        "all": []
      },
      "recommendation": "Dormiste 7 horas o más.",
      "escalation": "self_care",
      "source_ids": [
        "aasm_sleep"
      ],
      "basis": "source"
    }
  ],
  "sources": [
    {
      "id": "ochmo_sleep",
      "title": "NASA OCHMO-TB-041 – Sleep Accommodations (NASA-STD-3001)",
      "url": "https://www.nasa.gov/wp-content/uploads/2023/03/sleep-accomodations-technical-brief-ochmo.pdf"
    },
    {
      "id": "aasm_press",
      "title": "AASM – Seven or more hours of sleep per night: a health necessity for adults",
      "url": "https://aasm.org/seven-or-more-hours-of-sleep-per-night-a-health-necessity-for-adults/"
    },
    {
      "id": "aasm_sleep",
      "title": "AASM/SRS – Recommended Amount of Sleep for a Healthy Adult (consenso)",
      "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC4434546/"
    }
  ]
}
```

### `RAD_DOSE_DAILY`

```json
{
  "code": "RAD_DOSE_DAILY",
  "name": "Dosis de radiación diaria",
  "unit": "mSv/día",
  "value_type": "simple",
  "components": [
    {
      "name": "value",
      "type": "number",
      "role": "value",
      "required": true,
      "unit": "mSv"
    },
    {
      "name": "event_active",
      "type": "boolean",
      "role": "context",
      "required": false
    },
    {
      "name": "symptoms",
      "type": "string[]",
      "role": "context",
      "required": false,
      "values": "códigos del catálogo de síntomas"
    }
  ],
  "derived_fields": [
    {
      "name": "ratio_to_baseline",
      "type": "number",
      "how": "valor / mediana de los últimos 7 días del mismo tripulante (sin días de evento)"
    },
    {
      "name": "event_dose_msv",
      "type": "number",
      "how": "suma de dosis desde que se activó la alerta de evento solar (null si no hay evento)"
    }
  ],
  "hazards": [
    "space_radiation"
  ],
  "body_zone": "immune",
  "input_methods": [
    "sensor"
  ],
  "sensitivity": "standard",
  "rules_version": 1,
  "guide": {
    "measurable": "Sí. Dosímetros personales y de área; la CSA desarrolla un espectrómetro de neutrones autónomo (CANS) porque los neutrones aportan cerca del 30 % de la radiación en la ISS. En la demo, dosímetro simulado.",
    "why": "La radiación acumulada aumenta el riesgo de cáncer; una dosis alta en poco tiempo (evento solar) puede causar síntomas agudos.",
    "hazard_effect": "Space Radiation: fuera de la protección de la Tierra, los rayos cósmicos y los eventos solares aumentan la dosis. Como referencia, en la ISS se acumulan 0.2–0.5 mSv por día.",
    "when_to_escalate": "Flight surgeon: dosis del evento de 125 mSv o más, o náusea o vómito durante un evento. Crítico: 250 mSv en un evento (límite de NASA). Tripulación: dosis del día al doble de lo habitual.",
    "prevention": "Ir al refugio de tormenta en cuanto haya alerta solar, reducir el tiempo fuera del refugio y llevar siempre el dosímetro."
  },
  "rules": [
    {
      "level": "critical",
      "when": {
        "all": [
          {
            "field": "event_active",
            "op": "eq",
            "value": true
          },
          {
            "field": "symptoms",
            "op": "has_any",
            "value": [
              "nausea",
              "vomiting"
            ]
          }
        ]
      },
      "recommendation": "Tienes náusea o vómito durante un evento solar. Activa el modo emergencia: el triaje te guiará con el módulo de radiación.",
      "escalation": "flight_surgeon",
      "source_ids": [
        "orau_ars",
        "ntrs_ars_spe"
      ],
      "basis": "source_adapted",
      "note": "El vómito es parte del pródromo del síndrome agudo por radiación; en vuelo también puede deberse al mareo espacial, por eso pasa al triaje."
    },
    {
      "level": "critical",
      "when": {
        "field": "event_dose_msv",
        "op": "gte",
        "value": 250
      },
      "recommendation": "La dosis de este evento alcanzó el límite de NASA para eventos solares. Permanece en el refugio; se avisa al flight surgeon.",
      "escalation": "flight_surgeon",
      "source_ids": [
        "ochmo_rad"
      ],
      "basis": "source",
      "note": "NASA-STD-3001 Vol. 1 [V1 4031]: 250 mSv por evento solar."
    },
    {
      "level": "caution",
      "when": {
        "field": "event_dose_msv",
        "op": "gte",
        "value": 125
      },
      "recommendation": "La dosis del evento ya es la mitad del límite. Permanece en el refugio; se avisa al flight surgeon.",
      "escalation": "flight_surgeon",
      "source_ids": [
        "ochmo_rad"
      ],
      "basis": "design_rule",
      "note": "50 % del límite de 250 mSv: margen de diseño."
    },
    {
      "level": "caution",
      "when": {
        "field": "ratio_to_baseline",
        "op": "gte",
        "value": 2
      },
      "recommendation": "Tu dosis de hoy es al menos el doble de lo habitual. Revisa las alertas de clima espacial y sigue el protocolo del refugio.",
      "escalation": "crew",
      "source_ids": [
        "ntrs_ascend_rad"
      ],
      "basis": "design_rule",
      "note": "Factor 2 sobre la línea base: regla de diseño (pendiente de fuente)."
    },
    {
      "level": "normal",
      "when": {
        "all": []
      },
      "recommendation": "Tu dosis de hoy está dentro de lo habitual para esta misión.",
      "escalation": "self_care",
      "source_ids": [
        "ntrs_ascend_rad"
      ],
      "basis": "source"
    }
  ],
  "sources": [
    {
      "id": "orau_ars",
      "title": "ORAU/REACTS – Triage handout: pródromo de ARS y tiempo hasta el vómito",
      "url": "https://www.orau.gov/hsc/RadMassCasualties/assets/4_Triage_Handout.pdf"
    },
    {
      "id": "ntrs_ars_spe",
      "title": "NASA HRP – Space Radiation Protection Strategies (ARS por eventos solares)",
      "url": "https://ntrs.nasa.gov/api/citations/20170001372/downloads/20170001372.pdf"
    },
    {
      "id": "ochmo_rad",
      "title": "NASA OCHMO-TB-020 – Design for Ionizing Radiation Protection (NASA-STD-3001)",
      "url": "https://www.nasa.gov/wp-content/uploads/2023/03/radiation-protection-technical-brief-ochmo.pdf"
    },
    {
      "id": "ntrs_ascend_rad",
      "title": "NASA NTRS – Simonsen et al., ASCEND (dosis ISS 0.2–0.5 mSv/día)",
      "url": "https://ntrs.nasa.gov/api/citations/20250006168/downloads/ASCEND%20Simonsen%20draft%201.pdf"
    }
  ]
}
```

### `RAD_DOSE_CUM`

```json
{
  "code": "RAD_DOSE_CUM",
  "name": "Dosis de radiación acumulada (carrera)",
  "unit": "mSv",
  "value_type": "simple",
  "components": [
    {
      "name": "value",
      "type": "number",
      "role": "value",
      "required": true,
      "unit": "mSv"
    }
  ],
  "derived_fields": [
    {
      "name": "pct_of_career_limit",
      "type": "number",
      "how": "valor / 600 × 100"
    },
    {
      "name": "projected_end_msv",
      "type": "number",
      "how": "valor + mediana diaria × días restantes de misión"
    }
  ],
  "hazards": [
    "space_radiation"
  ],
  "body_zone": "immune",
  "input_methods": [
    "sensor"
  ],
  "sensitivity": "standard",
  "rules_version": 1,
  "guide": {
    "measurable": "Sí. Se calcula sumando las dosis diarias del dosímetro a la dosis de carrera previa.",
    "why": "Cuanta más dosis se acumula, mayor es el riesgo de cáncer a largo plazo.",
    "hazard_effect": "Space Radiation: NASA limita la dosis efectiva de carrera a 600 mSv para todas las edades y sexos (riesgo de cánceres inducidos por radiación).",
    "when_to_escalate": "Flight surgeon: proyección de 600 mSv o más al final de la misión, o 80 % del límite alcanzado. Crítico: 600 mSv alcanzados.",
    "prevention": "Planear las EVA y el tiempo fuera del refugio según la proyección, y aplicar el principio ALARA (tan bajo como sea razonablemente posible)."
  },
  "rules": [
    {
      "level": "critical",
      "when": {
        "field": "value",
        "op": "gte",
        "value": 600
      },
      "recommendation": "Alcanzaste el límite de dosis de carrera de NASA. El flight surgeon definirá los siguientes pasos.",
      "escalation": "flight_surgeon",
      "source_ids": [
        "ochmo_rad"
      ],
      "basis": "source",
      "note": "NASA-STD-3001 Vol. 1 [V1 4030]: < 600 mSv de carrera."
    },
    {
      "level": "caution",
      "when": {
        "field": "projected_end_msv",
        "op": "gte",
        "value": 600
      },
      "recommendation": "Con el ritmo actual superarías el límite de carrera antes de terminar la misión. El flight surgeon revisará el plan.",
      "escalation": "flight_surgeon",
      "source_ids": [
        "ochmo_rad"
      ],
      "basis": "source_adapted"
    },
    {
      "level": "caution",
      "when": {
        "field": "pct_of_career_limit",
        "op": "gte",
        "value": 80
      },
      "recommendation": "Ya usaste el 80 % de tu límite de dosis de carrera.",
      "escalation": "flight_surgeon",
      "source_ids": [
        "ochmo_rad"
      ],
      "basis": "design_rule",
      "note": "Corte del 80 %: regla de diseño."
    },
    {
      "level": "normal",
      "when": {
        "all": []
      },
      "recommendation": "Tu dosis acumulada está por debajo del 80 % del límite.",
      "escalation": "self_care",
      "source_ids": [
        "ochmo_rad"
      ],
      "basis": "source"
    }
  ],
  "sources": [
    {
      "id": "ochmo_rad",
      "title": "NASA OCHMO-TB-020 – Design for Ionizing Radiation Protection (NASA-STD-3001)",
      "url": "https://www.nasa.gov/wp-content/uploads/2023/03/radiation-protection-technical-brief-ochmo.pdf"
    }
  ]
}
```

### `HAB_CO2`

```json
{
  "code": "HAB_CO2",
  "name": "CO₂ del módulo (promedio de 1 h)",
  "unit": "mmHg",
  "value_type": "simple",
  "components": [
    {
      "name": "value",
      "type": "number",
      "role": "value",
      "required": true,
      "unit": "mmHg"
    },
    {
      "name": "module_id",
      "type": "string",
      "role": "context",
      "required": true
    }
  ],
  "derived_fields": [
    {
      "name": "avg_7d",
      "type": "number",
      "how": "promedio de 7 días del mismo módulo"
    }
  ],
  "hazards": [
    "hostile_closed_env"
  ],
  "body_zone": "environment",
  "input_methods": [
    "sensor"
  ],
  "sensitivity": "standard",
  "rules_version": 1,
  "guide": {
    "measurable": "Sí. Sensores de presión parcial de CO₂ del sistema de soporte vital. En la demo, sensor simulado.",
    "why": "El CO₂ alto causa dolor de cabeza, fatiga y menor rendimiento; los dolores de cabeza en vuelo se asocian con el CO₂.",
    "hazard_effect": "Hostile/Closed: la tripulación produce CO₂ y sin convección natural se acumula; en la ISS se han medido 1–9 mmHg.",
    "when_to_escalate": "Tripulación: más de 3 mmHg (promedio de 1 h) o 2.5 mmHg o más (promedio de 7 días). Flight surgeon: 10 mmHg o más.",
    "prevention": "Revisar el sistema de remoción de CO₂, mejorar la ventilación del módulo y planear el ejercicio en módulos bien ventilados."
  },
  "rules": [
    {
      "level": "critical",
      "when": {
        "field": "value",
        "op": "gte",
        "value": 10
      },
      "recommendation": "El CO₂ del módulo está muy alto. Sigan el protocolo de CO₂ alto y revisen ya el sistema de remoción.",
      "escalation": "flight_surgeon",
      "source_ids": [
        "ntrs_co2_smac",
        "jsc20584b"
      ],
      "basis": "source_adapted",
      "note": "10 mmHg era el SMAC de 24 h; JSC 20584 Rev B (2022) eliminó los SMAC de CO₂, por eso se usa como referencia histórica."
    },
    {
      "level": "caution",
      "when": {
        "field": "value",
        "op": "gt",
        "value": 4.5
      },
      "recommendation": "El CO₂ está alto: puede causar fatiga, malestar y náusea. Revisen la ventilación y el sistema de remoción.",
      "escalation": "crew",
      "source_ids": [
        "ochmo_co2"
      ],
      "basis": "source_adapted",
      "note": "Síntomas reportados en vuelo por encima de 4.5 mmHg (dato anecdótico de NASA)."
    },
    {
      "level": "caution",
      "when": {
        "field": "value",
        "op": "gt",
        "value": 3.0
      },
      "recommendation": "El CO₂ supera el límite de NASA para el promedio de 1 hora. Revisen la ventilación del módulo.",
      "escalation": "crew",
      "source_ids": [
        "ochmo_co2"
      ],
      "basis": "source",
      "note": "NASA-STD-3001 Vol. 2 Rev D [V2 6004]: ≤ 3 mmHg (promedio de 1 h)."
    },
    {
      "level": "caution",
      "when": {
        "field": "avg_7d",
        "op": "gte",
        "value": 2.5
      },
      "recommendation": "El CO₂ promedio de la semana está alto; aumenta el riesgo de dolor de cabeza.",
      "escalation": "crew",
      "source_ids": [
        "ochmo_co2"
      ],
      "basis": "source",
      "note": "NASA: mantener el promedio de 7 días < 2.5 mmHg para que el riesgo de dolor de cabeza sea < 1 %."
    },
    {
      "level": "normal",
      "when": {
        "all": []
      },
      "recommendation": "El CO₂ del módulo está dentro del límite de NASA.",
      "escalation": "self_care",
      "source_ids": [
        "ochmo_co2"
      ],
      "basis": "source"
    }
  ],
  "sources": [
    {
      "id": "ntrs_co2_smac",
      "title": "NASA NTRS – Scully et al., Effects of Acute Exposures to CO2 upon Cognitive Functions (SMAC histórico 24 h = 10 mmHg)",
      "url": "https://ntrs.nasa.gov/api/citations/20150021777/downloads/20150021777.pdf"
    },
    {
      "id": "jsc20584b",
      "title": "NASA JSC 20584 Rev B – SMACs (2022): se eliminan los SMAC de CO2",
      "url": "https://ntrs.nasa.gov/citations/20230001817"
    },
    {
      "id": "ochmo_co2",
      "title": "NASA OCHMO-TB-004 – Carbon Dioxide (NASA-STD-3001 Vol. 2 Rev D [V2 6004])",
      "url": "https://www.nasa.gov/ochmo-tb-004-carbon-dioxide-2/"
    }
  ],
  "notes": [
    "Indicador de entorno: se evalúa por módulo y genera la alerta para todos los tripulantes de ese módulo."
  ]
}
```

### `WB_MOOD`

```json
{
  "code": "WB_MOOD",
  "name": "Ánimo (check-in)",
  "unit": "0–100",
  "value_type": "scale",
  "components": [
    {
      "name": "value",
      "type": "number",
      "role": "value",
      "required": true,
      "unit": "0–100"
    }
  ],
  "derived_fields": [
    {
      "name": "baseline_ready",
      "type": "boolean",
      "how": "hay al menos 7 check-ins en la ventana de línea base (14 días, excluye los últimos 3)"
    },
    {
      "name": "adverse_z_3d",
      "type": "number",
      "how": "z del promedio de los últimos 3 check-ins contra la línea base personal, orientado para que positivo = peor (se invierte el signo: más bajo es peor)"
    },
    {
      "name": "adverse_sustained_days",
      "type": "integer",
      "how": "check-ins seguidos con adverse_z_3d ≥ 1.5"
    }
  ],
  "hazards": [
    "isolation_confinement"
  ],
  "body_zone": "brain",
  "input_methods": [
    "slider"
  ],
  "sensitivity": "confidential",
  "rules_version": 1,
  "direction": "high",
  "guide": {
    "measurable": "Sí. Deslizador sin números en el check-in diario (20 s). NASA BHP usa escalas analógicas visuales (VAS) como medida estándar.",
    "why": "El ánimo bajo sostenido afecta el sueño, la concentración y la convivencia.",
    "hazard_effect": "Isolation and Confinement: el aislamiento, la distancia de la Tierra y el estrés de la misión afectan la salud mental (riesgo de cambios conductuales y de trabajo en equipo de NASA HRP).",
    "when_to_escalate": "Salud conductual (confidencial): 5 check-ins seguidos claramente más bajo que tu rango habitual. Nunca se avisa a la tripulación.",
    "prevention": "Mantener rutinas, contacto con la familia, ejercicio y sueño; usar \"Quiero hablar con alguien\" en cualquier momento."
  },
  "rules": [
    {
      "level": "unrated",
      "when": {
        "field": "baseline_ready",
        "op": "eq",
        "value": false
      },
      "recommendation": "Estamos aprendiendo tu rango habitual. Sigue con tus check-ins.",
      "escalation": "self_care",
      "source_ids": [
        "nasa_bhp_measures"
      ],
      "basis": "design_rule",
      "note": "Línea base mínima de 7 check-ins: regla de diseño."
    },
    {
      "level": "caution",
      "when": {
        "field": "adverse_sustained_days",
        "op": "gte",
        "value": 5
      },
      "recommendation": "Llevas varios días distinto de lo habitual. Tu equipo de apoyo en Tierra lo sabrá de forma confidencial. Si quieres, usa \"Quiero hablar con alguien\".",
      "escalation": "behavioral_health",
      "source_ids": [
        "nasa_bhp_measures"
      ],
      "basis": "design_rule",
      "note": "z ≥ 1.5 sostenido 5 días: regla de diseño, pendiente de validación por salud conductual. NASA BHP no publica un corte clínico para las VAS."
    },
    {
      "level": "caution",
      "when": {
        "field": "adverse_sustained_days",
        "op": "gte",
        "value": 3
      },
      "recommendation": "Llevas unos días distinto de lo habitual. Puede ayudar dormir, moverte o hablar con alguien de confianza.",
      "escalation": "self_care",
      "source_ids": [
        "nasa_bhp_measures"
      ],
      "basis": "design_rule"
    },
    {
      "level": "normal",
      "when": {
        "all": []
      },
      "recommendation": "Gracias por tu check-in.",
      "escalation": "self_care",
      "source_ids": [
        "nasa_bhp_measures"
      ],
      "basis": "source"
    }
  ],
  "sources": [
    {
      "id": "nasa_bhp_measures",
      "title": "NASA NTRS – BHP Laboratory Standard Measures",
      "url": "https://ntrs.nasa.gov/api/citations/20170005421/downloads/20170005421.pdf"
    }
  ],
  "notes": [
    "El astronauta no ve un semáforo rojo en bienestar: la app muestra mensajes neutros. La racha premia completar el check-in, nunca el resultado."
  ]
}
```

### `WB_FATIGUE`

```json
{
  "code": "WB_FATIGUE",
  "name": "Fatiga (check-in)",
  "unit": "0–100",
  "value_type": "scale",
  "components": [
    {
      "name": "value",
      "type": "number",
      "role": "value",
      "required": true,
      "unit": "0–100"
    }
  ],
  "derived_fields": [
    {
      "name": "baseline_ready",
      "type": "boolean",
      "how": "hay al menos 7 check-ins en la ventana de línea base (14 días, excluye los últimos 3)"
    },
    {
      "name": "adverse_z_3d",
      "type": "number",
      "how": "z del promedio de los últimos 3 check-ins contra la línea base personal, orientado para que positivo = peor (más alto es peor)"
    },
    {
      "name": "adverse_sustained_days",
      "type": "integer",
      "how": "check-ins seguidos con adverse_z_3d ≥ 1.5"
    }
  ],
  "hazards": [
    "isolation_confinement"
  ],
  "body_zone": "brain",
  "input_methods": [
    "slider"
  ],
  "sensitivity": "confidential",
  "rules_version": 1,
  "direction": "low",
  "guide": {
    "measurable": "Sí. Deslizador sin números en el check-in diario (20 s). NASA BHP usa escalas analógicas visuales (VAS) como medida estándar.",
    "why": "La fatiga sostenida aumenta el riesgo de errores y puede reflejar mal sueño o carga excesiva.",
    "hazard_effect": "Isolation and Confinement: el aislamiento, la distancia de la Tierra y el estrés de la misión afectan la salud mental (riesgo de cambios conductuales y de trabajo en equipo de NASA HRP).",
    "when_to_escalate": "Salud conductual (confidencial): 5 check-ins seguidos claramente más alto que tu rango habitual. Nunca se avisa a la tripulación.",
    "prevention": "Mantener rutinas, contacto con la familia, ejercicio y sueño; usar \"Quiero hablar con alguien\" en cualquier momento."
  },
  "rules": [
    {
      "level": "unrated",
      "when": {
        "field": "baseline_ready",
        "op": "eq",
        "value": false
      },
      "recommendation": "Estamos aprendiendo tu rango habitual. Sigue con tus check-ins.",
      "escalation": "self_care",
      "source_ids": [
        "nasa_bhp_measures"
      ],
      "basis": "design_rule",
      "note": "Línea base mínima de 7 check-ins: regla de diseño."
    },
    {
      "level": "caution",
      "when": {
        "field": "adverse_sustained_days",
        "op": "gte",
        "value": 5
      },
      "recommendation": "Llevas varios días distinto de lo habitual. Tu equipo de apoyo en Tierra lo sabrá de forma confidencial. Si quieres, usa \"Quiero hablar con alguien\".",
      "escalation": "behavioral_health",
      "source_ids": [
        "nasa_bhp_measures"
      ],
      "basis": "design_rule",
      "note": "z ≥ 1.5 sostenido 5 días: regla de diseño, pendiente de validación por salud conductual. NASA BHP no publica un corte clínico para las VAS."
    },
    {
      "level": "caution",
      "when": {
        "field": "adverse_sustained_days",
        "op": "gte",
        "value": 3
      },
      "recommendation": "Llevas unos días distinto de lo habitual. Puede ayudar dormir, moverte o hablar con alguien de confianza.",
      "escalation": "self_care",
      "source_ids": [
        "nasa_bhp_measures"
      ],
      "basis": "design_rule"
    },
    {
      "level": "normal",
      "when": {
        "all": []
      },
      "recommendation": "Gracias por tu check-in.",
      "escalation": "self_care",
      "source_ids": [
        "nasa_bhp_measures"
      ],
      "basis": "source"
    }
  ],
  "sources": [
    {
      "id": "nasa_bhp_measures",
      "title": "NASA NTRS – BHP Laboratory Standard Measures",
      "url": "https://ntrs.nasa.gov/api/citations/20170005421/downloads/20170005421.pdf"
    }
  ],
  "notes": [
    "El astronauta no ve un semáforo rojo en bienestar: la app muestra mensajes neutros. La racha premia completar el check-in, nunca el resultado."
  ]
}
```

### `WB_STRESS`

```json
{
  "code": "WB_STRESS",
  "name": "Estrés (check-in)",
  "unit": "0–100",
  "value_type": "scale",
  "components": [
    {
      "name": "value",
      "type": "number",
      "role": "value",
      "required": true,
      "unit": "0–100"
    }
  ],
  "derived_fields": [
    {
      "name": "baseline_ready",
      "type": "boolean",
      "how": "hay al menos 7 check-ins en la ventana de línea base (14 días, excluye los últimos 3)"
    },
    {
      "name": "adverse_z_3d",
      "type": "number",
      "how": "z del promedio de los últimos 3 check-ins contra la línea base personal, orientado para que positivo = peor (más alto es peor)"
    },
    {
      "name": "adverse_sustained_days",
      "type": "integer",
      "how": "check-ins seguidos con adverse_z_3d ≥ 1.5"
    }
  ],
  "hazards": [
    "isolation_confinement"
  ],
  "body_zone": "brain",
  "input_methods": [
    "slider"
  ],
  "sensitivity": "confidential",
  "rules_version": 1,
  "direction": "low",
  "guide": {
    "measurable": "Sí. Deslizador sin números en el check-in diario (20 s). NASA BHP usa escalas analógicas visuales (VAS) como medida estándar.",
    "why": "El estrés sostenido afecta el sueño, el ánimo y el desempeño.",
    "hazard_effect": "Isolation and Confinement: el aislamiento, la distancia de la Tierra y el estrés de la misión afectan la salud mental (riesgo de cambios conductuales y de trabajo en equipo de NASA HRP).",
    "when_to_escalate": "Salud conductual (confidencial): 5 check-ins seguidos claramente más alto que tu rango habitual. Nunca se avisa a la tripulación.",
    "prevention": "Mantener rutinas, contacto con la familia, ejercicio y sueño; usar \"Quiero hablar con alguien\" en cualquier momento."
  },
  "rules": [
    {
      "level": "unrated",
      "when": {
        "field": "baseline_ready",
        "op": "eq",
        "value": false
      },
      "recommendation": "Estamos aprendiendo tu rango habitual. Sigue con tus check-ins.",
      "escalation": "self_care",
      "source_ids": [
        "nasa_bhp_measures"
      ],
      "basis": "design_rule",
      "note": "Línea base mínima de 7 check-ins: regla de diseño."
    },
    {
      "level": "caution",
      "when": {
        "field": "adverse_sustained_days",
        "op": "gte",
        "value": 5
      },
      "recommendation": "Llevas varios días distinto de lo habitual. Tu equipo de apoyo en Tierra lo sabrá de forma confidencial. Si quieres, usa \"Quiero hablar con alguien\".",
      "escalation": "behavioral_health",
      "source_ids": [
        "nasa_bhp_measures"
      ],
      "basis": "design_rule",
      "note": "z ≥ 1.5 sostenido 5 días: regla de diseño, pendiente de validación por salud conductual. NASA BHP no publica un corte clínico para las VAS."
    },
    {
      "level": "caution",
      "when": {
        "field": "adverse_sustained_days",
        "op": "gte",
        "value": 3
      },
      "recommendation": "Llevas unos días distinto de lo habitual. Puede ayudar dormir, moverte o hablar con alguien de confianza.",
      "escalation": "self_care",
      "source_ids": [
        "nasa_bhp_measures"
      ],
      "basis": "design_rule"
    },
    {
      "level": "normal",
      "when": {
        "all": []
      },
      "recommendation": "Gracias por tu check-in.",
      "escalation": "self_care",
      "source_ids": [
        "nasa_bhp_measures"
      ],
      "basis": "source"
    }
  ],
  "sources": [
    {
      "id": "nasa_bhp_measures",
      "title": "NASA NTRS – BHP Laboratory Standard Measures",
      "url": "https://ntrs.nasa.gov/api/citations/20170005421/downloads/20170005421.pdf"
    }
  ],
  "notes": [
    "El astronauta no ve un semáforo rojo en bienestar: la app muestra mensajes neutros. La racha premia completar el check-in, nunca el resultado."
  ]
}
```

### `WB_CREW_CONFLICT`

```json
{
  "code": "WB_CREW_CONFLICT",
  "name": "Roces con la tripulación (check-in)",
  "unit": "0–100",
  "value_type": "scale",
  "components": [
    {
      "name": "value",
      "type": "number",
      "role": "value",
      "required": true,
      "unit": "0–100"
    }
  ],
  "derived_fields": [
    {
      "name": "baseline_ready",
      "type": "boolean",
      "how": "hay al menos 7 check-ins en la ventana de línea base (14 días, excluye los últimos 3)"
    },
    {
      "name": "adverse_z_3d",
      "type": "number",
      "how": "z del promedio de los últimos 3 check-ins contra la línea base personal, orientado para que positivo = peor (más alto es peor)"
    },
    {
      "name": "adverse_sustained_days",
      "type": "integer",
      "how": "check-ins seguidos con adverse_z_3d ≥ 1.5"
    }
  ],
  "hazards": [
    "isolation_confinement"
  ],
  "body_zone": "brain",
  "input_methods": [
    "slider"
  ],
  "sensitivity": "confidential",
  "rules_version": 1,
  "direction": "low",
  "guide": {
    "measurable": "Sí. Deslizador sin números en el check-in diario (20 s). NASA BHP usa escalas analógicas visuales (VAS) como medida estándar.",
    "why": "Los conflictos sostenidos afectan la cohesión del equipo, clave para la seguridad de la misión.",
    "hazard_effect": "Isolation and Confinement: el aislamiento, la distancia de la Tierra y el estrés de la misión afectan la salud mental (riesgo de cambios conductuales y de trabajo en equipo de NASA HRP).",
    "when_to_escalate": "Salud conductual (confidencial): 5 check-ins seguidos claramente más alto que tu rango habitual. Nunca se avisa a la tripulación.",
    "prevention": "Mantener rutinas, contacto con la familia, ejercicio y sueño; usar \"Quiero hablar con alguien\" en cualquier momento."
  },
  "rules": [
    {
      "level": "unrated",
      "when": {
        "field": "baseline_ready",
        "op": "eq",
        "value": false
      },
      "recommendation": "Estamos aprendiendo tu rango habitual. Sigue con tus check-ins.",
      "escalation": "self_care",
      "source_ids": [
        "nasa_bhp_measures"
      ],
      "basis": "design_rule",
      "note": "Línea base mínima de 7 check-ins: regla de diseño."
    },
    {
      "level": "caution",
      "when": {
        "field": "adverse_sustained_days",
        "op": "gte",
        "value": 5
      },
      "recommendation": "Llevas varios días distinto de lo habitual. Tu equipo de apoyo en Tierra lo sabrá de forma confidencial. Si quieres, usa \"Quiero hablar con alguien\".",
      "escalation": "behavioral_health",
      "source_ids": [
        "nasa_bhp_measures"
      ],
      "basis": "design_rule",
      "note": "z ≥ 1.5 sostenido 5 días: regla de diseño, pendiente de validación por salud conductual. NASA BHP no publica un corte clínico para las VAS."
    },
    {
      "level": "caution",
      "when": {
        "field": "adverse_sustained_days",
        "op": "gte",
        "value": 3
      },
      "recommendation": "Llevas unos días distinto de lo habitual. Puede ayudar dormir, moverte o hablar con alguien de confianza.",
      "escalation": "self_care",
      "source_ids": [
        "nasa_bhp_measures"
      ],
      "basis": "design_rule"
    },
    {
      "level": "normal",
      "when": {
        "all": []
      },
      "recommendation": "Gracias por tu check-in.",
      "escalation": "self_care",
      "source_ids": [
        "nasa_bhp_measures"
      ],
      "basis": "source"
    }
  ],
  "sources": [
    {
      "id": "nasa_bhp_measures",
      "title": "NASA NTRS – BHP Laboratory Standard Measures",
      "url": "https://ntrs.nasa.gov/api/citations/20170005421/downloads/20170005421.pdf"
    }
  ],
  "notes": [
    "El astronauta no ve un semáforo rojo en bienestar: la app muestra mensajes neutros. La racha premia completar el check-in, nunca el resultado.",
    "Con 4 tripulantes este dato nunca es anónimo: solo lo ve el astronauta y salud conductual."
  ]
}
```

### `PHQ2_SCORE`

```json
{
  "code": "PHQ2_SCORE",
  "name": "Tamizaje de ánimo (PHQ-2)",
  "unit": "puntos (0–6)",
  "value_type": "scale",
  "components": [
    {
      "name": "value",
      "type": "integer",
      "role": "value",
      "required": true,
      "unit": "puntos"
    },
    {
      "name": "item_1",
      "type": "integer",
      "role": "context",
      "required": true,
      "values": "0–3"
    },
    {
      "name": "item_2",
      "type": "integer",
      "role": "context",
      "required": true,
      "values": "0–3"
    }
  ],
  "derived_fields": [],
  "hazards": [
    "isolation_confinement"
  ],
  "body_zone": "brain",
  "input_methods": [
    "questionnaire"
  ],
  "sensitivity": "confidential",
  "rules_version": 1,
  "guide": {
    "measurable": "Sí. PHQ-2: 2 preguntas sobre las últimas 2 semanas, cada 2 semanas, un día antes de la conferencia psicológica privada.",
    "why": "Es un tamizaje breve: no diagnostica, solo indica si conviene que salud conductual converse contigo.",
    "hazard_effect": "Isolation and Confinement: NASA HRP incluye el riesgo de cambios conductuales y trastornos psiquiátricos por aislamiento, radiación y distancia de la Tierra.",
    "when_to_escalate": "Salud conductual (confidencial): 3 puntos o más. Nunca se avisa a la tripulación ni a control de misión.",
    "prevention": "Conferencias psicológicas privadas, rutinas, contacto con la familia y \"Quiero hablar con alguien\"."
  },
  "rules": [
    {
      "level": "caution",
      "when": {
        "field": "value",
        "op": "gte",
        "value": 3
      },
      "recommendation": "Gracias por responder. Tu equipo de apoyo en Tierra revisará tus respuestas antes de tu conferencia privada. Si quieres hablar antes, usa \"Quiero hablar con alguien\".",
      "escalation": "behavioral_health",
      "source_ids": [
        "phq2_nida",
        "nasa_bhp_ops"
      ],
      "basis": "source",
      "note": "Punto de corte 3."
    },
    {
      "level": "normal",
      "when": {
        "all": []
      },
      "recommendation": "Gracias por responder.",
      "escalation": "self_care",
      "source_ids": [
        "phq2_nida"
      ],
      "basis": "source"
    }
  ],
  "sources": [
    {
      "id": "phq2_nida",
      "title": "NIDA CDE – Patient Health Questionnaire-2 (PHQ-2)",
      "url": "https://cde.nida.nih.gov/node/22"
    },
    {
      "id": "nasa_bhp_ops",
      "title": "NASA NTRS – BHP Operations at JSC (conferencias psicológicas privadas)",
      "url": "https://ntrs.nasa.gov/api/citations/20170003866/downloads/20170003866.pdf"
    }
  ],
  "notes": [
    "Al astronauta nunca se le muestra el puntaje ni un diagnóstico. No se usa PHQ-9 (exige protocolo de crisis)."
  ]
}
```

### `GAD2_SCORE`

```json
{
  "code": "GAD2_SCORE",
  "name": "Tamizaje de ansiedad (GAD-2)",
  "unit": "puntos (0–6)",
  "value_type": "scale",
  "components": [
    {
      "name": "value",
      "type": "integer",
      "role": "value",
      "required": true,
      "unit": "puntos"
    },
    {
      "name": "item_1",
      "type": "integer",
      "role": "context",
      "required": true,
      "values": "0–3"
    },
    {
      "name": "item_2",
      "type": "integer",
      "role": "context",
      "required": true,
      "values": "0–3"
    }
  ],
  "derived_fields": [],
  "hazards": [
    "isolation_confinement"
  ],
  "body_zone": "brain",
  "input_methods": [
    "questionnaire"
  ],
  "sensitivity": "confidential",
  "rules_version": 1,
  "guide": {
    "measurable": "Sí. GAD-2: 2 preguntas sobre las últimas 2 semanas, cada 2 semanas, un día antes de la conferencia psicológica privada.",
    "why": "Es un tamizaje breve: no diagnostica, solo indica si conviene que salud conductual converse contigo.",
    "hazard_effect": "Isolation and Confinement: NASA HRP incluye el riesgo de cambios conductuales y trastornos psiquiátricos por aislamiento, radiación y distancia de la Tierra.",
    "when_to_escalate": "Salud conductual (confidencial): 3 puntos o más. Nunca se avisa a la tripulación ni a control de misión.",
    "prevention": "Conferencias psicológicas privadas, rutinas, contacto con la familia y \"Quiero hablar con alguien\"."
  },
  "rules": [
    {
      "level": "caution",
      "when": {
        "field": "value",
        "op": "gte",
        "value": 3
      },
      "recommendation": "Gracias por responder. Tu equipo de apoyo en Tierra revisará tus respuestas antes de tu conferencia privada. Si quieres hablar antes, usa \"Quiero hablar con alguien\".",
      "escalation": "behavioral_health",
      "source_ids": [
        "gad2_kroenke",
        "nasa_bhp_ops"
      ],
      "basis": "source",
      "note": "Punto de corte 3."
    },
    {
      "level": "normal",
      "when": {
        "all": []
      },
      "recommendation": "Gracias por responder.",
      "escalation": "self_care",
      "source_ids": [
        "gad2_kroenke"
      ],
      "basis": "source"
    }
  ],
  "sources": [
    {
      "id": "gad2_kroenke",
      "title": "Kroenke et al. 2007, Ann Intern Med – Anxiety disorders in primary care (validación GAD-2)",
      "url": "https://pubmed.ncbi.nlm.nih.gov/17339617/"
    },
    {
      "id": "nasa_bhp_ops",
      "title": "NASA NTRS – BHP Operations at JSC (conferencias psicológicas privadas)",
      "url": "https://ntrs.nasa.gov/api/citations/20170003866/downloads/20170003866.pdf"
    }
  ],
  "notes": [
    "Al astronauta nunca se le muestra el puntaje ni un diagnóstico. No se usa PHQ-9 (exige protocolo de crisis)."
  ]
}
```

### `PVT_LAPSES`

```json
{
  "code": "PVT_LAPSES",
  "name": "Prueba de reacción: lapsos",
  "unit": "conteo",
  "value_type": "simple",
  "components": [
    {
      "name": "value",
      "type": "integer",
      "role": "value",
      "required": true,
      "unit": "lapsos (TR ≥ 355 ms)"
    },
    {
      "name": "device_id",
      "type": "string",
      "role": "context",
      "required": true
    }
  ],
  "derived_fields": [
    {
      "name": "baseline_ready",
      "type": "boolean",
      "how": "al menos 3 corridas previas en el mismo dispositivo y en condiciones de descanso"
    },
    {
      "name": "z_device_baseline",
      "type": "number",
      "how": "z contra la línea base personal del mismo dispositivo (positivo = peor)"
    }
  ],
  "hazards": [
    "isolation_confinement"
  ],
  "body_zone": "brain",
  "input_methods": [
    "minigame"
  ],
  "sensitivity": "confidential",
  "rules_version": 1,
  "guide": {
    "measurable": "Sí. Minijuego de 3 min inspirado en la PVT-B: tocar el círculo en cuanto aparece. La PVT forma parte de la Cognition Test Battery usada por NASA.",
    "why": "Mide la atención sostenida, que cae con la falta de sueño y la fatiga. Es obligatoria antes de tareas críticas (EVA, maniobras).",
    "hazard_effect": "Isolation and Confinement: el sueño corto y los horarios irregulares (riesgo de sueño inadecuado de NASA HRP) reducen la atención.",
    "when_to_escalate": "Flight surgeon (confidencial): 20 lapsos o más. A control de misión solo llega \"apto: sí / no confirmado\".",
    "prevention": "Proteger el sueño antes de tareas críticas y repetir la prueba tras descansar."
  },
  "rules": [
    {
      "level": "critical",
      "when": {
        "field": "value",
        "op": "gte",
        "value": 20
      },
      "recommendation": "Tu atención hoy está muy por debajo de lo normal. Descansa antes de cualquier tarea crítica; tu aptitud queda como \"no confirmada\".",
      "escalation": "flight_surgeon",
      "source_ids": [
        "pvt_fd",
        "pvtb_basner"
      ],
      "basis": "source_adapted",
      "note": "Basner & Rubinstein 2011: 11 y 20 lapsos (umbral 355 ms) separan desempeño alto, medio y bajo en una tarea de vigilancia. Se aplica fuera de ese contexto."
    },
    {
      "level": "caution",
      "when": {
        "field": "value",
        "op": "gte",
        "value": 11
      },
      "recommendation": "Tu atención hoy está por debajo de lo ideal. Si puedes, descansa y repite la prueba antes de una tarea crítica.",
      "escalation": "self_care",
      "source_ids": [
        "pvt_fd",
        "pvtb_basner"
      ],
      "basis": "source_adapted"
    },
    {
      "level": "caution",
      "when": {
        "field": "z_device_baseline",
        "op": "gte",
        "value": 2
      },
      "recommendation": "Tu resultado está peor que tu rango habitual. Repite la prueba después de descansar.",
      "escalation": "self_care",
      "source_ids": [
        "pvtb_basner"
      ],
      "basis": "design_rule",
      "note": "z ≥ 2 contra la línea base del dispositivo: regla de diseño."
    },
    {
      "level": "unrated",
      "when": {
        "field": "baseline_ready",
        "op": "eq",
        "value": false
      },
      "recommendation": "Aún estamos construyendo tu línea base en este dispositivo.",
      "escalation": "self_care",
      "source_ids": [
        "pvtb_basner"
      ],
      "basis": "design_rule"
    },
    {
      "level": "normal",
      "when": {
        "all": []
      },
      "recommendation": "Tu atención está en tu rango habitual.",
      "escalation": "self_care",
      "source_ids": [
        "pvtb_basner"
      ],
      "basis": "source"
    }
  ],
  "sources": [
    {
      "id": "pvt_fd",
      "title": "Basner & Rubinstein 2011, JOEM – Fitness for duty: 3-min PVT (11 y 20 lapsos, umbral 355 ms)",
      "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC3190077"
    },
    {
      "id": "pvtb_basner",
      "title": "Basner, Mollicone, Dinges 2011, Acta Astronautica – Validity and Sensitivity of a Brief PVT (PVT-B)",
      "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC3197786"
    }
  ],
  "notes": [
    "Lapso = respuesta ≥ 355 ms (umbral de la PVT-B; 500 ms es el de la PVT de 10 min).",
    "Aptitud para tarea crítica = \"no confirmado\" si cualquiera de los 3 indicadores PVT no está en normal."
  ]
}
```

### `PVT_MEAN_RT`

```json
{
  "code": "PVT_MEAN_RT",
  "name": "Prueba de reacción: tiempo medio",
  "unit": "ms",
  "value_type": "simple",
  "components": [
    {
      "name": "value",
      "type": "number",
      "role": "value",
      "required": true,
      "unit": "ms"
    },
    {
      "name": "device_id",
      "type": "string",
      "role": "context",
      "required": true
    }
  ],
  "derived_fields": [
    {
      "name": "baseline_ready",
      "type": "boolean",
      "how": "al menos 3 corridas previas en el mismo dispositivo y en condiciones de descanso"
    },
    {
      "name": "z_device_baseline",
      "type": "number",
      "how": "z contra la línea base personal del mismo dispositivo (positivo = peor)"
    }
  ],
  "hazards": [
    "isolation_confinement"
  ],
  "body_zone": "brain",
  "input_methods": [
    "minigame"
  ],
  "sensitivity": "confidential",
  "rules_version": 1,
  "guide": {
    "measurable": "Sí. Minijuego de 3 min inspirado en la PVT-B: tocar el círculo en cuanto aparece. La PVT forma parte de la Cognition Test Battery usada por NASA.",
    "why": "Mide la atención sostenida, que cae con la falta de sueño y la fatiga. Es obligatoria antes de tareas críticas (EVA, maniobras).",
    "hazard_effect": "Isolation and Confinement: el sueño corto y los horarios irregulares (riesgo de sueño inadecuado de NASA HRP) reducen la atención.",
    "when_to_escalate": "Flight surgeon (confidencial): 20 lapsos o más. A control de misión solo llega \"apto: sí / no confirmado\".",
    "prevention": "Proteger el sueño antes de tareas críticas y repetir la prueba tras descansar."
  },
  "rules": [
    {
      "level": "caution",
      "when": {
        "field": "z_device_baseline",
        "op": "gte",
        "value": 2
      },
      "recommendation": "Hoy reaccionas más lento que de costumbre. Descansa y repite la prueba antes de una tarea crítica.",
      "escalation": "self_care",
      "source_ids": [
        "pvtb_basner"
      ],
      "basis": "design_rule",
      "note": "No hay corte absoluto publicado para el tiempo medio; se compara contra la línea base."
    },
    {
      "level": "unrated",
      "when": {
        "field": "baseline_ready",
        "op": "eq",
        "value": false
      },
      "recommendation": "Aún estamos construyendo tu línea base en este dispositivo.",
      "escalation": "self_care",
      "source_ids": [
        "pvtb_basner"
      ],
      "basis": "design_rule"
    },
    {
      "level": "normal",
      "when": {
        "all": []
      },
      "recommendation": "Tu tiempo de reacción está en tu rango habitual.",
      "escalation": "self_care",
      "source_ids": [
        "pvtb_basner"
      ],
      "basis": "source"
    }
  ],
  "sources": [
    {
      "id": "pvtb_basner",
      "title": "Basner, Mollicone, Dinges 2011, Acta Astronautica – Validity and Sensitivity of a Brief PVT (PVT-B)",
      "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC3197786"
    }
  ]
}
```

### `PVT_FALSE_STARTS`

```json
{
  "code": "PVT_FALSE_STARTS",
  "name": "Prueba de reacción: falsos inicios",
  "unit": "conteo",
  "value_type": "simple",
  "components": [
    {
      "name": "value",
      "type": "integer",
      "role": "value",
      "required": true,
      "unit": "respuestas < 100 ms o sin estímulo"
    },
    {
      "name": "device_id",
      "type": "string",
      "role": "context",
      "required": true
    }
  ],
  "derived_fields": [
    {
      "name": "baseline_ready",
      "type": "boolean",
      "how": "al menos 3 corridas previas en el mismo dispositivo y en condiciones de descanso"
    },
    {
      "name": "z_device_baseline",
      "type": "number",
      "how": "z contra la línea base personal del mismo dispositivo (positivo = peor)"
    }
  ],
  "hazards": [
    "isolation_confinement"
  ],
  "body_zone": "brain",
  "input_methods": [
    "minigame"
  ],
  "sensitivity": "confidential",
  "rules_version": 1,
  "guide": {
    "measurable": "Sí. Minijuego de 3 min inspirado en la PVT-B: tocar el círculo en cuanto aparece. La PVT forma parte de la Cognition Test Battery usada por NASA.",
    "why": "Mide la atención sostenida, que cae con la falta de sueño y la fatiga. Es obligatoria antes de tareas críticas (EVA, maniobras).",
    "hazard_effect": "Isolation and Confinement: el sueño corto y los horarios irregulares (riesgo de sueño inadecuado de NASA HRP) reducen la atención.",
    "when_to_escalate": "Flight surgeon (confidencial): 20 lapsos o más. A control de misión solo llega \"apto: sí / no confirmado\".",
    "prevention": "Proteger el sueño antes de tareas críticas y repetir la prueba tras descansar."
  },
  "rules": [
    {
      "level": "caution",
      "when": {
        "field": "z_device_baseline",
        "op": "gte",
        "value": 2
      },
      "recommendation": "Hoy tocaste antes de tiempo más de lo habitual. Puede ser señal de cansancio; repite la prueba tras descansar.",
      "escalation": "self_care",
      "source_ids": [
        "pvtb_basner",
        "psytoolkit_pvtb"
      ],
      "basis": "design_rule"
    },
    {
      "level": "unrated",
      "when": {
        "field": "baseline_ready",
        "op": "eq",
        "value": false
      },
      "recommendation": "Aún estamos construyendo tu línea base en este dispositivo.",
      "escalation": "self_care",
      "source_ids": [
        "pvtb_basner"
      ],
      "basis": "design_rule"
    },
    {
      "level": "normal",
      "when": {
        "all": []
      },
      "recommendation": "Sin cambios respecto a tu rango habitual.",
      "escalation": "self_care",
      "source_ids": [
        "pvtb_basner"
      ],
      "basis": "source"
    }
  ],
  "sources": [
    {
      "id": "pvtb_basner",
      "title": "Basner, Mollicone, Dinges 2011, Acta Astronautica – Validity and Sensitivity of a Brief PVT (PVT-B)",
      "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC3197786"
    },
    {
      "id": "psytoolkit_pvtb",
      "title": "PsyToolkit – PVT-B (falsos inicios < 100 ms, según Basner 2011)",
      "url": "https://www.psytoolkit.org/library/pvtb.html"
    }
  ],
  "notes": [
    "Falso inicio < 100 ms: se toma de PsyToolkit, que lo atribuye a Basner 2011; confirmar en el texto original (pendiente)."
  ]
}
```

### `BODY_MASS`

```json
{
  "code": "BODY_MASS",
  "name": "Masa corporal",
  "unit": "kg",
  "value_type": "simple",
  "components": [
    {
      "name": "value",
      "type": "number",
      "role": "value",
      "required": true,
      "unit": "kg"
    }
  ],
  "derived_fields": [
    {
      "name": "pct_change_from_preflight",
      "type": "number",
      "how": "(valor − masa preflight) / masa preflight × 100"
    }
  ],
  "hazards": [
    "gravity_fields",
    "distance_from_earth"
  ],
  "body_zone": "muscle",
  "input_methods": [
    "manual"
  ],
  "sensitivity": "standard",
  "rules_version": 1,
  "guide": {
    "measurable": "Sí, pero no con báscula: en ingravidez se mide la masa con dispositivos de aceleración (SLAMMD o BMMD en la ISS).",
    "why": "Perder masa suele indicar que se come menos de lo necesario y se pierde músculo y hueso.",
    "hazard_effect": "Gravity Fields y Distance from Earth: los astronautas suelen comer menos de lo recomendado; pierden 2–5 % de masa el primer mes y la mantienen baja durante el vuelo.",
    "when_to_escalate": "Flight surgeon: pérdida del 5 % o más respecto a la masa preflight (rutina); 10 % o más (crítico).",
    "prevention": "Comer las raciones completas, ejercicio de resistencia y medir la masa con la frecuencia de la rutina."
  },
  "rules": [
    {
      "level": "critical",
      "when": {
        "field": "pct_change_from_preflight",
        "op": "lte",
        "value": -10
      },
      "recommendation": "Has perdido el 10 % o más de tu masa inicial. El flight surgeon revisará tu alimentación.",
      "escalation": "flight_surgeon",
      "source_ids": [
        "sn_smith"
      ],
      "basis": "source_adapted",
      "note": "Declaración de S. M. Smith (nutrición, NASA JSC): más de 10 % es crítico. No es una norma publicada."
    },
    {
      "level": "caution",
      "when": {
        "field": "pct_change_from_preflight",
        "op": "lte",
        "value": -5
      },
      "recommendation": "Has perdido el 5 % o más de tu masa inicial. Intenta completar todas tus raciones; el flight surgeon lo revisará.",
      "escalation": "flight_surgeon",
      "source_ids": [
        "sn_smith",
        "aafp_weight"
      ],
      "basis": "source_adapted",
      "note": "Smith: 5–10 % es preocupante. AAFP: > 5 % en 6–12 meses es clínicamente relevante (en adultos mayores)."
    },
    {
      "level": "normal",
      "when": {
        "all": []
      },
      "recommendation": "Tu masa corporal está cerca de tu valor inicial.",
      "escalation": "self_care",
      "source_ids": [
        "ntrs_body_mass"
      ],
      "basis": "source"
    }
  ],
  "sources": [
    {
      "id": "sn_smith",
      "title": "Science News – The Zero Gravity Diet (declaraciones de S. M. Smith, NASA JSC)",
      "url": "https://www.sciencenews.org/?p=40630"
    },
    {
      "id": "aafp_weight",
      "title": "AAFP – Unintentional Weight Loss in Older Adults (>5 % en 6–12 meses)",
      "url": "https://www.aafp.org/pubs/afp/issues/2014/0501/p718.html"
    },
    {
      "id": "ntrs_body_mass",
      "title": "NASA NTRS – Smith, Heer, Zwart: Nutrition SMO (pérdida de 2–5 % de masa el primer mes)",
      "url": "https://ntrs.nasa.gov/citations/20140013313"
    }
  ]
}
```

### `EXERCISE_MIN`

```json
{
  "code": "EXERCISE_MIN",
  "name": "Ejercicio",
  "unit": "min/día",
  "value_type": "simple",
  "components": [
    {
      "name": "value",
      "type": "number",
      "role": "value",
      "required": true,
      "unit": "min"
    },
    {
      "name": "type",
      "type": "string",
      "role": "context",
      "required": false,
      "values": "aerobic | resistive"
    }
  ],
  "derived_fields": [
    {
      "name": "rolling_7d_pct_of_prescription",
      "type": "number",
      "how": "minutos de los últimos 7 días / prescripción semanal × 100 (prescripción por defecto: 600 min/semana)"
    }
  ],
  "hazards": [
    "gravity_fields"
  ],
  "body_zone": "bones",
  "input_methods": [
    "manual",
    "wearable"
  ],
  "sensitivity": "standard",
  "rules_version": 1,
  "guide": {
    "measurable": "Sí. Registro de sesiones en cinta (T2), cicloergómetro (CEVIS) y equipo de resistencia (ARED).",
    "why": "El ejercicio es la principal contramedida contra la pérdida de hueso, músculo y capacidad aeróbica.",
    "hazard_effect": "Gravity Fields: sin carga, hueso y músculo se pierden; NASA exige mantener la capacidad aeróbica y la fuerza en 80 % o más de la previa. En la ISS el promedio es de 600 min por semana.",
    "when_to_escalate": "Flight surgeon: menos del 50 % de la prescripción semanal.",
    "prevention": "Seguir la prescripción diaria (unos 30 min aeróbicos + 30–60 min de resistencia) y reprogramar las sesiones perdidas."
  },
  "rules": [
    {
      "level": "caution",
      "when": {
        "field": "rolling_7d_pct_of_prescription",
        "op": "lt",
        "value": 50
      },
      "recommendation": "Esta semana hiciste menos de la mitad de tu ejercicio prescrito. El flight surgeon revisará tu plan.",
      "escalation": "flight_surgeon",
      "source_ids": [
        "ochmo_exercise"
      ],
      "basis": "design_rule",
      "note": "Cortes de 50 % y 80 % de cumplimiento: regla de diseño."
    },
    {
      "level": "caution",
      "when": {
        "field": "rolling_7d_pct_of_prescription",
        "op": "lt",
        "value": 80
      },
      "recommendation": "Vas por debajo de tu ejercicio prescrito esta semana. Intenta recuperar sesiones.",
      "escalation": "self_care",
      "source_ids": [
        "ochmo_exercise"
      ],
      "basis": "design_rule"
    },
    {
      "level": "normal",
      "when": {
        "all": []
      },
      "recommendation": "Vas al día con tu ejercicio prescrito.",
      "escalation": "self_care",
      "source_ids": [
        "ochmo_exercise"
      ],
      "basis": "source"
    }
  ],
  "sources": [
    {
      "id": "ochmo_exercise",
      "title": "NASA OCHMO-TB-031 – Exercise Overview",
      "url": "https://www.nasa.gov/wp-content/uploads/2023/12/ochmo-tb-031-exercise-overview.pdf"
    }
  ],
  "notes": [
    "Sin nivel crítico: el déficit de ejercicio no es una emergencia aguda."
  ]
}
```

### `VISION_CHECK`

```json
{
  "code": "VISION_CHECK",
  "name": "Síntomas visuales (SANS)",
  "unit": "sí/no",
  "value_type": "boolean",
  "components": [
    {
      "name": "near_blur",
      "type": "boolean",
      "role": "value",
      "required": true
    },
    {
      "name": "far_blur",
      "type": "boolean",
      "role": "value",
      "required": true
    },
    {
      "name": "amsler_distortion",
      "type": "boolean",
      "role": "value",
      "required": true
    },
    {
      "name": "blind_spot_or_field_loss",
      "type": "boolean",
      "role": "value",
      "required": true
    },
    {
      "name": "double_vision",
      "type": "boolean",
      "role": "value",
      "required": true
    },
    {
      "name": "transient_vision_loss",
      "type": "boolean",
      "role": "value",
      "required": true
    },
    {
      "name": "severe_headache",
      "type": "boolean",
      "role": "value",
      "required": true
    }
  ],
  "derived_fields": [],
  "hazards": [
    "gravity_fields"
  ],
  "body_zone": "eyes",
  "input_methods": [
    "clicks"
  ],
  "sensitivity": "standard",
  "rules_version": 1,
  "guide": {
    "measurable": "Sí. Autoevaluación con carta de agudeza visual y rejilla de Amsler; en la ISS también hay fondo de ojo y OCT.",
    "why": "El SANS puede cambiar la visión durante misiones largas; detectarlo temprano protege la vista y la misión.",
    "hazard_effect": "Gravity Fields: en ingravidez la estructura del ojo y del cerebro puede cambiar (edema del disco óptico, pliegues coroideos, aplanamiento del globo, cambio de graduación).",
    "when_to_escalate": "Flight surgeon (prioritario): distorsión en la rejilla de Amsler, punto ciego o pérdida de campo, visión doble o pérdidas breves de visión. Flight surgeon (rutina): visión borrosa nueva o dolor de cabeza intenso.",
    "prevention": "Autoevaluación semanal, usar las gafas de anticipación espacial si cambia la graduación y reportar cualquier cambio."
  },
  "rules": [
    {
      "level": "critical",
      "when": {
        "any": [
          {
            "field": "amsler_distortion",
            "op": "eq",
            "value": true
          },
          {
            "field": "blind_spot_or_field_loss",
            "op": "eq",
            "value": true
          },
          {
            "field": "double_vision",
            "op": "eq",
            "value": true
          },
          {
            "field": "transient_vision_loss",
            "op": "eq",
            "value": true
          }
        ]
      },
      "recommendation": "Reportaste un cambio en tu visión que el flight surgeon debe revisar pronto. Evita tareas que dependan de la vista fina hasta recibir indicaciones.",
      "escalation": "flight_surgeon",
      "source_ids": [
        "ntrs_sans_2023",
        "ntrs_sans_intro"
      ],
      "basis": "source_adapted",
      "note": "NASA: SANS con impacto funcional agudo = pérdida de campo visual o visión central distorsionada; visión doble y oscurecimientos transitorios son síntomas clásicos de hipertensión intracraneal."
    },
    {
      "level": "caution",
      "when": {
        "field": "severe_headache",
        "op": "eq",
        "value": true
      },
      "recommendation": "Reportaste dolor de cabeza intenso. Revisa también el CO₂ del módulo; el flight surgeon lo revisará.",
      "escalation": "flight_surgeon",
      "source_ids": [
        "ntrs_sans_intro",
        "ochmo_co2"
      ],
      "basis": "source_adapted"
    },
    {
      "level": "caution",
      "when": {
        "any": [
          {
            "field": "near_blur",
            "op": "eq",
            "value": true
          },
          {
            "field": "far_blur",
            "op": "eq",
            "value": true
          }
        ]
      },
      "recommendation": "Reportaste visión borrosa. Prueba tus gafas de anticipación espacial; el flight surgeon lo revisará en la próxima consulta.",
      "escalation": "flight_surgeon",
      "source_ids": [
        "ntrs_sans_2023"
      ],
      "basis": "source_adapted",
      "note": "El cambio de graduación (hipermetropía) es un signo de SANS."
    },
    {
      "level": "normal",
      "when": {
        "all": []
      },
      "recommendation": "Sin cambios visuales reportados.",
      "escalation": "self_care",
      "source_ids": [
        "ntrs_sans_2023"
      ],
      "basis": "source"
    }
  ],
  "sources": [
    {
      "id": "ntrs_sans_2023",
      "title": "NASA NTRS – SANS: 2023 Clinical Update",
      "url": "https://ntrs.nasa.gov/citations/20220014606"
    },
    {
      "id": "ntrs_sans_intro",
      "title": "NASA NTRS – Brunstetter, Introduction to SANS and its Risk to NASA Astronauts",
      "url": "https://ntrs.nasa.gov/api/citations/20170009173/downloads/20170009173.pdf"
    },
    {
      "id": "ochmo_co2",
      "title": "NASA OCHMO-TB-004 – Carbon Dioxide (NASA-STD-3001 Vol. 2 Rev D [V2 6004])",
      "url": "https://www.nasa.gov/ochmo-tb-004-carbon-dioxide-2/"
    }
  ]
}
```

### `SYMPTOM`

```json
{
  "code": "SYMPTOM",
  "name": "Síntoma por zona del cuerpo",
  "unit": "catálogo",
  "value_type": "catalog",
  "components": [
    {
      "name": "symptoms",
      "type": "string[]",
      "role": "value",
      "required": true,
      "values": "códigos del catálogo de síntomas"
    },
    {
      "name": "severity",
      "type": "integer",
      "role": "context",
      "required": false,
      "values": "1–3"
    }
  ],
  "derived_fields": [],
  "hazards": [
    "gravity_fields",
    "hostile_closed_env",
    "space_radiation",
    "isolation_confinement"
  ],
  "body_zone": "by_symptom",
  "input_methods": [
    "clicks"
  ],
  "sensitivity": "standard",
  "rules_version": 1,
  "guide": {
    "measurable": "Sí. El astronauta toca la zona del cuerpo en la figura y elige el síntoma.",
    "why": "Algunos síntomas son señales de alarma que no pueden esperar a la siguiente medición.",
    "hazard_effect": "Varios peligros: mareo y desorientación al cambiar de gravedad, infecciones en espacio cerrado, náusea tras un evento solar y dolor de cabeza por CO₂.",
    "when_to_escalate": "Tripulación + flight surgeon: cualquier señal de alarma de infarto o ACV (dolor en el pecho, falta de aire, cara caída, debilidad de un brazo, dificultad para hablar, cambio súbito de visión o de equilibrio, dolor de cabeza súbito e intenso) o confusión nueva. Tripulación: síntomas de posible infección.",
    "prevention": "Reportar temprano, higiene y revisar el entorno (CO₂, temperatura) cuando hay dolor de cabeza o mareo."
  },
  "rules": [
    {
      "level": "critical",
      "when": {
        "field": "symptoms",
        "op": "has_any",
        "value": [
          "chest_pain",
          "shortness_of_breath",
          "face_drooping",
          "arm_weakness",
          "speech_difficulty",
          "sudden_vision_change",
          "sudden_balance_loss",
          "severe_headache_sudden",
          "unresponsive",
          "confusion"
        ]
      },
      "recommendation": "Reportaste un síntoma de alarma. Avisa ya a tu tripulación y activa el modo emergencia si empeora.",
      "escalation": "flight_surgeon",
      "source_ids": [
        "aha_warning",
        "news2"
      ],
      "basis": "source_adapted",
      "note": "Señales de alarma de infarto y ACV de la AHA; confusión nueva = puntaje 3 en NEWS2."
    },
    {
      "level": "caution",
      "when": {
        "field": "symptoms",
        "op": "has_any",
        "value": [
          "fainting"
        ]
      },
      "recommendation": "Reportaste un desmayo o casi desmayo. Quédate sujeto, mide tu presión y pulso, y avisa a tu tripulación.",
      "escalation": "crew",
      "source_ids": [
        "aha_low_bp"
      ],
      "basis": "source_adapted"
    },
    {
      "level": "caution",
      "when": {
        "field": "symptoms",
        "op": "has_any",
        "value": [
          "fever_feeling",
          "cough",
          "sore_throat",
          "diarrhea",
          "vomiting",
          "rash"
        ]
      },
      "recommendation": "Tus síntomas podrían ser de una infección. Mide tu temperatura, refuerza la higiene y avisa a tu tripulación para evitar contagios.",
      "escalation": "crew",
      "source_ids": [
        "nasa_hrp_risks",
        "nasa_hrp_hazards"
      ],
      "basis": "source_adapted",
      "note": "NASA HRP: cambios inmunes y del microbioma aumentan el riesgo de enfermar en espacio cerrado."
    },
    {
      "level": "caution",
      "when": {
        "field": "symptoms",
        "op": "has_any",
        "value": [
          "dizziness",
          "palpitations",
          "headache",
          "nausea",
          "excessive_thirst",
          "frequent_urination",
          "blurred_vision",
          "back_pain",
          "muscle_pain",
          "bone_pain",
          "fatigue"
        ]
      },
      "recommendation": "Gracias por reportarlo. Sigue la guía de autocuidado y vuelve a registrarlo si continúa o empeora.",
      "escalation": "self_care",
      "source_ids": [
        "nasa_hrp_risks"
      ],
      "basis": "design_rule"
    },
    {
      "level": "normal",
      "when": {
        "all": []
      },
      "recommendation": "Sin síntomas reportados.",
      "escalation": "self_care",
      "source_ids": [
        "nasa_hrp_risks"
      ],
      "basis": "source"
    }
  ],
  "sources": [
    {
      "id": "aha_warning",
      "title": "AHA – Heart Attack, Stroke and Cardiac Arrest Symptoms",
      "url": "https://www.heart.org/en/about-us/heart-attack-and-stroke-symptoms"
    },
    {
      "id": "news2",
      "title": "Royal College of Physicians – NEWS2, Chart 1: The NEWS scoring system (reproducido por NHS NWAS)",
      "url": "https://www.nwas.nhs.uk/publications/news2-national-early-warning-score"
    },
    {
      "id": "aha_low_bp",
      "title": "AHA – Low Blood Pressure: When Blood Pressure Is Too Low",
      "url": "https://www.heart.org/en/health-topics/high-blood-pressure/the-facts-about-high-blood-pressure/low-blood-pressure-when-blood-pressure-is-too-low"
    },
    {
      "id": "nasa_hrp_risks",
      "title": "NASA HRP – Risks of Human Spaceflight",
      "url": "https://www.nasa.gov/hrp/risks/"
    },
    {
      "id": "nasa_hrp_hazards",
      "title": "NASA HRP – 5 Hazards of Human Spaceflight",
      "url": "https://www.nasa.gov/hrp/hazards/"
    }
  ]
}
```

### `HAB_TEMP`

```json
{
  "code": "HAB_TEMP",
  "name": "Temperatura del módulo",
  "unit": "°C",
  "value_type": "simple",
  "components": [
    {
      "name": "value",
      "type": "number",
      "role": "value",
      "required": true,
      "unit": "°C"
    },
    {
      "name": "module_id",
      "type": "string",
      "role": "context",
      "required": true
    }
  ],
  "derived_fields": [],
  "hazards": [
    "hostile_closed_env"
  ],
  "body_zone": "environment",
  "input_methods": [
    "sensor"
  ],
  "sensitivity": "standard",
  "rules_version": 1,
  "guide": {
    "measurable": "Sí. Sensores del sistema de control ambiental. En la demo, sensor simulado.",
    "why": "Fuera del rango cómodo baja el rendimiento y se duerme peor; los extremos dañan la salud.",
    "hazard_effect": "Hostile/Closed: el soporte vital debe mantener la temperatura; el ejercicio y los equipos generan calor.",
    "when_to_escalate": "Tripulación: fuera de 20–25 °C. Flight surgeon: fuera de 18–27 °C.",
    "prevention": "Ajustar el control térmico del módulo y la ropa, y planear el ejercicio en módulos ventilados."
  },
  "rules": [
    {
      "level": "critical",
      "when": {
        "any": [
          {
            "field": "value",
            "op": "lt",
            "value": 18
          },
          {
            "field": "value",
            "op": "gt",
            "value": 27
          }
        ]
      },
      "recommendation": "La temperatura del módulo está fuera de los límites de salud de NASA. Ajusten el control térmico o cambien de módulo.",
      "escalation": "flight_surgeon",
      "source_ids": [
        "ochmo_eclss"
      ],
      "basis": "source_adapted",
      "note": "[V2 6012] límites de salud: envolvente de 18 °C/75 % HR a 27 °C/25 % HR (aquí simplificada a 18–27 °C)."
    },
    {
      "level": "caution",
      "when": {
        "any": [
          {
            "field": "value",
            "op": "lt",
            "value": 20
          },
          {
            "field": "value",
            "op": "gt",
            "value": 25
          }
        ]
      },
      "recommendation": "La temperatura del módulo está fuera de la zona de rendimiento. Ajusten el control térmico.",
      "escalation": "crew",
      "source_ids": [
        "ochmo_eclss"
      ],
      "basis": "source",
      "note": "[V2 6013] zona de rendimiento: 20–25 °C."
    },
    {
      "level": "normal",
      "when": {
        "all": []
      },
      "recommendation": "Temperatura del módulo en la zona de rendimiento.",
      "escalation": "self_care",
      "source_ids": [
        "ochmo_eclss"
      ],
      "basis": "source"
    }
  ],
  "sources": [
    {
      "id": "ochmo_eclss",
      "title": "NASA OCHMO-TB-002 – ECLSS: Human-Centered Approach ([V2 6012], [V2 6013])",
      "url": "https://www.nasa.gov/wp-content/uploads/2023/07/eclss-technical-brief-ochmo.pdf"
    }
  ]
}
```

### `HAB_HUMIDITY`

```json
{
  "code": "HAB_HUMIDITY",
  "name": "Humedad relativa del módulo",
  "unit": "%",
  "value_type": "simple",
  "components": [
    {
      "name": "value",
      "type": "number",
      "role": "value",
      "required": true,
      "unit": "% HR"
    },
    {
      "name": "module_id",
      "type": "string",
      "role": "context",
      "required": true
    }
  ],
  "derived_fields": [],
  "hazards": [
    "hostile_closed_env"
  ],
  "body_zone": "environment",
  "input_methods": [
    "sensor"
  ],
  "sensitivity": "standard",
  "rules_version": 1,
  "guide": {
    "measurable": "Sí. Sensores del sistema de control ambiental. En la demo, sensor simulado.",
    "why": "El aire muy seco irrita ojos y vías respiratorias; el muy húmedo favorece el moho y la condensación.",
    "hazard_effect": "Hostile/Closed: la respiración y el sudor agregan humedad que el soporte vital debe retirar; la humedad influye en la carga microbiana.",
    "when_to_escalate": "Tripulación: fuera de 30–60 %. Flight surgeon: fuera de 25–75 %.",
    "prevention": "Ajustar el control de humedad y revisar la condensación."
  },
  "rules": [
    {
      "level": "critical",
      "when": {
        "any": [
          {
            "field": "value",
            "op": "lt",
            "value": 25
          },
          {
            "field": "value",
            "op": "gt",
            "value": 75
          }
        ]
      },
      "recommendation": "La humedad del módulo está fuera de los límites de salud de NASA. Ajusten el control de humedad.",
      "escalation": "flight_surgeon",
      "source_ids": [
        "ochmo_eclss"
      ],
      "basis": "source_adapted",
      "note": "[V2 6012] envolvente simplificada a 25–75 % HR."
    },
    {
      "level": "caution",
      "when": {
        "any": [
          {
            "field": "value",
            "op": "lt",
            "value": 30
          },
          {
            "field": "value",
            "op": "gt",
            "value": 60
          }
        ]
      },
      "recommendation": "La humedad del módulo está fuera de la zona de rendimiento.",
      "escalation": "crew",
      "source_ids": [
        "ochmo_eclss"
      ],
      "basis": "source",
      "note": "[V2 6013] zona de rendimiento: 30–60 % HR."
    },
    {
      "level": "normal",
      "when": {
        "all": []
      },
      "recommendation": "Humedad del módulo en la zona de rendimiento.",
      "escalation": "self_care",
      "source_ids": [
        "ochmo_eclss"
      ],
      "basis": "source"
    }
  ],
  "sources": [
    {
      "id": "ochmo_eclss",
      "title": "NASA OCHMO-TB-002 – ECLSS: Human-Centered Approach ([V2 6012], [V2 6013])",
      "url": "https://www.nasa.gov/wp-content/uploads/2023/07/eclss-technical-brief-ochmo.pdf"
    }
  ]
}
```

### `HAB_NOISE`

```json
{
  "code": "HAB_NOISE",
  "name": "Ruido del módulo",
  "unit": "dBA",
  "value_type": "simple",
  "components": [
    {
      "name": "value",
      "type": "number",
      "role": "value",
      "required": true,
      "unit": "dBA"
    },
    {
      "name": "period",
      "type": "string",
      "role": "context",
      "required": true,
      "values": "work | sleep"
    },
    {
      "name": "module_id",
      "type": "string",
      "role": "context",
      "required": true
    }
  ],
  "derived_fields": [],
  "hazards": [
    "hostile_closed_env"
  ],
  "body_zone": "environment",
  "input_methods": [
    "sensor"
  ],
  "sensitivity": "standard",
  "rules_version": 1,
  "guide": {
    "measurable": "Sí. Sonómetros y dosímetros acústicos. En la demo, sensor simulado.",
    "why": "El ruido continuo causa dolor de cabeza, fatiga, mal sueño y puede impedir oír alarmas; el muy alto daña el oído.",
    "hazard_effect": "Hostile/Closed: ventiladores, bombas y equipos de ejercicio funcionan todo el día en un espacio pequeño.",
    "when_to_escalate": "Tripulación: más de ~58 dBA en trabajo o ~49 dBA en sueño. Flight surgeon: 85 dBA o más.",
    "prevention": "Usar protección auditiva, alejarse de las fuentes de ruido y apagar equipos innecesarios en el periodo de sueño."
  },
  "rules": [
    {
      "level": "critical",
      "when": {
        "field": "value",
        "op": "gte",
        "value": 85
      },
      "recommendation": "El ruido está en nivel peligroso para el oído. Usa protección auditiva ya y aléjate de la fuente.",
      "escalation": "flight_surgeon",
      "source_ids": [
        "ochmo_acoustics"
      ],
      "basis": "source",
      "note": "[V2 6077]: < 85 dBA sin importar la duración."
    },
    {
      "level": "caution",
      "when": {
        "all": [
          {
            "field": "period",
            "op": "eq",
            "value": "sleep"
          },
          {
            "field": "value",
            "op": "gt",
            "value": 49
          }
        ]
      },
      "recommendation": "Hay demasiado ruido para dormir bien. Usa tapones y avisa a la tripulación para reducir fuentes.",
      "escalation": "crew",
      "source_ids": [
        "ochmo_sleep",
        "ntrs_nc_dba"
      ],
      "basis": "source_adapted",
      "note": "Límite de sueño NC-40 (≈ 49 dBA). La equivalencia NC → dBA es aproximada."
    },
    {
      "level": "caution",
      "when": {
        "field": "value",
        "op": "gt",
        "value": 58
      },
      "recommendation": "El ruido del módulo supera el límite continuo para áreas de trabajo. Considera protección auditiva.",
      "escalation": "crew",
      "source_ids": [
        "ochmo_acoustics",
        "ntrs_nc_dba"
      ],
      "basis": "source_adapted",
      "note": "[V2 6078] NC-50 en áreas de trabajo (≈ 58 dBA). La equivalencia NC → dBA es aproximada."
    },
    {
      "level": "normal",
      "when": {
        "all": []
      },
      "recommendation": "El ruido del módulo está dentro de los límites.",
      "escalation": "self_care",
      "source_ids": [
        "ochmo_acoustics"
      ],
      "basis": "source"
    }
  ],
  "sources": [
    {
      "id": "ochmo_acoustics",
      "title": "NASA OCHMO-TB-035 – Acoustics ([V2 6077], [V2 6078])",
      "url": "https://www.nasa.gov/sites/default/files/atoms/files/acoustics_technical_brief_ochmo_0.pdf"
    },
    {
      "id": "ochmo_sleep",
      "title": "NASA OCHMO-TB-041 – Sleep Accommodations (NASA-STD-3001)",
      "url": "https://www.nasa.gov/wp-content/uploads/2023/03/sleep-accomodations-technical-brief-ochmo.pdf"
    },
    {
      "id": "ntrs_nc_dba",
      "title": "NASA NTRS – Goodman, acústica en naves (NC-50 ≈ 58.1 dBA; NC-40 ≈ 49.0 dBA)",
      "url": "https://ntrs.nasa.gov/api/citations/20090043801/downloads/20090043801.pdf"
    }
  ]
}
```
