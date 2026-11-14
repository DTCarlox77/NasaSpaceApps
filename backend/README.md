# Astro Health — Backend

API REST en Node.js + Express + PostgreSQL para el monitoreo de salud de astronautas.

> **Aviso importante**
>
> - Todos los datos de astronautas que maneja este proyecto son **SINTÉTICOS**. No se usan datos reales de ninguna persona.
> - La aplicación es una herramienta de **apoyo a la decisión**. **No** realiza ni sustituye un diagnóstico médico.

## Requisitos

- [Node.js 20 LTS](https://nodejs.org/) (ver `.nvmrc`; con nvm: `nvm use`)
- npm
- [Docker](https://www.docker.com/) con Docker Compose (para PostgreSQL 16)

## Puesta en marcha local

Todos los comandos se ejecutan dentro de la carpeta `backend/`.

```bash
cp .env.example .env     # 1. variables de entorno
npm i                    # 2. dependencias
npm run db:up            # 3. levanta PostgreSQL en Docker
npm run db:migrate       # 4. aplica las migraciones
npm run dev              # 5. inicia la API con recarga automática
```

Comprobación:

- Health check: <http://localhost:3000/api/v1/health>
- Documentación (Swagger UI): <http://localhost:3000/api/docs>

### Scripts disponibles

| Script               | Descripción                                                         |
| -------------------- | ------------------------------------------------------------------- |
| `npm run dev`        | Inicia la API con nodemon                                           |
| `npm start`          | Inicia la API en modo normal                                        |
| `npm run db:up`      | Levanta el contenedor de PostgreSQL (`docker compose up -d`)        |
| `npm run db:down`    | Detiene el contenedor de PostgreSQL                                 |
| `npm run db:migrate` | Aplica las migraciones pendientes de `db/migrations`                |
| `npm run db:seed`    | Ejecuta los seeds de `db/seeds`                                     |
| `npm run db:reset`   | Borra el schema `public`, migra y siembra (bloqueado en producción) |
| `npm run lint`       | Revisa el código con ESLint                                         |
| `npm run format`     | Formatea el código con Prettier                                     |

### Migraciones

- Son archivos `.sql` numerados en `db/migrations/` (`000_init.sql`, `001_...sql`, ...) y forman parte del script DDL entregable del proyecto.
- `scripts/migrate.js` los aplica en orden, cada uno en su propia transacción, y registra cada archivo en la tabla `schema_migrations`. Ejecutarlo varias veces no reaplica nada.
- Nunca modifiques una migración ya aplicada: crea una nueva con el siguiente número.

## Estructura de carpetas

```
backend/
├── src/
│   ├── app.js              # configuración de Express, middlewares, rutas y Swagger
│   ├── server.js           # arranque del servidor y cierre ordenado
│   ├── config/             # variables de entorno y pool de PostgreSQL
│   ├── routes/             # definición de rutas (montadas bajo /api/v1)
│   ├── controllers/        # manejo de peticiones HTTP
│   ├── services/           # lógica de negocio
│   ├── models/             # repositorios SQL por entidad
│   ├── middlewares/        # notFound y manejo uniforme de errores
│   ├── engine/             # motor de evaluación (pendiente)
│   ├── simulator/          # simulador de datos sintéticos (pendiente)
│   └── utils/              # utilidades compartidas
├── db/
│   ├── migrations/         # DDL en archivos .sql numerados
│   └── seeds/              # datos iniciales en .sql
├── scripts/                # migrate.js y seed.js
├── docs/openapi.yaml       # especificación OpenAPI 3.0
└── docker-compose.yml      # PostgreSQL 16 con volumen persistente
```

### Formato de errores

Todas las respuestas de error siguen el mismo formato JSON:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Ruta no encontrada: GET /api/v1/foo",
    "details": null
  }
}
```

## Convención de ramas

```
main ← develop ← feature/<nombre>
                 fix/<nombre>
                 chore/<nombre>
```

- `main`: código estable/entregable.
- `develop`: integración. Todas las ramas de trabajo salen de `develop` y vuelven a ella mediante Pull Request.
- `feature/<nombre>`: nuevas funcionalidades.
- `fix/<nombre>`: corrección de errores.
- `chore/<nombre>`: configuración, dependencias y tareas de mantenimiento.

## Convención de commits

Se usa [Conventional Commits](https://www.conventionalcommits.org/es/), con mensajes cortos y en español:

| Tipo        | Uso                                            |
| ----------- | ---------------------------------------------- |
| `feat:`     | nueva funcionalidad                            |
| `fix:`      | corrección de un error                         |
| `chore:`    | configuración, dependencias, tareas de soporte |
| `docs:`     | documentación                                  |
| `refactor:` | cambio de código sin alterar el comportamiento |
| `test:`     | pruebas                                        |

Ejemplo: `feat: agrega endpoint de signos vitales`
