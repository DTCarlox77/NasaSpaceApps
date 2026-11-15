# Panel de Tierra (Astro Health)

Panel web para el equipo en Tierra del reto *Health Monitoring Software for Astronauts* (NASA Space Apps): **control de misión** (`admin`), **flight surgeon** y **salud conductual**. Solo consume la API del backend (`../backend`, contrato `backend/docs/openapi.yaml` v1.7). La app móvil de la tripulación es otro proyecto.

> **Datos sintéticos.** Es una herramienta de apoyo a la decisión, **no** un diagnóstico.

Hecho hasta P2: base (cliente HTTP, despertar del servidor, login, navegación por rol), estado del enlace en la cabecera, **dashboard de tripulación** y **bandeja de alertas**. Emergencias, Cumplimiento y Demo llegan en P3, y Salud conductual en P4; mientras tanto, cada una es un placeholder que dice qué endpoint usará.

## Requisitos

- Node 20.19 o más nuevo, y npm.
- Un backend: el desplegado en Render (por defecto), uno local o el mock de Prism.

## Empezar

En PowerShell, desde `panel/`:

```powershell
Copy-Item .env.example .env
npm ci
npm run dev
```

Abre http://localhost:5173. El puerto es fijo (`strictPort`): ese origen está permitido en `CORS_ORIGIN` de la API. Si el 5173 está ocupado, `npm run dev` falla en vez de usar otro puerto (desde otro puerto el navegador bloquearía las respuestas por CORS).

## Scripts

| Script | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo en http://localhost:5173. |
| `npm run build` | `tsc -b` + `vite build` → `dist/`. |
| `npm run preview` | Sirve `dist/` en el puerto 5173. |
| `npm run typecheck` | TypeScript estricto, sin generar archivos. |
| `npm test` | Pruebas con Vitest (sin red: `fetch` simulado). |
| `npm run lint` | ESLint. |

## A qué backend apunta

`VITE_API_URL` en `panel/.env` es la URL base **sin** `/api/v1` (el panel la agrega). Para probar escrituras (acuse, respuesta) sin tocar la base compartida de Render, ponla en `panel/.env.local` apuntando al backend local; `.env.local` tiene prioridad y no se sube. Después de cambiarla, reinicia `npm run dev`.

| Backend | `VITE_API_URL` |
|---|---|
| Render (por defecto) | `https://astro-health-api-81jd.onrender.com` |
| Local (`cd ../backend; npm run dev`) | `http://localhost:3000` |
| Mock de Prism (`cd ../backend; npm run api:mock`) | `http://localhost:4010` |

Con el mock, cualquier usuario "entra" con el ejemplo del contrato. Para ver el cambio de contraseña obligatorio sin tocar cuentas reales, pide el 428 al mock: `curl -X POST http://localhost:4010/api/v1/auth/login -H "Prefer: code=428" ...`, o mira la prueba `src/test/login.test.tsx`.

## Modo demo sin servidor (`VITE_DATA_MODE=mock`)

Para que **todo el flujo se vea en la demo** sin depender de Render ni de un backend local:

```powershell
$env:VITE_DATA_MODE = 'mock'; npm run dev
```

(o pon `VITE_DATA_MODE=mock` en `panel/.env.local`). `VITE_DATA_MODE` vale `api` (por defecto) o `mock`; cualquier otro valor muestra "Falta configurar el panel".

