import { sql, type Kysely } from 'kysely'

/**
 * Moderacion de comentarios (HU-41).
 *
 * `moderation_status` se anade a `product_comments` con `DEFAULT 'PENDING'`:
 * es el mismo valor con el que `ProductComment.publish()` ya inicializa todo
 * comentario nuevo, asi que el valor por defecto de la columna solo repite lo
 * que el dominio ya hace, no inventa una regla aparte.
 *
 * `comment_moderation_actions` sigue el mismo patron que `comment_reports`
 * (migracion 004): SIN clave foranea a `product_comments`, porque un registro
 * de auditoria es evidencia y debe sobrevivir aunque el comentario moderado
 * deje de estar disponible.
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema
    .alterTable('product_comments')
    .addColumn('moderation_status', 'text', (col) => col.notNull().defaultTo('PENDING'))
    .execute()

  await sql`
    alter table product_comments
      add constraint product_comments_estado_moderacion_conocido
      check (moderation_status in ('PENDING', 'APPROVED', 'DELETED', 'HIDDEN', 'EDITED', 'MARKED'))
  `.execute(db)

  await db.schema
    .createTable('comment_moderation_actions')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('comment_id', 'text', (col) => col.notNull())
    .addColumn('actor_id', 'text', (col) => col.notNull())
    .addColumn('action', 'text', (col) => col.notNull())
    .addColumn('reason', 'text', (col) => col.notNull())
    .addColumn('previous_status', 'text', (col) => col.notNull())
    .addColumn('new_status', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull())
    .addCheckConstraint(
      'comment_moderation_actions_accion_conocida',
      sql`action in ('APPROVE', 'DELETE', 'HIDE', 'EDIT', 'MARK')`,
    )
    .addCheckConstraint(
      'comment_moderation_actions_estado_anterior_conocido',
      sql`previous_status in ('PENDING', 'APPROVED', 'DELETED', 'HIDDEN', 'EDITED', 'MARKED')`,
    )
    .addCheckConstraint(
      'comment_moderation_actions_estado_nuevo_conocido',
      sql`new_status in ('PENDING', 'APPROVED', 'DELETED', 'HIDDEN', 'EDITED', 'MARKED')`,
    )
    .execute()

  // El acceso real de HU-41.1 es "el historial de un comentario concreto,
  // del mas reciente al mas antiguo".
  await db.schema
    .createIndex('comment_moderation_actions_por_comentario')
    .on('comment_moderation_actions')
    .columns(['comment_id', 'created_at'])
    .execute()
}

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.dropTable('comment_moderation_actions').execute()
  await sql`alter table product_comments drop constraint product_comments_estado_moderacion_conocido`.execute(
    db,
  )
  await db.schema.alterTable('product_comments').dropColumn('moderation_status').execute()
}
