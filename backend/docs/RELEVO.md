# Relevo del backend

Cierre de la **tarea 12** (API desplegada estable para la demo: configuración endurecida, reinicio de demo, prueba de humo, arranque en frío y plan B), 2026-11-15, rama `backend`. Antes: el tramo 1 cerró las tareas 1–5; el tramo 2, el despliegue y la tarea 6; luego la 7 (simulador), la 8 (sincronización offline), la 9 (triaje), la 10 (bienestar) y la 11 (acceso).

Después de la tarea 12: `GET /crew/status` (pantalla "Tripulación" de la app, contrato v1.7, sin migración). Ver "Pantalla Tripulación".

## Estado

**Endpoints reales** (82 de 86; el resto lleva `x-status-impl: pending` en `docs/openapi.yaml` y sigue en el mock):

| Módulo | Endpoints |
|---|---|
| Sistema | `GET /health` |
| Auth | `POST /auth/login`, `/auth/change-password`, `/auth/refresh`, `/auth/logout`, `GET /me` |
| Cuentas (admin) | `POST /admin/users`, `/admin/users/{id}/reset-password`, `/admin/users/{id}/unlock`, `PATCH /admin/astronauts/{id}` (tarea 8, `sex`) |
| Misión | `GET /missions/{id}/crew` (tarea 8), `GET /crew/status` (v1.7, pantalla "Tripulación") |
| Catálogo | `GET /indicators`, `/indicators/{code}`, `/rules`, `/body-zones`, `/symptoms` |
| Lecturas | `POST /readings`, `GET /me/readings`, `GET /me/body-status` |
| Hábitat | `POST /habitat/readings`, `GET /habitat/status` |
| Tierra (tarea 6) | `GET /admin/dashboard/crew`, `GET /admin/inbox`, `POST /admin/escalations/{id}/ack`, `POST /admin/escalations/{id}/messages`, `GET /escalations/{id}/messages` |
| Misión (tarea 6) | `GET`/`POST /admin/missions`, `PATCH /admin/missions/{id}`, `GET`/`POST /admin/environments`, `PATCH /admin/environments/{code}`, `GET`/`POST /admin/assignments`, `PATCH /admin/assignments/{id}`, `GET`/`POST /admin/comm-outages`, `PATCH /admin/comm-outages/{id}` |
| Simulador (tarea 7, solo demo) | `POST /admin/simulator/history`, `POST /admin/simulator/scenarios/{name}` (`x-status: extra`; 404 sin `SIMULATOR_ENABLED=true`) |
| Demo (tarea 12, solo demo) | `POST /admin/demo/reset` (`x-status: extra`, solo admin; 404 fuera del modo demo; `{ "confirm": "ARES-1" }`) |
| Sync (tarea 8) | `POST /sync/push`, `GET /sync/pull` |
| Emergencia (tarea 9) | `GET /emergency/protocol`, `POST /emergency/sessions`, `GET /emergency/sessions/{id}`, `POST /emergency/sessions/{id}/assessments`, `/confirm`, `/heartbeat`, `/questions`, `/close`, `PUT /emergency/assessments/{id}/answers`, `POST /emergency/assessments/{id}/complete` |
| Emergencias en Tierra (tarea 9) | `GET /admin/emergencies`, `GET /admin/emergencies/{id}` |
| Bienestar (tarea 10) | `POST /wellbeing/checkins`, `GET /wellbeing/instruments`, `POST /wellbeing/screenings`, `POST /wellbeing/pvt-runs`, `POST /wellbeing/support-requests`, `GET /wellbeing/support-requests/{id}/messages`, `GET /me/wellbeing` |
| Acceso (tarea 11) | `GET /admin/audit/confidential-access` (solo behavioral_health), `GET /me/confidential-access` (nuevo, el astronauta), `GET`/`POST /admin/devices` (el `GET` es nuevo), `POST /admin/devices/{id}/revoke`, `POST /crew/users/{id}/unlock`, `POST /crew/users/{id}/reset-pin`, `POST /crew/devices`, `PUT /me/offline-pin`, `GET /admin/audit/delegated-actions`, `GET /missions/current`; `X-Device-Credential` en las rutas del triaje |
| Salud conductual y cumplimiento (tarea 10) | `GET /admin/behavioral/inbox`, `GET /admin/behavioral/astronauts/{id}`, `POST /admin/behavioral/support-requests/{id}/messages`, `/ack`, `/close`, `POST /admin/behavioral/escalations/{id}/ack`, `/close` (nuevas), `GET /admin/compliance` |

**Piezas:**
- **Catálogo**: 26 indicadores (9 confidenciales), 112 reglas y 43 fuentes (`docs/catalogo-indicadores.json`, generado con `tools/build_catalog.py`).
- **Motor**:
  - evaluador común `src/engine/conditions.js` (semáforo y triaje);
  - campos derivados en `src/engine/derived.js` (puro);
  - servicio de evaluación `src/services/evaluation.service.js`;
  - triaje `src/engine/triage.js`.
- **Contrato**: `docs/openapi.yaml` v1.7 (86 operaciones; los cambios de cada versión, en la sección "Cambios" de `info.description`). Mock con `npm run api:mock`, guía en `docs/api-guia-frontend.md`. `npm run api:lint`: 0 errores (las 4 advertencias de siempre). Las respuestas reales de bienestar se validaron con `prism proxy --errors`: sin violaciones.
- **Base de datos**:
  - migraciones 000–013 (48 tablas; la 008 agrega índices de escalamiento, la 009 `astronauts.sex`, la 010 completa `sync_batches` / `sync_items`, la 011 los estados `pending` y `merged` de la emergencia, la 012 el triaje, la 013 el bienestar: `wellbeing_checkins.supersedes_id`, `closed_by` y un índice de la bandeja conductual, y la 014 el acceso: tipos nuevos de `auth_events` e índice de `delegated_actions`) y seeds 001–004 (la 004 es el protocolo de triaje v2; la tarea 10 no agregó seed);
  - el seed del catálogo se genera con `node tools/build_catalog_seed.js` (`--check` avisa si quedó desactualizado).
- **Permisos**:
  - `src/middlewares/auth.js`: `authenticate`, `requireRole`, `requireCrewRole` y la lista blanca del rol `service`;
  - `src/services/accessPolicy.js`: `canAccess`, `enforceAccess` y la bitácora confidencial.
- **Pruebas**: `node --test` (`npm test`) → **458 de 458**, sin saltadas, contra la base de pruebas `astro_health_test`. Incluyen la matriz de permisos (con las vistas `crew_status` y `crew_physical`), los derivados, el catálogo, el enrutamiento de escalamientos (unitarias, 8), el simulador (unitarias 15, apagado 1), `sex` (unitarias 5), sync (unitarias 5), el protocolo v2 (unitarias 7), bienestar (unitarias 7), acceso (unitarias 3), configuración y logs (12, tarea 12: JWT y CORS en producción, el servidor que no arranca, iteraciones del PIN, modo demo, CORS en la app, logs sin secretos y las negativas del CLI) y las suites de base de datos (humo 4, autenticación 14, semáforo 15, escalamiento y panel 16, simulador 9, `sex` 6, sync 12, triaje 12, bienestar 14, acceso 15, reinicio de demo 5, pantalla Tripulación 7). Si la base de pruebas no existe, esas suites se saltan con el comando para crearla.
- **Escalamiento** (tarea 6):
  - `src/services/escalation.service.js`: enrutamiento por categoría y prioridad;
  - `src/services/escalationDelivery.service.js`: queued → delivered y recálculo de `deliver_at` por cortes;
  - `src/services/escalationInbox.service.js`: bandeja, acuse y mensajes (Tierra y a bordo);
  - `src/services/dashboard.service.js`: dashboard físico de la tripulación;
  - `src/services/missionAdmin.service.js`: misiones, entornos, asignaciones y cortes.
- **Simulador** (tarea 7): generador puro en `src/simulator/` (`random.js`, `profiles.js`, `history.js`, `scenarios.js`) y escritura en `src/services/simulator.service.js`, que usa los servicios reales (`readings.service`, `habitat.service` y el nuevo `wellbeingRecorder.js`). CLI `scripts/simulate.js`. Ver "Simulador (demo)".
- **Sync** (tarea 8): `src/services/syncPush.service.js` (lote, orden, reloj, conflictos e historial), `src/services/syncEntities.js` (registro de tipos → servicios reales; extensible para el triaje), `src/services/syncPull.service.js` (cursor por flujos) y `src/models/sync.model.js`. Ver "Sincronización offline".
- **Triaje** (tarea 9): `src/services/emergency.service.js` (activación, hombre muerto, latido, preguntas, cierre y reporte), `src/services/triageAssessment.service.js` (evaluación y comparación dispositivo/servidor), `src/services/emergencyGround.service.js` (panel), `src/services/triageView.js` (orden de atención y roster, puro), `src/services/emergencyCommon.js` (actor, escalamientos y formas) y `src/models/emergency.model.js`. Ver "Modo emergencia (triaje)".
- **Pantalla Tripulación** (v1.7): `src/services/crewStatus.service.js` (roster, emergencia abierta, alertas a bordo y semáforo del CMO), `src/models/crewStatus.model.js` y la ruta en `crew.routes.js`. La regla está en `canAccess` (vistas `crew_status` y `crew_physical`). Ver "Pantalla Tripulación".
- **Acceso** (tarea 11): `src/services/devices.service.js` (credencial de tableta, alta, lista y revocación, límite de fallos por IP), `src/middlewares/auth.js` (`authenticateUserOrDevice`, `requireRoleOrDevice`), `src/services/delegation.service.js` (mapa de capacidades del comandante y auditoría), `src/services/offlinePin.service.js` (PIN sin conexión), `src/models/{devices,delegated}.model.js` y las rutas `admin.devices.routes.js` y `crew.routes.js`. Ver "Acceso".
- **Bienestar** (tarea 10): `src/services/wellbeing.service.js` (check-in, cuestionarios, PVT, instrumentos e historial propio; lo usan las rutas y `/sync/push`), `src/services/wellbeingRecorder.js` (grupos de lecturas y check-in por día), `src/services/supportRequest.service.js` ("Quiero hablar con alguien"), `src/services/behavioral.service.js` (bandeja, detalle, acuse, cierre y cumplimiento), `src/models/{wellbeing,support,behavioral}.model.js` y las rutas `wellbeing.routes.js` y `behavioral.routes.js`. Ver "Bienestar".
- **Despliegue**: `render.yaml` (Blueprint de Render) en la raíz del repo; arranque con `npm run start:deploy` (migra, siembra la demo si `DEMO_SEED=true` y arranca). Ver "Despliegue (Render)".
- **Demo estable** (tarea 12): `src/config/loadEnv.js` (validación pura de las variables; `env.js` termina el proceso si falla), `src/utils/safeLog.js` y `src/middlewares/requestLog.js` (logs sin secretos ni datos de salud), `src/services/demoReset.service.js` + `src/models/demoReset.model.js` (reinicio de demo, ruta `admin.demo.routes.js` y CLI `scripts/demoReset.js`) y `scripts/smoke.js` (prueba de humo). Ver "Día de la demo".

## Cómo levantar el proyecto

Requisitos: Node 20+ (`.nvmrc`) y PostgreSQL 16+ (local, p. ej. el 18 en Windows) o Docker. Todo se ejecuta dentro de `backend/`.

