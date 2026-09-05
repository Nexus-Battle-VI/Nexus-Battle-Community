# Arquitectura de Nexus-Battle-Community

Documento técnico del servicio. La arquitectura del sistema completo, los ADR y los diagramas viven en [Nexus-Battle-Infrastructure](https://github.com/Nexus-Battle-VI/Nexus-Battle-Infrastructure).

## Bounded context

**Community** es responsable de la conversación entre jugadores: hilos, mensajes y las decisiones de moderación sobre ellos.

No es responsable de quién es la persona que escribe. El identificador proviene del contexto Account y aquí se trata como opaco. Esa frontera limita deliberadamente el dato personal que este contexto llega a almacenar: no guarda correos ni nombres.

### Datos que posee

Community es propietario exclusivo de los hilos, sus mensajes, y de los comentarios y calificaciones que los jugadores publican sobre un producto (HU-40). Ningún otro servicio accede a este almacén, ni directamente ni mediante claves foráneas.

El `productId` que referencian los comentarios y calificaciones es un dato de OTRO servicio (`Nexus-Battle-Catalog`): Community no posee el producto, solo lo que los jugadores dicen sobre él.

Es el contexto del producto con **mayor exposición a contenido escrito por personas usuarias**, y por tanto el que concentra el riesgo de abuso.

## Capas

```text
+---------------------------------------------------------------------+
|  adapters/inbound/http   ThreadsController, ProductCommentsController|
+---------------------------------------------------------------------+
|  application             OpenThread, PublishPost, HidePost,         |
|                          CloseThread, GetThread, ListThreads,       |
|                          PublishProductComment, ListProductComments,|
|                          RateProduct, GetProductReviewSummary       |
+---------------------------------------------------------------------+
|  domain                  Thread (raiz), ProductComment,             |
|                          ProductReview, ModerationPolicy,           |
|                          objetos de valor y eventos                 |
+---------------------------------------------------------------------+
|  adapters/outbound       Thread/ProductComment/ProductReview        |
|                          Repository (InMemory y Postgres),          |
|                          LocalProductCatalog, SystemClock,          |
|                          UuidGenerator                               |
+---------------------------------------------------------------------+
|  infrastructure          config, observability, health,             |
|                          bootstrap (raiz de composicion)            |
+---------------------------------------------------------------------+
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

## Por qué el comentario de producto no es un Post

HU-40 exige que un jugador pueda publicar cualquier cantidad de comentarios sobre un producto, sin límite. Reutilizar `Thread`/`Post` para esto habría heredado `ModerationPolicy.MAX_POSTS_PER_THREAD` (500 mensajes por agregado) — un tope que existe por una razón real (evitar cargar un agregado sin límite) pero que aquí habría contradicho la propia regla de negocio de HU-40.

Por eso `ProductComment` es una entidad independiente, identificada por su propio id y asociada a un `productId`, sin agregado padre y sin invariantes de "hilo cerrado". Se consulta paginada (`limit`/`offset`), no cargando todo el histórico de un producto de una vez.

`ProductReview` (la calificación) es, a su vez, independiente de `ProductComment`: retirar un comentario no borra la calificación de quien lo escribió, y calificar un producto no limita cuántos comentarios puede seguir publicando ese jugador. La unicidad de "una calificación por jugador y producto" la garantiza en última instancia la restricción `UNIQUE` del motor, no solo la comprobación previa del caso de uso — verificado contra PostgreSQL real ante dos solicitudes concurrentes.

## Existencia de producto: un catálogo local, no una llamada a Catalog

`ProductExistencePort` (implementado hoy por `LocalProductCatalog`) es el mismo patrón que `LocalCatalogPricing` en `Nexus-Battle-Commerce`: un adaptador completo sobre datos en memoria, no una simulación del servicio real. Community no llama en vivo a `Nexus-Battle-Catalog` porque el contrato público de Catalog expone `sku`, mientras que este dominio ya trabaja con `productId` (el mismo `productId` canónico de Catalog, validado con el mismo patrón UUID) — la brecha de identificador queda fuera del alcance de HU-40.

## Moderación de comentarios (HU-41)

HU-41 depende de HU-40 y HU-46 (ya integrados) y, documentado en Management, de `EN-006 — Trazabilidad y auditoría`: una capacidad transversal común para las acciones administrativas de todo el org, pensada para dar un esquema de auditoría compartido entre Catalog, Account y Community. EN-006 sigue sin ninguna Task ni decisión del Product Owner sobre dónde vive esa capacidad -"Épica padre: Pendiente de decisión"-, así que HU-41 no la invoca: sería inventar un contrato con algo que todavía no existe.

En su lugar, `CommentModerationAction` es el registro de auditoría **mínimo que HU-41 exige por sí misma** -actor, fecha, motivo, estado anterior y nuevo estado, y desde HU-41.8 también la IP de origen (Management#194 referencia EN-006 sin cerrarlo; ver más abajo)-, acotado a la moderación de comentarios y sin ninguna pretensión de sustituir a EN-006. Cuando esa capacidad transversal exista, este registro es candidato a reconciliarse con ella; hasta entonces, vive en la persistencia propia de Community, igual que `CommentReport`.

### Auditoría reforzada (HU-41.8): IP, atomicidad e inmutabilidad

El PDF fuente (7.3.5, Registro de auditoría) exige, para acciones administrativas, IP de origen además de actor/fecha/motivo/valores. HU-41.8 añade exactamente eso a `CommentModerationAction` -`ipAddress`- sin ampliar su alcance más allá: no se añaden `actorRole`, `correlationId` ni ningún otro campo sin una necesidad demostrable, y esto **no** es una implementación de `EN-006 — Trazabilidad y auditoría` (Management#194), que sigue sin Tasks ni decisión del Product Owner.

- **La IP se resuelve EXCLUSIVAMENTE del servidor**, nunca del cuerpo de la petición: `CommentModerationController` usa `@Ip()` de NestJS sobre cada una de las cinco acciones, y `ValidationPipe({ forbidNonWhitelisted: true })` ya rechaza cualquier `ipAddress` que Web intente enviar en el body antes de que el caso de uso la vea. `main.ts` fija `app.set('trust proxy', 1)`: Community está siempre detrás de un único proxy inverso real (Caddy, `reverse_proxy` simple sin manipular cabeceras — ver el Caddyfile de `Nexus-Battle-Infrastructure`), así que confiar en exactamente un salto de `X-Forwarded-For` es lo que hace que `request.ip` refleje al jugador real y no a Caddy, sin abrir la puerta a que un cliente inyecte saltos adicionales falsos.
- **Comentario y auditoría se escriben en una única transacción** (`CommentModerationTransactionPort`, con `PostgresCommentModerationTransaction` abriendo una transacción real de Kysely): si cualquiera de las dos escrituras falla, ninguna queda hecha. Antes de HU-41.8, `comments.save()` y `actions.save()` eran dos escrituras independientes que podían dejar estado parcial ante un fallo intermedio.
- **`comment_moderation_actions` es append-only frente al motor, no solo frente al código**: la migración de HU-41.8 añade un disparador (`comment_moderation_actions_solo_insercion`) que hace fallar cualquier `UPDATE`/`DELETE` directo sobre la tabla, y `PostgresCommentModerationActionRepository.save()` ya NO usa `ON CONFLICT DO NOTHING` -una colisión de id ahora falla de forma audible en vez de hacer desaparecer evidencia en silencio-.
- Los registros anteriores a esta migración conservan `ip_address = NULL`: no se inventa una IP retroactiva para evidencia que nunca se capturó.

`ProductComment` gana un `moderationStatus` (`PENDING` al publicarse, y uno de `APPROVED`/`DELETED`/`HIDDEN`/`EDITED`/`MARKED` tras la acción correspondiente, uno a uno). HU-41 no declara ninguna transición vetada entre esos cinco estados: un comentario oculto puede aprobarse después. "Eliminar" es un borrado **lógico** -la fila permanece con `DELETED`-, no físico: borrar la fila destruiría la evidencia que la propia historia exige conservar.

La cola de moderación (`GET /comments/moderation-queue`, HU-41.1) tiene **dos fuentes de entrada** (Management#29, HU-41.7): `CommentReport` (HU-46, origen `USER_REPORT`) y `AutomaticModerationFlag` (HU-41.7, origen `AUTOMATIC_FILTER`). `ModerationQueueRepositoryPort` combina ambas agrupando por comentario, de modo que uno con los dos orígenes aparece UNA sola vez; el DTO de cada entrada expone `sources` para que un consumidor (Web) distinga si el comentario llegó por reporte, por detección automática, o por ambos.

### Filtro automático de contenido (HU-41.7, Management#29)

`CommentContentModerationPolicyPort` evalúa el contenido de un comentario y devuelve candidatas a señal (`ModerationSignalCandidate`), sin decidir nada por sí mismo: nunca oculta, elimina ni sanciona, y nunca llama a otro servicio (ni Account ni ningún otro tiene hoy un contrato reutilizable de lista negra de contenido). Su única implementación, `ConfigurableCommentContentModerationPolicy`, es una política **local y configurable** de Community: los términos prohibidos y los patrones sospechosos vienen de `COMMENT_MODERATION_FORBIDDEN_TERMS`/`COMMENT_MODERATION_SUSPICIOUS_PATTERNS` (listas separadas por comas), nunca hardcodeados en el código de producción. Sin configurar, el filtro no genera ninguna señal — es una capacidad que se activa por configuración, no un comportamiento que aparece por defecto.

Cada candidata que `PublishProductComment` encuentra se persiste como `AutomaticModerationFlag`: una entidad independiente (mismo patrón que `CommentReport`, sin clave foránea a `product_comments`) que identifica el comentario, fija el origen en `AUTOMATIC_FILTER`, la fecha de detección, y la evidencia técnica mínima (el término o fragmento que disparó la regla — nunca el comentario completo ni datos personales). El comentario se publica siempre con normalidad; la señal es evidencia para el Moderador, no una decisión de moderación.

`CommentPublicationTransactionPort` (`InMemoryCommentPublicationTransaction` / `PostgresCommentPublicationTransaction`) es lo que garantiza que el comentario y sus señales se escriben de forma atómica: el adaptador PostgreSQL abre una transacción real de Kysely y construye los repositorios de comentarios y de señales ligados a ella, de modo que un fallo a mitad de camino revierte ambas escrituras. Es un puerto acotado a esta única necesidad de atomicidad, no un Unit of Work genérico para todo el servicio.

El vocabulario usado en las pruebas automatizadas (por ejemplo `forbidden-test-term`) es artificial y de prueba: no representa ninguna regla de negocio real, tal y como exige Management#29 explícitamente.

## Puertos

| Puerto                                  | Responsabilidad                                                            | Implementación actual                                                                     |
| --------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `ThreadRepositoryPort`                  | Persistir, recuperar y listar hilos                                        | `InMemoryThreadRepository` / `PostgresThreadRepository`                                   |
| `ProductCommentRepositoryPort`          | Persistir y listar (paginados) comentarios de producto                     | `InMemoryProductCommentRepository` / `PostgresProductCommentRepository`                   |
| `ProductReviewRepositoryPort`           | Persistir calificaciones y calcular su resumen                             | `InMemoryProductReviewRepository` / `PostgresProductReviewRepository`                     |
| `CommentReportRepositoryPort`           | Persistir reportes de jugador (HU-46)                                      | `InMemoryCommentReportRepository` / `PostgresCommentReportRepository`                     |
| `CommentModerationActionRepositoryPort` | Persistir y consultar la auditoría de moderación (HU-41.3/41.8)            | `InMemoryCommentModerationActionRepository` / `PostgresCommentModerationActionRepository` |
| `CommentModerationTransactionPort`      | Atomicidad de comentario + auditoría en una acción de moderación (HU-41.8) | `InMemoryCommentModerationTransaction` / `PostgresCommentModerationTransaction`           |
| `AutomaticModerationFlagRepositoryPort` | Persistir señales del filtro automático (HU-41.7)                          | `InMemoryAutomaticModerationFlagRepository` / `PostgresAutomaticModerationFlagRepository` |
| `ModerationQueueRepositoryPort`         | Combinar reportes y señales automáticas en la cola de moderación (HU-41.1) | `InMemoryModerationQueueRepository` / `PostgresModerationQueueRepository`                 |
| `CommentContentModerationPolicyPort`    | Evaluar contenido y devolver candidatas a señal (HU-41.7)                  | `ConfigurableCommentContentModerationPolicy`                                              |
| `CommentPublicationTransactionPort`     | Atomicidad de publicar comentario + señal automática (HU-41.7)             | `InMemoryCommentPublicationTransaction` / `PostgresCommentPublicationTransaction`         |
| `ProductExistencePort`                  | Confirmar que un producto existe                                           | `LocalProductCatalog`                                                                     |
| `ClockPort`                             | Proveer el instante actual                                                 | `SystemClock`                                                                             |
| `IdGeneratorPort`                       | Generar identificadores                                                    | `UuidGenerator`                                                                           |

## Patrones aplicados

| Patrón                | Dónde                                                                                                                                                                                                                                   | Por qué                                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ports and Adapters    | Todas las dependencias externas                                                                                                                                                                                                         | Permite sustituir la persistencia sin tocar el dominio                                                                                            |
| Aggregate             | `Thread` con sus mensajes                                                                                                                                                                                                               | Las invariantes abarcan el hilo completo                                                                                                          |
| Entidad independiente | `ProductComment`, `ProductReview`, `CommentReport`, `CommentModerationAction`, `AutomaticModerationFlag`                                                                                                                                | Sin invariantes compartidas entre comentarios/calificaciones/reportes/auditoría/señales de un mismo producto; ninguna necesita cargar a las demás |
| Repository            | `ThreadRepositoryPort`, `ProductCommentRepositoryPort`, `ProductReviewRepositoryPort`, `CommentReportRepositoryPort`, `CommentModerationActionRepositoryPort`, `AutomaticModerationFlagRepositoryPort`, `ModerationQueueRepositoryPort` | Aísla cada entidad del mecanismo de almacenamiento                                                                                                |
| State                 | `ThreadStatus`, `CommentModerationStatus`                                                                                                                                                                                               | Concentra qué operaciones/estados admite cada agregado                                                                                            |
| Domain Events         | `post.published`, `post.hidden`, `thread.closed`                                                                                                                                                                                        | Registra hechos de forma trazable                                                                                                                 |

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
- **El filtrado automático de contenido (HU-41.7) es una política LOCAL de Community, no un modelo de NLP ni un proveedor externo.** Sin `COMMENT_MODERATION_FORBIDDEN_TERMS`/`COMMENT_MODERATION_SUSPICIOUS_PATTERNS` configurados, no genera ninguna señal; la moderación de las señales que genera sigue siendo manual y reactiva -el filtro nunca sanciona, oculta ni elimina por sí mismo-.
- La lectura de hilos no está paginada. El límite de 500 mensajes por hilo lo hace aceptable en la demo, no en la arquitectura objetivo. La lectura de comentarios de producto sí está paginada (`limit`/`offset`) desde el principio, precisamente porque HU-40 no admite un tope equivalente al de `Thread`.
- **La existencia de producto se verifica contra un catálogo local (`LocalProductCatalog`), no contra `Nexus-Battle-Catalog` en vivo.** El contrato público de Catalog expone `sku`; este dominio ya trabaja con `productId`. Resolver esa brecha de identificador queda fuera del alcance de HU-40.
- **Las imágenes de comentario se guardan como referencia (URL), no como archivo subido.** No existe todavía almacenamiento propio de objetos en Community: la decisión de si se reutiliza el bucket S3 de Catalog o se solicita uno nuevo está pendiente en el Enabler EN-028 de `Nexus-Battle-Management`.
- El promedio de calificación de un producto se calcula y expone solo desde Community (`GET /products/:productId/reviews/summary`); no se escribe en el producto canónico de Catalog. Ese endpoint interno es una integración coordinada pero separada, del lado de Catalog.
- ~~La cola de moderación (HU-41.1) solo incluye comentarios reportados.~~ Resuelto en HU-41.7 (Management#29): la cola combina reportes (`USER_REPORT`) y detecciones del filtro automático (`AUTOMATIC_FILTER`).
- **El registro de auditoría de moderación (`CommentModerationAction`, HU-41.3/41.8) es propio de Community, no la capacidad transversal de `EN-006 — Trazabilidad y auditoría` (Management#194).** EN-006 sigue sin Tasks ni decisión del Product Owner sobre dónde vive; este registro es el mínimo que HU-41 exige por sí misma (incluida la IP de origen que añade HU-41.8) y queda documentado como candidato a reconciliarse con EN-006 cuando esta exista.

Estas limitaciones están declaradas de forma explícita para que la arquitectura de demo no se confunda con la arquitectura objetivo.
