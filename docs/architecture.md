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

## Puertos

| Puerto                         | Responsabilidad                                        | Implementación actual                                                   |
| ------------------------------ | ------------------------------------------------------ | ----------------------------------------------------------------------- |
| `ThreadRepositoryPort`         | Persistir, recuperar y listar hilos                    | `InMemoryThreadRepository` / `PostgresThreadRepository`                 |
| `ProductCommentRepositoryPort` | Persistir y listar (paginados) comentarios de producto | `InMemoryProductCommentRepository` / `PostgresProductCommentRepository` |
| `ProductReviewRepositoryPort`  | Persistir calificaciones y calcular su resumen         | `InMemoryProductReviewRepository` / `PostgresProductReviewRepository`   |
| `ProductExistencePort`         | Confirmar que un producto existe                       | `LocalProductCatalog`                                                   |
| `ClockPort`                    | Proveer el instante actual                             | `SystemClock`                                                           |
| `IdGeneratorPort`              | Generar identificadores                                | `UuidGenerator`                                                         |

## Patrones aplicados

| Patrón                | Dónde                                                                                 | Por qué                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Ports and Adapters    | Todas las dependencias externas                                                       | Permite sustituir la persistencia sin tocar el dominio                                                                 |
| Aggregate             | `Thread` con sus mensajes                                                             | Las invariantes abarcan el hilo completo                                                                               |
| Entidad independiente | `ProductComment`, `ProductReview`                                                     | Sin invariantes compartidas entre comentarios/calificaciones de un mismo producto; ninguna necesita cargar a las demás |
| Repository            | `ThreadRepositoryPort`, `ProductCommentRepositoryPort`, `ProductReviewRepositoryPort` | Aísla cada entidad del mecanismo de almacenamiento                                                                     |
| State                 | `ThreadStatus`                                                                        | Concentra qué operaciones admite cada estado                                                                           |
| Domain Events         | `post.published`, `post.hidden`, `thread.closed`                                      | Registra hechos de forma trazable                                                                                      |

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
- La lectura de hilos no está paginada. El límite de 500 mensajes por hilo lo hace aceptable en la demo, no en la arquitectura objetivo. La lectura de comentarios de producto sí está paginada (`limit`/`offset`) desde el principio, precisamente porque HU-40 no admite un tope equivalente al de `Thread`.
- **La existencia de producto se verifica contra un catálogo local (`LocalProductCatalog`), no contra `Nexus-Battle-Catalog` en vivo.** El contrato público de Catalog expone `sku`; este dominio ya trabaja con `productId`. Resolver esa brecha de identificador queda fuera del alcance de HU-40.
- **Las imágenes de comentario se guardan como referencia (URL), no como archivo subido.** No existe todavía almacenamiento propio de objetos en Community: la decisión de si se reutiliza el bucket S3 de Catalog o se solicita uno nuevo está pendiente en el Enabler EN-028 de `Nexus-Battle-Management`.
- El promedio de calificación de un producto se calcula y expone solo desde Community (`GET /products/:productId/reviews/summary`); no se escribe en el producto canónico de Catalog. Ese endpoint interno es una integración coordinada pero separada, del lado de Catalog.

Estas limitaciones están declaradas de forma explícita para que la arquitectura de demo no se confunda con la arquitectura objetivo.