1. Copia `.env.example` a `.env`. Los valores de desarrollo ya sirven: usuario `astro`, contraseña `astro_dev`, base `astro_health`; deja `JWT_SECRET` vacío en desarrollo.
2. Crea la base de desarrollo:
   - **PostgreSQL local**, como `postgres`:
     ```sql
     CREATE ROLE astro LOGIN PASSWORD 'astro_dev';
     CREATE DATABASE astro_health OWNER astro;
     ```
   - **Docker**: `npm run db:up` (`docker-compose.yml`, PostgreSQL 16; ahí `astro` es superusuario).
3. Crea la base de pruebas (una vez): `CREATE DATABASE astro_health_test OWNER astro;`. En Windows:
   ```bash
   "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -c "CREATE DATABASE astro_health_test OWNER astro"
   ```
   Con Docker, o si `astro` tiene `CREATEDB`, la crean las propias pruebas.
4. Arranca:
   ```bash
   npm i
   npm run db:reset    # migraciones 000–014 + seeds (solo la base de desarrollo)
   npm run dev         # http://localhost:3000/api/v1/health · Swagger en /api/docs
   ```
5. Verifica: `node --test`, `npx eslint .`, `npx prettier --check .` y `npm run api:lint`.
   - Finales de línea: `.gitattributes` (raíz) fuerza LF en el repo y en la copia de trabajo, aunque la máquina tenga `core.autocrlf=true`. Después de este cambio, cada uno hace `git pull` y, si ve archivos modificados solo por finales de línea, `git checkout -- .` (descarta cambios sin commit: guarda antes los tuyos). Si `prettier --check` sigue marcando todo, vuelve a sacar los archivos: `git rm -r --cached -q . && git reset --hard` (con el árbol limpio).
   - Si ya tenías la base de desarrollo, aplica la migración nueva con `npm run db:migrate` (no hace falta `db:reset`).
6. Mock para los frontends: `npm run api:mock` (`:4010`).
7. Si cambias el catálogo: `python tools/build_catalog.py`, luego `node tools/build_catalog_seed.js` y `npm run db:reset`.

## Despliegue (Render)

> La API desplegada usa los **datos sintéticos** del seed (los mismos usuarios con `Demo2026!`). Nunca cargues datos reales ahí.

**URL pública**: `https://astro-health-api-81jd.onrender.com`
- API: `https://astro-health-api-81jd.onrender.com/api/v1` (salud en `/api/v1/health`: `"status":"ok"` y `"db":"up"`).
- Swagger: `https://astro-health-api-81jd.onrender.com/api/docs`.
- Auto-deploy desde la rama `backend`: cada push despliega. Para confirmar qué commit corre, mira *Events* en el panel del servicio.
- **Logs**: panel de Render → servicio `astro-health-api` → *Logs* (salida del arranque: migraciones, seed y errores). Los fallos de build o de health check salen en *Events* → el deploy → *View logs*.
- **Se duerme**: en el plan gratuito, tras ~15 min sin tráfico. La primera petición tarda ~50 s; llama a `/api/v1/health` antes de una demo.

**Cómo funciona**:
- `render.yaml` (raíz del repo) crea la base `astro-health-db` (PostgreSQL 16, plan free) y el servicio web `astro-health-api` (Node 20, `rootDir: backend`, rama `backend`).
- Build: `npm ci`. Start: `npm run start:deploy` → `scripts/start.js`: migraciones pendientes, seed de demo solo con `DEMO_SEED=true` y servidor. El plan gratuito no tiene pre-deploy, por eso se migra al arrancar. El seed es idempotente (`ON CONFLICT DO NOTHING`); el del catálogo vuelve a dejar las reglas del JSON.
- Health check: `/api/v1/health` (503 si la base no responde).

**Variables de entorno** (todas, con su valor por defecto, en `.env.example`; las que no están aquí no hace falta ponerlas en Render):

| Variable | Valor en Render | Notas |
|---|---|---|
| `NODE_ENV` | `production` | Activa `trust proxy`, exige `JWT_SECRET` fuerte y `CORS_ORIGIN` sin `*` (si no, el servidor no arranca y el deploy falla: Render sigue sirviendo el anterior). |
| `DATABASE_URL` | la *Internal Database URL* de Render | Reemplaza a las `DB_*`. |
| `DB_SSL` | `no-verify` | `false` si la base no acepta SSL; `true` verifica el certificado. |
| `JWT_SECRET` | aleatorio, ≥ 32 caracteres | El Blueprint lo genera (`generateValue`). Rechaza el de desarrollo, los de ejemplo ("changeme", "secret"...) y los de pocos caracteres distintos. A mano: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. |
| `CORS_ORIGIN` | orígenes del panel y de Expo web, separados por coma | Nunca `*` en producción. `esquema://host[:puerto]` sin ruta. El Blueprint ya no lo fija (`sync: false`): se pone en el panel. |
| `TRUST_PROXY` | `1` | Saltos de proxy; el rate limit ve la IP real del cliente. |
| `DEMO_SEED` | `true` | Solo en el despliegue de demo. Sin la bandera, `seed.js` se niega con `NODE_ENV=production`. |
| `SIMULATOR_ENABLED` | `true` | Activa `POST /admin/simulator/*` y, con `DEMO_SEED=true`, `POST /admin/demo/reset` (sin ellas, 404). El plan gratuito no tiene consola: se usan por estos endpoints. |
| `NODE_VERSION` | `20` | |
| `OFFLINE_PIN_PBKDF2_ITERATIONS` | (por defecto 600000) | Iteraciones del verificador local del PIN (mín. 10 000). Bajarla solo si la app tarda demasiado. |
| `TRIAGE_*`, `SYNC_*`, `WELLBEING_*`, `LOCKOUT_*`, `RATE_LIMIT_*`, `OFFLINE_UNLOCK_DAYS`, `JWT_*_TTL`, `TEMP_PASSWORD_LENGTH`, `EXERCISE_WEEKLY_PRESCRIPTION_MIN` | (por defecto) | Valores pensados para la demo. |

`PORT` lo pone Render.

**Lista para el panel de Render** (tarea 12; nada de esto lo hace el código). **Antes del push**, porque con `NODE_ENV=production` el servidor nuevo no arranca con `CORS_ORIGIN=*`:
1. Servicio `astro-health-api` → *Environment*: `CORS_ORIGIN` = los orígenes reales del panel y de Expo web (p. ej. `https://panel.example.com,http://localhost:5173,http://localhost:8081`; pendiente que los frontends confirmen los suyos). Guardar.
2. En la misma pantalla: confirmar `SIMULATOR_ENABLED=true`, `DEMO_SEED=true`, `NODE_ENV=production`, `TRUST_PROXY=1` y que `JWT_SECRET` exista (generado, ≥ 32 caracteres). Si alguna falta, agregarla.
3. *Settings* → *Health Check Path*: `/api/v1/health` (debe estar así por el Blueprint; confirmarlo).
4. Push de `backend` → *Events*: el deploy termina en *Live* y `GET /api/v1/health` responde `"status":"ok","db":"up"`. Si falla, *Logs* muestra la línea `[env] ...` con el motivo (nunca el valor de un secreto).
5. Si el servicio se creó desde el Blueprint y Render ofrece sincronizarlo tras el push: `CORS_ORIGIN` quedó con `sync: false` (no la pisa).
6. Base `astro-health-db` → anotar la fecha de expiración del plan gratuito (30 días desde que se creó) y hacer el respaldo antes de la demo (README → "Respaldo").

**Límites del plan gratuito**: el servicio se duerme tras ~15 min sin tráfico (la primera petición tarda ~50 s) y la base gratuita expira a los 30 días. El rate limit es en memoria: una sola instancia.

**Railway** (si Render falla): mismo código. Crea un PostgreSQL y un servicio desde el repo con *Root Directory* `backend`, *Start Command* `npm run start:deploy`, y las variables de arriba (`DATABASE_URL=${{Postgres.DATABASE_URL}}`; si no conecta, prueba `DB_SSL=false`). El plan B más rápido es la API local con ngrok (README).

## Día de la demo

Comandos completos (Git Bash y PowerShell) en el README, sección "Día de la demo".

1. **Despertar**: abrir `https://astro-health-api-81jd.onrender.com/api/v1/health` unos minutos antes (~50 s la primera vez).
2. **Prueba de humo**: `npm run smoke -- --base=https://astro-health-api-81jd.onrender.com/api/v1` (~1.5 min; tabla de pasos, código 1 si algo falla).
3. **Reinicio de demo**: `POST /admin/demo/reset` con `{"confirm":"ARES-1"}` como `mission.control`. Revisar `fitness` (3 `fit`, ATLAS `not_confirmed`) y que `panel_flags` no traiga `critical`.
4. **Respaldo**: `pg_dump` de la *External Database URL* (README → "Respaldo").
5. **Plan B**: API local + `ngrok http 3000` (README → "Plan B"); la app cambia `EXPO_PUBLIC_API_URL` y el panel su URL base.

**Reinicio de demo** (`demoReset.service.js`; endpoint y `npm run demo:reset -- --confirm ARES-1`). Orden y por qué:
1. Marca la historia como cargada **antes** de tocar nada: el check-in perdido cuenta desde ahora. Si la API dormía o la última historia es de hace días, el barrido de 15 s veía > 30 h sin check-in y abría emergencias en cuanto la API despertaba (o a mitad de la recarga).
2. Usuarios del seed (ids fijos de los seeds 001 y 003): activos, sin intentos ni bloqueo (`account_unlocked` si estaban bloqueados); si la contraseña ya no es `Demo2026!`, se restaura (`password_reset`, refresh tokens revocados, `password_changed_at` nuevo: sus access tokens dejan de servir); `must_change_password` como en el seed (solo ATLAS). Va antes de la historia: un astronauta desactivado no saldría en la tripulación vigente.
3. Historia de 14 días hasta ahora por `loadHistory` (idempotente; vuelve a marcar la hora al terminar).
4. Emergencias `pending`/`active` → `cancelled` con `close_notes`, evento `closed` (actor = el admin) y reporte, sin escalar a Tierra. Un plazo de "estoy bien" pendiente de esas sesiones solo agrega luego su evento `deadman_expired` (la sesión ya no se activa).
5. Cortes en curso → `ends_at = ahora` por `missionAdmin.updateOutage` (recalcula `deliver_at`). Los programados a futuro no se tocan (`scheduled_left`).
6. Escalamientos y solicitudes de apoyo abiertos de ARES-1 → `closed` (`closed_by` = el admin, null desde la terminal). Después de las emergencias: una activación que el barrido hizo justo antes también deja escalamientos. La respuesta solo cuenta los físicos y de emergencia.
7. Aptitud: PVT en descanso de ahora en `TAB-1` con el valor del medio de la línea base del perfil para todos menos uno → 3 `fit`. Queda `not_confirmed` el primero de ATLAS, LYRA, VEGA, ORION sin PVT apta reciente (normalmente ATLAS; LYRA si la historia le dio a ATLAS su PVT semanal de las 09:00 dentro de las 12 h). Si los 4 ya tenían una, lo dice en `notes`.
- Un reinicio a la vez (advisory lock; 409 `DEMO_RESET_RUNNING`). Local: ~3 s con la historia ya cargada, ~8 s la primera vez.
- **No se puede limpiar sin borrar** (append-only): lecturas y evaluaciones de escenarios y pruebas de humo, la línea de tiempo de las emergencias, `auth_events`, `confidential_access_log`, `delegated_actions`, `sync_batches`/`sync_items`. El dashboard muestra la **última** lectura vigente por indicador: un `SYMPTOM` o una fiebre de un escenario ensayado sigue en rojo/ámbar hasta que llegue una lectura más nueva (los signos vitales se renuevan con la historia del día siguiente; `SYMPTOM` no tiene historia). `panel_flags` lo muestra. Si queda un `critical`: no ensayar escenarios en Render antes de la demo o, si ya pasó, recrear la base (Blueprint + `DEMO_SEED=true`) y reiniciar.

