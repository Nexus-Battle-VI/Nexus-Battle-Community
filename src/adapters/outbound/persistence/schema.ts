import type { Generated } from 'kysely'

/**
 * Esquema de la base de datos de Community, tipado para Kysely.
 *
 * **Es la unica fuente de verdad de los tipos de persistencia.** No hay paso de
 * generacion de codigo: lo que se declara aqui es lo que el compilador verifica
 * en cada consulta. Si una migracion anade una columna y esta interfaz no la
 * refleja, el codigo que la use no compila.
 *
 * Los nombres de columna son `snake_case`, que es la convencion de PostgreSQL.
 * La traduccion a la instantanea del agregado ocurre en `mapping.ts`, y ocurre
 * de forma explicita: no hay conversion automatica de nombres que sorprenda.
 */
export interface ThreadsTable {
  readonly id: string
  readonly title: string

  /**
   * Autor del hilo, tal y como lo declaro el testimonio verificado.
   *
   * Es un identificador de OTRO servicio y por eso no lleva clave foranea:
   * Community no puede referenciar la tabla de cuentas de Account, ni debe.
   * Que el autor exista es responsabilidad de quien acepto el testimonio.
   */
  readonly author_id: string

  readonly status: string
  readonly created_at: Generated<Date>
  readonly updated_at: Generated<Date>
}

/**
 * Mensajes del hilo, en su propia tabla.
 *
 * No son un agregado propio —no tienen sentido fuera de su hilo— pero si filas
 * propias: guardarlos como JSON en una columna del hilo impediria que la base
 * de datos validara nada de ellos y convertiria cada lectura parcial en una
 * deserializacion completa.
 */
export interface PostsTable {
  readonly id: string

  /** Clave foranea DENTRO del mismo servicio, que es lo que si esta permitido. */
  readonly thread_id: string

  /**
   * Posicion del mensaje dentro del hilo.
   *
   * El orden es parte del agregado y no se deduce de `created_at`: con un reloj
   * fijo —el de las pruebas— dos mensajes comparten instante, y el orden pasaria
   * a depender del identificador, que no significa nada. La posicion lo dice.
   */
  readonly position: number

  readonly author_id: string
  readonly content: string
  readonly hidden: boolean
  readonly created_at: Date
}

/**
 * Comentarios de producto.
 *
 * Fila propia, sin padre: a diferencia de `posts`, no hay agregado `Thread`
 * que las contenga ni tope de mensajes por hilo que aplicarles. HU-40 exige
 * explicitamente que no exista un limite maximo de comentarios por producto.
 */
export interface ProductCommentsTable {
  readonly id: string

  /**
   * Referencia a un producto de Catalog. Sin clave foranea: es un
   * identificador de OTRO servicio, igual que `author_id`.
   */
  readonly product_id: string

  readonly author_id: string
  readonly content: string

  /** Referencias de imagen, nunca el binario. Vacio cuando no hay ninguna. */
  readonly images: string[]

  readonly created_at: Date

  /**
   * Estado de moderacion (HU-41). `PENDING` al publicarse; las acciones de
   * moderacion lo mueven a uno de los otros cinco valores, uno a uno con
   * `ModerationAction`.
   */
  readonly moderation_status: string
}

/**
 * Calificacion de un jugador sobre un producto.
 *
 * La restriccion `UNIQUE (product_id, author_id)` es la que hace cumplir "una
 * calificacion por jugador y producto" incluso ante dos solicitudes
 * concurrentes: la comprobacion previa en el caso de uso no basta por si sola.
 */
export interface ProductReviewsTable {
  readonly id: string
  readonly product_id: string
  readonly author_id: string
  readonly rating: number
  readonly created_at: Date
}

/**
 * Reportes de comentario (HU-46).
 *
 * Sin clave foranea a `product_comments`: es una referencia DENTRO del mismo
 * servicio, pero un reporte debe seguir existiendo como evidencia aunque el
 * comentario reportado deje de estar disponible, y una clave foranea con
 * `on delete cascade` lo borraria junto con el comentario.
 */
export interface CommentReportsTable {
  readonly id: string
  readonly comment_id: string
  readonly author_id: string
  readonly category: string
  readonly description: string | null
  readonly created_at: Date
}

/**
 * Registro de auditoria de una accion de moderacion (HU-41.3).
 *
 * Sin clave foranea a `product_comments`, por la misma razon que
 * `CommentReportsTable`: es evidencia de moderacion y debe sobrevivir aunque
 * el comentario moderado deje de estar disponible.
 */
export interface CommentModerationActionsTable {
  readonly id: string
  readonly comment_id: string
  readonly actor_id: string
  readonly action: string
  readonly reason: string
  readonly previous_status: string
  readonly new_status: string
  readonly created_at: Date

  /**
   * IP de origen (HU-41.8, migracion 006). `NULL` solo en filas anteriores a
   * esa migracion -compatibilidad hacia atras-; toda fila nueva la resuelve
   * siempre desde el servidor, nunca del cuerpo de la peticion.
   */
  readonly ip_address: string | null
}

export interface Database {
  readonly threads: ThreadsTable
  readonly posts: PostsTable
  readonly product_comments: ProductCommentsTable
  readonly product_reviews: ProductReviewsTable
  readonly comment_reports: CommentReportsTable
  readonly comment_moderation_actions: CommentModerationActionsTable
}
