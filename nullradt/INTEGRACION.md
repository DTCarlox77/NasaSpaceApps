# Integración de la app con la API del backend

Contrato: `backend/docs/openapi.yaml` (v1.6) y `backend/docs/api-guia-frontend.md` (rama `backend`).
API desplegada: `https://astro-health-api-81jd.onrender.com/api/v1` (datos **sintéticos** compartidos).

**Regla de oro:** si la app y el backend no coinciden, manda el backend (contrato, reglas y confidencialidad).
Se adaptó la app, nunca el contrato. Lo que no tiene endpoint queda solo en el dispositivo y, si es un
indicador, marcado como "sin evaluar". La app no inventa endpoints ni umbrales médicos.

El modo demo sin servidor (`EXPO_PUBLIC_API_URL` vacío) sigue igual que antes: maqueta, login `NR-A-0000`
con contraseñas de prueba y todo en el dispositivo. Sirve de respaldo para la presentación.

## 1. Variables de entorno

| Variable | Valor | Uso |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | `https://astro-health-api-81jd.onrender.com` (sin `/api/v1`) | Vacío = modo demo. Si alguien pone `/api/v1` al final, se quita. |
| `EXPO_PUBLIC_API_TIMEOUT_MS` | `15000` | Timeout normal. |
| `EXPO_PUBLIC_API_WAKE_TIMEOUT_MS` | `60000` | `GET /health` al abrir la app y el login (Render gratuito tarda ~50 s en despertar). |
| `EXPO_PUBLIC_REQUIRE_AUTH` | `true` | Con API el login es obligatorio siempre (se fuerza aunque diga `false`). Sin API, `false` = entrar directo con la sesión demo. |

| `EXPO_PUBLIC_HEALTH_MODE` | `local` | **Temporal.** `local` (por defecto) = Monitor, Medir y Registro usan la simulación de los equipos externos, las reglas del dispositivo y guardan en el teléfono (con foto si el dato es manual). `server` = `GET /me/body-status` + `POST /readings` (§5). Login, emergencia, triaje, bienestar y sync usan la API en ambos casos. |

Copia `.env.example` como `.env` (ignorado por git). Nunca subas secretos.

## 2. Arquitectura (capas de `AGENTS.md`)

`presentation → usecases → repositories → datasources`, cableado en `src/di/container.ts`.

| Capa | Archivos nuevos o cambiados |
|---|---|
| Dominio | `entities/Session.ts` (errores por código, roles), `HealthIndicator.ts`, `ReadingSubmission.ts`, `Wellbeing.ts`, `EmergencyReport.ts`, `Sync.ts`, `Crew.ts`; repositorios `WellbeingRepository`, `SyncRepository`; casos de uso `SubmitReading`, `WellbeingUseCases`, `SyncUseCases`, `AuthUseCases` (cambio de contraseña, logout, despertar), `uuid.ts` |
| Datos remotos | `httpClient.ts` (Bearer + refresh rotativo), `apiTypes.ts`, `auth/health/wellbeing/emergency/sync/crewRemoteDataSource.ts` |
| Datos locales | `sessionSecureDataSource.ts` (tokens y `device_id` en SecureStore), `outboxLocalDataSource.ts` (cola; reemplaza a `pendingReportsLocalDataSource`), `syncStateLocalDataSource.ts` (cursor), `wellbeingLocalDataSource.ts` (racha), `healthCacheDataSource.ts` (+ catálogo) |
| Mapeo | `data/mappers/catalogMap.ts` (tabla app ↔ catálogo, ver §4) |
| Presentación | `sync/syncEngine.ts`, `hooks/useSyncLoop.ts`, stores `syncStore`, `supportStore`, `checkInStore` (v2), `healthLogStore`; pantallas (ver §5) |

## 3. Autenticación

