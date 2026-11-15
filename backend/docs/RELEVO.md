# Relevo del backend

Cierre del **tramo 2** (despliegue + tarea 6), 2026-11-14, rama `backend`. El tramo 1 cerró las tareas 1–5.

## Estado

**Endpoints reales** (36 de 73; el resto lleva `x-status-impl: pending` en `docs/openapi.yaml` y sigue en el mock):

| Módulo | Endpoints |
|---|---|
| Sistema | `GET /health` |
| Auth | `POST /auth/login`, `/auth/change-password`, `/auth/refresh`, `/auth/logout`, `GET /me` |
| Cuentas (admin) | `POST /admin/users`, `/admin/users/{id}/reset-password`, `/admin/users/{id}/unlock` |
| Catálogo | `GET /indicators`, `/indicators/{code}`, `/rules`, `/body-zones`, `/symptoms` |
| Lecturas | `POST /readings`, `GET /me/readings`, `GET /me/body-status` |
| Hábitat | `POST /habitat/readings`, `GET /habitat/status` |
| Tierra (tarea 6) | `GET /admin/dashboard/crew`, `GET /admin/inbox`, `POST /admin/escalations/{id}/ack`, `POST /admin/escalations/{id}/messages`, `GET /escalations/{id}/messages` |
| Misión (tarea 6) | `GET`/`POST /admin/missions`, `PATCH /admin/missions/{id}`, `GET`/`POST /admin/environments`, `PATCH /admin/environments/{code}`, `GET`/`POST /admin/assignments`, `PATCH /admin/assignments/{id}`, `GET`/`POST /admin/comm-outages`, `PATCH /admin/comm-outages/{id}` |

**Piezas:**
- **Catálogo**: 26 indicadores (9 confidenciales), 112 reglas y 43 fuentes (`docs/catalogo-indicadores.json`, generado con `tools/build_catalog.py`).
- **Motor**:
  - evaluador común `src/engine/conditions.js` (semáforo y triaje);
  - campos derivados en `src/engine/derived.js` (puro);
  - servicio de evaluación `src/services/evaluation.service.js`;
  - triaje `src/engine/triage.js`.
- **Contrato**: `docs/openapi.yaml` v1.1 (73 operaciones). Mock con `npm run api:mock`, guía en `docs/api-guia-frontend.md`. `npm run api:lint`: 0 errores.
- **Base de datos**:
  - migraciones 000–008 (44 tablas; la 008 agrega índices de escalamiento) y seeds 001–003;
  - el seed del catálogo se genera con `node tools/build_catalog_seed.js` (`--check` avisa si quedó desactualizado).
- **Permisos**:
  - `src/middlewares/auth.js`: `authenticate`, `requireRole`, `requireCrewRole` y la lista blanca del rol `service`;
  - `src/services/accessPolicy.js`: `canAccess`, `enforceAccess` y la bitácora confidencial.
- **Pruebas**: `node --test` → **319 de 319**, sin saltadas, contra la base de pruebas `astro_health_test`. Incluyen la matriz de permisos, los derivados, el catálogo, el enrutamiento de escalamientos (unitarias, 8) y las suites de base de datos (humo 4, autenticación 14, semáforo 15, escalamiento y panel 15). Si la base de pruebas no existe, esas suites se saltan con el comando para crearla.
- **Escalamiento** (tarea 6):
  - `src/services/escalation.service.js`: enrutamiento por categoría y prioridad;
  - `src/services/escalationDelivery.service.js`: queued → delivered y recálculo de `deliver_at` por cortes;
  - `src/services/escalationInbox.service.js`: bandeja, acuse y mensajes (Tierra y a bordo);
  - `src/services/dashboard.service.js`: dashboard físico de la tripulación;
  - `src/services/missionAdmin.service.js`: misiones, entornos, asignaciones y cortes.
- **Despliegue**: `render.yaml` (Blueprint de Render) en la raíz del repo; arranque con `npm run start:deploy` (migra, siembra la demo si `DEMO_SEED=true` y arranca). Ver "Despliegue (Render)".

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
   npm run db:reset    # migraciones 000–007 + seeds (solo la base de desarrollo)
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

**Variables de entorno**:

| Variable | Valor | Notas |
|---|---|---|
| `NODE_ENV` | `production` | Activa `trust proxy` y exige `JWT_SECRET`. |
| `DATABASE_URL` | la *Internal Database URL* de Render | Reemplaza a las `DB_*`. |
| `DB_SSL` | `no-verify` | `false` si la base no acepta SSL; `true` verifica el certificado. |
| `JWT_SECRET` | aleatorio, ≥ 32 caracteres | El Blueprint lo genera (`generateValue`). A mano: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. |
| `CORS_ORIGIN` | `*` o URLs separadas por coma | Ej.: `https://panel.example.com,http://localhost:5173`. |
| `TRUST_PROXY` | `1` | Saltos de proxy; el rate limit ve la IP real del cliente. |
| `DEMO_SEED` | `true` | Solo en el despliegue de demo. Sin la bandera, `seed.js` se niega con `NODE_ENV=production`. |
| `NODE_VERSION` | `20` | |

`PORT` lo pone Render. El resto (`JWT_ACCESS_TTL`, `LOCKOUT_*`, etc.) tiene valores por defecto.

