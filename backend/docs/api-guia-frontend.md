# Guía de la API para los frontends (app móvil y panel web)

Contrato completo: [`docs/openapi.yaml`](openapi.yaml) (OpenAPI 3.0.3, v1.4). Si esta guía y el YAML difieren, manda el YAML. Los cambios desde v1 están en la [sección 8](#8-cambios-del-contrato-v11-a-v14).

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
   - **200**: guarda `access_token` (15 min, `JWT_ACCESS_TTL`) y `refresh_token` (7 días, `JWT_REFRESH_TTL`). `context` trae la misión y el rol de tripulación; el astronauta nunca elige misión.
   - **428 `PASSWORD_CHANGE_REQUIRED`**: llama a `POST /auth/change-password` con `Authorization: Bearer <error.details.password_change_token>`. Responde como un login completo.
   - **423 `ACCOUNT_LOCKED`**: muestra `error.details.locked_until`. Tras 5 intentos fallidos; lo desbloquea admin o el comandante.
   - **401 `INVALID_CREDENTIALS`**: mismo mensaje exista o no el usuario.
2. Cuando el access token expira (cualquier 401 `UNAUTHENTICATED`), llama a `POST /auth/refresh` con `{ refresh_token, device_id }` y **reemplaza los dos tokens**: el refresh es rotativo y el anterior deja de servir.
3. Si refresh responde **401 `TOKEN_REUSE_DETECTED`**, se revocó toda la sesión: vuelve al login.
4. `POST /auth/logout` revoca el refresh del dispositivo.

## 3. Sin conexión: cola local y sincronización

La app trabaja sin enlace y sincroniza al volver: **sube** lo que hizo (`POST /sync/push`) y **baja** lo nuevo (`GET /sync/pull`). Las dos son solo del astronauta y ya son reales (tarea 8).

### Cola en SQLite

- Cada registro creado en el dispositivo lleva un `client_uuid` (UUID v4) **generado una sola vez, al crearlo**, y se guarda en la cola local (SQLite) junto con su `entity`, `priority`, `created_at` y `payload`. **En cada reintento se manda el mismo `client_uuid`**: es la clave de idempotencia (un reintento responde `duplicate`, nunca duplica).
- `measured_at` es la hora del dispositivo (UTC) y va dentro del `payload`; `received_at` lo pone el servidor. El servidor no corrige la hora del dispositivo.
- Para corregir una lectura, encola una nueva con `supersedes_uuid` = el `client_uuid` de la anterior (y un `client_uuid` nuevo). Nunca se borra ni se sobrescribe. Solo se puede corregir una vez.
- `payload` = el mismo body que el endpoint en línea, sin `client_uuid` (va en el item):

| `entity` | `payload` igual a |
|---|---|
| `reading` | `POST /readings` |
| `habitat_reading` | un elemento de `POST /habitat/readings` (lectura manual del módulo) |
| `wellbeing_checkin` | `POST /wellbeing/checkins` (`mood`, `fatigue`, `stress`, `crew_conflict` enteros 0–100, `sleep_hours` opcional, `private_note` opcional). Un segundo check-in el mismo día corrige al anterior (`result.supersedes_id`). |
| `pvt_run` | `POST /wellbeing/pvt-runs` |
| `wellbeing_screening` | `POST /wellbeing/screenings` (PHQ-2 / GAD-2) |
| `emergency_session` · `emergency_assessment` · `emergency_answer` · `emergency_complete` · `emergency_confirm` · `emergency_heartbeat` · `emergency_question` · `emergency_close` | Los endpoints de `/emergency/*` (sección 10). Van **antes que todo** aunque el item diga `normal`. Las referencias (`session_id`, `assessment_id`) aceptan el `client_uuid`: sin conexión no conoces los id del servidor. |
| `support_request` | `POST /wellbeing/support-requests` ("Quiero hablar con alguien", sección 11). |

### Subir: `POST /sync/push`

```json
{ "device_id": "ipad-crew-01", "sent_at": "2026-11-14T08:00:00Z",
  "items": [ { "client_uuid": "…", "entity": "reading", "priority": "normal",
               "created_at": "2026-11-14T02:00:05Z",
               "payload": { "indicator_code": "SPO2", "measured_at": "2026-11-14T02:00:00Z",
                            "values": { "value": 89 }, "input_method": "wearable" } } ] }
```

Lote de ejemplo completo (24 h sin conexión, con un crítico, una corrección y un duplicado): [`docs/examples/sync-push.json`](examples/sync-push.json).

- `device_id` debe ser el de tu sesión (el del login) o una tableta registrada de la misión (`TAB-1`, `TAB-2`); otro → 403 `DEVICE_NOT_OWNED`.
- Máximo **500 items** por lote (más → 413 `PAYLOAD_TOO_LARGE`): divide la cola en lotes. Manda primero los de `priority: "emergency"`.
- El servidor procesa primero `emergency`, luego los **críticos** (los detecta él con sus valores) y luego el resto por `measured_at`; `sequence` dice el orden real. Cada item va aparte: uno malo no tumba el lote.
- `results` viene **en el mismo orden que `items`**. Qué hacer con cada uno:

| `status` | Acción |
|---|---|
| `accepted` | Quítalo de la cola. `result` trae lo mismo que el endpoint en línea (`evaluation`, `escalation_id`; de bienestar, solo `message` neutro, `offer_support`, `streak`…; de `support_request`, `deliver_at` y `suggestions`) y `late_sync` / `lag_s`. |
| `duplicate` | Ya estaba (un reintento): quítalo de la cola. `server_id` es el registro existente. |
| `conflict` | No lo reintentes igual. `PAYLOAD_MISMATCH`: ese `client_uuid` ya existe con otro contenido (un bug: nunca reutilices un `client_uuid` para otra cosa); si querías corregir, crea una corrección con `supersedes_uuid` y un `client_uuid` nuevo. `SUPERSEDE_CONFLICT`: esa lectura ya se corrigió; muestra la vigente. Quítalo de la cola y avisa al usuario. |
| `rejected` | Inválido: no lo reintentes tal cual. `VALIDATION_ERROR` (`details` dice el campo, p. ej. `payload.mood`), `FUTURE_TIMESTAMP` (el reloj del dispositivo está adelantado más de 5 min: pide revisar la hora), `UNKNOWN_ENTITY`. `ENTITY_NOT_SUPPORTED`: déjalo en la cola para cuando el servidor lo acepte. |

- **Errores del lote completo** (no hay `results`): sin red, 5xx o 429 → reintenta el **mismo** lote con backoff exponencial y jitter (p. ej. 2 s, 4 s, 8 s… hasta 5 min); como todo es idempotente, reintentar nunca duplica. 401 → refresh del token y reintenta. 403/400/413 → no reintentes igual.
- `clock_offset_s` = recepción − `sent_at`: si es muy grande, el reloj del dispositivo está desfasado (solo informativo).
- **Llegó tarde** (`late_sync: true`, más de 15 min entre la medición y la recepción): la lectura se evalúa con su `measured_at` y, si escala, el aviso sale **desde ahora** (Tierra lo recibe tras el retraso de la misión). Un crítico viejo sigue escalando. El panel muestra "registrado hace X h" con `measured_at` / `lag_s` de la bandeja.

### Bajar: `GET /sync/pull?cursor=&limit=`

- Llámalo al reconectar (después del push), al abrir la app y cada pocos minutos mientras haya enlace. Guarda el `cursor` que devuelve y mándalo la próxima vez; si `has_more`, vuelve a llamar enseguida. Sin cursor, empieza desde el principio (instalación nueva). El mismo cursor devuelve lo mismo: si una llamada falla, repítela con el cursor anterior.
- Trae, desde tu cursor (`limit` en total, 50 por defecto, hasta 200):
  - `evaluations`: el resultado del servidor para tus lecturas estándar (incluidas las del push). Reemplaza el resultado que calculó la app sin conexión. `supersedes_uuid` marca correcciones.
  - `escalations`: tus alertas que ya llegaron a su destino.
  - `messages`: respuestas de Tierra **ya entregadas** (`deliver_at <= ahora`): `channel: "escalation"` (flight surgeon) o `channel: "support"` (salud conductual, a tus solicitudes de apoyo; `thread_id` = id de la solicitud). Durante un corte no llega nada (en `mission.link.status: "outage"`).
- Y el estado actual: `rules.changed` → descarga `GET /rules`; `protocol.changed` → `GET /emergency/protocol`; `catalog` y `mission` (retraso, enlace `up` / `outage`) con su versión; `reminders` pendientes y `routines` activas.
- Bienestar: el pull **nunca** trae niveles ni alertas de bienestar (tampoco las tuyas): solo mensajes neutros.
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
| 403 | `FORBIDDEN`, `NO_ACTIVE_ASSIGNMENT`, `DEVICE_NOT_OWNED` | El rol no puede hacer esto (o el dispositivo del lote no es tuyo). |
| 404 | `NOT_FOUND` | |
| 409 | `CONFLICT`, `USERNAME_TAKEN`, `CREW_ROLE_TAKEN`, `ASSIGNMENT_OVERLAP`, `OUTAGE_OVERLAP`, `SESSION_ALREADY_ACTIVE` | `details` dice con qué choca. |
| 413 | `PAYLOAD_TOO_LARGE` | Foto de más de 5 MB o lote de sync con más de 500 items. |
| 423 | `ACCOUNT_LOCKED` | `details.locked_until`. |
| 428 | `PASSWORD_CHANGE_REQUIRED` | `details.password_change_token`. |
| 429 | `RATE_LIMITED` | Espera `Retry-After` segundos. |

## 6. Qué ve cada rol

Cada operación del YAML trae `x-roles` (quién puede llamarla), `x-crew-role` (si exige comandante o CMO) y `x-sensitivity: confidential` (bienestar).

| Rol | App / panel | Ve |
|---|---|---|
| `astronaut` | App móvil | Lo suyo: lecturas, figura, bienestar propio, emergencia. El comandante tiene además acciones delegadas (`/crew/...`). |
| `flight_surgeon` | Panel | Semáforo físico de la tripulación, bandeja (`/admin/inbox`), emergencias, la alerta de bienestar que el catálogo le escala (`PVT_LAPSES` crítico: solo "aptitud no confirmada", sin métricas) y aptitud `fit` / `not_confirmed`. Nunca los valores del check-in ni la nota. |
| `behavioral_health` | Panel | Detalle confidencial de bienestar (`/admin/behavioral/...`): valores, tendencias, z, cuestionarios, PVT y solicitudes de apoyo (nunca la nota privada del check-in). Cada lectura queda auditada. |
| `admin` | Panel | Cuentas, dispositivos, misiones y entornos; de bienestar, solo cumplimiento (`/admin/compliance`) y aptitud `fit` / `not_confirmed`. Nunca valores, tendencias ni solicitudes. |
| Tableta sin sesión | App móvil | Solo emergencia, con `X-Device-Credential`. |
| `service` | Sensores y simulador | Solo `POST /api/v1/habitat/readings`. Cualquier otra ruta responde 403. |

La tripulación no ve nada del bienestar de los demás: ni el comandante ni el oficial médico (CMO), tampoco las solicitudes de apoyo.

## 7. MVP y extra

`x-status` en cada operación: 69 son `mvp` y 9 son `extra` (se pueden dejar para el final):

- `PUT /me/offline-pin`
- `POST /crew/users/{id}/unlock`, `POST /crew/users/{id}/reset-pin`, `POST /crew/devices`
- `GET /me/routines`, `GET /me/gamification`
- `PUT /admin/indicators/{code}/rules`
- `POST /admin/simulator/history`, `POST /admin/simulator/scenarios/{name}` (solo demo)

## 8. Cambios del contrato (v1.1 a v1.4)

- **Rol `service`**: cuenta de servicio de los sensores y del simulador del hábitat. Solo puede llamar `POST /api/v1/habitat/readings` (`x-roles: [astronaut, service]`); cualquier otra ruta le responde 403. El simulador ya no usa una cuenta `admin`.
- **`trigger_type: crew_event`**: nueva forma de activar el modo emergencia (un tripulante avisa, p. ej. por voz), además de `manual_button`, `missed_checkin`, `critical_reading` y `environment_alarm`. Si la app muestra el motivo de la emergencia, agrega este valor.
- **`PATCH /api/v1/admin/assignments/{id}`**: `assigned_to` ya puede ser una fecha futura; la asignación sigue vigente hasta esa fecha. Antes respondía 400. Un periodo de comandante o de CMO que se solape con otro del mismo rol responde 409.

### v1.2 (tarea 8)

- **`sex` del astronauta** (`female` | `male` | null): sexo biológico para referencias clínicas, **no** identidad de género (datos sintéticos). Lo ve el propio astronauta (`GET /me` → `context.sex`) y el flight surgeon y salud conductual en `GET /missions/{id}/crew`. Admin lo escribe (`POST /admin/users` → `astronaut.sex`, `PATCH /admin/astronauts/{id}` `{ "sex": "female" }`; otro valor → 400) pero **no lo recibe**. Otro astronauta y el dashboard nunca lo ven: si el campo no viene, no lo pintes.
- **Sync real** (sección 3). Cambios: `entity` acepta cualquier nombre (lo desconocido sale `rejected` por item, no 400); orden emergency → críticos → resto por `measured_at`; la respuesta del push agrega `batch_id`, `clock_offset_s`, `counts` y `sequence`; el pull agrega `limit`, `catalog`, `mission`, `evaluations`, `escalations` y `routines`.
- **Bandeja**: cada alerta de una lectura trae `measured_at`, `late_sync` y `lag_s` para mostrar "registrado hace X h".
- `GET /missions/{id}/crew` ya es real.
- Simulador: escenario `offline_batch` (lote de 24 h por sync).

### v1.3 (tarea 9, triaje)

- **Emergencia real** (sección 10). Cambios que pueden romper algo:
  - `POST /emergency/sessions` con una sesión ya abierta **ya no da 409** `SESSION_ALREADY_ACTIVE`: se une a ella y responde **201** con `joined: true` y la sesión abierta. Si tu app manejaba el 409 para "unirse", usa `joined`.
  - `POST /emergency/sessions/{id}/assessments` acepta una **reevaluación** del mismo tripulante (antes 409); el 409 queda para la sesión cerrada (`SESSION_CLOSED`).
- `EmergencyStatus` agrega `pending` (activación automática esperando "estoy bien") y `merged` (activación que se unió a otra). `responder_safe` puede venir `null`.
- Nuevos: `POST /emergency/sessions/{id}/confirm` ("estoy bien") y `POST /emergency/sessions/{id}/questions` (pregunta a Tierra).
- La sesión trae `deadman`, `heartbeat`, `assessments` y `attention_order` (orden de atención con motivo). `complete` agrega `mismatch_fields`, `device_result`, `next` y `attention_order`.
- `POST /readings` agrega `emergency` si la lectura crítica abrió una emergencia.
- Panel: `GET /admin/emergencies` (`counts` null para admin) y `/{id}` con `timeline`, `attention_order`, `questions` y `report`; admin sin datos clínicos. La bandeja ya no le manda `triage` a admin.
- Sync: los `emergency_*` ya tienen servicio y hay 4 nuevos (`emergency_confirm`, `emergency_complete`, `emergency_question`, `emergency_close`).

### v1.4 (tarea 10, bienestar)

- **Bienestar real** (sección 11): `/wellbeing/*`, `GET /me/wellbeing`, `GET /admin/compliance` y `/admin/behavioral/*`. Cambios que pueden romper algo:
  - `sleep_hours` del check-in ya **no es obligatorio** (viene de la pulsera).
  - `fitness` (dashboard y cumplimiento) es la aptitud con una PVT de las **últimas 12 h**; sin PVT reciente, `not_confirmed` (antes: la última PVT de cuando fuera).
- Un check-in por día: otro el mismo día es una **corrección** (`supersedes_id` en la respuesta).
- `WellbeingAck` agrega `supersedes_id`, `streak` y `screening_due`; `offer_support` siempre `true`.
- `SupportRequest` agrega `suggestions` (con urgencia `now`). Urgencias: `later` (puede esperar), `today`, `now`.
- Nuevos para salud conductual: `POST /admin/behavioral/support-requests/{id}/ack` y `/close`, `POST /admin/behavioral/escalations/{id}/ack` y `/close`. La bandeja agrega `include_closed` y en cada item `channel`, `priority` y `measured_at`; el detalle agrega `checkins`, `escalations` y `trend`.
- `Compliance` agrega `checkin_today`, `streak_days` y `generated_at`.
- `PVT_LAPSES` crítico: el flight surgeon recibe en su bandeja (`category: wellbeing`) solo "aptitud no confirmada".
- Sync: `support_request` ya tiene servicio.

## 9. Qué ya es real (tareas 1–10) y cómo pasar del mock a la API

En el YAML, las operaciones que **todavía** son solo mock llevan `x-status-impl: pending`. Las que no la llevan ya responden en la API local:

| Módulo | Endpoints reales |
|---|---|
| Sistema | `GET /health` |
| Auth | `POST /auth/login`, `/auth/change-password`, `/auth/refresh`, `/auth/logout`, `GET /me` |
| Cuentas (admin) | `POST /admin/users`, `/admin/users/{id}/reset-password`, `/admin/users/{id}/unlock`, `PATCH /admin/astronauts/{id}` |
| Misión | `GET /missions/{id}/crew` |
| Sync (tarea 8) | `POST /sync/push`, `GET /sync/pull` |
| Emergencia (tarea 9) | `GET /emergency/protocol`, `POST /emergency/sessions`, `GET /emergency/sessions/{id}`, `POST /emergency/sessions/{id}/assessments`, `/confirm`, `/heartbeat`, `/questions`, `/close`, `PUT /emergency/assessments/{id}/answers`, `POST /emergency/assessments/{id}/complete` |
| Emergencias en Tierra (tarea 9) | `GET /admin/emergencies`, `GET /admin/emergencies/{id}` |
| Catálogo | `GET /indicators`, `/indicators/{code}`, `/rules`, `/body-zones`, `/symptoms` |
| Lecturas | `POST /readings`, `GET /me/readings`, `GET /me/body-status` |
| Hábitat | `POST /habitat/readings`, `GET /habitat/status` |
| Tierra | `GET /admin/dashboard/crew`, `GET /admin/inbox`, `POST /admin/escalations/{id}/ack`, `POST /admin/escalations/{id}/messages`, `GET /escalations/{id}/messages` |
| Misión (admin) | `GET`/`POST /admin/missions`, `PATCH /admin/missions/{id}`, `GET`/`POST /admin/environments`, `PATCH /admin/environments/{code}`, `GET`/`POST /admin/assignments`, `PATCH /admin/assignments/{id}`, `GET`/`POST /admin/comm-outages`, `PATCH /admin/comm-outages/{id}` |
| Simulador (admin, solo demo) | `POST /admin/simulator/history`, `POST /admin/simulator/scenarios/{name}` |
| Bienestar (tarea 10) | `POST /wellbeing/checkins`, `GET /wellbeing/instruments`, `POST /wellbeing/screenings`, `POST /wellbeing/pvt-runs`, `POST /wellbeing/support-requests`, `GET /wellbeing/support-requests/{id}/messages`, `GET /me/wellbeing` |
| Salud conductual y cumplimiento (tarea 10) | `GET /admin/behavioral/inbox`, `GET /admin/behavioral/astronauts/{id}`, `POST /admin/behavioral/support-requests/{id}/messages`, `/ack`, `/close`, `POST /admin/behavioral/escalations/{id}/ack`, `/close`, `GET /admin/compliance` |

Para pasar del mock a la API local:

1. Levanta la API: `npm run db:reset` (una vez) y `npm run dev` → `http://localhost:3000`.
2. Cambia la URL base de `http://localhost:4010` a `http://localhost:3000`. Las rutas son las mismas (`/api/v1/...`).
3. Ya no sirve "Bearer cualquier cosa": haz login con un usuario del seed (por ejemplo `a.ortega` / `Demo2026!`) y usa su `access_token`. El access token dura 15 minutos: implementa el refresh (sección 2).
4. Lo que siga `pending` déjalo apuntando al mock (`:4010`) hasta que se implemente.

Comportamientos reales que el mock no muestra:
- `POST /readings` evalúa con las reglas activas y calcula los campos derivados con tu historial: el mismo valor puede dar otro nivel según las lecturas anteriores (p. ej. noches seguidas de poco sueño).
- `values` se valida contra el catálogo (requeridos, tipos y unidades): un 98.6 en `BODY_TEMP` (°F) responde 400.
- `GET /me/body-status` trae `checkin_completed` en la zona `brain` y la tarjeta `environment` del módulo.
- **Retraso con Tierra (ARES-1 = 90 s)**: una alerta a `flight_surgeon` aparece en `GET /admin/inbox` 90 s después de la lectura; antes, el acuse y la respuesta responden 404. La respuesta del flight surgeon llega a la app otros 90 s después (`deliver_at`). Lo crítico físico avisa a bordo al instante.
- **Cortes de enlace**: con un corte abierto (`POST /admin/comm-outages` sin `ends_at`), lo nuevo queda con `deliver_at: null` ("pendiente de envío"). Al cerrarlo (`PATCH ... { ends_at }`) se recalcula: sale al volver el enlace + 90 s.
- **Bandeja**: orden por prioridad (`emergency` > `urgent` > `routine`) y luego lo que espera desde hace más tiempo. Filtros `category` (`reading|emergency|wellbeing|manual`) y `status` (`delivered|acknowledged|responded`). El acuse es idempotente; responder marca `responded`.
- **Dashboard**: solo indicadores físicos con lecturas, serie de hasta 10 puntos y `trend` (`rising|falling|stable|insufficient_data`). `fitness` (`fit` / `not_confirmed`, apto para tarea crítica con una PVT de las últimas 12 h) lo ven el flight surgeon y admin; `compliance` viene **`null` para el flight surgeon** (solo admin): pinta "sin acceso", no "0".
- **Hilo a bordo**: `GET /escalations/{id}/messages` con el `escalation_id` que devolvió `POST /readings`. Lo ve el astronauta dueño (y el CMO si es físico).

### API desplegada (Render)

- URL base: **`https://astro-health-api-81jd.onrender.com/api/v1`** (mismas rutas que en local).
- Swagger: `https://astro-health-api-81jd.onrender.com/api/docs`.
- Mismos usuarios y contraseña del seed (`Demo2026!`): son **datos sintéticos**. No metas datos reales.
- El access token dura 15 min: ante un 401 `UNAUTHENTICATED`, usa `POST /auth/refresh` (sección 2).
- El plan gratuito se duerme tras ~15 min sin uso: la primera petición puede tardar ~50 s. Llama a `GET /api/v1/health` al abrir la app para despertarla.
- CORS: si tu frontend corre en un dominio propio, pide que se agregue a `CORS_ORIGIN`.
- Los datos se comparten entre todos los que usen la API desplegada: usa `client_uuid` nuevos y no esperes un estado limpio.

### Datos de demo: simulador

Para tener historia en las gráficas y alertas en vivo, la API trae un simulador de datos **sintéticos** de ARES-1 (solo demo: `x-status: extra`). Responde 404 si el servidor no tiene `SIMULATOR_ENABLED=true` (en Render está activado). Solo lo llama `admin` (`mission.control`); a cualquier otro rol le responde 403.

- `POST /admin/simulator/history` `{ "days": 14, "seed": 42 }`: 14 días de signos vitales, sueño, ejercicio, radiación, bienestar y hábitat cada hora. Todo en rangos normales (alguna precaución leve, ningún crítico). Es idempotente: correrlo otra vez no duplica nada. Tarda unos segundos (en Render, hasta ~1 min).
- `POST /admin/simulator/scenarios/{name}` con `{ astronaut, module_id, intensity: "low"|"high", contagion }` (todo opcional):
  - `solar_event`: evento solar en los dosímetros. Con `astronaut`, ese tripulante tiene náusea (crítico).
  - `crew_illness`: fiebre, tos y FC alta en `astronaut` (LYRA). Con `contagion: true` enferma un segundo tripulante.
  - `co2_spike`: el CO₂ de `module_id` (HAB-1) sube a precaución; en `high`, a crítico.
  - `wellbeing_decline`: bienestar peor 5 días en `astronaut` (ATLAS): alerta **confidencial** a salud conductual, y al final ATLAS pide hablar con alguien (urgencia `now`). Lo ve solo `bh.salas` en `GET /admin/behavioral/inbox` cuando llega a Tierra (90 s). No aparece en la bandeja del flight surgeon ni en el dashboard, y el resumen no lo muestra (ni siquiera como conteo).
  - `offline_batch`: 24 h sin conexión de `astronaut` (ORION) empujadas por `POST /sync/push` desde `TAB-1` (el mismo lote que `docs/examples/sync-push.json`): el SpO₂ crítico de hace 6 h escala con `late_sync`; trae una corrección y un duplicado. El resumen agrega `sync` con los conteos.
  - `emergency_solar`: el triaje de punta a punta (sección 10): evento solar → VEGA y `astronaut` (LYRA) con náusea → activación automática → hombre muerto vencido → el comandante evalúa (LYRA no responde) → corte de enlace → el reporte sale al cerrar el corte. El resumen agrega `emergency`. Ojo: si ya hay una sesión abierta en la misión, se une a ella.
- La respuesta es un resumen: lecturas creadas, niveles por indicador y escalamientos por destino (`crew`, `flight_surgeon`). Lo de `flight_surgeon` llega a `GET /admin/inbox` 90 s después.

Contra Render, con curl:

```bash
API=https://astro-health-api-81jd.onrender.com/api/v1
TOKEN=$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json'   -d '{"username":"mission.control","password":"Demo2026!","device_id":"demo-console"}'   | node -pe 'JSON.parse(require("fs").readFileSync(0)).access_token')
AUTH="Authorization: Bearer $TOKEN"
JSON='Content-Type: application/json'

curl -s -X POST $API/admin/simulator/history -H "$AUTH" -H "$JSON" -d '{"days":14,"seed":42}'
curl -s -X POST $API/admin/simulator/scenarios/solar_event -H "$AUTH" -H "$JSON" -d '{"intensity":"high","astronaut":"VEGA"}'
curl -s -X POST $API/admin/simulator/scenarios/crew_illness -H "$AUTH" -H "$JSON" -d '{"astronaut":"LYRA","contagion":true}'
curl -s -X POST $API/admin/simulator/scenarios/co2_spike -H "$AUTH" -H "$JSON" -d '{"module_id":"HAB-1","intensity":"high"}'
curl -s -X POST $API/admin/simulator/scenarios/wellbeing_decline -H "$AUTH" -H "$JSON" -d '{"astronaut":"ATLAS"}'
curl -s -X POST $API/admin/simulator/scenarios/offline_batch -H "$AUTH" -H "$JSON" -d '{"astronaut":"ORION"}'
curl -s -X POST $API/admin/simulator/scenarios/emergency_solar -H "$AUTH" -H "$JSON" -d '{"astronaut":"LYRA"}'
```

### Sync contra Render (como astronauta)

```bash
API=https://astro-health-api-81jd.onrender.com/api/v1
ATOKEN=$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"a.ortega","password":"Demo2026!","device_id":"demo-ipad"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).access_token')
# Push del lote de ejemplo (desde backend/; device_id TAB-1 es una tableta de la misión).
# La primera vez sale accepted; los siguientes, duplicate (reintento idempotente).
curl -s -X POST $API/sync/push -H "Authorization: Bearer $ATOKEN" \
  -H 'Content-Type: application/json' -d @docs/examples/sync-push.json
# Pull: guarda .cursor y mándalo la próxima vez.
curl -s "$API/sync/pull?limit=50" -H "Authorization: Bearer $ATOKEN"
curl -s "$API/sync/pull?limit=50&cursor=<cursor>" -H "Authorization: Bearer $ATOKEN"
```

Los datos son compartidos: si otro equipo ya cargó la historia, la tuya sale toda en `duplicate` (está bien).

## 10. Modo emergencia (triaje)

Sin depender de Tierra, la tripulación abre una emergencia, evalúa a cada tripulante con el protocolo (START adaptado a microgravedad + módulo de radiación) y obtiene a quién atender primero. Tierra recibe todo cuando el enlace lo permite. **No diagnostica ni receta**: lo que no cubre el protocolo se pregunta a Tierra.

### App: el mismo evaluador sin conexión

1. Al iniciar sesión (y cuando `GET /sync/pull` diga `protocol.changed`), descarga `GET /emergency/protocol` y guárdalo. Es la **v2**: `definition.questions` (con `prompt`, `type`, `choices`, `next`), `results`, reglas de radiación y escalamiento, y `sources`.
2. Corre **el mismo evaluador** que el servidor: copia `src/engine/triage.js` y `src/engine/conditions.js` (puros, sin dependencias) y llama `evaluateAssessment(definition, respuestas, context)`. Te da `pending` (la pregunta que sigue), `triage_category`, `radiation_flag` y `escalations`.
3. Una sesión se evalúa siempre con su versión (`session.protocol.version`): si la tuya es vieja, `GET /emergency/protocol?version=N`.

### App: voz que lee + botones

- Lee en voz alta el `prompt` de la pregunta `pending` (reemplaza `{call_sign}`) y muestra **solo botones** con las opciones: sí/no (`{ "value": true }`), `choices` (`{ "choice": "1_2h" }`) o varias (`{ "choice": ["nausea", "fatigue"] }`). El servidor rechaza lo que no esté en el protocolo (400): no hay texto libre en el triaje.
- Si el tripulante **no responde** (rojo por "no obedece órdenes" o por la vía aérea), la v2 solo pregunta lo que tú puedes observar: si alguien lo vio vomitar, cuándo, y su estado de conciencia (ACVPU). Nunca le preguntes síntomas.
- `responder_safe` primero: si es `false`, `next_step: "secure_self"` → muestra "ponte a salvo" antes de evaluar.

### App: flujo

1. **Abrir**: botón → `POST /emergency/sessions` (`trigger_type: manual_button`, o `crew_event` si avisa un tripulante). Si ya había una abierta, la respuesta trae `joined: true` y esa sesión: únete, no abras otra.
2. **Activación automática**: si `POST /readings` devuelve `emergency` (`status: "pending"`), o el pull trae una sesión `pending` con tu nombre en `deadman`, muestra a pantalla completa **"¿Estás bien?"** con cuenta regresiva hasta `deadline_at` (60 s). "Estoy bien" → `POST /emergency/sessions/{id}/confirm`. Si no responde nadie, el servidor la activa, avisa a la tripulación y escala a Tierra (y "estoy bien" tarde da 409 `DEADMAN_EXPIRED`).
3. **Evaluar**: sigue el `roster` (primero quien no respondió, luego quien tiene una lectura crítica reciente; `prefill` sugiere respuestas desde lecturas). Por tripulante: `POST /emergency/sessions/{id}/assessments` → `PUT /emergency/assessments/{id}/answers` (puedes mandarlas de a poco; `preview.pending` dice qué sigue) → `POST /emergency/assessments/{id}/complete` con tu `device_result`.
4. **Resultado**: usa siempre el del servidor. Si `matches_device` es `false`, muestra la clasificación del servidor y avisa "la tableta calculó otra cosa" (`mismatch_fields`). `attention_order` es a quién atender primero, con su `reason`; `next` es a quién evaluar después. Reevaluar = otra evaluación del mismo tripulante (la anterior no se borra).
5. **Latido**: mientras alguien atiende una sesión activa, `POST /emergency/sessions/{id}/heartbeat` cada ~30 s. Si pasan 120 s sin latido, Tierra y la tripulación reciben un aviso.
6. **Cerrar**: comandante o CMO, `POST /emergency/sessions/{id}/close` (`closed` = atendida, `cancelled` = falsa alarma).

### App: sin conexión

- Todo va a la cola de SQLite con `priority: "emergency"` (sección 3) y su `client_uuid`: sesión, evaluaciones, respuestas, completar, "estoy bien", preguntas y cierre. Referencia la sesión y la evaluación por **su `client_uuid`** (`session_id` / `assessment_id`). El servidor procesa primero la sesión, luego las evaluaciones, respuestas y cierres, aunque lleguen desordenados.
- Si dos tabletas abrieron sesiones distintas sin conexión, la segunda se une a la primera (`result.joined`, `merged_into`) y sus evaluaciones quedan en la principal. No se pierde nada.
- Evalúa y clasifica en la tableta con el evaluador local; al reconectar, manda `device_result` en el complete y toma el del servidor.

### App: mientras Tierra no responde

- Tierra tarda (ARES-1: 90 s de ida y otros 90 de vuelta) y durante un corte no recibe nada. Muestra el estado de cada aviso: `deliver_at` futuro = "en camino a Tierra (llega a las hh:mm)"; `null` = "pendiente de envío: sin enlace" (`mission.link.status: "outage"` en el pull).
- Sigue el protocolo y el orden de atención sin esperar a Tierra. Lo que no cubre el protocolo → `POST /emergency/sessions/{id}/questions`. La respuesta llega a **toda la tripulación** por `GET /sync/pull` (`messages`, `channel: "escalation"`) cuando su `deliver_at` ya pasó.

### Panel (flight surgeon y admin)

- `GET /admin/emergencies`: sesiones que ya llegaron a Tierra. `counts` (cuántos rojos, amarillos…) solo para el flight surgeon; admin recibe `null`.
- `GET /admin/emergencies/{id}`: lo que ya llegó, con su `timeline`. El flight surgeon ve las evaluaciones con respuestas, el `attention_order`, las `questions` de la tripulación y el `report` completo cuando llega el cierre (línea de tiempo, clasificaciones, versión del protocolo y diferencias tableta/servidor). Admin solo ve el **estado operativo**: estados de la sesión y de cada evaluación, sin categorías, respuestas, preguntas ni reporte.
- Acuse y respuesta: los avisos de la emergencia están en `GET /admin/inbox?category=emergency`; `POST /admin/escalations/{id}/ack` y `/messages` (la respuesta viaja con retraso). Para contestar una pregunta, usa el `escalation_id` de la pregunta.
- El triaje no incluye datos de bienestar.

### Contra Render

Git Bash:

```bash
API=https://astro-health-api-81jd.onrender.com/api/v1
login() { curl -s -X POST $API/auth/login -H 'Content-Type: application/json' \
  -d "{\"username\":\"$1\",\"password\":\"Demo2026!\",\"device_id\":\"demo-$1\"}" \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).access_token'; }
ORION=$(login a.ortega); REYES=$(login dr.reyes); JSON='Content-Type: application/json'
uuid() { node -e 'console.log(require("crypto").randomUUID())'; }
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

curl -s $API/emergency/protocol -H "Authorization: Bearer $ORION" | head -c 300; echo
S=$(curl -s -X POST $API/emergency/sessions -H "Authorization: Bearer $ORION" -H "$JSON" \
  -d "{\"client_uuid\":\"$(uuid)\",\"trigger_type\":\"manual_button\",\"started_at\":\"$NOW\",\"context\":{\"solar_event_active\":true},\"responder_safe\":{\"value\":true}}" \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).session.id'); echo "sesión $S"
A=$(curl -s -X POST $API/emergency/sessions/$S/assessments -H "Authorization: Bearer $ORION" -H "$JSON" \
  -d "{\"client_uuid\":\"$(uuid)\",\"astronaut_id\":\"10000000-0000-4000-8000-000000000013\",\"started_at\":\"$NOW\"}" \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')
curl -s -X PUT $API/emergency/assessments/$A/answers -H "Authorization: Bearer $ORION" -H "$JSON" -d "{\"answers\":[
  {\"client_uuid\":\"$(uuid)\",\"question_code\":\"responsive_and_mobile\",\"answer\":{\"value\":true},\"source\":\"tap\",\"answered_at\":\"$NOW\"},
  {\"client_uuid\":\"$(uuid)\",\"question_code\":\"vomiting\",\"answer\":{\"value\":false},\"source\":\"tap\",\"answered_at\":\"$NOW\"},
  {\"client_uuid\":\"$(uuid)\",\"question_code\":\"prodromal_symptoms\",\"answer\":{\"choice\":[\"none\"]},\"source\":\"tap\",\"answered_at\":\"$NOW\"}]}"
curl -s -X POST $API/emergency/assessments/$A/complete -H "Authorization: Bearer $ORION" -H "$JSON" \
  -d "{\"completed_at\":\"$NOW\",\"device_result\":{\"status\":\"completed\",\"triage_category\":\"green\",\"radiation_flag\":\"none\",\"rules_version\":2}}"
curl -s -X POST $API/emergency/sessions/$S/close -H "Authorization: Bearer $ORION" -H "$JSON" \
  -d "{\"closed_at\":\"$NOW\",\"status\":\"closed\"}"
sleep 95   # el retraso de ARES-1
curl -s $API/admin/emergencies/$S -H "Authorization: Bearer $REYES"
```

PowerShell:

```powershell
$API = 'https://astro-health-api-81jd.onrender.com/api/v1'
function Login($u) { (Invoke-RestMethod -Method Post "$API/auth/login" -ContentType 'application/json' `
  -Body (@{ username = $u; password = 'Demo2026!'; device_id = "demo-$u" } | ConvertTo-Json)).access_token }
