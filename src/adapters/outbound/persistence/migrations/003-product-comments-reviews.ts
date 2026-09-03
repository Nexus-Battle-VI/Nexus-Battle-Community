import { sql, type Kysely } from 'kysely'

/**
 * Comentarios y calificaciones de producto (HU-40).
 *
 * Deliberadamente SIN clave foranea entre `product_comments`/`product_reviews`
 * y ninguna tabla de producto: el producto vive en `Nexus-Battle-Catalog`, y
 * una clave foranea entre servicios esta prohibida en este proyecto.
 *
 * Tampoco hay relacion entre `product_comments` y `product_reviews`: son
 * entidades independientes a proposito, para que retirar un comentario nunca
 * pueda borrar la calificacion de quien lo escribio.
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema
    .createTable('product_comments')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('product_id', 'text', (col) => col.notNull())
    .addColumn('author_id', 'text', (col) => col.notNull())
    .addColumn('content', 'text', (col) => col.notNull())
    .addColumn('images', sql`text[]`, (col) => col.notNull().defaultTo(sql`'{}'::text[]`))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull())
    .addCheckConstraint(
      'product_comments_maximo_imagenes',
      sql`array_length(images, 1) is null or array_length(images, 1) <= 5`,
    )
    .execute()

  // El acceso real es "dame los comentarios de este producto, mas recientes
  // primero". Sin este indice, cada lectura recorreria la tabla entera.
  await db.schema
    .createIndex('product_comments_por_producto')
    .on('product_comments')
    .columns(['product_id', 'created_at', 'id'])
    .execute()

  await db.schema
    .createTable('product_reviews')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('product_id', 'text', (col) => col.notNull())
    .addColumn('author_id', 'text', (col) => col.notNull())
    .addColumn('rating', 'integer', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull())
    .addCheckConstraint('product_reviews_calificacion_valida', sql`rating between 1 and 5`)
    // La garantia definitiva de "una calificacion por jugador y producto",
    // valida incluso ante dos solicitudes concurrentes.
    .addUniqueConstraint('product_reviews_jugador_producto_unico', ['product_id', 'author_id'])
    .execute()

  // El acceso real para el promedio es "todas las calificaciones de este
  // producto"; el indice cubre tambien la comprobacion de unicidad.
  await db.schema
    .createIndex('product_reviews_por_producto')
    .on('product_reviews')
    .columns(['product_id'])
    .execute()
}

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.dropTable('product_reviews').execute()
  await db.schema.dropTable('product_comments').execute()
}