**Prueba de humo** (`scripts/smoke.js`, parte del script de la tarea 10): la base es compartida, así que no abre emergencias (la SpO₂ crítica se mide hace 4 h, más que `TRIAGE_AUTO_READING_MAX_AGE_MIN`, y se corrige enseguida para que el panel no la muestre), usa `client_uuid` nuevos en cada corrida, el lote de `/sync/push` es el ejemplo (idempotente; el `device_id` del sobre es el de la sesión) y cierra su solicitud de apoyo. Deja el escalamiento de la SpO₂ (el reinicio lo cierra), un check-in de hoy de ORION y una FC normal. Nunca imprime tokens (las respuestas que muestra pasan por `redact`). Por eso el orden del día de la demo es humo → reinicio.

## Simulador (demo)

Datos **sintéticos** de ARES-1 para que la demo tenga historia y escenarios en vivo. Todo pasa por los servicios reales (validación, reglas activas, derivados, escalamientos) como el usuario que lo registraría: cada astronauta (`recorded_by` = su usuario) y `svc.habitat` para el hábitat. Nada de SQL directo a `readings`; todo con `synthetic = true`.

**Historia normal** (`days`, por defecto 14, máx. 60; `seed`, por defecto 42):
- por astronauta y día: check-in 07:00 (WB_* y sueño), signos vitales 07:25 (presión, FC en reposo, FR, SpO₂, temperatura), ejercicio 18:00 y dosis de radiación diaria y acumulada 23:45; glucosa en ayunas cada 2–3 días, masa semanal, PVT semanal (más 3 corridas de línea base en los días 1–3 de la misión) y PHQ-2/GAD-2 cada 2 semanas;
- hábitat: HAB-1 (hh:05) y HAB-2 (hh:35) cada hora, con CO₂, temperatura, humedad y ruido (`period` sleep de 22:00 a 06:00 UTC);
- valores alrededor de una línea base por astronauta dentro de la banda normal: ningún crítico ni escalamiento, solo alguna precaución de autocuidado (presión ≥ 120, sueño < 7 h, glucosa ≥ 100);
- **idempotente**: valor y `client_uuid` salen de semilla + sujeto + indicador + fecha (UUID versión 8 derivado de SHA-256). Correrla otra vez da todo `duplicate`; más tarde el mismo día solo agrega las horas nuevas. Local: ~11 s para ~3300 lecturas.

**Escenarios** (`POST /admin/simulator/scenarios/{name}`, body opcional `{ astronaut, module_id, intensity: low|high, contagion }`), "ahora" encima de la historia:

| Escenario | Qué crea | Resultado esperado |
|---|---|---|
| `solar_event` | Dosímetro de toda la tripulación con `event_active`, 3 lecturas en 90 min. Con `astronaut`, ese tripulante reporta náusea en el pico. | `RAD_DOSE_DAILY` caution (doble de la mediana → crew; evento ≥ 125 mSv → flight surgeon). `high`: ≥ 250 mSv → critical. Náusea → critical. |
| `crew_illness` | `astronaut` (LYRA): 38.4 °C, FC 112, tos y sensación de fiebre. `contagion: true`: empezó ayer y un segundo tripulante enferma hoy. | `BODY_TEMP`, `HEART_RATE` y `SYMPTOM` en caution → crew. `high`: 39.6 °C → critical (flight surgeon + crew). |
| `co2_spike` | `module_id` (HAB-1): 6 lecturas en 50 min, de 2.4 a 5.2 mmHg (`high`: hasta 10.8). | `HAB_CO2` caution → crew. `high`: ≥ 10 → critical → flight surgeon. |
| `wellbeing_decline` | `astronaut` (ATLAS): 5 check-ins seguidos peores (corrige los de la historia con `supersedes_uuid`). `high`: PHQ-2 = 4 y GAD-2 = 3. Al final, una solicitud de apoyo con urgencia `now` (tarea 10). | Escalamiento **confidencial** a `behavioral_health` (WB_*, y PHQ-2/GAD-2 en `high`) y la solicitud, visibles en `GET /admin/behavioral/inbox` 90 s después. Nunca a la tripulación ni a admin (el resumen no la cuenta). |
| `emergency_solar` (tarea 9) | Evento solar en los dosímetros de todos; VEGA y `astronaut` (LYRA) con náusea; el comandante evalúa a VEGA, LYRA (no responde) y ATLAS; corte de enlace con una pregunta y el cierre en cola; luego se cierra el corte. | Activación automática por lectura crítica → hombre muerto vencido (el barrido se adelanta `TRIAGE_DEADMAN_S`) → LYRA rojo y primero en el orden de atención; dispositivo = servidor; el reporte sale al cerrar el corte (llega tras 90 s). Si ya había una sesión abierta, se une a ella. |
| `offline_batch` (tarea 8) | `astronaut` (ORION): ~24 h sin conexión en `TAB-1`, empujadas por `POST /sync/push` (13 items: vitales, ejercicio, check-in, PVT, un SpO₂ 89 % de hace 6 h, una presión corregida con `supersedes_uuid` y un duplicado). | 12 `accepted` + 1 `duplicate`. El SpO₂ se procesa primero, llega con `late_sync` y escala desde la recepción (flight surgeon + crew). Mismo minuto → todo `duplicate`. |

- El resumen trae lecturas creadas/duplicadas, niveles por indicador **estándar** y escalamientos no confidenciales por destino. De bienestar solo cuenta registros: nunca niveles ni escalamientos (admin no puede verlos).
- Un reintento en el mismo minuto no duplica; dispararlo más tarde crea un episodio nuevo. `solar_event` repetido acumula la dosis del evento (sigue la racha de `event_active`) y deja una `RAD_DOSE_CUM` por tripulante = acumulada previa + dosis del evento; la historia que se cargue después suma también esas dosis de evento a su acumulada.
- Las alertas a `flight_surgeon` aparecen en `GET /admin/inbox` tras el retraso de ARES-1 (90 s).

**Cómo correrlo**:
- Local (CLI, usa la base de `.env`, no necesita `SIMULATOR_ENABLED`):
  ```bash
  npm run sim:history -- --days 14 --seed 42
  npm run sim:scenario -- solar_event --astronaut VEGA --intensity high
  npm run sim:scenario -- crew_illness --contagion
  npm run sim:scenario -- co2_spike --module HAB-2
  npm run sim:scenario -- wellbeing_decline --astronaut ATLAS
  npm run sim:offline-batch -- --astronaut ORION      # = sim:scenario -- offline_batch
  npm run sim:emergency -- --astronaut LYRA           # = sim:scenario -- emergency_solar
  # --out docs/examples/emergency-session.json guarda el reporte que recibe Tierra
  # Solo arma el lote (sin base), p. ej. para regenerar el ejemplo del contrato:
  npm run sim:offline-batch -- --dry-run --now 2026-11-14T08:00:00Z --out docs/examples/sync-push.json
  ```
- Render (sin consola): con `SIMULATOR_ENABLED=true`, como `mission.control`:
  ```bash
  API=https://astro-health-api-81jd.onrender.com/api/v1
  TOKEN=$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json' \
    -d '{"username":"mission.control","password":"Demo2026!","device_id":"demo-console"}' \
    | node -pe 'JSON.parse(require("fs").readFileSync(0)).access_token')
  curl -s -X POST $API/admin/simulator/history -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' -d '{"days":14,"seed":42}'
  curl -s -X POST $API/admin/simulator/scenarios/co2_spike -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' -d '{"module_id":"HAB-1","intensity":"high"}'
  ```
  La historia tarda unos segundos (en Render, hasta ~1 min; si el servicio dormía, súmale ~50 s).

## Sincronización offline

La app guarda todo en SQLite sin conexión y al reconectar sube lotes (`POST /sync/push`) y baja cambios (`GET /sync/pull`). Guía para la app: `docs/api-guia-frontend.md` §3.

**Push** (`syncPush.service.js`):
1. Sobre del lote: `device_id`, `sent_at`, 1–`SYNC_MAX_BATCH` items (más → 413 antes de tocar nada).
2. Solo `astronaut` con asignación; el `device_id` debe ser suyo: el `did` de su sesión, uno con refresh token o PIN offline suyo, o una tableta activa de su misión (`devices.label`). Si no, 403 `DEVICE_NOT_OWNED`.
3. Se crea la fila de `sync_batches` (con `clock_offset_ms` = recepción − `sent_at`).
4. Cada item: sobre (`client_uuid`, `entity`, `priority`, `created_at`, `payload`), handler del registro (`syncEntities.js`) y hash SHA-256 del payload canónico (claves ordenadas, fechas ISO normalizadas; sin `created_at` ni `priority`).
5. Orden: rango 0 `priority: emergency`, 1 crítico (reglas activas con los valores del payload y `sex`, sin derivados), 2 el resto; dentro, por `measured_at` (o `created_at`); una corrección baja el rango de su original del mismo lote y los originales van antes que las correcciones.
6. Por item, en su propia transacción (la del servicio): futuro → `FUTURE_TIMESTAMP`; hash distinto al aceptado antes → `PAYLOAD_MISMATCH`; si no, el servicio real (`createReading`, `createHabitatReadings`, `wellbeingRecorder`). Un 409 del servicio → `conflict` (`SUPERSEDE_CONFLICT` si es por `supersedes_uuid`); otro error → `rejected` (un error inesperado también: `INTERNAL_ERROR`, sin tumbar el lote).
7. `sync_items` registra cada item procesado (estado, `server_id`, código de error, hash, `late_sync`, `lag_s`) y al final se guardan los conteos y la duración del lote.

**Pull** (`syncPull.service.js`): cuatro flujos keyset (marca, id) — evaluaciones de sus lecturas estándar, sus escalamientos no confidenciales ya entregados, mensajes de Tierra entregados y respuestas a sus solicitudes de apoyo — mezclados por fecha hasta `limit`. El cursor (base64url) guarda la marca de cada flujo y las versiones de reglas, protocolo, catálogo y misión (`changed`). Solo lee hasta `now() − SYNC_PULL_SETTLE_MS`.

**Ejemplo**: `docs/examples/sync-push.json` (el lote de `offline_batch` con `--now 2026-11-14T08:00:00Z`; una prueba lo empuja tal cual).

**Curl contra Render** (como astronauta; desde `backend/`):
```bash
API=https://astro-health-api-81jd.onrender.com/api/v1
ATOKEN=$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"a.ortega","password":"Demo2026!","device_id":"demo-ipad"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).access_token')
curl -s -X POST $API/sync/push -H "Authorization: Bearer $ATOKEN" \
  -H 'Content-Type: application/json' -d @docs/examples/sync-push.json
curl -s "$API/sync/pull?limit=50" -H "Authorization: Bearer $ATOKEN"
```

## Modo emergencia (triaje)

Sin depender de Tierra: la tripulación abre una emergencia, evalúa a cada tripulante con el protocolo (START adaptado + radiación) y obtiene el orden de atención; Tierra recibe todo con el retraso y los cortes del enlace. Guía para la app y el panel: `docs/api-guia-frontend.md` §10.