$orion = @{ Authorization = "Bearer $(Login 'a.ortega')" }
$reyes = @{ Authorization = "Bearer $(Login 'dr.reyes')" }
$now = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
function Post($url, $headers, $body) { Invoke-RestMethod -Method Post "$API$url" -Headers $headers `
  -ContentType 'application/json' -Body ($body | ConvertTo-Json -Depth 6) }

$s = Post '/emergency/sessions' $orion @{ client_uuid = "$([guid]::NewGuid())"; trigger_type = 'manual_button'
  started_at = $now; context = @{ solar_event_active = $true }; responder_safe = @{ value = $true } }
$a = Post "/emergency/sessions/$($s.session.id)/assessments" $orion @{ client_uuid = "$([guid]::NewGuid())"
  astronaut_id = '10000000-0000-4000-8000-000000000013'; started_at = $now }
$answers = @(
  @{ client_uuid = "$([guid]::NewGuid())"; question_code = 'responsive_and_mobile'; answer = @{ value = $true }; source = 'tap'; answered_at = $now },
  @{ client_uuid = "$([guid]::NewGuid())"; question_code = 'vomiting'; answer = @{ value = $false }; source = 'tap'; answered_at = $now },
  @{ client_uuid = "$([guid]::NewGuid())"; question_code = 'prodromal_symptoms'; answer = @{ choice = @('none') }; source = 'tap'; answered_at = $now })
Invoke-RestMethod -Method Put "$API/emergency/assessments/$($a.id)/answers" -Headers $orion `
  -ContentType 'application/json' -Body (@{ answers = $answers } | ConvertTo-Json -Depth 6)
Post "/emergency/assessments/$($a.id)/complete" $orion @{ completed_at = $now
  device_result = @{ status = 'completed'; triage_category = 'green'; radiation_flag = 'none'; rules_version = 2 } }
Post "/emergency/sessions/$($s.session.id)/close" $orion @{ closed_at = $now; status = 'closed' }
Start-Sleep -Seconds 95   # el retraso de ARES-1
Invoke-RestMethod "$API/admin/emergencies/$($s.session.id)" -Headers $reyes | ConvertTo-Json -Depth 8
```

Si ya hay una sesión abierta en ARES-1 (otra persona, o un escenario del simulador), tu `POST /emergency/sessions` sale `joined: true`: estás en esa sesión.

## 11. Bienestar (confidencial)

Check-in diario de 20 s, cuestionarios breves, prueba de reacción y "Quiero hablar con alguien". **No diagnostica**: al astronauta nunca se le muestra un puntaje, un color, un semáforo ni un diagnóstico de bienestar, solo mensajes neutros. El servidor compara contra el **rango habitual** de cada astronauta y, si un cambio se sostiene, avisa de forma confidencial **solo a salud conductual**, con el retraso del enlace.

### App: check-in diario

1. Cuatro deslizadores **sin números visibles** (0–100 por dentro): ánimo, fatiga, estrés y roces con la tripulación. Más horas de sueño de la pulsera (si las hay) y una nota privada opcional.
2. `POST /wellbeing/checkins` (o `entity: "wellbeing_checkin"` en la cola de sync) con `client_uuid` nuevo y `measured_at`. Ejemplo: [`docs/examples/wellbeing-checkin.json`](examples/wellbeing-checkin.json).
3. Respuesta (`WellbeingAck`):
   - `message`: muéstralo **tal cual**. Es el texto neutro de la regla del catálogo ("Estamos aprendiendo tu rango habitual…", "Gracias por tu check-in.", "Llevas unos días distinto de lo habitual…"). Nunca pintes un color ni calcules nada con él.
   - `offer_support`: siempre `true` → el botón "Quiero hablar con alguien" está siempre visible.
   - `streak`: `streak_days` (días seguidos con check-in), `checkins_this_week` y `checkins_goal_week` (7). **Premia completar el check-in, nunca el resultado**: no hay `/me/gamification` todavía, usa este campo.
   - `screening_due: true` → ofrece el PHQ-2 y el GAD-2 (cada 14 días, un día antes de la conferencia psicológica).
   - `supersedes_id` no null → era el segundo check-in del día: **corrigió** al anterior (un check-in por día UTC; gana el último que llega). Úsalo para "editar el check-in de hoy".
4. La nota privada **solo la ves tú**: vuelve en `GET /me/wellbeing` y nadie más la recibe (ni salud conductual).
5. Duplicado (mismo `client_uuid`) → 200 con la misma respuesta: quítalo de la cola.

`GET /me/wellbeing?from=&to=&cursor=&limit=`: su historial (check-ins con valores y nota, cuestionarios solo con el instrumento, PVT con la aptitud y solicitudes de apoyo con su estado). Nunca niveles ni puntajes.

### App: cuestionarios y prueba de reacción

- `GET /wellbeing/instruments?lang=es|en`: texto oficial de Pfizer del PHQ-2 y el GAD-2, con licencia y fuentes. Muestra `prompt`, los 2 `items` y las 4 `options`.
- `POST /wellbeing/screenings` `{ client_uuid, instrument: "PHQ2"|"GAD2", measured_at, item_1, item_2 }` → `message` neutro. **El puntaje no vuelve nunca**; si llega al corte (3), salud conductual lo ve antes de la conferencia privada. No hay PHQ-9.
- `POST /wellbeing/pvt-runs` con las métricas del minijuego (`lapses` = respuestas de 355 ms o más, `mean_rt_ms`, `false_starts`), `device_id` y `before_critical_task` → `fitness` (`fit` / `not_confirmed`) y un `message`. La línea base es por dispositivo: las 3 primeras corridas en descanso de cada tableta dan `not_confirmed`.

### App: "Quiero hablar con alguien"

1. Urgencia: `later` (puede esperar), `today` (hoy) o `now` (ahora). Canal: `message` (texto) o `session` (pedir una sesión). El audio todavía no existe en el contrato.
2. `POST /wellbeing/support-requests` `{ client_uuid, urgency, channel, content, created_at }` (o `entity: "support_request"` en sync). Ejemplo: [`docs/examples/support-request.json`](examples/support-request.json).
3. Muestra el estado del envío con `deliver_at`: futuro = "en camino a Tierra (llega a las hh:mm)"; `null` = "pendiente de envío: sin enlace".
4. Con `urgency: "now"`, la respuesta trae `suggestions`: ofrece **respiración guiada** (`guided_breathing`) y **hablar con el oficial médico de a bordo** (`talk_to_cmo`). Son sugerencias para el astronauta: el servidor **no avisa a nadie a bordo** (ni al CMO ni al comandante), así que no lo insinúes en la interfaz.
5. Las respuestas de salud conductual llegan por `GET /sync/pull` (`messages` con `channel: "support"`, `thread_id` = la solicitud) **solo cuando su `deliver_at` ya pasó** (ARES-1: 90 s; durante un corte, nada). Haz pull al enviar, a los ~3 min y luego en tu ciclo normal. El hilo también está en `GET /wellbeing/support-requests/{id}/messages`.
6. Nadie de la tripulación ve tus solicitudes; otro astronauta que pida su hilo recibe 404.

### Panel: bandeja de salud conductual (`behavioral_health`)

- `GET /admin/behavioral/inbox?include_closed=&cursor=&limit=`: alertas (`wellbeing_alert` de los deslizadores o la PVT, `screening_alert` del PHQ-2/GAD-2) y solicitudes (`support_request`) que **ya llegaron** a Tierra, con `status`, `urgency`, `channel`, `priority`, `summary`, `measured_at` y `deliver_at`. Orden: apoyo "ahora", alertas urgentes, apoyo "hoy", alertas de rutina, apoyo "más tarde".
- `GET /admin/behavioral/astronauts/{id}` (`{id}` = astronauta): por deslizador `level`, `last_value`, `adverse_z_3d`, `adverse_sustained_days`, `trend` y la serie; `checkins` (valores, **sin la nota**), `screenings` con puntaje, `pvt_runs`, `support_requests` y `escalations` abiertos.
- Acuse y respuesta: `POST /admin/behavioral/support-requests/{id}/ack`, `/messages` (viaja con retraso: `deliver_at`, o `null` si hay un corte) y `/close`; `POST /admin/behavioral/escalations/{id}/ack` y `/close`. Antes de que llegue a Tierra → 404; cerrado → 409 al responder.
- **Un escalamiento abierto por indicador**: mientras no lo cierres, el mismo cambio sostenido no vuelve a avisar cada día. Ciérralo cuando lo atiendas; si el cambio sigue, se abre uno nuevo.
- Cada lectura (bandeja y detalle) queda en la bitácora de accesos confidenciales (quién, de quién, qué y cuándo; sin el contenido).

### Panel: cumplimiento (admin) y flight surgeon

- `GET /admin/compliance?from=&to=` (solo admin): por astronauta `checkin_today`, `last_checkin_at`, `streak_days`, `checkins_completed` / `checkins_expected`, `screenings_completed`, `pvt_runs` y **"apto para tarea crítica"** (`fitness`): `fit` solo si hay una PVT de las últimas 12 h con los tres indicadores normales; si no, `not_confirmed` ("no confirmado"). Sin valores, tendencias ni solicitudes. Por defecto, los últimos 7 días UTC.
- El flight surgeon ve la aptitud en el dashboard y, si una PVT da lapsos críticos, una alerta en `GET /admin/inbox?category=wellbeing` que solo dice "aptitud no confirmada" (sin métricas). Nada más del bienestar.

### Contra Render

Git Bash (desde `backend/`; los textos con acentos van en un archivo con `-d @...`, no en la línea de comandos):

```bash
API=https://astro-health-api-81jd.onrender.com/api/v1
login() { curl -s -X POST $API/auth/login -H 'Content-Type: application/json' \
  -d "{\"username\":\"$1\",\"password\":\"Demo2026!\",\"device_id\":\"demo-$1\"}" \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).access_token'; }
ORION=$(login a.ortega); BH=$(login bh.salas); ADMIN=$(login mission.control); JSON='Content-Type: application/json'

# Check-in (el segundo del mismo día corrige al primero) y solicitud de apoyo "now".
curl -s -X POST $API/wellbeing/checkins -H "Authorization: Bearer $ORION" -H "$JSON" -d @docs/examples/wellbeing-checkin.json
curl -s -X POST $API/wellbeing/support-requests -H "Authorization: Bearer $ORION" -H "$JSON" -d @docs/examples/support-request.json
curl -s "$API/me/wellbeing?limit=5" -H "Authorization: Bearer $ORION"

# Salud conductual: la solicitud aparece 90 s después (retraso de ARES-1).
sleep 95
curl -s "$API/admin/behavioral/inbox" -H "Authorization: Bearer $BH"
SR=$(curl -s "$API/admin/behavioral/inbox" -H "Authorization: Bearer $BH" \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).items.find(i => i.kind === "support_request").id')
curl -s -X POST $API/admin/behavioral/support-requests/$SR/messages -H "Authorization: Bearer $BH" -H "$JSON" \
  -d '{"body":"Gracias por escribir. Hablamos hoy a las 15:00 UTC?"}'
curl -s "$API/admin/behavioral/astronauts/10000000-0000-4000-8000-000000000011" -H "Authorization: Bearer $BH"

# La respuesta llega a la app por pull 90 s después.
sleep 95
curl -s "$API/sync/pull?limit=50" -H "Authorization: Bearer $ORION"

# Admin: solo cumplimiento y aptitud.
curl -s $API/admin/compliance -H "Authorization: Bearer $ADMIN"
```

PowerShell (manda el body en UTF-8 para no romper los acentos):

```powershell
$API = 'https://astro-health-api-81jd.onrender.com/api/v1'
function Login($u) { (Invoke-RestMethod -Method Post "$API/auth/login" -ContentType 'application/json' `
  -Body (@{ username = $u; password = 'Demo2026!'; device_id = "demo-$u" } | ConvertTo-Json)).access_token }
function Call($method, $url, $token, $json) {
  $params = @{ Method = $method; Uri = "$API$url"; Headers = @{ Authorization = "Bearer $token" } }
  if ($json) { $params.ContentType = 'application/json; charset=utf-8'; $params.Body = [Text.Encoding]::UTF8.GetBytes($json) }
  Invoke-RestMethod @params
}
$orion = Login 'a.ortega'; $bh = Login 'bh.salas'; $admin = Login 'mission.control'

$ack = Call Post '/wellbeing/checkins' $orion (Get-Content -Raw -Encoding UTF8 docs/examples/wellbeing-checkin.json)
"$($ack.message) | racha: $($ack.streak.streak_days) | corrige: $($ack.supersedes_id)"
$req = Call Post '/wellbeing/support-requests' $orion (Get-Content -Raw -Encoding UTF8 docs/examples/support-request.json)
"llega a Tierra: $($req.deliver_at) | sugerencias: $(($req.suggestions | ForEach-Object code) -join ', ')"

Start-Sleep -Seconds 95   # el retraso de ARES-1
$inbox = Call Get '/admin/behavioral/inbox' $bh
$sr = ($inbox.items | Where-Object kind -eq 'support_request' | Select-Object -First 1).id
Call Post "/admin/behavioral/support-requests/$sr/messages" $bh '{"body":"Gracias por escribir. ¿Hablamos hoy a las 15:00 UTC?"}'
Call Post "/admin/behavioral/support-requests/$sr/ack" $bh
(Call Get '/admin/compliance' $admin).astronauts | Format-Table call_sign, checkin_today, streak_days, fitness
```

Para la demo sin esperar a nadie: `POST /admin/simulator/scenarios/wellbeing_decline` como `mission.control` (necesita la historia) y, 90 s después, la bandeja de `bh.salas` muestra las alertas de ATLAS y su solicitud "ahora".
