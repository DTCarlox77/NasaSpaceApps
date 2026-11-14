# Guía de la API para los frontends (app móvil y panel web)

Contrato completo: [`docs/openapi.yaml`](openapi.yaml) (OpenAPI 3.0.3, v1). Si esta guía y el YAML difieren, manda el YAML.

> Datos sintéticos. La app es apoyo a la decisión, no un diagnóstico médico.

## 1. Levantar el mock

Requiere Node 20+ (la primera vez descarga Prism con `npx`). Desde `backend/`:

```bash
npm run api:mock      # Prism en http://localhost:4010
npm run api:lint      # valida el contrato (Redocly)
```

- **Mismas rutas en el mock y en la API real**: solo cambia el host. Mock `http://localhost:4010`, API real `http://localhost:3000`. Todas las rutas empiezan por `/api/v1`.
- El mock devuelve los ejemplos del contrato (datos del seed: misión ARES-1, ORION, VEGA, LYRA, ATLAS, dr.reyes, mission.control).
- Los endpoints protegidos exigen `Authorization: Bearer <lo que sea>` (sin header → 401) y el mock valida el body (inválido → 400).
- Para pedir otra respuesta documentada, usa el header `Prefer`:
  - `Prefer: code=201`: en los endpoints idempotentes el mock responde por defecto el **200 de duplicado**; con esto ves el 201 de creación (el body es el mismo).
  - `Prefer: code=423` / `code=428`: login bloqueado o con cambio de contraseña obligatorio.
  - `Prefer: example=stopped`: elige un ejemplo por nombre (los nombres están en el YAML).
- Swagger UI de la API real: `npm run dev` y abre <http://localhost:3000/api/docs>.

```bash
curl -s -X POST http://localhost:4010/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"a.ortega","password":"Demo2026!","device_id":"ipad-crew-01"}'

curl -s http://localhost:4010/api/v1/me/body-status -H 'Authorization: Bearer demo'
```

## 2. Login, cambio obligatorio y refresh

1. `POST /api/v1/auth/login` con `{ username, password, device_id }`.
   - **200**: guarda `access_token` (1 h) y `refresh_token`. `context` trae la misión y el rol de tripulación; el astronauta nunca elige misión.
   - **428 `PASSWORD_CHANGE_REQUIRED`**: llama a `POST /auth/change-password` con `Authorization: Bearer <error.details.password_change_token>`. Responde como un login completo.
   - **423 `ACCOUNT_LOCKED`**: muestra `error.details.locked_until`. Tras 5 intentos fallidos; lo desbloquea admin o el comandante.
   - **401 `INVALID_CREDENTIALS`**: mismo mensaje exista o no el usuario.
2. Cuando el access token expira (cualquier 401 `UNAUTHENTICATED`), llama a `POST /auth/refresh` con `{ refresh_token, device_id }` y **reemplaza los dos tokens**: el refresh es rotativo y el anterior deja de servir.
3. Si refresh responde **401 `TOKEN_REUSE_DETECTED`**, se revocó toda la sesión: vuelve al login.
4. `POST /auth/logout` revoca el refresh del dispositivo.

## 3. Lecturas sin conexión

- Cada registro creado en el dispositivo lleva un `client_uuid` (UUID v4) **generado una sola vez**, al crearlo. En los reintentos se reutiliza el mismo: el servidor responde 200 con el registro existente en vez de duplicarlo.
- `measured_at` es la hora del dispositivo (UTC); `received_at` lo pone el servidor.
- Para corregir una lectura, crea una nueva con `supersedes_uuid` = el `client_uuid` de la anterior. Nunca se borra.
- Sin conexión, guarda cada operación en una cola local y envíala en lotes (máximo 500) con `POST /api/v1/sync/push`. Cada item lleva `{ client_uuid, entity, priority, created_at, payload }`; `payload` tiene el mismo body que el endpoint en línea. Las emergencias van con `priority: "emergency"` (el servidor las procesa primero).
- Qué hacer con cada resultado del lote:

| `status` | Acción |
|---|---|
| `accepted` | Quítalo de la cola. `result` trae la evaluación si aplica. |
| `duplicate` | Ya estaba; quítalo de la cola. |
| `conflict` | Choca con el servidor (p. ej. ya hay una sesión de emergencia activa: únete a `error.details.session_id`). |
| `rejected` | Inválido: no lo reintentes tal cual; muestra `error.message`. |