**Protocolo**: `crew_emergency` **v2** activo (seed 004; la v1 queda igual e inactiva). Si el tripulante no responde, el módulo de radiación solo pregunta signos observables (vómito visto, cuándo, conciencia ACVPU). `auto_activation` (qué lecturas críticas abren la emergencia) y `attention_order` son datos del protocolo, marcados `basis: design_rule`. Ningún umbral nuevo.

**Ciclo de una sesión**:
1. **Activación**:
   - manual (`POST /emergency/sessions`, cualquier astronauta de la misión): nace `active` y escala a bordo (`crew`) y a Tierra (`flight_surgeon`);
   - automática por lectura crítica (`readings.service` → `onCriticalReading`, también por `/sync/push`): de los indicadores de `auto_activation`, medida hace menos de `TRIAGE_AUTO_READING_MAX_AGE_MIN`;
   - automática por check-in perdido (`detectMissedCheckins`): más de `TRIAGE_AUTO_MISSED_CHECKIN_H` sin check-in, contando desde la última carga de la historia del simulador (`system_markers`) o `TRIAGE_AUTO_SINCE`; sin ninguna, no se detecta. Una vez por ausencia.
2. **Hombre muerto** (solo automáticas): nace `pending` con un plazo por tripulante afectado (`emergency_deadman`, `TRIAGE_DEADMAN_S`). "Estoy bien" de todos → `cancelled`. Plazo vencido → `sweepDeadman` la activa, avisa a bordo y escala a Tierra. Empezar a evaluar o un botón manual también la activan.
3. **Una sola sesión abierta** (`pending` | `active`) por misión (índice único). Otra activación se une: fila `merged` con `merged_into` + evento `joined`.
4. **Evaluación**: respuestas de vocabulario cerrado; al completar, `evaluateAssessment` con la versión del protocolo de la evaluación. Escala según el protocolo y siempre a `flight_surgeon`. Reevaluación append-only.
5. **Tierra**: cada evento de la línea de tiempo (`emergency_events`) lleva `deliver_at` (con cortes); el panel solo ve lo que llegó. Al cerrar (comandante o CMO): escalamiento + reporte (`emergency_reports`), visible cuando llega el evento `closed`.
6. **Preguntas fuera del protocolo**: `POST /emergency/sessions/{id}/questions` → mensaje `to_earth` en el hilo de la sesión. La respuesta de Tierra llega a toda la tripulación por `/sync/pull`.

**Barrido** (`runTriageSweep` = `detectMissedCheckins` + `sweepDeadman`, reloj inyectable): intervalo del servidor (`TRIAGE_SWEEP_INTERVAL_S`) y al leer una sesión, el panel de emergencias o la bandeja (Render se duerme). Cada cambio es un UPDATE condicional (`... WHERE expired_at IS NULL RETURNING`), así que dos barridos a la vez no disparan dos veces.

**Ejemplo**: `docs/examples/emergency-session.json` (el reporte de `emergency_solar`).

**Contra Render**: ver `docs/api-guia-frontend.md` §10 (Git Bash y PowerShell; los dos se probaron contra la API local) y `npm run sim:emergency` / `POST /admin/simulator/scenarios/emergency_solar` para la demo.

## Bienestar

Check-in diario de 20 s, cuestionarios breves, prueba de reacción y "Quiero hablar con alguien". **No diagnostica**: al astronauta solo le llegan los mensajes neutros de las reglas del catálogo. Guía para la app y el panel: `docs/api-guia-frontend.md` §11.

**Flujo del check-in** (`POST /wellbeing/checkins` y `entity: wellbeing_checkin` de sync, mismo servicio):
1. Valida (deslizadores enteros 0–100, sueño opcional 0–24, nota ≤ 1000) y, bajo un advisory lock por astronauta, busca el check-in vigente de ese día UTC.
2. Si ya hay uno, el nuevo lo **corrige**: fila nueva con `supersedes_id` y lecturas con `supersedes_uuid` de las vigentes del anterior (append-only; gana el último que llega).
3. Cada lectura pasa por `recordAndEvaluate`: reglas activas, derivados (`baseline_ready`, `adverse_z_3d` orientado con `direction`, `adverse_sustained_days`), `conditions.js` y escalamiento.
4. `adverse_sustained_days ≥ 5` → escalamiento **confidencial** a `behavioral_health` con `compute_deliver_at` (uno abierto por astronauta e indicador; ver Decisiones).
5. Respuesta: el `recommendation` de la regla más relevante de los WB_* (la que escala más lejos y luego la de mayor nivel), `offer_support: true`, racha y `screening_due`.

**"Quiero hablar con alguien"**: `support_requests` con `deliver_at = compute_deliver_at(misión, recepción)` (el recálculo por cortes ya lo cubría desde la tarea 6). Las respuestas de `behavioral_health` (`support_messages`) salen por el flujo `p` de `/sync/pull` cuando su `deliver_at` ya pasó. Con urgencia `now`, la respuesta trae `suggestions` (respiración guiada y oficial médico de a bordo) y el servidor no avisa a nadie.

**Bandeja de `behavioral_health`**: escalamientos `behavioral_health` y solicitudes ya entregados, por rango (apoyo `now`, alertas urgentes, apoyo `today`, alertas de rutina, apoyo `later`) y `deliver_at`. Acuse y cierre (nuevos en el contrato). Bitácora: una fila de `confidential_access_log` por astronauta que aparece en la página de la bandeja y una por consulta del detalle; las escrituras (acuse, respuesta, cierre) no se registran como lecturas.

**Ejemplos**: `docs/examples/wellbeing-checkin.json` y `docs/examples/support-request.json` (bodies de `POST`; una prueba los manda tal cual).

**Contra Render**: `docs/api-guia-frontend.md` §11 (Git Bash y PowerShell; los dos se probaron contra la API local).

## Acceso

Guía para la app y el panel: `docs/api-guia-frontend.md` §12.

**Emergencia sin sesión** (credencial de tableta):
- Credencial = `dc_` + 32 bytes de `crypto.randomBytes` en base64url (46 caracteres). Se muestra **una sola vez** (`POST /admin/devices` o `POST /crew/devices`); en `devices.credential_hash` queda solo su SHA-256 en hex (es aleatoria y de alta entropía: no necesita bcrypt; mismo esquema que TAB-1 y TAB-2 del seed).
- `authenticateUserOrDevice` (solo en `emergency.routes.js`): con Bearer manda el usuario; si no, `X-Device-Credential` → `req.device` → `deviceActor`. Rutas: protocolo, abrir o unirse, ver la sesión, evaluaciones (crear, responder, completar), "estoy bien" (con `astronaut_id`), latido, preguntas a Tierra y cerrar. Cualquier otra ruta exige Bearer → 401.
- 401 `INVALID_DEVICE_CREDENTIAL` (mismo mensaje): desconocida, revocada, misión no activa, o usada sobre una sesión de otra misión (`assertCrew`). Cada fallo deja `device_auth_failed` en `auth_events` (con la IP y, si se conoce, el id de la tableta; nunca la credencial) y cuenta para el límite por IP (`RATE_LIMIT_DEVICE_CREDENTIAL_PER_MINUTE`, en memoria) → 429 con `Retry-After`.
- La sesión guarda `device_id`, la línea de tiempo `actor_device` (etiqueta) y `auth_events` registra `device_emergency_started`. `last_seen_at` se actualiza en cada uso.

**Bloqueo por intentos** (ya existía): 401 idéntico exista o no el usuario; 423 con `locked_until` aunque la contraseña sea correcta; `account_locked` al bloquear. Nuevo: `account_unlocked` cuando el bloqueo vence solo (en el primer intento después) y `delegated_unlock` cuando desbloquea el comandante (admin ya registraba `account_unlocked`).

**Comandante** (`delegation.service.js`, mapa `COMMANDER_CAPABILITIES`: `unlock_user`, `reset_offline_pin`, `register_device`): `requireCrewRole('commander')` + tripulante vigente de SU misión (`v_current_crew`; otro → 404). Cada uso: fila en `delegated_actions` (append-only), evento en `auth_events` y aviso a Tierra con `deliver_at = compute_deliver_at(misión, received_at)` **calculado al leer** (`reported_to_ground_at` queda sin uso). `GET /admin/audit/delegated-actions` muestra solo lo que ya llegó.

**PIN sin conexión** (`offlinePin.service.js`): bcrypt en `offline_pins.pin_hash`; `offline_unlock_until = now() + OFFLINE_UNLOCK_DAYS` y cada login en línea en ese dispositivo lo renueva. La app guarda su propio verificador (PBKDF2, parámetros en `offline_verifier`). Un PIN nuevo reemplaza al anterior; el comandante lo borra en todos los dispositivos del tripulante; revocar una tableta borra los PIN de esa etiqueta para la tripulación de su misión.

**Auditoría de accesos confidenciales** (`confidentialAudit.service.js`, decisión de la tarea 11): saber de quién consultó salud conductual ya revela algo conductual, así que **no** la ve admin ni el flight surgeon. `GET /admin/audit/confidential-access` → solo `behavioral_health`, sobre los astronautas de su misión (`crew_assignments`), filtrable por `astronaut_id`. `GET /me/confidential-access` → el astronauta, solo las filas sobre él. Nunca el contenido ni la IP. Leer la auditoría no agrega filas a la bitácora.

**Contra Render**: `docs/api-guia-frontend.md` §12 (Git Bash y PowerShell, incluida la emergencia con TAB-1; los dos se probaron contra la API local).

## Pantalla Tripulación

Guía para la app: `docs/api-guia-frontend.md` §13. `GET /crew/status`, solo astronautas con asignación vigente (su misión, sin parámetros).

**Quién ve qué** (todo en `canAccess`, sin reglas sueltas en el servicio):
- Vista `crew_status`: astronauta de la misión, solo lectura, categoría `physical` o `emergency`, nunca `behavioral` ni confidencial. Da el roster, la sesión abierta y las alertas.
- Vista `crew_physical`: además `crew_role = crew_medical_officer`. Se evalúa **antes** del `switch` (como `clinical_profile`) para que "lo propio" no la abra: un tripulante normal tampoco ve su propio semáforo aquí (lo tiene en `/me/body-status`). El comandante no la tiene.
- `CREW_PHYSICAL_HIDDEN` (`resource.indicator_code`) vale para las **dos** vistas: hoy `SLEEP_HOURS`, que llega con el check-in y diría quién lo hizo y a qué hora (cumplimiento, que solo ve admin). Ni el semáforo del CMO ni las alertas de esta pantalla lo muestran, para nadie a bordo. Del semáforo, el servicio pregunta a `canAccess` por cada indicador del catálogo y solo lee de la base los permitidos; de las alertas, filtra cada una por su indicador. El escalamiento no cambia: el dueño la recibe por `GET /sync/pull` y el flight surgeon, la crítica en Tierra.
- Tierra y `service` → 403 `FORBIDDEN` (`service` ya lo cortaba `restrictServiceAccounts`); astronauta sin asignación → 403 `NO_ACTIVE_ASSIGNMENT` (solo cambia el código del error; la negación es de `canAccess`).

