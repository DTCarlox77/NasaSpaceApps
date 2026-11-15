# Astro Health — Backend

API REST (Node.js + Express + PostgreSQL) para el monitoreo de salud de una tripulación en una misión espacial: lecturas con semáforo, bienestar confidencial, triaje de emergencia sin depender de Tierra, sincronización sin conexión y el panel de Tierra con el retraso y los cortes del enlace.

> **Aviso importante**
>
> - Todos los datos de astronautas de este proyecto son **SINTÉTICOS**. No se usan datos reales de ninguna persona; nunca cargues datos reales en la API desplegada.
> - Es una herramienta de **apoyo a la decisión**. **No** diagnostica ni sustituye el juicio del oficial médico de a bordo ni del flight surgeon.

- **API desplegada (demo)**: <https://astro-health-api-81jd.onrender.com/api/v1> · Swagger: <https://astro-health-api-81jd.onrender.com/api/docs>
- **Contrato**: [`docs/openapi.yaml`](docs/openapi.yaml) (OpenAPI 3.0, v1.6) · guía para la app y el panel: [`docs/api-guia-frontend.md`](docs/api-guia-frontend.md)
- **Estado y decisiones**: [`docs/RELEVO.md`](docs/RELEVO.md)

## Requisitos

- [Node.js 20](https://nodejs.org/) o superior (`.nvmrc`; con nvm: `nvm use`) y npm.
- PostgreSQL 16 o superior: instalado en la máquina (en Windows, p. ej. el 18) **o** [Docker](https://www.docker.com/) con Docker Compose.

## Levantarlo en local

Todo se ejecuta dentro de `backend/`.

1. Variables de entorno: `cp .env.example .env`. Los valores de desarrollo ya sirven (usuario `astro`, contraseña `astro_dev`, base `astro_health`; `JWT_SECRET` vacío en desarrollo).
2. La base:
   - **PostgreSQL local**, como `postgres`:
     ```sql
     CREATE ROLE astro LOGIN PASSWORD 'astro_dev';
     CREATE DATABASE astro_health OWNER astro;
     CREATE DATABASE astro_health_test OWNER astro;  -- la de las pruebas
     ```
   - **Docker**: `npm run db:up` (PostgreSQL 16 de `docker-compose.yml`; ahí `astro` puede crear la base de pruebas solo).
3. Arranca:
   ```bash
   npm i
   npm run db:reset                               # migraciones + seeds (datos de demo)
   npm run demo:reset -- --confirm ARES-1         # historia de 14 días y aptitud (opcional)
   npm run dev                                    # http://localhost:3000/api/v1/health
   ```
   Swagger en <http://localhost:3000/api/docs>; mock del contrato con `npm run api:mock` (`:4010`).
4. Verifica: `npm test`, `npx eslint .`, `npx prettier --check .`, `npm run api:lint` y `npm run smoke`.

Usuarios de demo (contraseña de todos: **`Demo2026!`**): `mission.control` (admin), `dr.reyes` (flight surgeon), `bh.salas` (salud conductual), `a.ortega` (ORION, comandante), `k.mensah` (VEGA, oficial médico), `l.tanaka` (LYRA), `m.silva` (ATLAS, debe cambiar la contraseña en el primer login) y `svc.habitat` (sensores). Tabletas: `TAB-1` (`dc_demo_tab1_sintetica`) y `TAB-2` (`dc_demo_tab2_sintetica`), solo para las rutas de emergencia.

## Variables de entorno

Todas están en [`.env.example`](.env.example) con su valor por defecto y para qué sirven. Las que importan para desplegar:

| Variable | Local | Render | Para qué |
|---|---|---|---|
| `NODE_ENV` | `development` | `production` | En producción el servidor **no arranca** sin un `JWT_SECRET` fuerte ni con `CORS_ORIGIN=*`. |
| `PORT` | `3000` | (lo pone Render) | Puerto HTTP. |
| `DB_*` / `DATABASE_URL` | `DB_*` | `DATABASE_URL` | Conexión a PostgreSQL; `DB_SSL` (`no-verify` por defecto con `DATABASE_URL`). |
| `JWT_SECRET` | vacío | aleatorio, ≥ 32 caracteres | Firma de los tokens. Nunca uno de ejemplo. |
| `CORS_ORIGIN` | `*` | orígenes del panel y de Expo web, separados por coma | Qué páginas web pueden llamar a la API. Las apps nativas no lo necesitan. |
| `TRUST_PROXY` | (false) | `1` | IP real detrás del proxy (rate limit y auditoría). |
| `DEMO_SEED` | — | `true` | Carga el seed de demo (sintético) al arrancar en producción. |
| `SIMULATOR_ENABLED` | `false` | `true` | Simulador (`/admin/simulator/*`) y reinicio de demo (`/admin/demo/reset`); sin `true`, 404. |
| `OFFLINE_PIN_PBKDF2_ITERATIONS` | `600000` | (por defecto) | Iteraciones del verificador local del PIN (mín. 10 000). |

El resto (`LOCKOUT_*`, `RATE_LIMIT_*`, `SYNC_*`, `TRIAGE_*`, `WELLBEING_*`, `OFFLINE_UNLOCK_DAYS`, `JWT_*_TTL`...) tiene un valor por defecto pensado para la demo.

## Scripts

| Script | Qué hace |
|---|---|
| `npm run dev` | API con recarga automática (nodemon). |
| `npm start` | API sin recarga. |
| `npm run start:deploy` | Arranque de despliegue: migraciones pendientes, seed de demo (solo con `DEMO_SEED=true`) y servidor. |
| `npm test` | Pruebas (`node --test`) contra la base `astro_health_test`; **nunca** tocan la de desarrollo. |
| `npm run db:up` / `db:down` | Levanta o detiene PostgreSQL en Docker. |
| `npm run db:migrate` | Aplica las migraciones pendientes de `db/migrations`. |
| `npm run db:seed` | Ejecuta los seeds de `db/seeds` (idempotentes). |
| `npm run db:reset` | Borra el schema, migra y siembra. Bloqueado con `NODE_ENV=production`. |
| `npm run sim:history` | Historia sintética de ARES-1 (`-- --days 14 --seed 42`). |
| `npm run sim:scenario` | Un escenario ahora (`-- solar_event --astronaut VEGA --intensity high`, `crew_illness`, `co2_spike`, `wellbeing_decline`, `offline_batch`, `emergency_solar`). |
| `npm run sim:offline-batch` / `sim:emergency` | Atajos de `offline_batch` y `emergency_solar`. |
| `npm run demo:reset` | Reinicio de la demo (`-- --confirm ARES-1`): ver abajo. |
| `npm run smoke` | Prueba de humo de una API (`-- --base=<url>`; por defecto la local). |
| `npm run lint` / `format` | ESLint / Prettier. |
| `npm run api:lint` / `api:mock` | Valida el contrato / mock de Prism en `:4010`. |

**Reinicio de demo** (`npm run demo:reset -- --confirm ARES-1` en local; `POST /api/v1/admin/demo/reset` con `{"confirm":"ARES-1"}` como `mission.control` en Render, que no tiene consola). No borra nada: recarga la historia de 14 días hasta ahora, cierra emergencias, cortes de enlace, escalamientos y solicitudes de apoyo abiertos (también los de las pruebas de humo), deja los usuarios del seed desbloqueados y con `Demo2026!` (ATLAS sigue con cambio de contraseña obligatorio), evita que el check-in perdido active el triaje y registra una PVT reciente para que el panel muestre **3 aptos y ATLAS "no confirmado"**. La respuesta trae `panel_flags`: lo que el panel seguirá marcando (una lectura crítica de un escenario anterior no se puede quitar sin borrar). Solo en modo demo (`SIMULATOR_ENABLED=true` y, en producción, `DEMO_SEED=true`).

**Prueba de humo** (`npm run smoke -- --base=<url>`): salud → login → lectura normal y crítica (medida hace 4 h: escala pero **no abre emergencias**) y su corrección → body-status → `/sync/push` del ejemplo → `/sync/pull` → check-in y solicitud de apoyo → bandeja del flight surgeon y, tras el retraso, de `bh.salas` (cierra su solicitud) → confidencialidad (admin, CMO y flight surgeon → 403 en la bandeja conductual; cumplimiento sin valores) → la credencial de tableta sirve para el protocolo y da 401 en `/me`. Tarda ~1.5 min por el retraso de ARES-1, imprime una tabla y sale con código 1 si algo falla. Nunca imprime tokens. Lo que deja lo limpia el reinicio de demo.

## Despliegue en Render

`render.yaml` (raíz del repo) es el Blueprint: base `astro-health-db` (PostgreSQL 16, plan free) y servicio `astro-health-api` (Node 20, `rootDir: backend`, rama `backend`, auto-deploy en cada push).

- **Build**: `npm ci`. **Start**: `npm run start:deploy` (el plan gratuito no tiene pre-deploy: migra al arrancar; el seed es idempotente y nunca borra).
- **Health check**: `/api/v1/health` (503 si la base no responde).
- **Variables**: las de la tabla de arriba. `CORS_ORIGIN` se pone en el panel de Render (el Blueprint no la pisa); sin ella, con `NODE_ENV=production`, el deploy falla a propósito.
- **Logs**: panel de Render → `astro-health-api` → *Logs*. Las peticiones se registran sin valores de la query, headers ni bodies; los errores, sin datos de la fila.
- **Plan gratuito**: el servicio se **duerme** tras ~15 min sin tráfico (la primera petición tarda ~50 s) y la base gratuita **expira a los 30 días** de crearse (revisa la fecha en el panel de la base; ver "Respaldo").

## Día de la demo

1. **Despertar la API** unos minutos antes (responde `"status":"ok","db":"up"`; la primera vez puede tardar ~50 s):
   ```bash
   curl -s --max-time 120 https://astro-health-api-81jd.onrender.com/api/v1/health
   ```
   ```powershell
   Invoke-RestMethod https://astro-health-api-81jd.onrender.com/api/v1/health -TimeoutSec 120
   ```
2. **Prueba de humo** (antes del reinicio: el reinicio limpia lo que deja):
   ```bash
   npm run smoke -- --base=https://astro-health-api-81jd.onrender.com/api/v1
   ```
3. **Reinicio de demo** por el endpoint (Git Bash):
   ```bash
   API=https://astro-health-api-81jd.onrender.com/api/v1
   TOKEN=$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json' \
     -d '{"username":"mission.control","password":"Demo2026!","device_id":"demo-console"}' \
     | node -pe 'JSON.parse(require("fs").readFileSync(0)).access_token')
   curl -s --max-time 300 -X POST $API/admin/demo/reset -H "Authorization: Bearer $TOKEN" \
     -H 'Content-Type: application/json' -d '{"confirm":"ARES-1"}'
   ```
   PowerShell:
   ```powershell
   $API = 'https://astro-health-api-81jd.onrender.com/api/v1'
   $login = Invoke-RestMethod -Method Post -Uri "$API/auth/login" -ContentType 'application/json' -Body '{"username":"mission.control","password":"Demo2026!","device_id":"demo-console"}'
   $h = @{ Authorization = "Bearer $($login.access_token)" }
   Invoke-RestMethod -Method Post -Uri "$API/admin/demo/reset" -Headers $h -ContentType 'application/json' -Body '{"confirm":"ARES-1"}' -TimeoutSec 300 | ConvertTo-Json -Depth 6
   ```
   Revisa en la respuesta: `emergencies`, `comm_outages`, `fitness` (3 `fit`, ATLAS `not_confirmed`) y `panel_flags` (que no haya `critical`).

**Guion corto** (todo sintético; los mensajes llegan a Tierra con 90 s de retraso):
1. Panel (`dr.reyes`): dashboard de ARES-1 con 14 días de historia, 3 aptos y ATLAS "no confirmado".
2. App (`m.silva`, ATLAS): primer login → cambio de contraseña obligatorio → check-in de bienestar y PVT → ATLAS pasa a "apto" en el panel.
3. Escenario en vivo (`POST /admin/simulator/scenarios/co2_spike` o `solar_event`): el semáforo cambia en la app y la alerta llega a la bandeja de Tierra tras el retraso.
4. Emergencia (`emergency_solar` o el botón desde la tableta `TAB-1`): hombre muerto, evaluación START, orden de atención y el reporte que sale a Tierra al volver el enlace.
5. Confidencialidad: `bh.salas` ve la bandeja conductual; admin y el flight surgeon no (403).
6. Al terminar (o antes de repetir): reinicio de demo.

### Respaldo de la base de Render

En el panel de Render → `astro-health-db` → *Connect* → copia la **External Database URL**. Necesitas `pg_dump` 16 o superior (en Windows viene con PostgreSQL 18). La URL lleva la contraseña: no la pegues en archivos ni en el chat.

Git Bash:
```bash
read -rs RENDER_DB_URL   # pega la External Database URL (no se ve) y Enter
"/c/Program Files/PostgreSQL/18/bin/pg_dump.exe" "$RENDER_DB_URL" --format=custom --no-owner --no-acl --file="astro-health-$(date +%Y%m%d-%H%M).dump"
```
PowerShell:
```powershell
$env:RENDER_DB_URL = Read-Host 'External Database URL'
& 'C:\Program Files\PostgreSQL\18\bin\pg_dump.exe' $env:RENDER_DB_URL --format=custom --no-owner --no-acl --file="astro-health-$(Get-Date -Format yyyyMMdd-HHmm).dump"
```
Si da error de SSL, agrega `?sslmode=require` al final de la URL. Para restaurar en una base nueva (p. ej. si la gratuita expiró): `pg_restore --no-owner --no-acl --dbname "<URL de la base nueva>" astro-health-AAAAMMDD-HHMM.dump`. Guarda el `.dump` fuera del repo.

### Plan B: API local con ngrok

Si Render falla, la misma API corre en tu PC y ngrok la publica por HTTPS.

1. Base local con datos de demo: `npm run db:reset` y luego `npm run demo:reset -- --confirm ARES-1`.
2. En `.env` (solo para el plan B):
   - `JWT_SECRET=` uno aleatorio (`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`): con ngrok la API es pública y el secreto de desarrollo está en el repo.
   - `SIMULATOR_ENABLED=true` (simulador y reinicio de demo por el endpoint).
   - `TRUST_PROXY=1` (ngrok es un proxy: sin esto, todos los logins cuentan como la misma IP para el rate limit).
   - `CORS_ORIGIN=` el origen del panel y el de Expo web (en desarrollo también acepta `*`).
3. `npm run dev` (puerto 3000) y, en otra terminal, `ngrok http 3000`. ngrok muestra una URL `https://<algo>.ngrok-free.app`.
4. URL base nueva:
   - App (Expo): `EXPO_PUBLIC_API_URL=https://<algo>.ngrok-free.app` (sin `/api/v1`) y reiniciar Expo (`npx expo start -c`).
   - Panel: su URL base de la API → `https://<algo>.ngrok-free.app/api/v1`.
   - El plan gratuito de ngrok muestra una página de aviso a los navegadores: si el panel recibe HTML en vez de JSON, agrega el header `ngrok-skip-browser-warning: true` a sus peticiones. Las apps nativas no la ven.
5. Comprueba: `npm run smoke -- --base=https://<algo>.ngrok-free.app/api/v1`.

## Estructura

```
backend/
├── src/
│   ├── app.js / server.js  # Express, CORS, logs, rutas, Swagger; arranque y barrido del triaje
│   ├── config/             # variables de entorno (loadEnv.js valida) y pool de PostgreSQL
│   ├── routes/ controllers/ services/ models/
│   ├── engine/             # semáforo (conditions.js), derivados y triaje
│   ├── simulator/          # historia y escenarios sintéticos (puros)
│   ├── middlewares/        # autenticación, rate limit, logs y errores
│   └── utils/
├── db/migrations/          # DDL numerado (nunca se edita una migración ya subida)
├── db/seeds/               # datos de demo SINTÉTICOS (idempotentes)
├── scripts/                # migrate, seed, start (despliegue), simulate, demoReset, smoke
├── docs/                   # contrato, guía de frontends, relevo, catálogo y ejemplos
└── test/                   # node --test (base astro_health_test)
```

Errores con un único formato: `{ "error": { "code", "message", "details" } }`.

## Convenciones

- Ramas: `main` ← `develop` ← `feature/*`, `fix/*`, `chore/*`; el backend se trabaja en `backend` (Render despliega desde ahí).
- Commits: [Conventional Commits](https://www.conventionalcommits.org/es/) en español (`feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`).
- Migraciones nuevas con el siguiente número; seeds idempotentes; `.env` nunca se sube.