| Paso | Petición | App |
|---|---|---|
| Despertar | `GET /health` (60 s) al abrir | `container.wakeServer` en `_layout.tsx`, sin bloquear. |
| Login | `POST /auth/login { username, password, device_id }` | Campo **Usuario** (p. ej. `a.ortega`) en lugar de `NR-A-0000`. Guarda `access_token` y `refresh_token` **solo en SecureStore**. |
| Contexto | `context.mission`, `context.crew_role`, `context.call_sign`, `context.sex` | La misión la da el servidor: el paso 2 del login **la muestra, no la elige**. Rol de la app = `astronaut` para todo astronauta (`flight_surgeon` → `flightSurgeon`, resto → `crew`); lo de a bordo (comandante, oficial médico) se lee de `crewRole`. |
| 428 `PASSWORD_CHANGE_REQUIRED` | `POST /auth/change-password` con `Bearer = details.password_change_token`, `{ current_password, new_password, device_id }` | Formulario "Cambia tu contraseña" (mínimo 10). Responde como un login. Lo necesita `m.silva` (ATLAS). |
| 423 `ACCOUNT_LOCKED` | `details.locked_until` | "Cuenta bloqueada hasta las hh:mm. Pide al comandante que la desbloquee." |
| 401 `INVALID_CREDENTIALS` | | Siempre "Usuario o contraseña incorrectos". |
| 403 `NO_ACTIVE_ASSIGNMENT` · 429 `RATE_LIMITED` | | Mensajes propios. |
| Refresh | Ante 401 `UNAUTHENTICATED`: `POST /auth/refresh { refresh_token, device_id }` **una vez**, guarda los **dos** tokens nuevos y reintenta. | Un solo refresh aunque fallen varias peticiones a la vez. 401 `TOKEN_REUSE_DETECTED` o refresh fallido → cierra sesión y vuelve al login. Sin red no cierra sesión. |
| Logout | `POST /auth/logout { device_id }` | Mejor esfuerzo; borra tokens, sesión y caché de salud del dispositivo. |
| `device_id` | | UUID generado una vez (`app-<uuid>`) y guardado en SecureStore; sobrevive al logout. |

Errores: siempre `{ error: { code, message, details } }`; la app programa contra `code` (`HttpError.code`).

## 4. Mapeo app ↔ catálogo (verificado contra `GET /indicators`, catalog_version 1)

| `IndicatorId` (app) | Código | Zona del servidor | `BodySystemId` | Medir en la app |
|---|---|---|---|---|
| heartRate | `HEART_RATE` | heart | cardiovascular | Sí (`{ value, at_rest: true }`, `wearable`) |
| bloodPressure | `BLOOD_PRESSURE` | heart | cardiovascular | Sí (`{ systolic, diastolic, symptoms: [] }`, `manual`: el catálogo no admite `wearable`) |
| spo2 | `SPO2` | lungs | respiratory | Sí (`wearable`) |
| respRate | `RESP_RATE` | lungs | respiratory | Sí (`wearable`) |
| bodyTemperature | `BODY_TEMP` (°C) | immune | immune | Sí (`manual`, el catálogo solo admite `manual`) |
| glucose | `GLUCOSE` | metabolism | metabolism (nuevo chip, sin región en la figura) | No (solo se muestra) |
| sleepHours | `SLEEP_HOURS` | brain | brain | No |
| radDoseDaily / radDoseCum | `RAD_DOSE_DAILY` / `RAD_DOSE_CUM` | immune | immune | No (sensor) |
| bodyMass | `BODY_MASS` | muscle | muscular | No |
| exerciseMin | `EXERCISE_MIN` | bones | skeletal | No |
| visionCheck | `VISION_CHECK` | eyes | eyes | No (el número mostrado = respuestas "sí") |
| symptoms | `SYMPTOM` | zona de cada síntoma | según zona | Desde el check-in (§6) |
| **eyePressure** (presión ocular) | — | — | eyes | **Solo dispositivo, "sin evaluar"** |
| **urinaryCalcium** (calcio urinario) | — | — | skeletal | **Solo dispositivo, "sin evaluar"** |
| **gripStrength** (fuerza de agarre) | — | — | muscular | **Solo dispositivo, "sin evaluar"** |
| **reactionTime** | (`PVT_*` es confidencial) | — | brain | **Solo dispositivo, "sin evaluar"**; el PVT va por `/wellbeing/pvt-runs` |

- `HAB_*` (zona `environment`) no es zona del cuerpo: no se muestra todavía (pendiente tarjeta de hábitat).
- Los confidenciales (`WB_*`, `PHQ2_SCORE`, `GAD2_SCORE`, `PVT_*`) nunca entran al semáforo: van por `/wellbeing/*`.
- Estados: `normal`/`caution`/`critical` igual; `unrated` ↔ `unevaluated` ("sin evaluar", nunca como "bien").
- Escalamiento: `self_care` → `self`, `crew` → `crew`, `flight_surgeon` → `flightSurgeon`.
- Peligros: `space_radiation`→radiation, `isolation_confinement`→isolation, `distance_from_earth`→distance, `gravity_fields`→gravity, `hostile_closed_env`→environment.
- Síntomas del check-in → códigos de `GET /symptoms`: headache→`headache`, nausea→`nausea`, backPain→`back_pain`, blurredVision→`blurred_vision`, fatigue→`fatigue`. `congestion` e `insomnia` no existen en el catálogo: quedan en el dispositivo.
- `input_method` siempre dentro de `input_methods` del catálogo (`inputMethodFor`).