**Decisiones**:
- `emergency` es la sesión `pending`/`active` de la misión y sale **igual en cada fila**: hay una sola por misión y cubre a toda la tripulación (lo pedía el diseño por tripulante).
- `crew_alerts`: escalamientos `level = 'crew'`, `category = 'physical'`, `source_type = 'reading'`, no confidenciales, ya entregados y con `created_at` en las últimas 24 h (`ALERT_WINDOW_HOURS`). El indicador sale por `v_readings_standard` (un `source_id` de bienestar no cruza) y el `level` de `reading_evaluations` (si faltara, de la prioridad). Nunca `reason`: lleva el valor. Sin las de `SLEEP_HOURS` (`CREW_PHYSICAL_HIDDEN`), aunque las dos reglas de noches cortas del catálogo escalen a bordo: la de 3 noches (`caution` → `crew`) y la de 7 (`critical` → `flight_surgeon`, que por ser crítica física también va a bordo).
- `physical`: última lectura vigente (no corregida) **de la misión** por indicador estándar, sin el hábitat; mismas zonas y regla de `SYMPTOM` que `/me/body-status`, sin `checkin_completed`. `indicators` solo trae los que tienen lectura. Sin `SLEEP_HOURS` (ver `crew_physical`): `brain` solo lo colorea `SYMPTOM` (9 síntomas del catálogo caen ahí, p. ej. `headache` y `confusion`).
- Las pruebas revisan el JSON completo de cada rol contra `WB_`, `PVT`, `PHQ`, `GAD`, `SLEEP_HOURS`, `fitness`, `support`, `checkin`, `sex`, `note` y `reason`, con bienestar real en la base (check-in, PVT, PHQ-2, solicitud de apoyo) y un escalamiento conductual "trampa" con `level = 'crew'`.

## Credenciales demo

> Todo es **sintético**, solo para la demo local. Contraseña de todos los usuarios del seed: **`Demo2026!`**.

| Usuario | Rol | Quién es | Notas |
|---|---|---|---|
| `mission.control` | `admin` | Control de Misión (demo) | Administra cuentas y dispositivos. |
| `dr.reyes` | `flight_surgeon` | Dra. Elena Reyes (sintética) | Equipo en Tierra de ARES-1 (`medical`). |
| `bh.salas` | `behavioral_health` | Dra. Inés Salas (sintética) | Equipo en Tierra de ARES-1 (`behavioral`). |
| `a.ortega` | `astronaut` | ORION · comandante | |
| `k.mensah` | `astronaut` | VEGA · oficial médico (CMO) | |
| `l.tanaka` | `astronaut` | LYRA · ingeniera de vuelo | |
| `m.silva` | `astronaut` | ATLAS · especialista de misión | Debe cambiar la contraseña en el primer login (428). |
| `svc.habitat` | `service` | Sensores del hábitat | Solo `POST /habitat/readings`. |

Tabletas de ARES-1 (header `X-Device-Credential`, solo para los endpoints de emergencia):
- `TAB-1`: `dc_demo_tab1_sintetica`
- `TAB-2`: `dc_demo_tab2_sintetica`

`npm run db:reset` vuelve todo a este estado (solo en local; en Render, `db:reset` está deshabilitado con `NODE_ENV=production`: ahí se usa el reinicio de demo, que cierra lo abierto sin borrar). `node --test` **no toca** `astro_health`: usa la base de pruebas `astro_health_test` (`DB_NAME_TEST`).

## Decisiones

**Datos y base**
- Respuestas del triaje: `{ "value": … }` para sí/no y números, `{ "choice": "<código>" }` para opciones; el adaptador también acepta valores sueltos.
- Bandera de radiación = `none` si el recorrido no pasa por el módulo de radiación (incluida la categoría negra).
- **Lecturas confidenciales**: el dashboard y todas las consultas que muestran datos usan la vista `v_readings_standard` (`readings` JOIN `indicators` WHERE `sensitivity = 'standard'`), **nunca** `readings` directo. Solo el historial interno del motor (que necesita también los WB y PVT) lee `readings`. La vista se creó con `r.*`: si `readings` gana columnas, hay que recrearla.
- **Lecturas append-only**:
  - un trigger impide UPDATE y DELETE;
  - una corrección es una lectura nueva con `supersedes_uuid`, del mismo autor y del mismo indicador, una sola vez (una segunda corrección es 409);
  - `client_uuid` es único por autor (`recorded_by`);
  - equivalencias con el contrato: `components` = `values` y `source` = `input_method` (o el `source` de `/habitat/readings`).
- **Adjuntos en la base**: columna `data` bytea de hasta 5 MB, porque en Render/Railway el disco se borra en cada deploy. Un CHECK verifica `sha256` y `size_bytes`. No selecciones `data` en los listados.
- **Reglas versionadas**: una sola versión activa por indicador y la última regla debe ser `{ "all": [] }`. El `id` de la versión es el `audit_id` de `PUT /admin/indicators/{code}/rules`.
- **Escalamientos**:
  - `category` (`physical|behavioral|emergency`) se deriva de `source_type` con un trigger;
  - `is_confidential` es siempre true si `level = behavioral_health`;
  - `v_ground_inbox` excluye los confidenciales;
  - el filtro de la bandeja del contrato (`reading|emergency|wellbeing|manual`) se traduce desde `source_type`.
- **Equipo en Tierra**: si no se indica `function`, se deriva del rol. `behavioral` solo va con el rol `behavioral_health`. Astronautas y cuentas `service` no pueden ser parte del equipo.
- **Tripulación vigente**: `v_current_crew` usa `assigned_from <= now() < assigned_to`, así que un `assigned_to` futuro es válido (contrato v1.1). Comandante y CMO no pueden tener periodos solapados (`EXCLUDE`).
- **`synthetic`**: `DEFAULT true` en todas las tablas que lo tienen.
- **`astronauts.sex`** (migración 009, `female | male | null`, CHECK `astronauts_sex_ck` según la convención del repo): sexo biológico para referencias clínicas, no identidad de género. Lo escribe admin (`POST /admin/users` → `astronaut.sex`, `PATCH /admin/astronauts/{id}`) pero no lo recibe; lo ven el propio astronauta (`GET /me`) y flight surgeon / salud conductual de su misión (`GET /missions/{id}/crew`), por la vista `clinical_profile` de `canAccess` y `filterAstronautProfile`. Nunca otro astronauta (ni CMO ni comandante) ni el dashboard. El motor lo pone en el contexto de las reglas (`ruleContext`, no se guarda en `derived`); ninguna regla lo usa y la radiación no depende de él (600 mSv de carrera, universal, NASA-STD-3001 Vol. 1 [V1 4030]).
- **Tablas append-only** (`confidential_access_log`, `delegated_actions`, `readings`): sus FK son `ON DELETE RESTRICT`, porque un `SET NULL` sería un UPDATE que el trigger bloquea. A los usuarios se los desactiva (`is_active`), no se los borra.

**Autenticación y permisos**
- **Tokens**:
  - access token: JWT HS256 de 15 minutos (`JWT_ACCESS_TTL`), con los claims `sub`, `role`, `did`, `scope` y `pcv`;
  - `pcv` es la versión de la contraseña: al cambiarla o al hacer un reset, todos los access tokens anteriores dejan de servir;
  - refresh token: opaco (`rt_…`), de 7 días, ligado al `device_id`; en la base solo se guarda su SHA-256.
- **Refresh rotativo**: cada uso revoca el token y crea uno nuevo (`replaced_by`).
  - Si se reusa un token ya rotado, se revoca la familia (la cadena `replaced_by` que lo siguió), se registra `token_reuse_detected` y se responde 401.
  - Un token revocado por logout o por cambio de contraseña da 401 `UNAUTHENTICATED`, no reuso.
- **Cambio obligatorio (428)**: `error.details.password_change_token` es un JWT con `scope: password_change` de 10 minutos y un solo uso. Con él, o con `must_change_password`, solo se pueden usar `change-password` y `logout`.
- **Bloqueo**:
  - 5 fallos bloquean la cuenta 15 minutos y responden 423 con `locked_until`;
  - el 401 de login es idéntico exista o no el usuario (con un hash de relleno, para que tarde lo mismo);
  - cada intento queda en `auth_events`, donde `account_locked` cubre el bloqueo.
- **Rate limit**: en memoria y por IP (30 logins/minuto). Sirve para una sola instancia.
- **Rol `service`**: un middleware global responde 403 a toda ruta fuera de `POST /api/v1/habitat/readings`. Se vincula a su misión con `service_accounts`.
- **Política de acceso**: `canAccess(actor, resource)` es pura y la única fuente de verdad.
  - Los servicios usan `enforceAccess`: 403 si se niega, y registra en `confidential_access_log` cada lectura confidencial permitida.
  - El `flight_surgeon` solo **lee** lo físico de otros; responde con mensajes de escalamiento.
  - `admin` es un rol global de operaciones y no está acotado por misión; el resto sí.
- **Altas**: la contraseña temporal (12 caracteres) se devuelve una sola vez y solo se guarda su hash bcrypt. Si a un rol de Tierra no se le indican misiones, entra al equipo de las misiones activas del admin que lo crea.
- **Credenciales de dispositivos**: de las tabletas se guarda el SHA-256 de la credencial (es aleatoria, no una contraseña). El PIN offline va con bcrypt.

**Motor del semáforo (tarea 5)**
- **Evaluación**:
  - reglas activas (versionadas) + campos derivados + `evaluateIndicator`, el mismo evaluador que la app offline;
  - se guarda en `reading_evaluations` con `rules_version` y los derivados usados (`derived`);
  - el catálogo se cachea en memoria y se recarga cuando cambia la marca de versión de la base (otra versión activa de reglas, un indicador actualizado);
  - `catalog_version` sale de `docs/catalogo-indicadores.json`.
- **Campos derivados** (`src/engine/derived.js`). Lo que no se puede calcular se **omite**, así la condición es falsa y no dispara por falta de datos:
  - `consecutive_nights_le_6h`: una noche es un día UTC de `measured_at`; una noche sin registro corta la racha.
  - `ratio_to_baseline`: mediana de los 7 días anteriores, sin días de evento. `event_dose_msv`: suma de la racha `event_active` que termina en la lectura actual.
  - `projected_end_msv`: mediana de las dosis diarias de 7 días (sin eventos) × días que faltan hasta `missions.ends_at`. Sin fecha de fin no se calcula.
  - `avg_7d` (CO₂, por módulo): incluye la lectura actual y exige al menos una anterior en la ventana.
  - `pct_change_from_preflight`: la línea base es **la primera lectura de masa del astronauta en la misión**, porque el catálogo no tiene campo preflight.
  - `rolling_7d_pct_of_prescription`: prescripción de 600 min/semana (`EXERCISE_WEEKLY_PRESCRIPTION_MIN`). Solo se calcula si hay un registro de hace ≥ 6 días; si no, "pocos minutos" sería falta de datos.
  - WB_*: la línea base son los check-ins de los 14 días anteriores sin los últimos 3 (lista con ≥ 7), con desviación muestral; si la desviación es 0 no hay `adverse_z_3d`. PVT_*: "en descanso" = corrida con `before_critical_task = false`.
- **`POST /readings`**:
  - valida `values` contra los `components` del catálogo (requeridos, tipos, valores admitidos y códigos de síntomas);
  - aplica rangos plausibles por unidad: es una regla de diseño, sin fuente clínica, para detectar °F o lb;
  - `input_method` debe estar en `input_methods` del indicador;
  - rechaza con 400 los confidenciales (entran por `/wellbeing/*`) y los del hábitat.
- **Escalamiento** (tarea 6, ver abajo).
- **Body-status**:
  - los confidenciales no aportan color; en `brain` solo cuenta `SLEEP_HOURS`;
  - `checkin_completed` = hubo check-in hoy (día UTC);
  - la tarjeta `environment` es el `module_id` pedido o el módulo con la lectura del hábitat más reciente;
  - `SYMPTOM` aparece en la zona de cada síntoma reportado.