- Al volver la conexión, llama a `GET /api/v1/sync/pull?cursor=<último>`. Trae mensajes de Tierra ya entregados y recordatorios. Si `rules.changed`, descarga `GET /rules`; si `protocol.changed`, descarga `GET /emergency/protocol`. Guarda el `cursor` nuevo y repite mientras `has_more`.
- Respuestas del triaje: `{ "value": true }` para sí/no y números, `{ "choice": "1_2h" }` para opciones y `{ "choice": ["nausea", "fatigue"] }` para opción múltiple.

## 4. Semáforo y figura humana

- Niveles: `normal`, `caution`, `critical` y `unrated` (sin evaluar: no hay dato válido o falta línea base). No muestres `unrated` como "bien".
- `GET /api/v1/me/body-status` → `zones[]`: pinta cada zona con `worst_level` (`critical` > `caution` > `normal` > `unrated`). Cada indicador trae `level`, `recommendation` (muéstrala tal cual) y `last_value`.
- Tras `POST /readings` usa `evaluation` de la respuesta: es el resultado de `evaluateIndicator` (`level`, `recommendation`, `escalation`, `rule_index`, `rules_version`, `basis`, `source_ids`). Si trae `escalation_id`, se avisó a la tripulación o a Tierra.
- Sin conexión, la app evalúa con las reglas de `GET /rules` y `src/engine/conditions.js`, el mismo código que el servidor; al sincronizar manda el resultado del servidor.
- El entorno del módulo (CO₂, temperatura, humedad, ruido) no es una zona del cuerpo: es una tarjeta aparte con `GET /api/v1/habitat/status`.
- Bienestar **nunca** aparece en el semáforo: al astronauta solo se le muestran mensajes neutros (`message`), sin colores ni puntajes.
- Lo que viaja a Tierra lleva `deliver_at` (retraso + cortes). `deliver_at: null` = en cola esperando enlace: muéstralo como "pendiente de envío".

## 5. Formato de errores

Siempre `{ "error": { "code", "message", "details" } }`. Programa contra `code`, no contra `message`.

| HTTP | `code` | Uso |
|---|---|---|
| 400 | `VALIDATION_ERROR` (o uno específico, p. ej. `WEAK_PASSWORD`) | `details` lista los campos. |
| 401 | `UNAUTHENTICATED`, `INVALID_CREDENTIALS`, `TOKEN_REUSE_DETECTED` | Refresh o volver al login. |
| 403 | `FORBIDDEN`, `NO_ACTIVE_ASSIGNMENT` | El rol no puede hacer esto. |
| 404 | `NOT_FOUND` | |
| 409 | `CONFLICT`, `USERNAME_TAKEN`, `CREW_ROLE_TAKEN`, `ASSIGNMENT_OVERLAP`, `OUTAGE_OVERLAP`, `SESSION_ALREADY_ACTIVE` | `details` dice con qué choca. |
| 413 | `PAYLOAD_TOO_LARGE` | Foto de más de 5 MB. |
| 423 | `ACCOUNT_LOCKED` | `details.locked_until`. |
| 428 | `PASSWORD_CHANGE_REQUIRED` | `details.password_change_token`. |
| 429 | `RATE_LIMITED` | Espera `Retry-After` segundos. |

## 6. Qué ve cada rol

Cada operación del YAML trae `x-roles` (quién puede llamarla), `x-crew-role` (si exige comandante o CMO) y `x-sensitivity: confidential` (bienestar).

| Rol | App / panel | Ve |
|---|---|---|
| `astronaut` | App móvil | Lo suyo: lecturas, figura, bienestar propio, emergencia. El comandante tiene además acciones delegadas (`/crew/...`). |
| `flight_surgeon` | Panel | Semáforo físico de la tripulación, bandeja (`/admin/inbox`), emergencias y alertas de bienestar escaladas (solo estado). |
| `behavioral_health` | Panel | Detalle confidencial de bienestar (`/admin/behavioral/...`). Cada acceso queda auditado. |
| `admin` | Panel | Cuentas, dispositivos, misiones y entornos; de bienestar, solo cumplimiento y aptitud `fit` / `not_confirmed`. |
| Tableta sin sesión | App móvil | Solo emergencia, con `X-Device-Credential`. |

La tripulación no ve nada del bienestar de los demás.

## 7. MVP y extra

`x-status` en cada operación: 66 son `mvp` y 7 son `extra` (se pueden dejar para el final):

- `PUT /me/offline-pin`
- `POST /crew/users/{id}/unlock`, `POST /crew/users/{id}/reset-pin`, `POST /crew/devices`
- `GET /me/routines`, `GET /me/gamification`
- `PUT /admin/indicators/{code}/rules`