## 5. Pantallas → endpoints

| Pantalla | Con API |
|---|---|
| Login | `/auth/login`, `/auth/change-password`; paso 2 muestra la misión asignada (`/missions/current`, `/missions/{id}/crew`). |
| Inicio / Monitor / Cuerpo 3D | `GET /me/body-status` (semáforo y `recommendation` tal cual), `GET /indicators` (nombres, unidades, fuentes), `GET /me/readings?code=&from=` (tendencia, últimos 7 días). Caché offline. Chip nuevo **Metabolismo**. |
| Medir | `POST /readings` (`client_uuid`, `indicator_code`, `measured_at`, `values`, `input_method`, `device_id`). Muestra `evaluation.level` y `recommendation` tal cual; con `escalation_id`: "se avisó a la tripulación / a Tierra"; con `emergency`: tarjeta **"¿Estás bien?"** con cuenta regresiva → `POST /emergency/sessions/{id}/confirm`. El valor sigue siendo del equipo simulado de la app. |
| Bienestar | `POST /wellbeing/checkins`; síntomas → `POST /readings` (`SYMPTOM`). Con `screening_due`: tarjeta al cuestionario. |
| Hablar con alguien (nueva, `/support`) | `POST /wellbeing/support-requests`; respuestas por `GET /sync/pull` (`channel: support`). |
| Cuestionario (nueva, `/screening`) | `GET /wellbeing/instruments?lang=`, `POST /wellbeing/screenings`. Nunca muestra el puntaje. |
| Tests → Reflejos | `POST /wellbeing/pvt-runs` (`lapses` = respuestas ≥ 355 ms, `mean_rt_ms`, `false_starts`, `trials`, `duration_s`, `device_id`, `before_critical_task`). Muestra **Apto / No confirmado** y el `message`. Stroop, memoria y visión siguen locales. |
| Emergencia (agitar / botón) | `POST /emergency/sessions` (`manual_button`, `client_uuid`, `started_at`, `context.solar_event_active`, `responder_safe`); `joined: true` = te uniste a la abierta. `GET /emergency/sessions/{id}` para refrescar. Cancelar (falsa alarma) solo comandante u oficial médico: `POST /emergency/sessions/{id}/close`. Botón **"Evaluar a la tripulación (triaje)"** → `/triage/[sessionId]` (§10). |
| Triaje (nueva, `/triage/[sessionId]` y `/triage/[sessionId]/assess/[astronautId]`) | `GET /emergency/protocol`, `GET /emergency/sessions/{id}`, `POST …/assessments` → `PUT /emergency/assessments/{id}/answers` → `POST …/complete`, `POST …/heartbeat`, `POST …/questions`, `POST …/close`. Ver §10. |
| Tripulación | Roster: `GET /missions/current` + `GET /missions/{id}/crew`. Salud: solo `GET /crew/status` (404 → "Disponible pronto"). |
| Perfil | Rol de tripulación y usuario del servidor; con API no se cambia de misión. |
| Más → Sincronizar | Fuerza `push` + `pull` y dice cuántos registros quedan. |

## 6. Bienestar y confidencialidad (guía §11)

- Check-in: 4 deslizadores **sin números visibles** (0–100 por dentro): ánimo, **fatiga** (antes "energía"), estrés y **roces con la tripulación** (nuevo, lo exige el backend). Sueño y nota privada opcionales.
- Se muestra solo el `message` del servidor tal cual y la racha (`streak`). Se quitaron `checkInFlags`, los íconos de ánimo coloreados, los "x/5" y "Todo en orden". El historial solo dice "check-in completado".
- Segundo check-in del día = corrección (el servidor responde `supersedes_id`; la app lo indica).
- "Quiero hablar con alguien" siempre visible. Urgencia `later | today | now`, canal `message | session`. Con `now` se muestran las `suggestions` sin insinuar que se avisó a alguien a bordo. Estado por `deliver_at` (en camino / entregada / sin enlace).
- La prueba de reflejos ya no colorea el indicador del cerebro (antes comparaba contra una línea base local): queda "sin evaluar".
- Los síntomas NO son confidenciales: se envían como lectura física y la pantalla lo dice.
- La tripulación nunca ve el bienestar de nadie (tampoco en `/crew/status`).

## 7. Qué se guarda en el servidor y qué queda local

