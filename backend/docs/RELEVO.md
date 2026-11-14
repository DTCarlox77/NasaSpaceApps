# Relevo del backend

## Estado

Al 2026-11-14, rama `backend`:

- **Catálogo**: 26 indicadores (9 confidenciales), 112 reglas y 43 fuentes en `docs/catalogo-indicadores.json`. Evaluador común en `src/engine/conditions.js`; el triaje (`triage.js`) lo usa.
- **Contrato**: `docs/openapi.yaml` v1.1, con 73 operaciones (66 mvp y 7 extra). Mock con `npm run api:mock` y guía en `docs/api-guia-frontend.md`. `npm run api:lint`: 0 errores.
- **Base de datos**: migraciones 000–007 (44 tablas) y seeds 001–003. `npm run db:reset` corre limpio y los seeds son idempotentes. El seed del catálogo se genera con `node tools/build_catalog_seed.js` (`--check` avisa si quedó desactualizado).
- **Autenticación y permisos (tarea 4)**:
  - endpoints: `POST /auth/login`, `/auth/change-password`, `/auth/refresh`, `/auth/logout`, `GET /me`, `POST /admin/users`, `/admin/users/{id}/reset-password` y `/admin/users/{id}/unlock`;
  - middlewares en `src/middlewares/auth.js`: `authenticate`, `requireRole`, `requireCrewRole` y la lista blanca del rol `service`;
  - política de acceso en `src/services/accessPolicy.js`;
  - rate limit de login en `src/middlewares/authRateLimit.js`.
- **Pruebas**: `node --test` da 269 (incluye la matriz de permisos y 14 pruebas de integración con supertest). Las suites de base se saltan solas si no hay conexión.
- **Pendiente de implementar**: el resto de los endpoints del contrato (lecturas, hábitat, sync, emergencia, bienestar y panel) y la traducción oficial de PHQ-2/GAD-2 (ver Pendientes).

## Cómo levantar el proyecto

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

`npm run db:reset` vuelve todo a este estado. **`node --test` también reinicia la base local** (antes y después de la suite de integración).

## Decisiones

- Respuestas del triaje: `{ "value": … }` para sí/no y números, `{ "choice": "<código>" }` para opciones; el adaptador también acepta valores sueltos.
- Bandera de radiación = `none` si el recorrido no pasa por el módulo de radiación (incluida la categoría negra).
- **Lecturas confidenciales**: el dashboard y todas las consultas del panel usan la vista `v_readings_standard` (`readings` JOIN `indicators` WHERE `sensitivity = 'standard'`), **nunca** `readings` directo. La vista se creó con `r.*`: si `readings` gana columnas, hay que recrearla.
- **Lecturas append-only**: un trigger impide UPDATE y DELETE. Una corrección es una lectura nueva con `supersedes_uuid` (del mismo autor y una sola vez; una segunda corrección es 409). `client_uuid` es único por autor (`recorded_by`). Equivalencias con el contrato: `components` = `values` y `source` = `input_method` (o el `source` de `/habitat/readings`).
- **Adjuntos en la base**: columna `data` bytea de hasta 5 MB, porque en Render/Railway el disco se borra en cada deploy. Un CHECK verifica `sha256` y `size_bytes`. No selecciones `data` en los listados.
- **Reglas versionadas**: una sola versión activa por indicador y la última regla debe ser `{ "all": [] }`. El `id` de la versión es el `audit_id` de `PUT /admin/indicators/{code}/rules`.
- **Escalamientos**: `category` (`physical|behavioral|emergency`) se deriva de `source_type` con un trigger, y `is_confidential` es siempre true si `level = behavioral_health`. `v_ground_inbox` excluye los confidenciales. El filtro de la bandeja del contrato (`reading|emergency|wellbeing|manual`) se traduce desde `source_type`.
- **Equipo en Tierra**: si no se indica `function`, se deriva del rol. `behavioral` solo va con el rol `behavioral_health`. Astronautas y cuentas `service` no pueden ser parte del equipo.
- **Rol `service`**: solo puede llamar `POST /habitat/readings` (lo hace cumplir la API). Se vincula a su misión con `service_accounts`, porque el body del contrato no trae la misión.
- **Tripulación vigente**: `v_current_crew` usa `assigned_from <= now() < assigned_to`, así que un `assigned_to` futuro es válido (contrato v1.1). Comandante y CMO no pueden tener periodos solapados (`EXCLUDE`).
- **`synthetic`**: `DEFAULT true` en todas las tablas que lo tienen.
- **Credenciales**:
  - tabletas: se guarda el SHA-256 de la credencial (es aleatoria, no una contraseña);
  - PIN offline: bcrypt; un reset del comandante deja `pin_hash` en NULL;
  - en `auth_events`, `account_locked` cubre el bloqueo (no hay `lockout`).
