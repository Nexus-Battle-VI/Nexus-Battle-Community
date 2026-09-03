import { sql, type Kysely } from 'kysely'

/**
 * Reportes de comentario (HU-46).
 *
 * Deliberadamente SIN clave foranea a `product_comments`: un reporte es
 * evidencia de moderacion y debe sobrevivir aunque el comentario reportado
 * se retire, algo que `on delete cascade` impediria.
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema
    .createTable('comment_reports')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('comment_id', 'text', (col) => col.notNull())
    .addColumn('author_id', 'text', (col) => col.notNull())
    .addColumn('category', 'text', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull())
    .addCheckConstraint(
      'comment_reports_categoria_conocida',
      sql`category in ('SPAM', 'OFFENSIVE_CONTENT', 'HARASSMENT', 'FALSE_INFORMATION', 'INAPPROPRIATE_CONTENT', 'COPYRIGHT_VIOLATION')`,
    )
    .execute()

  // El acceso real de HU-46.3 es "cuantos reportes hizo este jugador desde
  // tal instante": sin este indice, cada intento de reportar recorreria la
  // tabla entera.
  await db.schema
    .createIndex('comment_reports_por_autor')
    .on('comment_reports')
    .columns(['author_id', 'created_at'])
    .execute()
}

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.dropTable('comment_reports').execute()
}