| Dato | Dónde | Por qué |
|---|---|---|
| Lecturas de Medir (FC, PA, SpO₂, FR, temperatura) | Servidor (`/readings`) | Endpoint y reglas del catálogo. |
| Check-in (4 deslizadores, sueño, nota privada) | Servidor (`/wellbeing/checkins`) | Endpoint confidencial; la nota solo la ve el astronauta. |
| Síntomas del check-in con código | Servidor (`SYMPTOM`) | Lectura física del catálogo. |
| Congestión, insomnio | Dispositivo | No existen en `GET /symptoms`. |
| Solicitudes de apoyo | Servidor | Endpoint confidencial. |
| PVT (reflejos) | Servidor (`/pvt-runs`) | Endpoint confidencial. |
| PHQ-2 / GAD-2 | Servidor | Endpoint confidencial; puntaje nunca vuelve. |
| Emergencia crítica | Servidor (`/emergency/sessions`) | Endpoint de triaje. |
| Evaluaciones de triaje, respuestas, latido, preguntas a Tierra | Servidor (`/emergency/*`); copia local mientras no sube | Endpoints del triaje. La copia local (`nullradt-triage-state-v1`) se borra al cerrar sesión. |
| Protocolo de triaje (`GET /emergency/protocol`) y reglas (`GET /rules`) | Dispositivo (caché) | Para evaluar sin conexión. No son datos personales: sobreviven al cierre de sesión. |
| **Alerta de precaución** | **Dispositivo** | No es una emergencia y el contrato no tiene endpoint para ella; mandarla como emergencia sería falso. |
| Nota escrita en la alerta | No se envía | `EmergencySessionCreate` no tiene ese campo. |
| Presión ocular, calcio urinario, fuerza de agarre | Dispositivo ("sin evaluar") | No están en el catálogo. |
| Stroop, memoria, visión (tests) | Dispositivo | Sin endpoint. |
| Rutina, foto de perfil, ajustes | Dispositivo | Sin endpoint. |
| Tokens, `device_id` | SecureStore | Credenciales. |
| Cola offline, cursor, caché de salud y catálogo, racha | AsyncStorage | Offline-first. La caché de salud se borra al cerrar sesión. |

## 8. Sin conexión: cola y sincronización (guía §3)

- Cada registro lleva un `client_uuid` (UUID v4) generado **una vez** al crearlo; se reintenta siempre con el mismo.
- Patrón: se intenta el endpoint en línea; sin red, 5xx o 429 → a la cola con el mismo body (sin `client_uuid`). 4xx → se muestra el error (no se encola), salvo emergencias, que se encolan ante cualquier error.
- Entidades: `reading`, `wellbeing_checkin`, `pvt_run`, `wellbeing_screening`, `support_request`, `emergency_session`, `emergency_confirm`, `emergency_assessment`, `emergency_answer`, `emergency_complete`, `emergency_heartbeat`, `emergency_question`, `emergency_close`.
- Push (`POST /sync/push`): lotes de ≤ 500, emergencias primero en el mismo orden que el servidor (`syncEntities.js`: sesión → "estoy bien" → evaluación → respuestas → completar → latido → preguntas → cierre) y luego por antigüedad. Resultados por posición: `accepted`/`duplicate` → se sacan (y se aplica `result`: evaluación, mensaje, racha, `deliver_at`…); `conflict` → se sacan y se avisa; `rejected` → se sacan y se avisa (`FUTURE_TIMESTAMP` pide revisar la hora), salvo `ENTITY_NOT_SUPPORTED`, que se queda. Error del lote → se conserva y se reintenta.
- Pull (`GET /sync/pull`) con cursor guardado por usuario, repitiendo mientras `has_more`: `evaluations` reemplazan el "sin evaluar" (o lo calculado en el dispositivo, §13) de las lecturas encoladas; `protocol.changed` → `GET /emergency/protocol` y `rules.changed` → `GET /rules?since_version=` (§11, §13); `messages` de `support` van al hilo de la solicitud y los de `escalation` se avisan; se guarda el estado del enlace.
- Cuándo: al entrar a la app, al reconectar la red, al volver a primer plano, cada 3 min, tras enviar algo en cola, desde Más → Sincronizar y en la tarea de segundo plano (~15 min).
- Una emergencia creada **sin sesión** (SOS desde el login) se encola y la sube la próxima sesión que inicie.

## 9. Cómo probar contra Render

