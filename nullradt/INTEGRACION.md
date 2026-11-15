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
| Emergencia (agitar / botón) | `POST /emergency/sessions` (`manual_button`, `client_uuid`, `started_at`, `responder_safe`); `joined: true` = te uniste a la abierta. `GET /emergency/sessions/{id}` para refrescar. Cancelar (falsa alarma) solo comandante u oficial médico: `POST /emergency/sessions/{id}/close`. |
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
- Entidades: `reading`, `wellbeing_checkin`, `pvt_run`, `wellbeing_screening`, `support_request`, `emergency_session`, `emergency_confirm`, `emergency_close`.
- Push (`POST /sync/push`): lotes de ≤ 500, emergencias primero (sesión → confirmación → cierre) y luego por antigüedad. Resultados por posición: `accepted`/`duplicate` → se sacan (y se aplica `result`: evaluación, mensaje, racha, `deliver_at`…); `conflict` → se sacan y se avisa; `rejected` → se sacan y se avisa (`FUTURE_TIMESTAMP` pide revisar la hora), salvo `ENTITY_NOT_SUPPORTED`, que se queda. Error del lote → se conserva y se reintenta.
- Pull (`GET /sync/pull`) con cursor guardado por usuario, repitiendo mientras `has_more`: `evaluations` reemplazan el "sin evaluar" de las lecturas encoladas; `messages` de `support` van al hilo de la solicitud y los de `escalation` se avisan; se guarda el estado del enlace.
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

## 10. Pendientes

- `GET /crew/status` aún responde 404 en Render: la app muestra "Disponible pronto". La forma esperada está en `apiTypes.ts` (`ApiCrewStatus`).
- Evaluación **sin conexión** con las reglas de `GET /rules` y el mismo motor del servidor (`conditions.js`): hoy una lectura sin red queda "sin evaluar" hasta sincronizar (no se inventan umbrales).
- Flujo de triaje completo (`/emergency/sessions/{id}/assessments`, respuestas, `complete`, latido, preguntas a Tierra) y "¿Estás bien?" a partir del pull: la app solo abre/une la sesión, muestra su estado y confirma "estoy bien" desde Medir.
- PIN sin conexión (`PUT /me/offline-pin`), credencial de tableta (`X-Device-Credential`) y acciones del comandante (`/crew/...`).
- Tarjeta del entorno del módulo (`environment` de body-status / `GET /habitat/status`).
- Hilo de mensajes de una alerta (`GET /escalations/{id}/messages`) y bandeja de mensajes de Tierra en pantalla (hoy llegan como aviso).
- La pantalla Medir sigue usando valores simulados del "equipo" (no hay entrada manual de números).
- La cola usa AsyncStorage (como la cola anterior), no SQLite.
