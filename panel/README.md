# Panel de Tierra (Astro Health)

Panel web para el equipo en Tierra del reto *Health Monitoring Software for Astronauts* (NASA Space Apps): **control de misión** (`admin`), **flight surgeon** y **salud conductual**. Solo consume la API del backend (`../backend`, contrato `backend/docs/openapi.yaml` v1.7). La app móvil de la tripulación es otro proyecto.

> **Datos sintéticos.** Es una herramienta de apoyo a la decisión, **no** un diagnóstico.

Esta es la base (P1): proyecto, cliente HTTP, despertar del servidor, login, layout y navegación por rol. Las pantallas con datos llegan en P2–P4; por ahora cada sección es un placeholder que dice qué endpoint usará.

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

`VITE_API_URL` en `panel/.env` es la URL base **sin** `/api/v1` (el panel la agrega). Después de cambiarla, reinicia `npm run dev`.

| Backend | `VITE_API_URL` |
|---|---|
| Render (por defecto) | `https://astro-health-api-81jd.onrender.com` |
| Local (`cd ../backend; npm run dev`) | `http://localhost:3000` |
| Mock de Prism (`cd ../backend; npm run api:mock`) | `http://localhost:4010` |

Con el mock, cualquier usuario "entra" con el ejemplo del contrato. Para ver el cambio de contraseña obligatorio sin tocar cuentas reales, pide el 428 al mock: `curl -X POST http://localhost:4010/api/v1/auth/login -H "Prefer: code=428" ...`, o mira la prueba `src/test/login.test.tsx`.

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

## Estructura

```
src/
  config/env.ts        VITE_API_URL → API_BASE (/api/v1)
  api/                 http (cliente), auth, health, queryClient, types
  auth/                storage (tokens), AuthProvider, SessionGate, RequireRole, mensajes
  nav/access.ts        matriz rol → secciones
  layout/AppShell.tsx  cabecera + barra lateral
  pages/               WakeGate, Login, ChangePassword, Forbidden, NotFound, placeholders
  components/          Button, Field, Banner, Spinner, StatusBadge
  styles/              tokens.css (colores, semáforo) y global.css
  test/                pruebas (Vitest + Testing Library)
```
