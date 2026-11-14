# Relevo del backend

## Estado

Al 2026-11-14, rama `backend`:

- **Catálogo**: 26 indicadores (9 confidenciales), 112 reglas y 43 fuentes en `docs/catalogo-indicadores.json`. Evaluador común en `src/engine/conditions.js`; el triaje (`triage.js`) lo usa.
- **Contrato**: `docs/openapi.yaml` v1.1, con 73 operaciones (66 mvp y 7 extra). Mock con `npm run api:mock` y guía en `docs/api-guia-frontend.md`. `npm run api:lint`: 0 errores.
- **Base de datos**: migraciones 000–007 (44 tablas) y seeds 001–003. `npm run db:reset` corre limpio y los seeds son idempotentes. El seed del catálogo se genera con `node tools/build_catalog_seed.js` (`--check` avisa si quedó desactualizado).
- **Pruebas**: `node --test` da 129. La prueba de humo `test/db.smoke.test.js` se salta sola si no hay base.
- **Pendiente de implementar**: los endpoints (hoy solo existe `/health`) y las reglas que la base no puede hacer cumplir (ver Decisiones).

## Cómo levantar el proyecto

## Credenciales demo

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

## Pendientes

- Tarea 9: `responder_safe` es una pregunta de la sesión. El servicio debe copiar esa respuesta en las respuestas de cada evaluación antes de llamar a `evaluateAssessment`; si no, el resultado es `incomplete` con `pending: "responder_safe"`.
- Una respuesta `{ value: null }` cuenta como pendiente.

## Siguiente tarea