- El cliente HTTP (`src/api/http.ts`) **no sale a la red**: delega en el adaptador `src/api/mock/`, que responde por método + ruta del contrato con los **mismos esquemas JSON y los mismos códigos de error**. Las pantallas y los hooks son idénticos en los dos modos. `VITE_API_URL` no hace falta y el panel no llama a `/health` (no hay servidor que despertar).
- **Usuarios**: `mission.control` (admin), `dr.reyes` (flight surgeon) y `bh.salas` (salud conductual), con **cualquier contraseña no vacía**. Un astronauta (`a.ortega`, `k.mensah`, `l.tanaka`, `m.silva`) se rechaza igual que hoy.
- **Mismas reglas de acceso que la API**: 403 a admin y flight surgeon en todo lo conductual; 403 a admin en hilo, acuse y respuesta de las alertas de bienestar, de `SLEEP_HOURS` y de `category=emergency`; `compliance` null para el flight surgeon; la nota privada del check-in no existe.
- **Datos fijos** (`src/api/mock/fixtures/`, sintéticos y con fechas relativas a "ahora"): misión ARES-1 con retraso de 90 s; ORION (a.ortega, comandante), VEGA (k.mensah, oficial médico), LYRA (l.tanaka) y ATLAS (m.silva); 14 días de lecturas con precauciones y una crítica; alertas de todas las categorías (una sincronizada tarde y otra que llega a Tierra ~2 min después de abrir); una emergencia abierta (evento solar), una cerrada con reporte y una cancelada; bienestar para salud conductual.
- **Persistencia local** (`localStorage`, clave `panel-demo-state-v1`, JSON versionado): se guardan solo los cambios sobre los fixtures, con ids estables (acuses, respuestas, mensajes de apoyo, cierres y, desde V1b, cuentas creadas o editadas y cambios de contraseña, estos solo como hash SHA-256). También el `t0` de los fixtures: al recargar, los eventos programados (la alerta de los 2 min, la solicitud de VEGA a los 2,5 min) no se repiten. Si `localStorage` falla o el JSON está roto o es de otra versión, se ignora (aviso en consola) y arranca con los fixtures. "Demo → Reiniciar" lo borra. En modo api no se guarda nada de esto (solo el `device_id` de siempre).
- Cada mensaje a bordo vuelve con `deliver_at` = ahora + 90 s.
- La cabecera muestra la cinta fija **"Modo demo sin servidor · datos sintéticos"**.

## Usuarios demo (equipo en Tierra)

Contraseña de todos: **`Demo2026!`** (datos sintéticos).

| Usuario | Rol | Ve |
|---|---|---|
| `mission.control` | `admin` (control de misión) | Dashboard, Alertas, Emergencias, Cumplimiento y Demo |
| `dr.reyes` | `flight_surgeon` | Dashboard, Alertas y Emergencias |
| `bh.salas` | `behavioral_health` | Salud conductual |

Un astronauta (`a.ortega`, …) se rechaza: "Este panel es para el equipo en Tierra. Los astronautas usan la app móvil."

## Avisos

- **Render se duerme** tras ~15 min sin uso: al abrir, el panel llama a `/api/v1/health` y espera hasta 60 s ("Despertando el servidor…").
- **La base de Render es compartida** con la app y los demás equipos: no la uses para pruebas destructivas.
- **No uses `m.silva`**: tiene el cambio de contraseña obligatorio; si lo cambias, deja de servir para la demo de la app.
- **No falles el login a propósito con un usuario demo**: 5 intentos fallidos lo bloquean 15 min. Para probar "credenciales inválidas" usa un usuario que no existe (p. ej. `no.existe`).

## Cómo funciona

- **Sesión** [decisión]: el `access_token` vive solo en memoria; `refresh_token`, `user` y `context` en `sessionStorage` (se borran al cerrar la pestaña). Al recargar, el panel pide un token nuevo con `POST /auth/refresh`. El `device_id` (`panel-<uuid>`) está en `localStorage` y sobrevive al cierre de sesión.
- **Cliente HTTP** (`src/api/http.ts`):
  - errores del contrato → `HttpError(status, code, message, details)`: se decide por `code`, nunca por el texto;
  - un 401 `UNAUTHENTICATED` hace **un solo** refresh aunque fallen varias peticiones a la vez, guarda los dos tokens (es rotativo) y reintenta;
  - si el refresh se rechaza, la sesión termina ("Tu sesión terminó. Inicia sesión de nuevo.");
  - una caída de red o un timeout (20 s) es `NetworkError` y no cierra la sesión.