**Límites del plan gratuito**: el servicio se duerme tras ~15 min sin tráfico (la primera petición tarda ~50 s) y la base gratuita expira a los 30 días. El rate limit es en memoria: una sola instancia.

**Railway** (si Render falla): mismo código. Crea un PostgreSQL y un servicio desde el repo con *Root Directory* `backend`, *Start Command* `npm run start:deploy`, y las variables de arriba (`DATABASE_URL=${{Postgres.DATABASE_URL}}`; si no conecta, prueba `DB_SSL=false`).

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

`npm run db:reset` vuelve todo a este estado (solo en local; en Render, `db:reset` está deshabilitado con `NODE_ENV=production`). `node --test` **no toca** `astro_health`: usa la base de pruebas `astro_health_test` (`DB_NAME_TEST`).

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

**Pruebas y herramientas**
- **Pruebas con base**:
  - usan siempre `DB_NAME_TEST` (`astro_health_test`); `test/helpers/db.js` cambia `DB_NAME` antes de cargar `src/` y se niega a correr si las dos bases coinciden;
  - si la base no existe la crea; sin permiso, la suite se salta con el comando para crearla;
  - cada suite la reinicia al empezar, bajo un advisory lock (`node --test` corre los archivos en paralelo).
- **Herramientas del contrato**: `npx` con versiones fijadas (`@redocly/cli@2.72.1`, `@stoplight/prism-cli@5.16.0`); no son dependencias.
- **Finales de línea**: LF en todo el repo por `.gitattributes` (`* text=auto eol=lf`, binarios aparte).
- **`prism proxy --errors`**: valida las respuestas reales contra el contrato. Una petición inválida (p. ej. un enum de query) la rechaza Prism con su propio 422 antes de llegar a la API: no es un fallo; el 400 real lo cubren las pruebas.

## Pendientes

- **`delegated_actions.reported_to_ground_at`**: la tabla es append-only (trigger), así que el recálculo por cortes no puede actualizarla. Cuando se implementen las acciones delegadas, calcular la entrega al leer (o guardar el envío y derivar `deliver_at` con `compute_deliver_at`).
- **`GET /admin/emergencies` y `/{id}`** siguen pendientes (dependen de las sesiones de emergencia, tarea 9).
- **Hilo de Tierra**: el panel no tiene un `GET` del hilo de un escalamiento (el contrato no lo define); lo ve a bordo con `GET /escalations/{id}/messages`. Si el panel lo necesita, agregarlo al contrato.
- **Tarea 9**: `responder_safe` es una pregunta de la sesión. El servicio debe copiar esa respuesta en las respuestas de cada evaluación antes de llamar a `evaluateAssessment`; si no, el resultado es `incomplete` con `pending: "responder_safe"`. Una respuesta `{ value: null }` cuenta como pendiente.
- **Tarea 10 (bienestar)**: los derivados WB_* y PVT_* ya están en `derived.js` y el motor los usa. Faltan los endpoints `/wellbeing/*`, que deben agrupar las lecturas (`wellbeing_checkin_id`, `pvt_run_id`, `instrument_administration_id`).
  - **Regla para `PVT_LAPSES` critical** (decidida, sin implementar): el detalle (métricas de la PVT) va solo a `behavioral_health`, confidencial, como hoy. Además, el flight surgeon recibe **solo el estado** "aptitud no confirmada": una alerta `flight_surgeon` no confidencial, `source_type = wellbeing`, con un `reason` neutro y sin métricas (aparece en su bandeja con `category: wellbeing`; admin no la ve). Hoy `routeEvaluation` manda lo conductual solo a `behavioral_health`: al implementarlo, agrega ese segundo destino solo para PVT_LAPSES critical y su prueba.
- **`POST /attachments`** no está implementado. `POST /readings` ya acepta `attachment_id` si el adjunto existe y es del autor.
- **La base no hace cumplir** (lo hace la API): que las lecturas agrupadas en un check-in o una PVT sean del mismo astronauta, y recalcular `deliver_at` cuando cambia un corte (`missionAdmin.service.js` → `escalationDelivery.service.js`: cualquier otro camino que toque `mission_comm_outages` debe llamar a `recomputeAfterOutageChange`).

## Siguiente tarea

**Tarea 7: simulador de datos sintéticos** (`src/simulator/`, hoy vacío).

- Un proceso Node (`npm run sim`, p. ej. `scripts/simulate.js` + `src/simulator/`) que inicie sesión como `svc.habitat` (rol `service`) y envíe lotes a `POST /api/v1/habitat/readings` para `HAB-1` y `HAB-2` (CO₂, temperatura, humedad y ruido), con `client_uuid` nuevo por lectura y `source: simulator`.
- Escenarios para la demo: normal, subida de CO₂ hasta caution/critical (dispara escalamientos y aparece en `GET /admin/inbox` tras el retraso de 90 s) y vuelta a la normalidad.
- Opcional: lecturas fisiológicas sintéticas de la tripulación (como astronauta, con su login) para poblar el dashboard y las tendencias.
- Parámetros por variables o flags: URL base (local o Render), intervalo, escenario y semilla aleatoria para que sea reproducible.
- Todo marcado como sintético. El rol `service` solo puede llamar esa ruta (403 en cualquier otra).
- Pruebas: generador puro (semilla → serie), y una integración corta contra `astro_health_test`.