**Escalamiento y panel de Tierra (tarea 6)**
- **Enrutamiento** (`routeEvaluation`, pura):
  - físico: `crew` → a bordo, `delivered` con `deliver_at = now()`; `flight_surgeon` → a Tierra, `queued` con `deliver_at = compute_deliver_at(misión, now())`; si es critical, también a `crew`;
  - conductual (indicador confidencial): **solo** `behavioral_health`, `is_confidential`, `source_type = wellbeing`, aunque la regla diga `flight_surgeon` (PVT_LAPSES critical). Nunca a la tripulación ni a admin. El `reason` no lleva el valor ("alerta de bienestar");
  - prioridad: critical = `urgent`, caution = `routine` (`emergency` queda para el triaje).
- **Idempotencia**: la lectura ya lo es por `client_uuid`; además, índice único `(source_id, level)` para lecturas y bienestar (migración 008) y `ON CONFLICT DO NOTHING` devuelve el existente. `client_uuid` de `escalations` se respeta si viene (para sync/manual).
- **Entrega**: no hay job. La bandeja filtra `deliver_at <= now()` y, al leerla, promueve `queued → delivered`. Lo ya llegado pero no promovido se muestra como `delivered`.
- **Cortes**: al crear, corregir, cerrar o reabrir un corte se recalcula `deliver_at` de lo que todavía no llegó (NULL o futuro) en escalamientos a Tierra, `escalation_messages`, `support_requests` y `support_messages`, con `compute_deliver_at(misión, hora de envío)`. Lo ya entregado no cambia. Cambiar el retraso de un entorno **no** recalcula lo que está en camino.
- **Bandeja** (`v_ground_inbox`): solo `flight_surgeon` y no confidencial. Las categorías visibles las decide `canAccess`: admin no ve `wellbeing`; el flight surgeon sí (solo estado, `view: escalated_alert`). Orden: prioridad y luego `deliver_at` **ascendente** (lo que espera desde hace más, primero). La evaluación de la lectura se une por `v_readings_standard`. Una misión por consulta (`mission_id` o la activa más reciente del equipo en Tierra; admin sin equipo → la activa más reciente).
- **Acuse y respuesta**: solo sobre lo que ya está en la bandeja; si no, 404 (Tierra todavía no sabe que existe). Cerrado → 409. El acuse es idempotente (devuelve el primero). Responder pasa a `responded` y cuenta como acuse. Para `canAccess` el acuse y la respuesta son `read` sobre el escalamiento: el flight surgeon no escribe datos de salud.
- **Hilo a bordo** (`GET /escalations/{id}/messages`): `to_crew` solo con `deliver_at <= now()`; `to_earth` siempre. Lo ven el dueño y el CMO (si es físico), por `canAccess`.
- **Dashboard**: tripulación vigente; por indicador físico con lecturas, hasta 10 puntos desde `v_readings_standard` (sin corregidas). Valor de la serie: `value`, o la sistólica, o el primer número. Tendencia (regla de diseño): último frente a la media de los anteriores, ±5 %. `fitness` (`pvt_runs.fitness` más reciente; sin PVT = `not_confirmed`) lo ven **flight surgeon y admin** (vista `fitness` de `canAccess`); `compliance` (días UTC con check-in en 7 días, hasta 7) **solo admin**. Lo que el rol no puede ver va en `null` (contrato nullable).
- **Misión**: crear una misión agrega al admin a su equipo en Tierra (`operations`). Los solapes se revisan antes de escribir para devolver el id en conflicto (`ASSIGNMENT_OVERLAP`, `CREW_ROLE_TAKEN`, `OUTAGE_OVERLAP`); las restricciones `EXCLUDE` siguen como red de seguridad. `active=true` usa la vigencia de `v_current_crew`.
- **Pruebas sin sleeps**: el paso del tiempo se simula moviendo `created_at` y `deliver_at` hacia atrás.

**Simulador (tarea 7)**
- **Valores asumidos** (todos en `src/simulator/profiles.js`, con su fuente o marcados como suposición de diseño):
  - bandas del catálogo como límites: la historia se recorta antes del umbral que escala (p. ej. sistólica ≤ 134, FC 61–98, SpO₂ ≥ 95, temperatura 36.1–37.3, sueño ≥ 6.1 h);
  - radiación diaria 0.35 mSv ± 0.04 (0.22–0.48), de `ntrs_ascend_rad` (ISS, 0.2–0.5 mSv/día). ARES-1 es un tránsito a Marte, donde la dosis real es mayor; se usa la referencia del catálogo. Dosis de carrera previa por astronauta: 0–60 mSv (suposición);
  - ejercicio ≈ 86–95 min/día (`ochmo_exercise`: 600 min/semana); CO₂ ≈ 2 mmHg con subida de día (`ochmo_co2`); temperatura, humedad y ruido dentro de `ochmo_eclss` y `ntrs_nc_dba`;
  - sueño ≈ 7.2 h: la guía dice que en vuelo se duermen 6–6.5 h, pero eso daría precaución casi a diario (suposición para que la historia quede normal);
  - medias y desviaciones de cada astronauta, horarios y periodo de sueño 22:00–06:00 UTC: suposición de diseño;
  - escenarios: curvas y picos elegidos para cruzar los umbrales del catálogo (suposición de diseño).
- **PVT**: la regla necesita 3 corridas previas en descanso en el mismo dispositivo. La historia agrega 3 corridas de línea base en los días 1–3 de la misión (`TAB-1`) y las semanales rotan entre esos valores, así el z nunca llega a 2 y la aptitud queda `fit`.
- **wellbeing_decline**: el derivado cuenta check-ins seguidos con z ≥ 1.5 contra 14 días sin los últimos 3. Al 5.º día, los 2 primeros días malos ya están en la línea base y suben su desviación: por eso el empeoramiento es progresivo (35 puntos 2 días y 50 los 3 siguientes; z ≈ 2.6–3.0). Corrige el check-in del día (`supersedes_uuid`, mismo `measured_at`) en vez de agregar otro, porque dos check-ins por día mezclarían valores buenos y malos.
- **`wellbeingRecorder.js`**: registro de check-in, corrección, PVT (calcula `pvt_runs.fitness` con `fitnessFromPvt`) y cuestionario, con sus lecturas agrupadas y por `recordAndEvaluate`. Es la base de los endpoints `/wellbeing/*` (tarea 10). `readings.model.insert` ahora acepta el grupo (`wellbeingCheckinId`, `pvtRunId`, `instrumentAdministrationId`).
- **Endpoints**: el gate de `SIMULATOR_ENABLED` responde 404 antes de autenticar (no revela que existen) y va antes del router de `/admin` (que exige admin a todo `/admin/*`). Luego `admin`; el resto, 403.
- **Paralelo**: cada sujeto (cada astronauta y el hábitat) se escribe en serie, en orden de `measured_at` (los derivados leen lo anterior); los sujetos corren en paralelo.

**Sincronización (tarea 8)**
- **Migraciones**: 009 = `astronauts.sex`, 010 = sincronización. `sync_batches` y `sync_items` ya existían (005): la 010 no los crea, los completa (conteos por resultado, `late_count`, `clock_offset_ms`, `duration_ms`; `payload_hash`, `late_sync`, `lag_s`), cambia el CHECK de `item_count` (el máximo lo pone `SYNC_MAX_BATCH`) y el de `entity` (cualquier nombre `^[a-z][a-z0-9_]{0,39}$`, para registrar también los tipos desconocidos), y quita el UNIQUE `(batch_id, client_uuid)` (un client_uuid repetido en el lote es el duplicado del segundo). Nunca se guarda el payload, solo su hash.
- **Contrato (cambios mínimos, anotados en "Cambios" del YAML)**: se respetan los nombres del contrato aunque el brief dijera otros: `entity` (no `type`), `accepted` (no `created`), `created_at` en el item y `measured_at` en el payload, `wellbeing_screening` (no `instrument_administration`). Cambió: `entity` deja de ser enum cerrado; el orden pasa a emergency → críticos → resto por `measured_at` (antes "por created_at"); respuesta con `batch_id`, `clock_offset_s`, `counts`, `sequence`, `late_sync`/`lag_s`; 403 en push; el pull agrega `limit`, `catalog`, `mission`, `evaluations`, `escalations`, `routines`; la bandeja agrega `measured_at`, `late_sync`, `lag_s`. Todo aditivo para quien ya usaba el mock, salvo que el ejemplo de `emergency_answer` ahora sale `rejected` (`ENTITY_NOT_SUPPORTED`) hasta la tarea 9.
- **Política de conflictos**:
  - idempotencia por `client_uuid` del autor (como en línea): mismo `client_uuid` + mismo contenido → `duplicate` con el `server_id` existente;
  - mismo `client_uuid` + otro contenido → `conflict` `PAYLOAD_MISMATCH`: se compara el hash con el del item aceptado antes por sync y, para lecturas creadas en línea o por el simulador, contra la lectura guardada (indicador, valores, método, `measured_at`, `supersedes_uuid`). Nunca se sobrescribe (append-only);
  - segunda corrección del mismo original → `conflict` `SUPERSEDE_CONFLICT` (el índice único de 005);
  - un `conflict` no se reintenta igual: la app lo saca de la cola y avisa.
- **Reintentos**: un lote reenviado crea otra fila en `sync_batches` (queda el historial de reintentos) pero ninguna fila de datos nueva: lecturas, evaluaciones, escalamientos y grupos de bienestar quedan igual (lo prueba `test/sync.integration.test.js`).
- **Reloj**: `measured_at` nunca se corrige. Más de `SYNC_MAX_FUTURE_SKEW_S` (300 s) en el futuro → `FUTURE_TIMESTAMP`; la misma tolerancia aplica ahora en línea (`measuredAtIssue`, antes fija en 5 min). El offset del lote solo se registra.
- **Llegada tarde**: se evalúa con su `measured_at` (los derivados usan el historial anterior a esa hora) y el escalamiento se crea al recibirla, con `compute_deliver_at(misión, now())` y sus cortes: un crítico de hace 30 h sigue escalando y llega a Tierra 90 s después de la recepción. `late_sync` = más de `SYNC_LATE_AFTER_S` (900 s, regla de diseño) entre medición y recepción; se calcula igual en la bandeja (`measured_at`, `late_sync`, `lag_s`) para cualquier lectura, llegue por sync o en línea.
- **Críticos primero**: el servidor no confía en la prioridad del dispositivo para lo crítico; lo evalúa con los valores del payload. Una regla que dependa de derivados (p. ej. noches seguidas) no se detecta así: esa lectura va en su orden normal.
- **Bienestar por sync**: el check-in del contrato (`mood`, `fatigue`, `stress`, `crew_conflict`, `sleep_hours`, `private_note`) se traduce a WB_* y `SLEEP_HOURS` (`input_method: manual`); PVT (`lapses`, `mean_rt_ms`, `false_starts`) a PVT_*; screening a PHQ2/GAD2_SCORE. Las lecturas del grupo llevan `client_uuid` derivados (`derivedUuid('sync-group', client_uuid del item, código)`, UUID v8), distintos de los del simulador (`sim-uuid`). La respuesta es neutra (`message`, `offer_support: true` siempre, para no filtrar nada; `fitness` en PVT). Los deslizadores se validan enteros 0–100 en el handler (el catálogo no tiene rango para WB_*).
- **Pull**: cursor por flujo, así un flujo no frena a otro; `has_more` si quedó algo de cualquier flujo. Las fechas del cursor van en UTC con microsegundos (no dependen de la zona del servidor). El margen de 2 s (`SYNC_PULL_SETTLE_MS`) evita perder filas de transacciones que confirman tarde; las pruebas lo ponen en 0. Los escalamientos salen cuando llegan a destino (`deliver_at`) y con el estado de ese momento: los cambios posteriores (acuse, respuesta) llegan como mensajes.
- **Recordatorios y rutinas**: el pull devuelve los vigentes en cada respuesta (estado, no incremental); todavía no se llenan (no hay endpoints que los creen).

