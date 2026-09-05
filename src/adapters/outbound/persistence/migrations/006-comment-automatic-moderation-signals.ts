import { sql, type Kysely } from 'kysely'

/**
 * Senales del filtro automatico de contenido (Management#29, HU-41.7).
 *
 * Mismo patron que `comment_reports` (migracion 004) y
 * `comment_moderation_actions` (migracion 005): SIN clave foranea a
 * `product_comments`, porque una senal es evidencia y debe sobrevivir aunque
 * el comentario senalado deje de estar disponible.
 *
 * `source` queda con un unico valor posible hoy (`AUTOMATIC_FILTER`): es el
 * unico origen automatico que existe. La restriccion se relajaria en una
 * migracion futura si se anadiera otro, siguiendo el mismo patron de 3 fases
 * que ya usa Catalog para sus validadores -- no se anticipa aqui una lista de
 * valores que todavia no existen.
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema
    .createTable('comment_moderation_signals')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('comment_id', 'text', (col) => col.notNull())
    .addColumn('source', 'text', (col) => col.notNull())
    .addColumn('rule_type', 'text', (col) => col.notNull())
    .addColumn('rule_match', 'text', (col) => col.notNull())
    .addColumn('detected_at', 'timestamptz', (col) => col.notNull())
    .addCheckConstraint(
      'comment_moderation_signals_origen_conocido',
      sql`source = 'AUTOMATIC_FILTER'`,
    )
    .addCheckConstraint(
      'comment_moderation_signals_regla_conocida',
      sql`rule_type in ('FORBIDDEN_TERM', 'SUSPICIOUS_PATTERN')`,
    )
    .execute()

  // El acceso real de HU-41.1 es "cola de moderacion agrupada por
  // comentario, de la mas reciente a la mas antigua" -- igual que el indice
  // equivalente de `comment_reports`.
  await db.schema
    .createIndex('comment_moderation_signals_por_comentario')
    .on('comment_moderation_signals')
    .columns(['comment_id', 'detected_at'])
    .execute()
}

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.dropTable('comment_moderation_signals').execute()
}
