import type { Kysely } from 'kysely'

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema
    .createIndex('posts_por_autor')
    .on('posts')
    .columns(['author_id', 'created_at', 'id'])
    .execute()
}

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.dropIndex('posts_por_autor').execute()
}