**Triaje (tarea 9)**
- **Migraciones**: 011 = estados `pending` y `merged` de `emergency_status` (sola: un valor nuevo de un enum no se puede usar en la misma transacción); 012 = el resto: índice de una sesión abierta por misión, columnas de la sesión (`merged_into`, `responder_safe`, `activated_at`, latido, cierre), evaluaciones sin los UNIQUE `(session_id, astronaut_id)` y `(session_id, sequence_no)` (reevaluación append-only y dos tabletas sin conexión), con `protocol_id`, `reassessment_of`, `result`, `device_result` y `matches_device`; tablas `emergency_deadman`, `emergency_events` (append-only salvo `deliver_at`), `emergency_reports` y `system_markers`; `escalation_messages.client_uuid`.
- **Cambios al contrato** (sección "Cambios" del YAML, v1.3): una segunda activación **se une** (201 + `joined`) en vez de 409 `SESSION_ALREADY_ACTIVE` (el brief pide unirse; el 409 obligaba a la app a reintentar); reevaluación permitida (el 409 queda para la sesión cerrada); estados `pending` y `merged`; nuevos `/confirm` (hombre muerto de 60 s, distinto del latido de 120 s del contrato, que también está) y `/questions`; `responder_safe` puede ser null en las automáticas y lo contesta el primer evaluador; campos nuevos en sesión, evaluación, resultado, lectura y panel; 4 entidades de sync nuevas. Lo demás, como estaba.
- **Política de fusión**: la primera sesión que llega (en línea o por sync) es la principal. Cualquier otra activación mientras esté abierta queda como fila `merged` (`merged_into` = la principal, con su `client_uuid`, disparador, autor y hora) y un evento `joined`. Las evaluaciones que referencian la sesión fusionada (por id o `client_uuid`) se guardan en la principal, así que nunca se pierde una evaluación; cerrar la fusionada cierra la principal (es el mismo incidente). Si la principal ya estaba cerrada, la nueva abre su propia sesión.
- **Dispositivo vs servidor**: el servidor recalcula siempre con `evaluateAssessment` y la versión del protocolo de la evaluación (`protocol_id`). Se guarda lo que mandó la tableta (`device_result`), `matches_device` y `result.mismatch_fields` (status, categoría, bandera de radiación, versión), y un evento `device_mismatch` con las dos versiones y `used: server`. Prioriza el resultado del servidor. Completar otra vez devuelve lo guardado sin volver a escalar.
- **Orden de atención** (`attention_order` del protocolo): START (rojo, amarillo, verde, negro); dentro, radiación probable > posible > ninguna (regla de diseño); quien no tiene evaluación va después de los rojos (regla de diseño: puede ser rojo). Roster de evaluación: primero el plazo de "estoy bien" vencido, luego el que espera respuesta, luego la lectura crítica de la última hora.
- **Lectura crítica vieja**: escala igual (como en la tarea 8), pero no abre la emergencia si se midió hace más de `TRIAGE_AUTO_READING_MAX_AGE_MIN` (120 min, regla de diseño): un crítico que llega por sync 30 h después no despierta a la tripulación.
- **Escalamientos**: categoría `emergency`, idempotentes por `client_uuid` derivado (fuente + motivo + destino). El motivo nunca lleva datos clínicos. **Admin**: no hay nivel de escalamiento para admin; su "aviso operativo" es ver esos mismos avisos en la bandeja sin `triage` (nueva vista `operational` de `canAccess`) y el panel de emergencias sin clínica.
- **Sin bienestar**: el triaje no lee ni devuelve datos de bienestar (decisión del MVP). Única excepción: el disparador `missed_checkin` usa la HORA del último check-in (nunca sus valores); el motivo dice "sin respuesta a la alerta de check-in".
- **Actor**: los servicios reciben `{ kind: 'user' | 'device', ... }` (`emergencyCommon.userActor` / `deviceActor`), nunca `req.user`. Desde la tarea 11 el controlador arma `deviceActor` con `X-Device-Credential`.
- **Sync**: `emergency_*` con `priority: emergency` en el registro (rango 0 aunque el item diga normal) y un orden entre ellos (sesión → "estoy bien" → evaluación → respuestas → completar → latido → pregunta → cierre). Completar, cerrar, latido y "estoy bien" son `idempotentBySync`: un reintento con el mismo hash es `duplicate` sin volver a ejecutar.
- **Paso 0**: el recálculo por cortes de lo que estaba en cola ya existía desde la tarea 6 (con prueba). Faltaba el caso de un corte cerrado hacia atrás: ahora lo que estaba en cola sale con `greatest(compute_deliver_at(...), now())` (nunca con un `deliver_at` pasado que el pull ya no recogería). Prueba en `test/escalations.integration.test.js`.

**Bienestar (tarea 10)**
- **Paso 0**: `wellbeingRecorder.js` ya registraba check-in, corrección, PVT y cuestionario, y los derivados WB_*/PVT_* ya estaban en `derived.js`; el enrutamiento conductual, el recálculo por cortes de `support_requests`/`support_messages` y el flujo `p` del pull también existían. Se reutilizó todo; no se duplicó el cálculo.
- **Migración 013** (sin seed nuevo): `wellbeing_checkins.supersedes_id` (una corrección por check-in, índice único), `escalations.closed_by`, `support_requests.closed_by` e índice de escalamientos conductuales abiertos.
- **Un check-in por día de misión** = día UTC de `measured_at` (la misión trabaja en UTC). El segundo es una corrección; si un check-in tardío por sync cae en un día que ya tenía uno, también lo corrige (gana el último que llega). Si el nuevo no trae sueño, la lectura de sueño del anterior sigue vigente.
- **La nota privada solo la ve el astronauta** (decisión del MVP): vuelve en `GET /me/wellbeing`; `behavioral_health` ve valores, tendencias y escalamientos, nunca la nota (las consultas de `behavioral.model.js` no la seleccionan). El astronauta leyendo lo suyo no se registra en la bitácora (no es un acceso de otro).
- **Mensaje al astronauta**: el `recommendation` de la regla del catálogo (sin números ni colores). `offer_support` siempre `true`, en línea y por sync (el botón no depende del resultado: un booleano variable filtraría el nivel).
- **Racha**: días UTC seguidos con check-in que terminan hoy (o ayer si hoy falta) y días con check-in en los últimos 7. No existe `/me/gamification`: va en la respuesta del check-in (`streak`).
- **Reglas de diseño nuevas** (configurables, `basis: design_rule`, sin umbral clínico):
  - `WELLBEING_ONE_OPEN_ESCALATION=true`: un escalamiento `behavioral_health` abierto por astronauta e indicador; mientras no se cierre, la evaluación apunta al abierto y no se crea otro. Bloqueo por astronauta + indicador (advisory lock). Aplica a WB_*, PHQ-2/GAD-2 y PVT_* (la alerta de estado al flight surgeon no se agrupa: cada PVT crítica avisa).
  - `WELLBEING_FITNESS_MAX_AGE_H=12`: "apto para tarea crítica" solo con una PVT de las últimas 12 h (cualquier corrida, en descanso o antes de la tarea); sin PVT reciente, `not_confirmed`. Lo usan el dashboard y `/admin/compliance` (antes el dashboard tomaba la última PVT de cuando fuera).
  - `WELLBEING_SCREENING_EVERY_DAYS=14`: PHQ-2/GAD-2 cada 14 días, `screening_due` desde el día 13 (un día antes de la conferencia psicológica; la agenda de conferencias no está modelada).
  - Orden de la bandeja conductual y sugerencias de urgencia `now` (respiración guiada, oficial médico).
- **`PVT_LAPSES` critical** (lo decidido en la tarea 9): `routeEvaluation` agrega para lo confidencial que el catálogo escala a `flight_surgeon` un segundo destino no confidencial (`category: behavioral`, `statusOnly`) con un motivo sin métricas ni indicador. El simulador no lo cuenta en el resumen de admin.
- **Umbrales**: ninguno nuevo. Los de WB_*, PHQ-2/GAD-2 (corte 3) y PVT_* (11/20 lapsos, z ≥ 2, lapso ≥ 355 ms) salen del catálogo. No hay PHQ-9.
- **Contrato (v1.4, cambios mínimos en "Cambios" del YAML)**: `sleep_hours` opcional; `WellbeingAck` + `supersedes_id`, `streak`, `screening_due`; `SupportRequest.suggestions`; acuse y cierre de `behavioral_health` (4 rutas nuevas: el contrato no tenía cómo cerrar, y el cierre es lo que libera la regla de uno abierto); bandeja con `include_closed`, `channel`, `priority`, `measured_at`; detalle con `checkins`, `escalations`, `trend`; `Compliance` + `checkin_today`, `streak_days`, `generated_at`; 200 de duplicado en cuestionarios y PVT. Se respetan los nombres del contrato aunque el brief dijera otros: urgencia `later` (= "puede esperar", el brief decía `can_wait`). El audio no está en el contrato: no se agregó.
- **Sync**: `support_request` registrado (idempotente; mismo `client_uuid` con otro contenido → `PAYLOAD_MISMATCH`). Los handlers de bienestar ahora llaman a `wellbeing.service` (antes traducían el payload en `syncEntities.js`): la misma respuesta que en línea. El sueño del check-in entra como `wearable` (antes `manual` por sync).
- **Simulador**: `wellbeing_decline` termina con una solicitud de apoyo `now` por el servicio real; el resumen no la cuenta (admin no puede ver ni conteos) y un error se informa como `wellbeing` sin decir qué era.
- **Fix aparte** (tarea 9): el corte de `emergency_solar` empezaba 1 s antes de "ahora" y, si otro corte acababa de cerrarse, se solapaba, el 409 se ignoraba y la pregunta salía sin corte: la prueba fallaba en la suite completa (pasaba sola). Ahora empieza después del último corte cerrado.

