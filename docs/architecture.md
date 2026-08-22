# Arquitectura de Nexus-Battle-Community

Documento técnico del servicio. La arquitectura del sistema completo, los ADR y los diagramas viven en [Nexus-Battle-Infrastructure](https://github.com/Nexus-Battle-VI/Nexus-Battle-Infrastructure).

## Bounded context

**Community** es responsable de la conversación entre jugadores: hilos, mensajes y las decisiones de moderación sobre ellos.

No es responsable de quién es la persona que escribe. El identificador proviene del contexto Account y aquí se trata como opaco. Esa frontera limita deliberadamente el dato personal que este contexto llega a almacenar: no guarda correos ni nombres.

### Datos que posee

Community es propietario exclusivo de los hilos y sus mensajes. Ningún otro servicio accede a este almacén, ni directamente ni mediante claves foráneas.

Es el contexto del producto con **mayor exposición a contenido escrito por personas usuarias**, y por tanto el que concentra el riesgo de abuso.

## Capas

```text
+-------------------------------------------------------------+
|  adapters/inbound/http   ThreadsController                   |
+-------------------------------------------------------------+
|  application             OpenThread, PublishPost, HidePost,  |
|                          CloseThread, GetThread, ListThreads |
+-------------------------------------------------------------+
|  domain                  Thread (raiz), ModerationPolicy,    |
|                          objetos de valor y eventos          |
+-------------------------------------------------------------+
|  adapters/outbound       InMemoryThreadRepository,           |
|                          SystemClock, UuidGenerator          |
+-------------------------------------------------------------+
|  infrastructure          config, observability, health,      |
|                          bootstrap (raiz de composicion)     |
+-------------------------------------------------------------+
```

## Por qué el mensaje no es un agregado

Un mensaje no existe fuera de su hilo. Las reglas que lo gobiernan son invariantes del hilo completo:

- no se publica en un hilo cerrado;
- no se superan los 500 mensajes por hilo;
- no se repite el identificador de un mensaje dentro del hilo.

Ninguna de esas reglas puede verificarse mirando un mensaje aislado. Por eso `Thread` es la raíz y los mensajes viven dentro de ella, cargándose y guardándose como una unidad.

El coste de esta decisión es real: un hilo con muchos mensajes se carga entero. El límite de 500 lo acota, y la alternativa — un agregado por mensaje — haría imposible garantizar las invariantes sin bloqueos.

## Ocultar no es borrar

```text
persistencia      ->  conserva TODOS los mensajes, con su marca `hidden`
proyeccion (DTO)  ->  filtra los ocultos antes de salir del servicio
```

La separación entre `toSnapshot()` y `toThreadDto()` es intencionada:

- **`toSnapshot()`** incluye los mensajes ocultos. La persistencia debe conservarlos para que una decisión de moderación pueda revisarse o revertirse (`restorePost`).
- **`toThreadDto()`** los omite. La lectura pública nunca debe exponerlos.

Si ambas responsabilidades vivieran en el mismo método, ocultar sería o bien irreversible o bien ineficaz.

## Puertos

| Puerto                 | Responsabilidad                           | Implementación actual      |
| ---------------------- | ----------------------------------------- | -------------------------- |
| `ThreadRepositoryPort` | Persistir, recuperar y listar hilos       | `InMemoryThreadRepository` |
| `ClockPort`            | Proveer el instante actual                | `SystemClock`              |
| `IdGeneratorPort`      | Generar identificadores de hilo y mensaje | `UuidGenerator`            |

## Patrones aplicados

| Patrón             | Dónde                                            | Por qué                                                |
| ------------------ | ------------------------------------------------ | ------------------------------------------------------ |
| Ports and Adapters | Todas las dependencias externas                  | Permite sustituir la persistencia sin tocar el dominio |
| Aggregate          | `Thread` con sus mensajes                        | Las invariantes abarcan el hilo completo               |
| Repository         | `ThreadRepositoryPort`                           | Aísla el agregado del mecanismo de almacenamiento      |
| State              | `ThreadStatus`                                   | Concentra qué operaciones admite cada estado           |
| Domain Events      | `post.published`, `post.hidden`, `thread.closed` | Registra hechos de forma trazable                      |

No se aplica CQRS ni Event Sourcing.

## Eventos de dominio

| Evento                     | Cuándo                              |
| -------------------------- | ----------------------------------- |
| `community.post.published` | Se publica un mensaje               |
| `community.post.hidden`    | Se oculta un mensaje por moderación |
| `community.thread.closed`  | Se cierra un hilo                   |

`post.published` transporta la **longitud** del contenido, no el contenido. Un evento que cruza el límite del servicio no debe llevar texto escrito por personas usuarias fuera del contexto que lo custodia. Hay una prueba que verifica que el texto no aparece en el evento serializado.

## Observabilidad

Registro JSON estructurado por línea, emitido exclusivamente desde `infrastructure/observability/logger.ts`. El resto del código tiene prohibido escribir en la consola mediante la regla `no-console` de ESLint.

No se registra el contenido de los mensajes.

## Salud

`/api/health/live` confirma que el proceso responde y no consulta dependencias. `/api/health/ready` evalúa el repositorio real y responde `503` cuando falla. Una comprobación que lanza una excepción cuenta como fallo, nunca como éxito.

## Limitaciones conocidas del alcance actual

- La persistencia es en memoria y se pierde al reiniciar. El adaptador PostgreSQL depende de ADR-005.
- **No hay control de acceso.** El `moderatorId` llega en el cuerpo de la petición sin verificación: cualquiera podría ocultar mensajes o cerrar hilos. Es la limitación más relevante de este servicio. Resolverla requiere que Account emita credenciales verificables, lo que depende del proveedor de identidad pendiente de aprobación. **Este servicio no debe desplegarse en un entorno accesible sin resolverla.**
- No hay filtrado automático de contenido. La moderación es manual y reactiva.
- La lectura no está paginada. El límite de 500 mensajes por hilo lo hace aceptable en la demo, no en la arquitectura objetivo.

Estas limitaciones están declaradas de forma explícita para que la arquitectura de demo no se confunda con la arquitectura objetivo.
