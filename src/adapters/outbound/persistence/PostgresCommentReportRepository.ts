import type { Kysely } from 'kysely'

import type { CommentReport } from '../../../domain/entities/CommentReport'
import type { AuthorId } from '../../../domain/value-objects/community-values'
import type { CommentReportRepositoryPort } from '../../../application/ports/CommentReportRepositoryPort'
import type { Database } from './schema'
import { toCommentReportRow } from './mapping'

/**
 * Repositorio de reportes de comentario sobre PostgreSQL.
 *
 * `countByAuthorSince` se apoya en el indice `comment_reports_por_autor`
 * (`author_id, created_at`): es exactamente la consulta que HU-46.3 ejecuta
 * en cada intento de reporte, y sin el recorreria la tabla entera.
 */
export class PostgresCommentReportRepository implements CommentReportRepositoryPort {
  private readonly db: Kysely<Database>

  constructor(db: Kysely<Database>) {
    this.db = db
  }

  async save(report: CommentReport): Promise<void> {
    const row = toCommentReportRow(report.toSnapshot())

    await this.db
      .insertInto('comment_reports')
      .values(row)
      .onConflict((oc) => oc.column('id').doNothing())
      .execute()
  }

  async countByAuthorSince(authorId: AuthorId, since: Date): Promise<number> {
    const { total } = await this.db
      .selectFrom('comment_reports')
      .select((eb) => eb.fn.countAll().as('total'))
      .where('author_id', '=', authorId.value)
      .where('created_at', '>=', since)
      .executeTakeFirstOrThrow()

    return Number(total)
  }
}
