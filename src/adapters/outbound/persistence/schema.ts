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

export interface Database {
  readonly threads: ThreadsTable
  readonly posts: PostsTable
}
