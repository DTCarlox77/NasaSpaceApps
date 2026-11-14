# Relevo del backend

## Estado

## Cómo levantar el proyecto

## Credenciales demo

## Decisiones

- Respuestas del triaje: `{ "value": … }` para sí/no y números, `{ "choice": "<código>" }` para opciones; el adaptador también acepta valores sueltos.
- Bandera de radiación = `none` si el recorrido no pasa por el módulo de radiación (incluida la categoría negra).

## Pendientes

- Tarea 9: `responder_safe` es una pregunta de la sesión. El servicio debe copiar esa respuesta en las respuestas de cada evaluación antes de llamar a `evaluateAssessment`; si no, el resultado es `incomplete` con `pending: "responder_safe"`.
- Una respuesta `{ value: null }` cuenta como pendiente.

## Siguiente tarea