- **Tablas append-only** (`confidential_access_log`, `delegated_actions`, `readings`): sus FK son `ON DELETE RESTRICT`, porque un `SET NULL` sería un UPDATE que el trigger bloquea. A los usuarios se los desactiva (`is_active`), no se los borra.
- **Herramientas del contrato**: `npx` con versiones fijadas (`@redocly/cli@2.72.1`, `@stoplight/prism-cli@5.16.0`); no son dependencias.
- **Tokens**:
  - access token: JWT HS256 de 15 minutos (`JWT_ACCESS_TTL`), con los claims `sub`, `role`, `did` (dispositivo), `scope` y `pcv`;
  - `pcv` es la versión de la contraseña (`password_changed_at`): al cambiarla o al hacer un reset, todos los access tokens anteriores dejan de servir;
  - refresh token: opaco (`rt_…`), de 7 días (`JWT_REFRESH_TTL`), ligado al `device_id`; en la base solo se guarda su SHA-256.
- **Refresh rotativo**: cada uso revoca el token y crea uno nuevo (`replaced_by`). Si se reusa un token ya rotado, se revoca la familia (el token y toda la cadena `replaced_by` que lo siguió), se registra `token_reuse_detected` y se responde 401. Un token revocado por logout o por cambio de contraseña da 401 `UNAUTHENTICATED`, no reuso.
- **Cambio obligatorio (428)**: el login devuelve en `error.details.password_change_token` un JWT con `scope: password_change` que vence en 10 minutos. Es de un solo uso porque al cambiar la contraseña cambia `pcv`. Con ese token, o con `must_change_password`, solo se pueden usar `change-password` y `logout`; el resto responde 428.
- **Bloqueo y mensajes**:
  - 5 fallos (`LOCKOUT_MAX_ATTEMPTS`) bloquean la cuenta 15 minutos (`LOCKOUT_MINUTES`) y responden 423 con `locked_until`;
  - el 401 de login es idéntico exista o no el usuario: `details` es null y, cuando el usuario no existe, se compara contra un hash de relleno para que la respuesta tarde lo mismo;
  - cada intento queda en `auth_events`.
- **Rate limit**: en memoria y por IP (30 logins/minuto, `RATE_LIMIT_LOGIN_PER_MINUTE`), sin dependencias nuevas. Sirve para una sola instancia; con varias haría falta un almacén compartido. Detrás de un proxy (Render/Railway) habrá que configurar `trust proxy` para que `req.ip` sea la del cliente.
- **Rol `service`**: un middleware global (`restrictServiceAccounts`) responde 403 a toda ruta fuera de `POST /api/v1/habitat/readings`, incluidas las que no existen.
- **Política de acceso**: `canAccess(actor, resource)` es pura y la única fuente de verdad. Los servicios usan `enforceAccess`, que responde 403 si se niega y registra en `confidential_access_log` cada lectura confidencial permitida. El actor se arma con `loadActor(userId)`. `admin` no está acotado por misión (rol global de operaciones); el resto sí.
- **Altas**: la contraseña temporal (12 caracteres, `TEMP_PASSWORD_LENGTH`) se devuelve una sola vez y solo se guarda su hash bcrypt. Si a un rol de Tierra no se le indican misiones, entra al equipo de las misiones activas del admin que lo crea.
- **Pruebas con base**: `db:reset` antes y después de cada suite de integración, bajo un advisory lock de PostgreSQL (`test/helpers/db.js`), porque `node --test` corre los archivos en paralelo. Una transacción que se deshace no sirve: la app usa sus propias conexiones del pool.

## Pendientes

- Tarea 9: `responder_safe` es una pregunta de la sesión. El servicio debe copiar esa respuesta en las respuestas de cada evaluación antes de llamar a `evaluateAssessment`; si no, el resultado es `incomplete` con `pending: "responder_safe"`.
- Una respuesta `{ value: null }` cuenta como pendiente.
- PHQ-2 y GAD-2: el seed 003 todavía usa una **redacción adaptada** al español. La traducción oficial está detrás del botón "Agree" de https://www.phqscreeners.com/terms, que no se pudo abrir de forma automática. Falta el enlace directo al PDF en español para reemplazar los textos y la licencia.

## Siguiente tarea