- **Navegación por rol** (`src/nav/access.ts`): única fuente de qué ve cada rol, tomada del `x-roles` del contrato. Salud conductual es solo de `behavioral_health`; Cumplimiento y Demo, solo de `admin`. Una URL sin permiso muestra "Sin acceso" (no redirige). El backend vuelve a comprobar el rol en cada petición.
- **React Query**: no reintenta 401/403/404; errores de red y 5xx, hasta 2 veces; sin refetch al volver a la ventana.
- **Misión seleccionada** (`useMission()`): una de `context.ground_missions`. Toda consulta de datos lleva `mission_id` en la URL y en la clave (`['mission', mission_id, …]`); al cambiar de misión se borran.
- **Cabecera**: estado del enlace con `GET /missions/current` cada 30 s (activo con su retraso, o sin enlace hasta hh:mm; próximo corte; entorno y gravedad).
- **Dashboard** (`/tripulacion`, cada 30 s): semáforo físico por tripulante, sparkline y tendencia de la API, aptitud y, solo para admin, cumplimiento. El detalle está en `/tripulacion/:astronautId`. Si llega algo fuera del semáforo físico, no se muestra y se avisa.
- **Alertas** (`/alertas`, cada 15 s): bandeja por prioridad, filtro y etiqueta visible por categoría (lectura, emergencia · triaje, bienestar, manual), "Cargar más", acuse y respuesta a bordo. De bienestar solo se ve el estado.
  - **Hilo real** (contrato v1.8, `GET /admin/escalations/{id}/messages`, cada 15 s): mensajes de a bordo y de Tierra en orden, cada uno con su estado de entrega ("Llega a bordo a las hh:mm", "Pendiente de envío: sin enlace", "Entregado a bordo"; lo de a bordo, "Llegó a Tierra a las hh:mm"). Escalamiento cerrado: el hilo se lee y la respuesta queda deshabilitada (409). Si la alerta no está en lo cargado (p. ej. llega desde Emergencias), el detalle abre el hilo por id.
  - **Admin** en `category=emergency` (y en bienestar o `SLEEP_HOURS`, que el contrato le niega): sin hilo, acuse ni respuesta, "Solo estado operativo"; un 403 de la API muestra lo mismo.
  - `SLEEP_HOURS` no se muestra en el dashboard ni en el detalle de tripulante para ningún rol (defensa: el backend ya lo excluye desde v1.8).
- **Emergencias** (`/emergencias`, flight surgeon y admin): lista con estado, inicio, quién la abrió (manual o automática y motivo), tripulantes evaluados y peor categoría de triaje; filtro por estado. Detalle en `/emergencias/:id`: línea de tiempo vertical, orden de atención con la categoría (color + texto) y el bloque de radiación, último latido frente al umbral del hombre muerto del contrato, preguntas de la tripulación con "Responder en Alertas" y reporte al cierre. Admin ve solo el estado operativo (si la API mandara algo clínico, no se muestra). Sondeo cada 10 s con una emergencia abierta y 30 s si no. "Triaje autónomo a bordo · protocolo, no diagnóstico".
- **Aviso global**: con una emergencia abierta, la cabecera lo dice (flight surgeon y admin) con enlace al detalle.
- **Salud conductual** (SOLO `behavioral_health`; admin y flight surgeon no la ven y la URL muestra "Sin acceso"). Texto fijo: "Confidencial · cada consulta queda registrada · apoyo a la decisión, no diagnóstico".
  - Bandeja (`/salud-conductual`, cada 30 s): escalamientos confidenciales y solicitudes "Quiero hablar con alguien" con prioridad o urgencia y su retraso; "Incluir lo cerrado".
  - Detalle por astronauta (`/salud-conductual/astronauta/:id`, cada 60 s): los 4 deslizadores (ánimo, fatiga, estrés, roces) en el tiempo con la banda del rango habitual y la z adversa de la API; PHQ-2/GAD-2 solo positivo/negativo y fecha; PVT contra su línea base y aptitud; solicitudes (acuse, respuesta con `deliver_at`, cierre) y escalamientos abiertos (acuse y cierre). **Nunca la nota privada** del check-in.
  - Auditoría (`/salud-conductual/auditoria`): quién consultó datos confidenciales, de quién, qué y cuándo.
  - El rango habitual (media ± 1 desviación de sus check-ins anteriores a los últimos 3) y la línea base de la PVT (promedio de sus pruebas anteriores) los estima el panel: el contrato no los manda, y la pantalla lo dice.
- **Carga por ruta**: el dashboard (con Recharts), la bandeja, Emergencias y Salud conductual se cargan al abrirlos.

## Estructura

```
src/
  config/env.ts        VITE_API_URL → API_BASE (/api/v1)
  api/                 http (cliente), auth, missions, ground, queryKeys, types
  auth/                storage (tokens), AuthProvider, SessionGate, RequireRole, mensajes
  nav/access.ts        matriz rol → secciones y acciones (x-roles)
  mission/             misión seleccionada y resumen del enlace
  lib/time.ts          hh:mm, "hace X", retraso, cuenta regresiva, estado a bordo
  features/crew/       dashboard y detalle por tripulante
  features/alerts/     bandeja, acuse y respuesta
  layout/AppShell.tsx  cabecera (enlace) + barra lateral (contador de alertas)
  pages/               WakeGate, Login, ChangePassword, Forbidden, NotFound, placeholders
  components/          Button, Field, Banner, Spinner, StatusBadge
  styles/              tokens.css (colores, semáforo) y global.css
  test/                pruebas (Vitest + Testing Library)
```