1. `.env`: `EXPO_PUBLIC_API_URL=https://astro-health-api-81jd.onrender.com` y `EXPO_PUBLIC_REQUIRE_AUTH=true`.
2. `npx expo start` (o un build). La primera petición puede tardar ~50 s si Render dormía.
3. Astronautas del seed (`backend/db/seeds/001_demo_identidad_triaje.sql`, contraseña `Demo2026!`, datos sintéticos):
   `a.ortega` (ORION, comandante), `k.mensah` (VEGA, oficial médico), `l.tanaka` (LYRA, ingeniería de vuelo) y
   `m.silva` (ATLAS, especialista), que pide **cambio de contraseña** en el primer login (después del reinicio de
   demo vuelve a pedirlo). `dr.reyes` y `mission.control` son del panel web, no de la app.
4. Sin conexión: activa el modo avión, mide o haz el check-in (queda "pendiente de envío"), vuelve a conectar y en Más → Sincronizar.
5. Prueba de humo sin app: `node scripts/check-api.mjs` (o `--api http://IP:3000`). No imprime tokens ni abre emergencias. Deja una lectura `HEART_RATE` normal y el check-in de hoy de ORION (si ya había uno hoy, lo corrige).

> La base de Render es compartida: no abras emergencias de prueba sin avisar (la app sí puede hacerlo; ciérralas como falsa alarma con ORION o VEGA).

## 10. Triaje (guía §10)

**No diagnostica ni receta.** Usa SOLO el protocolo del servidor (`GET /emergency/protocol`, v2): sin preguntas,
umbrales ni textos clínicos propios. Lo que no cubre el protocolo → "Pregunta a Tierra". Sin LLM ni servicios en
la nube: todo funciona sin conexión.

**Entrada.** La alerta crítica (`alert.tsx`, botón o agitar) abre o une la sesión y muestra **"Evaluar a la
tripulación (triaje)"** → `/triage/[sessionId]` (id del servidor, o el `client_uuid` si la sesión quedó en cola o
es modo demo). La alerta ahora pregunta también *"¿Hay un evento solar o alarma de radiación activa?"*: es
`context.solar_event_active` del contrato (`EmergencyContext`); en una apertura manual el servidor no lo infiere y
sin él el protocolo omite su módulo de radiación. "¿Estás bien?" (`AreYouOkCard`) no cambió.