**Acceso (tarea 11)**
- **Paso 0**: ya existían el bloqueo (`LOCKOUT_*`, 423, `account_locked`, desbloqueo de admin), las tablas `devices`, `offline_pins` y `delegated_actions` (007), las credenciales de TAB-1/TAB-2 en SHA-256 y `deviceActor`. No se duplicó nada: se cableó la autenticación, se agregaron los servicios y rutas, y se completó la bitácora.
- **Migración 014** (sin seed nuevo): eventos `device_auth_failed` y `device_emergency_started` en `auth_events`, índice `(mission_id, received_at)` de `delegated_actions` y el comentario de que `reported_to_ground_at` queda sin uso.
- **Cambios al contrato (v1.5, "Cambios" del YAML)**: `GET /admin/devices` nuevo; `X-Device-Credential` también en "estoy bien" (`astronaut_id` en el body: con la tableta compartida no hay usuario) y en preguntas a Tierra; 401 `INVALID_DEVICE_CREDENTIAL` y 429; `Device.status`; 409 `DEVICE_LABEL_TAKEN`; `reported_to_earth = false` mientras espera enlace; `offline_verifier` en `PUT /me/offline-pin` y 403 `DEVICE_NOT_OWNED` / `DEVICE_REVOKED`; 403 en `/missions/current`.
- **"De otra misión → 401"**: la credencial autentica "una tableta de la misión X"; sobre una sesión de otra misión no es una credencial válida (401, no 403), igual que si la misión de la tableta no está activa.
- **"Estoy bien" desde la tableta**: solo para un afectado con plazo pendiente en esa sesión (si no, 409). Es una tableta compartida: cualquiera a bordo podría tocar el botón por el afectado, igual que con su propio iPad desbloqueado (riesgo aceptado; queda el `actor_device`).
- **Reglas de diseño nuevas** (configurables): `RATE_LIMIT_DEVICE_CREDENTIAL_PER_MINUTE=10` (solo fallos, por IP); `OFFLINE_UNLOCK_DAYS=7` (el contrato ya decía 7 días); verificador local del PIN con PBKDF2-HMAC-SHA256 y 600 000 iteraciones (OWASP Password Storage Cheat Sheet), sal de 16 bytes del dispositivo y `max_attempts = LOCKOUT_MAX_ATTEMPTS`.
- **PIN**: se define solo en el dispositivo de la sesión (`device_id` = `did` del token) y no en una tableta revocada. El servidor nunca lo verifica ni lo devuelve: ningún endpoint acepta el PIN (ni como contraseña, Bearer, credencial de tableta o refresh: probado).
- **Auditoría confidencial (cambio al contrato)**: `x-roles` de `GET /admin/audit/confidential-access` pasa de `[admin, behavioral_health]` a `[behavioral_health]` y se agrega `GET /me/confidential-access` para el astronauta (decidido con el responsable del backend).
- **Enumeración por bloqueo** (límite conocido): un usuario real se bloquea a los 5 fallos y uno inexistente nunca (sigue en 401), así que el 423 revela que la cuenta existe. El contrato pide el 423; el límite de login por IP (`RATE_LIMIT_LOGIN_PER_MINUTE`) acota el abuso.

**Despliegue y demo (tarea 12)**
- **Paso 0**: la auditoría de accesos confidenciales ya estaba implementada (tarea 11: `x-roles: [behavioral_health]`, `GET /me/confidential-access`, sin `x-status-impl: pending`); no se tocó.
- **Configuración**: `loadEnv(vars)` es pura y lanza `ConfigError`; `env.js` imprime el motivo con `[env]` y sale con 1. Las pruebas la llaman directo y un proceso real comprueba que `src/server.js` no arranca. Nombres de variables: los que ya existían; la única nueva es `OFFLINE_PIN_PBKDF2_ITERATIONS`.
- **JWT_SECRET** fuera de development/test: obligatorio, ≥ 32 caracteres, distinto del de desarrollo, sin palabras de ejemplo (change, secret, example, default, password…) y con ≥ 10 caracteres distintos. El mensaje nunca incluye el valor.
- **CORS**: fuera de development/test, `CORS_ORIGIN` vacío o `*` no arranca; cada origen se valida y normaliza (`URL.origin`: minúsculas, sin puerto por defecto, sin ruta). Un origen fuera de la lista no recibe `Access-Control-Allow-Origin` (no un 403): Swagger, que es del mismo origen, sigue funcionando y el navegador bloquea al resto. `render.yaml` deja `CORS_ORIGIN` con `sync: false` (antes fijaba `*`, que ahora tumbaría el deploy).
- **Logs**: morgan con la ruta sin los valores de la query (`?cursor=…`), nunca headers ni bodies; los errores 500 y los inesperados de sync y del triaje pasan por `describeError` (tipo, código, restricción y pila; sin `detail`/`where` de PostgreSQL, que traen la fila, y con los valores de "invalid input", JWT, `rt_` y `dc_` reemplazados).
- **Modo demo** = `SIMULATOR_ENABLED=true` y, fuera de development/test, `DEMO_SEED=true` (la base solo tiene datos sintéticos). Sin él, `POST /admin/demo/reset` da 404 antes de autenticar (como el simulador). El CLI se niega sin `--confirm ARES-1`, con `NODE_ENV=test` y en producción fuera del modo demo, siempre antes de abrir la base.
- **Confirmación**: `confirm` = el código de la misión (`ARES-1`), en el body del endpoint y como `--confirm` en el CLI.
- **Reinicio sin borrar**: se cierra o se marca; lo conductual se cierra pero no se cuenta (lo dispara admin). Las contraseñas se restauran solo si ya no son `Demo2026!` (así no se cierran sesiones sin necesidad).
- **PIN**: `OFFLINE_PIN_PBKDF2_ITERATIONS` (600 000, mínimo 10 000, regla de diseño): con un PIN de 4–8 dígitos la protección real es el límite de intentos y el almacén seguro; las iteraciones solo encarecen el ataque.

**Pruebas y herramientas**
- **Pruebas con base**:
  - usan siempre `DB_NAME_TEST` (`astro_health_test`); `test/helpers/db.js` cambia `DB_NAME` antes de cargar `src/` y se niega a correr si las dos bases coinciden;
  - si la base no existe la crea; sin permiso, la suite se salta con el comando para crearla;
  - cada suite la reinicia al empezar, bajo un advisory lock (`node --test` corre los archivos en paralelo).
- **Herramientas del contrato**: `npx` con versiones fijadas (`@redocly/cli@2.72.1`, `@stoplight/prism-cli@5.16.0`); no son dependencias.
- **Finales de línea**: LF en todo el repo por `.gitattributes` (`* text=auto eol=lf`, binarios aparte).
- **`prism proxy --errors`**: valida las respuestas reales contra el contrato. Una petición inválida (p. ej. un enum de query) la rechaza Prism con su propio 422 antes de llegar a la API: no es un fallo; el 400 real lo cubren las pruebas.

## Pendientes

- **Acceso, cosas a mirar**: el límite de fallos de credencial es en memoria (una sola instancia, como el de login). `offline_pins.failed_attempts` no se usa (los intentos del PIN los cuenta la app sin conexión). Un PIN débil (1111, 1234) se acepta: si se quiere, agregar una lista de PIN prohibidos (regla de diseño).
- **Pantalla Tripulación**: un tripulante ve las alertas de los demás pero no su hilo (`GET /escalations/{id}/messages` sigue siendo del dueño y, si es físico, del CMO). Si la app quiere abrirlo desde esta pantalla, decidirlo en `canAccess` y en el contrato.
- **Hilo de Tierra**: el panel no tiene un `GET` del hilo de un escalamiento (el contrato no lo define); lo ve a bordo con `GET /escalations/{id}/messages`. Si el panel lo necesita, agregarlo al contrato.
- **Bienestar, sin hacer** (fuera del MVP): `GET /me/gamification` (la racha va en la respuesta del check-in; faltan logros), `PUT /admin/indicators/{code}/rules` (behavioral_health editando reglas), audio en "Quiero hablar con alguien" (no está en el contrato), mensajes del astronauta en el hilo de apoyo (`support_messages` `to_earth` existe en la base pero no hay ruta), `interventions` (tabla sin endpoint), recordatorios de check-in/PHQ-2 (`reminders` no se llena) y agenda real de la conferencia psicológica (hoy `screening_due` es "cada 14 días"). La auditoría de accesos ya es real (tarea 11).
- **Bienestar, cosas a mirar**: el check-in tardío por sync de un día que ya tenía uno lo corrige aunque se haya medido antes (gana el último en llegar); si se quiere "gana el más reciente por `measured_at`", cambiar `currentCheckinOfDay`. La racha y "check-in hoy" usan el día UTC. La aptitud con PVT reciente hace que, tras la historia del simulador (PVT semanal), el dashboard muestre `not_confirmed` hasta que alguien haga una PVT.
- **Demo**: el reinicio no puede quitar lecturas de escenarios ensayados (append-only): ver `panel_flags` en "Día de la demo". Si se quiere, una "ronda de control" en el reinicio (lecturas normales nuevas de lo que quedó en critical) lo resolvería sin borrar; no se hizo porque agrega datos que nadie midió.
- **CORS**: faltan los orígenes reales del panel y de Expo web para `CORS_ORIGIN` en Render.
- **Integración (tarea 13)**: la app (`origin/frontend`, `nullradt/`) llama a `POST /api/v1/alerts` y manda `{ identifier, password }` en el login; el contrato usa `POST /emergency/sessions` y `{ username, password, device_id }`. Su `EXPO_PUBLIC_API_TIMEOUT_MS=8000` no aguanta el arranque en frío de Render (~50 s).
- **`GET /admin/sync/history`**: no está en el contrato, así que no se implementó. `sync_batches` ya tiene lo necesario (usuario, dispositivo, tamaño, conteos, offset y duración, sin payload): si el panel lo pide, agregarlo al contrato para admin y flight surgeon con metadatos y conteos totales, sin desglosar los tipos de bienestar.
- **Sync**: todos los tipos del contrato tienen servicio (`support_request` desde la tarea 10; un segundo check-in del día por sync es la corrección). Uno nuevo se agrega con `registerEntity(nombre, { when, handle })` en `syncEntities.js`.
- **Triaje, extras sin hacer**: detección de un evento de tripulación (`crew_event` solo existe como tipo de activación manual); activación por alarma del hábitat (`environment_alarm` se acepta del dispositivo y el contexto marca `co2`, pero una lectura crítica de CO₂ no abre sola la emergencia); estado `unreachable` de una evaluación (existe en el enum, ningún flujo lo pone); prellenado `maps_to` (fiebre desde `BODY_TEMP`): el protocolo no trae el umbral, así que el servidor no lo sugiere.
- **Triaje, cosas a mirar**: un corte cerrado hacia atrás ya no deja nada en el pasado (Paso 0), pero un evento que ya había llegado a Tierra no cambia. El reporte es una foto al cerrar: lo que llegue después por sync (p. ej. una evaluación tardía) está en la línea de tiempo del detalle, no en el reporte. El barrido del simulador adelanta el reloj (`expired_at` del plazo queda en el futuro unos segundos).
- **Prueba de historia del simulador**: la segunda carga ahora usa el mismo "ahora" que la primera; antes fallaba si las dos cargas caían a ambos lados de un horario de la historia (p. ej. la masa de las 06:50).
- **`reminders.delivered_at`** no se marca en el pull (sería escribir en un GET); los recordatorios se devuelven como estado.
- **`POST /attachments`** no está implementado. `POST /readings` ya acepta `attachment_id` si el adjunto existe y es del autor.
- **La base no hace cumplir** (lo hace la API): que las lecturas agrupadas en un check-in o una PVT sean del mismo astronauta, y recalcular `deliver_at` cuando cambia un corte (`missionAdmin.service.js` → `escalationDelivery.service.js`: cualquier otro camino que toque `mission_comm_outages` debe llamar a `recomputeAfterOutageChange`).

## Siguiente tarea

**Tarea 13: bugs de integración y code freeze en H44.**

- Antes: hacer en Render la lista de "Despliegue (Render)" (sobre todo `CORS_ORIGIN` **antes** del push) y confirmar el deploy con `npm run smoke -- --base=https://astro-health-api-81jd.onrender.com/api/v1`.
- Integrar la app y el panel contra la API desplegada: la app usa rutas y campos que no están en el contrato (`POST /api/v1/alerts`, `identifier` en el login) y un timeout de 8 s; el panel necesita su origen en `CORS_ORIGIN`.
- Corregir solo bugs de integración (contrato primero; sin migraciones ni endpoints nuevos salvo que bloqueen la demo). Code freeze en H44: después, solo el reinicio de demo y el respaldo.
- Ensayar el guion del README ("Día de la demo") de punta a punta con el reinicio entre ensayos; los escenarios, mejor en local (sus lecturas quedan en el panel de Render).
