import { sql, type Kysely } from 'kysely'

/**
 * Esquema inicial de Community.
 *
 * Las migraciones son TypeScript revisable en un PR, que es una de las razones
 * por las que ADR-012 eligio Kysely: el esquema cambia por el mismo camino que
 * el codigo, no por un fichero generado que nadie lee.
 *
 * `up` y `down` reciben `Kysely<unknown>` a proposito: una migracion NO debe
 * tipar contra el esquema actual. Si lo hiciera, dejaria de compilar en cuanto
 * una migracion posterior cambiara una tabla, y una migracion antigua tiene que
 * seguir siendo ejecutable tal y como se escribio.
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema
    .createTable('threads')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('title', 'text', (col) => col.notNull())
    // Sin clave foranea a proposito: el autor vive en Account, y una clave
    // foranea entre servicios esta prohibida en este proyecto.
    .addColumn('author_id', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('threads_estado_conocido', sql`status in ('OPEN', 'CLOSED')`)
    .execute()

  await db.schema
    .createTable('posts')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('thread_id', 'text', (col) =>
      // Clave foranea DENTRO del mismo servicio. La prohibicion del proyecto es
      // sobre claves foraneas entre servicios.
      col.notNull().references('threads.id').onDelete('cascade'),
    )
    .addColumn('position', 'integer', (col) => col.notNull())
    .addColumn('author_id', 'text', (col) => col.notNull())
    .addColumn('content', 'text', (col) => col.notNull())
    .addColumn('hidden', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull())
    // Dos mensajes del mismo hilo no pueden ocupar la misma posicion: el orden
    // del agregado dejaria de ser reconstruible y la lectura seria arbitraria.
    .addUniqueConstraint('posts_posicion_unica', ['thread_id', 'position'])
    .addCheckConstraint('posts_posicion_no_negativa', sql`position >= 0`)
    // El limite de mensajes por hilo es una regla de producto y vive en
    // `ModerationPolicy`; aqui solo se acota la posicion para que un fallo de
    // calculo no escriba un indice absurdo.
    .addCheckConstraint('posts_posicion_acotada', sql`position < 500`)
    .execute()

  // El acceso real es "dame los mensajes de este hilo, en orden". Sin este
  // indice, cada lectura de un hilo recorreria la tabla entera de mensajes.
  await db.schema
    .createIndex('posts_por_hilo')
    .on('posts')
    .columns(['thread_id', 'position'])
    .execute()
}

export const down = async (db: Kysely<unknown>): Promise<void> => {
  // En orden inverso: `posts` referencia a `threads`.
  await db.schema.dropTable('posts').execute()
  await db.schema.dropTable('threads').execute()
}