**`/triage/[sessionId]` (sesión).**
1. Carga en dos fases: primero lo guardado en el dispositivo (instantáneo, también sin enlace) y luego
   `GET /emergency/sessions/{id}` (tope 8 s). Muestra estado, hora, misión, versión del protocolo (o "copia de
   respaldo"), "sin enlace", "te uniste" y evento solar.
2. **`responder_safe` primero.** Si es `false` (`next_step: secure_self`) → tarjeta "Ponte a salvo" con el texto
   del protocolo y "Ya estoy a salvo"; si es `null` (activación automática) se pregunta con la pregunta
   `responder_safe` del protocolo. La respuesta dada en el dispositivo viaja con cada evaluación (el servidor la
   copia a la sesión). Hasta que sea `true` no se puede evaluar.
3. **A quién evaluar:** `roster` del servidor (con su `priority_reason`); sin enlace, la tripulación vigente guardada
   (`GET /missions/{id}/crew`, se guarda al iniciar sesión); en demo, la tripulación de la maqueta. Cada uno con su
   clasificación vigente (la última completada; reevaluar = evaluación nueva, la anterior no se borra).
4. **Orden de atención:** `attention_order` del servidor con su `reason`. Sin enlace (o con evaluaciones que aún no
   suben) se calcula en la tableta con la regla `attention_order` **del protocolo** (categorías en su orden,
   radiación probable antes que posible, los no evaluados después de los rojos), marcado "pendiente de confirmar"
   y sin motivo en texto (el motivo lo da el servidor).
5. **Pregunta a Tierra:** `POST /emergency/sessions/{id}/questions` (`client_uuid`, `body`, `asked_at`), con texto o
   dictado (`VoiceNoteInput`). Estado por `deliver_at`: futuro = "En camino, llega a las hh:mm"; `null` o en cola =
   "Pendiente de envío: sin enlace"; pasado = "Entregada a las hh:mm".
6. **Cerrar** (`closed` = atendida, `cancelled` = falsa alarma): solo comandante u oficial médico
   (`canCloseEmergency`, por `crew_role`), manteniendo presionado. Sin enlace queda en cola.
7. **Latido:** `POST /emergency/sessions/{id}/heartbeat` (`sent_at`, `device_id`) cada 30 s mientras una pantalla de
   triaje está enfocada y la sesión activa. Sin enlace se guarda **un solo** latido por sesión en la cola (el último).
8. Al entrar se pide el permiso de micrófono (una vez); si lo niegan, todo funciona con botones.

**`/triage/[sessionId]/assess/[astronautId]` (evaluación).**
- Una pregunta a la vez: la `pending` de `evaluateAssessment(definition, respuestas, session.context)` con el
  protocolo de **la versión de la sesión** (`session.protocol.version`; si no está guardada, `?version=N`; sin red,
  la activa guardada o la copia de respaldo). Botones según el tipo: sí/no → `{ value: bool }`, número →
  `{ value: n }`, opción → `{ choice: "código" }`, varias → `{ choice: [...] }` ("Ninguno" no va con otras, igual
  que valida el servidor). Las etiquetas de las opciones son las palabras del propio protocolo.
- Si el tripulante no responde, la v2 solo pregunta signos observables (`vomiting_observed`,
  `time_to_vomiting_observed`, `consciousness_level`): la app no agrega preguntas, solo sigue `pending`.
- "Atrás" quita la última respuesta del recorrido. Se guarda el borrador (se puede "Continuar").
- Al terminar: clasificación **local en pantalla** y envío **POST assessments → PUT answers → POST complete** con
  `device_result` (`status`, `triage_category`, `radiation_flag`, `rules_version`). Solo se mandan las respuestas del
  recorrido final. **Manda el servidor:** cuando llega su resultado se muestra el suyo; si `matches_device` es
  `false`, se muestra el del servidor, "La tableta calculó otra cosa" y en qué difiere (`mismatch_fields`).
  Avisos: tripulación = inmediato a bordo; Tierra = por `deliver_at`.
- **Sin conexión** (o si la sesión sigue en la cola): todo a la cola existente con `priority: "emergency"` y
  referencias por `client_uuid` (`session_id`, `assessment_id`) (guía §3 y §10). La clasificación local se ve igual,
  marcada "pendiente de confirmar por el servidor". Al sincronizar, el `result` del `emergency_complete` reemplaza la
  clasificación local (y avisa con un toast).
- Errores 4xx (sesión cerrada, respuestas fuera del protocolo) se muestran con "Reintentar"; no se encolan.
- Modo demo: el triaje funciona completo en el dispositivo (sin Tierra, sin latido).

Archivos: `src/app/triage/…`, `src/presentation/features/triage/*` (UI, voz, textos), `domain/entities/Triage.ts`,
`domain/usecases/TriageUseCases.ts` y `triageLocal.ts`, `data/repositories/TriageRepositoryImpl.ts`,
`data/datasources/local/triageLocalDataSource.ts`, `emergencyRemoteDataSource.ts`.

## 11. Motor compartido (mismo evaluador que el backend)

- `src/core/engine/conditions.js` y `src/core/engine/triage.js` son copia **TAL CUAL** (byte a byte) de
  `backend/src/engine/` en **`origin/backend` @ `d511109`** (último cambio del motor en el backend: `2403e85`,
  "style: aplica prettier al backend"). JS puro, sin dependencias. Los `.d.ts` de al lado solo describen su forma
  para TypeScript; **no se editan los `.js`**.
- Copia de respaldo: `src/data/datasources/local/fallback/triage-protocol-v2.json` = protocolo v2 de
  `backend/db/seeds/004_protocolo_triaje_v2.sql` (mismo commit), marcado `"fallback": true`. Solo se usa si la
  app nunca pudo bajar `GET /emergency/protocol` (primer arranque sin red).
- Protocolo guardado por versión (AsyncStorage `nullradt-triage-protocols-v1`): se baja al iniciar sesión, cuando
  el pull dice `protocol.changed` o la versión activa no coincide, y `?version=N` para una sesión con otra versión.
- **Mantenerlo sincronizado** cuando el backend cambie el motor o el protocolo:
  ```bash
  git fetch origin backend
  node scripts/sync-engine.mjs          # copia conditions.js, triage.js y regenera el respaldo v2
  node scripts/triage-parity.mjs        # debe quedar en verde
  ```
  y anota aquí el nuevo commit. `sync-engine.mjs` acepta `--ref <commit>`.
- **Prueba de paridad** `node scripts/triage-parity.mjs` (Node, sin dependencias, sin red): 6 escenarios de
  `backend/test/triage.v2.test.js` y `triage.test.js` con el evaluador de la app → lo que exigen esas pruebas. Si
  hay git y `origin/backend`, además corre los mismos escenarios con el evaluador del backend (leído con
  `git show`, sin escribir archivos) y exige el resultado completo idéntico, y avisa si las copias ya no son
  iguales a las del backend.

## 12. Voz (sin internet)

Flujo por pregunta: **lee** el texto con `speak()` (`src/core/speech/speech.ts`: voces del sistema instaladas,
descarta las `network`; tono `critical`), reemplazando `{call_sign}`; en preguntas de opción lee también las
opciones. Luego **escucha unos segundos** y compara lo dicho, sin IA, con un vocabulario cerrado
(`src/core/speech/closedVocabulary.ts` + `presentation/features/triage/triageLexicon.ts`): texto normalizado
(minúsculas, sin acentos ni signos), sinónimos es/en de sí/no ("sí, si, afirmativo, correcto, yes…" / "no,
negativo…"; "no sé" no cuenta como "no"), las opciones del protocolo con sinónimos simples, números en cifra o en
palabras, y los comandos **"repetir"**, **"botones"**, **"atrás"**. Siempre confirma: *"Entendí: X. ¿Correcto?"*
→ "sí" registra la respuesta con `source: "voice"`, "no" vuelve a preguntar. Si no entiende **2 veces**, lo dice
en voz alta y pasa a botones. **Los botones están siempre visibles**; un toque registra `source: "tap"`
(el contrato admite `voice`). Botones "Repetir" y "Responder por voz" / "Solo botones".

Idioma: el de la app. El protocolo trae los textos en español; en inglés se usa una traducción por
`question_code` **solo si el texto del servidor es exactamente el que se tradujo** (si el servidor lo cambia, se
lee el texto del protocolo): una traducción nunca cambia el significado.

| | Expo Go | Development build |
|---|---|---|
| Leer las preguntas en voz alta (`expo-speech`, offline) | Sí | Sí |
| Escuchar sola después de leer (`expo-speech-recognition`, on-device si `getOfflineSupport` lo permite, `contextualStrings` con las opciones) | No (el módulo nativo no está en Expo Go) | **Sí** |
| Responder por voz | Android: con un toque en "Responder por voz" se abre el reconocedor del sistema (`dictateWithSystem`); sin red funciona solo si el teléfono tiene el paquete de idioma offline. iOS: solo botones | Sí, también sin red con el modelo del idioma instalado (Android 13+: Laboratorio de voz → descargar modelo; iOS: dictado en el dispositivo) |
| Permiso de micrófono | `expo-audio` | `expo-speech-recognition` |

### Development build (APK de Android)

`expo-dev-client` ya está en `package.json` y `eas.json` trae dos perfiles, ambos con distribución interna y APK:

| Perfil | Qué es | JS |
|---|---|---|
| `development` | Development build (`developmentClient: true`): la app con los módulos nativos (`expo-speech-recognition`) y el lanzador del dev client. | Lo sirve Metro desde tu PC (`npx expo start`), con tu `.env` local. |
| `preview` | APK instalable sin dev client ni PC: para probar o presentar en un teléfono. | Va dentro del APK (se fija al compilar). |

**Con EAS (en la nube, desde Windows; no necesita Android Studio).** La cuenta de Expo la decide el equipo: el
repo NO trae `projectId` ni `owner` en `app.json`. La primera vez, quien tenga la cuenta enlaza el proyecto
(`eas init` / el propio `eas build` lo ofrece) y versiona ese cambio de `app.json`.
```bash
npx eas-cli@latest login
```
```bash
npx eas-cli@latest build --platform android --profile development
```
Instala el APK con el QR o el enlace que da EAS y, en la PC (misma red que el teléfono):
```bash
npx expo start
```
Con `expo-dev-client` instalado, `npx expo start` abre el development build; para seguir usando Expo Go:
`npx expo start --go`.

APK independiente (sin Metro):
```bash
npx eas-cli@latest build --platform android --profile preview
```
- El `.env` está en `.gitignore`, así que **EAS no lo sube**: sin variables, el APK `preview` queda en **modo
  demo**. Para que hable con la API, define `EXPO_PUBLIC_API_URL` (y `EXPO_PUBLIC_REQUIRE_AUTH=true`) en el perfil
  (`"env": { … }` en `eas.json`) o como variable de entorno del proyecto en EAS (expo.dev o `eas env`) antes de compilar. Son
  valores públicos (quedan dentro del APK): nunca secretos.
- `eas build --local` no está soportado en Windows (solo macOS/Linux o WSL sin soporte oficial): desde Windows,
  compila en la nube o con `expo run:android`.

**Local, sin EAS (Android Studio + SDK de Android instalados; el plugin `withNdkVersion` fija el NDK
`28.2.13676358`):** con el teléfono por USB y la depuración USB activada,
```bash
npx expo run:android --device
```
Genera `android/` (CNG: está en `.gitignore`, no se versiona ni se edita a mano), compila, instala el development
build y arranca Metro. Vuelve a correrlo solo al agregar una librería nativa o cambiar `app.json`; para cambios de
JS basta `npx expo start`. Para un APK de release local: `npx expo run:android --variant release`.

**Qué cambia en la voz con el development build:**
- Después de leer cada pregunta, la app **escucha sola** unos segundos (no hace falta tocar nada): se pasa de
  "toca para dictar" (Expo Go Android) o "solo botones" (Expo Go iOS) a manos libres.
- El reconocimiento corre **en el dispositivo** cuando `getOfflineSupport` dice que hay modelo del idioma
  (`requiresOnDeviceRecognition`): funciona sin internet. En Android 13+ el modelo se descarga desde el
  Laboratorio de voz; si falta, la tarjeta de voz lo avisa.
- Usa `contextualStrings` con las opciones de la pregunta y comandos ("sí", "no", "repetir", "botones", "atrás") y
  devuelve varias alternativas: entiende mejor el vocabulario cerrado.
- El permiso de micrófono lo pide `expo-speech-recognition` (en Expo Go lo pedía `expo-audio`).
- No cambia: la lectura en voz alta, la confirmación "Entendí: X. ¿Correcto?", el paso a botones tras 2 fallos y
  los botones siempre visibles. Si el modelo offline no está y no hay red, la voz falla y se responde con botones.

## 13. Evaluación sin conexión de las lecturas

- `GET /rules` se guarda con su versión (AsyncStorage `nullradt-rules-v1`), al iniciar sesión y cuando el pull dice
  `rules.changed` (pide solo lo nuevo con `since_version`).
- Sin conexión, una lectura nueva de Medir se evalúa con `evaluateIndicator` de `conditions.js` (mismo motor) y esas
  reglas, con el mismo contexto que el servidor (`ruleContext`: componentes de la lectura + `sex` del perfil).
  Se muestra el nivel y la recomendación **de la regla** con "Calculado en el dispositivo con las reglas del
  servidor, pendiente de confirmar al sincronizar" (y en Cuerpo: "calculado en el dispositivo, pendiente de
  confirmar"). Al sincronizar, la evaluación del servidor (push o pull) la reemplaza.
- **No se adivina:** si alguna regla del indicador usa un campo **derivado** del catálogo (`derived_fields`, que el
  servidor calcula con el historial en `derived.js`: p. ej. `SLEEP_HOURS`, `RAD_DOSE_*`, `BODY_MASS`,
  `EXERCISE_MIN`), si no hay reglas o catálogo guardados, o si el indicador es confidencial, la lectura queda
  **"sin evaluar"**. Las 5 que mide la app (FC, PA, SpO₂, FR, temperatura) no usan derivados.
- La alerta automática ("¿Estás bien?") la sigue abriendo solo el servidor.

## 14. Tripulación

El semáforo de cada compañero se muestra según `physical !== null` de `GET /crew/status`, **no** por el nombre del
rol (el backend usa `crew_medical_officer`). Ya era así; se verificó contra el contrato (`CrewRole` en
`openapi.yaml`). La guía de la rama `backend` (@ `d511109`) no tiene §13. Cerrar una emergencia sí depende del rol
(`commander` o `crew_medical_officer`), como exige el contrato (`x-crew-role`).

## 15. Pendientes

- `GET /crew/status` aún responde 404 en Render: la app muestra "Disponible pronto". La forma esperada está en `apiTypes.ts` (`ApiCrewStatus`).
- Triaje: `prefill` del roster (respuestas sugeridas desde lecturas) todavía no se usa (todo se contesta); "¿Estás bien?" a partir del pull (el contrato no trae sesiones en `/sync/pull`).
- Triaje sin nadie con sesión: credencial de tableta (`X-Device-Credential`, guía §12). Hoy el triaje necesita sesión iniciada (o modo demo).
- PIN sin conexión (`PUT /me/offline-pin`) y acciones del comandante (`/crew/...`).
- Tarjeta del entorno del módulo (`environment` de body-status / `GET /habitat/status`).
- Hilo de mensajes de una alerta (`GET /escalations/{id}/messages`) y bandeja de mensajes de Tierra en pantalla (hoy llegan como aviso).
- La pantalla Medir sigue usando valores simulados del "equipo" (no hay entrada manual de números).
- La cola usa AsyncStorage (como la cola anterior), no SQLite.
- Web (`expo start --web`) no es objetivo: las animaciones de entrada y la intro de marca bloquean la interfaz; el triaje se probó en Node con el código real (ver el mensaje del commit) y compila para Android.
