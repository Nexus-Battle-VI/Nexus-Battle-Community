import { sql, type Kysely } from 'kysely'

/**
 * Imagenes de comentario (HU-40, EN-028).
 *
 * SIN clave foranea a `product_comments`: la intencion se crea ANTES de que
 * exista el comentario -el jugador sube la imagen primero y la referencia
 * despues, al publicar-, asi que en el momento de crearse no hay fila de
 * comentario con la que enlazar.
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema
    .createTable('comment_image_assets')
    .addColumn('asset_id', 'text', (col) => col.primaryKey())
    .addColumn('author_id', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('content_type', 'text', (col) => col.notNull())
    .addColumn('content_length', 'integer', (col) => col.notNull())
    .addColumn('checksum_sha256', 'text', (col) => col.notNull())
    .addColumn('staging_key', 'text', (col) => col.notNull())
    .addColumn('target_key', 'text')
    .addColumn('image_url', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull())
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('finalized_at', 'timestamptz')
    .addCheckConstraint(
      'comment_image_assets_estado_conocido',
      sql`status in ('PENDING', 'READY', 'REJECTED', 'EXPIRED')`,
    )
    .addCheckConstraint(
      'comment_image_assets_mime_admitido',
      sql`content_type in ('image/jpeg', 'image/png', 'image/webp')`,
    )
    .execute()

  // El acceso real de HU-40.1 es "las intenciones vencidas de un jugador
  // concreto", para el mismo criterio de reconciliacion que Catalog aplica
  // sobre ProductAsset.
  await db.schema
    .createIndex('comment_image_assets_por_autor')
    .on('comment_image_assets')
    .columns(['author_id', 'created_at'])
    .execute()
}

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.dropTable('comment_image_assets').execute()
}
