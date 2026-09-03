import type { Kysely } from 'kysely'

import type { CommentReport } from '../../../domain/entities/CommentReport'
import type { AuthorId } from '../../../domain/value-objects/community-values'
import type {
  CommentReportRepositoryPort,
  ModerationQueuePage,
  ModerationQueuePageResult,
} from '../../../application/ports/CommentReportRepositoryPort'
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

  /**
   * Agrupa por `comment_id`: la cola de moderacion es de COMENTARIOS, no de
   * reportes -- un comentario con tres reportes aparece una vez, no tres.
   */
  async listModerationQueue(page: ModerationQueuePage): Promise<ModerationQueuePageResult> {
    const grouped = this.db
      .selectFrom('comment_reports')
      .select((eb) => [
        'comment_id',
        eb.fn.countAll().as('report_count'),
        eb.fn.max('created_at').as('last_reported_at'),
      ])
      .groupBy('comment_id')

    const rows = await grouped
      .orderBy('last_reported_at', 'desc')
      .limit(page.limit)
      .offset(page.offset)
      .execute()

    const { total } = await this.db
      .selectFrom(grouped.as('por_comentario'))
      .select((eb) => eb.fn.countAll().as('total'))
      .executeTakeFirstOrThrow()

    return {
      items: rows.map((row) => ({
        commentId: row.comment_id,
        reportCount: Number(row.report_count),
        lastReportedAt: row.last_reported_at.toISOString(),
      })),
      total: Number(total),
    }
  }
}
