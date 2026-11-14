# Relevo del backend

Cierre del **tramo 1** (tareas 1–5), 2026-11-14, rama `backend`.

## Estado

**Endpoints reales** (19 de 73; el resto lleva `x-status-impl: pending` en `docs/openapi.yaml` y sigue en el mock):

| Módulo | Endpoints |
|---|---|
| Sistema | `GET /health` |
| Auth | `POST /auth/login`, `/auth/change-password`, `/auth/refresh`, `/auth/logout`, `GET /me` |
| Cuentas (admin) | `POST /admin/users`, `/admin/users/{id}/reset-password`, `/admin/users/{id}/unlock` |
| Catálogo | `GET /indicators`, `/indicators/{code}`, `/rules`, `/body-zones`, `/symptoms` |
| Lecturas | `POST /readings`, `GET /me/readings`, `GET /me/body-status` |
| Hábitat | `POST /habitat/readings`, `GET /habitat/status` |

**Piezas:**
- **Catálogo**: 26 indicadores (9 confidenciales), 112 reglas y 43 fuentes (`docs/catalogo-indicadores.json`, generado con `tools/build_catalog.py`).
- **Motor**:
  - evaluador común `src/engine/conditions.js` (semáforo y triaje);
  - campos derivados en `src/engine/derived.js` (puro);
  - servicio de evaluación `src/services/evaluation.service.js`;
  - triaje `src/engine/triage.js`.
- **Contrato**: `docs/openapi.yaml` v1.1 (73 operaciones). Mock con `npm run api:mock`, guía en `docs/api-guia-frontend.md`. `npm run api:lint`: 0 errores.
- **Base de datos**:
  - migraciones 000–007 (44 tablas) y seeds 001–003;
  - el seed del catálogo se genera con `node tools/build_catalog_seed.js` (`--check` avisa si quedó desactualizado).
- **Permisos**:
  - `src/middlewares/auth.js`: `authenticate`, `requireRole`, `requireCrewRole` y la lista blanca del rol `service`;
  - `src/services/accessPolicy.js`: `canAccess`, `enforceAccess` y la bitácora confidencial.
- **Pruebas**: `node --test` → **295 de 295**, sin saltadas, contra la base de pruebas `astro_health_test`. Incluyen la matriz de permisos, los derivados, el catálogo y las suites de base de datos (humo 4, autenticación 14, semáforo 15). Si la base de pruebas no existe, esas 33 se saltan con el comando para crearla.
- **Escalamiento**: solo el mínimo. Las lecturas crean filas en `escalations`; la bandeja, el acuse y los mensajes son la tarea 6.

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
6. Mock para los frontends: `npm run api:mock` (`:4010`).
7. Si cambias el catálogo: `python tools/build_catalog.py`, luego `node tools/build_catalog_seed.js` y `npm run db:reset`.

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

`npm run db:reset` vuelve todo a este estado. `node --test` **no toca** `astro_health`: usa la base de pruebas `astro_health_test` (`DB_NAME_TEST`).

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
- **Escalamiento mínimo** (`TODO(tarea 6)` en `src/services/escalation.service.js`):
  - `crew` se entrega a bordo de inmediato (`delivered`);
  - `flight_surgeon` queda `queued` con `deliver_at = compute_deliver_at(misión, now())`;
  - si el nivel es critical y va a Tierra, se avisa también a `crew`;
  - prioridad: critical = `urgent`, caution = `routine`.
- **Body-status**:
  - los confidenciales no aportan color; en `brain` solo cuenta `SLEEP_HOURS`;
  - `checkin_completed` = hubo check-in hoy (día UTC);
  - la tarjeta `environment` es el `module_id` pedido o el módulo con la lectura del hábitat más reciente;
  - `SYMPTOM` aparece en la zona de cada síntoma reportado.

**Pruebas y herramientas**
- **Pruebas con base**:
  - usan siempre `DB_NAME_TEST` (`astro_health_test`); `test/helpers/db.js` cambia `DB_NAME` antes de cargar `src/` y se niega a correr si las dos bases coinciden;
  - si la base no existe la crea; sin permiso, la suite se salta con el comando para crearla;
  - cada suite la reinicia al empezar, bajo un advisory lock (`node --test` corre los archivos en paralelo).
- **Herramientas del contrato**: `npx` con versiones fijadas (`@redocly/cli@2.72.1`, `@stoplight/prism-cli@5.16.0`); no son dependencias.

## Pendientes

- **Despliegue**: activar `app.set('trust proxy', 1)` detrás del proxy de Render/Railway, para que el rate limit vea la IP real del cliente.
- **Tarea 9**: `responder_safe` es una pregunta de la sesión. El servicio debe copiar esa respuesta en las respuestas de cada evaluación antes de llamar a `evaluateAssessment`; si no, el resultado es `incomplete` con `pending: "responder_safe"`. Una respuesta `{ value: null }` cuenta como pendiente.
- **Tarea 10 (bienestar)**: los derivados WB_* y PVT_* ya están en `derived.js` y el motor los usa. Faltan los endpoints `/wellbeing/*`, que deben agrupar las lecturas (`wellbeing_checkin_id`, `pvt_run_id`, `instrument_administration_id`).
- **`POST /attachments`** no está implementado. `POST /readings` ya acepta `attachment_id` si el adjunto existe y es del autor.
- **La base no hace cumplir** (lo hace la API): que las lecturas agrupadas en un check-in o una PVT sean del mismo astronauta, y recalcular `deliver_at` cuando se cierra un corte de comunicación.

## Siguiente tarea

**Tarea 6 (tramo 2): escalamiento y panel de Tierra.** Servicio de escalamiento con `compute_deliver_at` y enrutamiento por categoría, más `/admin`: dashboard, bandeja, acuse y mensajes con retraso.

Archivos a tocar:
- `src/services/escalation.service.js`: reemplazar el `TODO(tarea 6)`.
  - Enrutamiento por `category` y prioridad.
  - Transición `queued → delivered` cuando pasa `deliver_at`: al leer la bandeja o con un job periódico.
  - Recálculo de `deliver_at` para lo que quedó en cola (NULL) al cerrar un corte.
- `src/models/escalations.model.js`: bandeja (`v_ground_inbox`), acuse y mensajes (`escalation_messages` con `compute_deliver_at`).
- Rutas, controladores y servicios nuevos:
  - `GET /admin/inbox`, `POST /admin/escalations/{id}/ack`, `POST /admin/escalations/{id}/messages`;
  - `GET /escalations/{id}/messages` (astronauta, solo lo ya entregado);
  - `GET /admin/dashboard/crew`, siempre sobre `v_readings_standard` + `reading_evaluations`;
  - `GET /admin/emergencies` y `/{id}`.
- Pasar por `accessPolicy`: el flight surgeon solo lee y responde con mensajes; `admin` ve solo cumplimiento y aptitud de bienestar (`fitnessForAdmin`).
- Pruebas `test/escalations.integration.test.js`, con un corte de comunicación que deja `deliver_at` NULL y otro que lo retrasa.
- Contrato: quitar `x-status-impl: pending` de esas operaciones y verificar con `prism proxy --errors`.
