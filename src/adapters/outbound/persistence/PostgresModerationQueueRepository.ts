import { sql, type Kysely } from 'kysely'

import type {
  ModerationQueuePage,
  ModerationQueuePageResult,
  ModerationQueueRepositoryPort,
} from '../../../application/ports/ModerationQueueRepositoryPort'
import type { Database } from './schema'

interface CombinedRow {
  readonly comment_id: string
  readonly report_count: string
  readonly last_reported_at: Date | null
  readonly automatic_flag_count: string
  readonly last_automatic_flagged_at: Date | null
}

/**
 * Lectura combinada de la cola de moderacion (HU-41.1, Management#29):
 * `comment_reports` (HU-46) UNION ALL `comment_moderation_signals` (HU-41.7),
 * agrupada por comentario para que un comentario con ambos origenes aparezca
 * UNA sola vez.
 *
 * Es SQL crudo -no el query builder tipado de Kysely- porque la agregacion
 * con `FILTER` por origen sobre una subconsulta UNION es exactamente el tipo
 * de consulta que el propio equipo de Kysely recomienda expresar con `sql`
 * directamente en lugar de forzarla al API tipado.
 */
export class PostgresModerationQueueRepository implements ModerationQueueRepositoryPort {
  private readonly db: Kysely<Database>

  constructor(db: Kysely<Database>) {
    this.db = db
  }

  async listModerationQueue(page: ModerationQueuePage): Promise<ModerationQueuePageResult> {
    const rows = await sql<CombinedRow>`
      select
        combined.comment_id as comment_id,
        count(*) filter (where combined.source = 'REPORT') as report_count,
        max(combined.created_at) filter (where combined.source = 'REPORT') as last_reported_at,
        count(*) filter (where combined.source = 'AUTOMATIC_FILTER') as automatic_flag_count,
        max(combined.created_at) filter (where combined.source = 'AUTOMATIC_FILTER') as last_automatic_flagged_at,
        max(combined.created_at) as last_activity_at
      from (
        select comment_id, created_at, 'REPORT' as source from comment_reports
        union all
        select comment_id, detected_at as created_at, 'AUTOMATIC_FILTER' as source from comment_moderation_signals
      ) as combined
      group by combined.comment_id
      order by last_activity_at desc
      limit ${page.limit}
      offset ${page.offset}
    `.execute(this.db)

    const totalResult = await sql<{ total: string }>`
      select count(*) as total
      from (
        select comment_id from (
          select comment_id from comment_reports
          union all
          select comment_id from comment_moderation_signals
        ) as combined
        group by comment_id
      ) as por_comentario
    `.execute(this.db)

    const total = totalResult.rows[0]?.total ?? '0'

    return {
      items: rows.rows.map((row) => ({
        commentId: row.comment_id,
        reportCount: Number(row.report_count),
        lastReportedAt: row.last_reported_at === null ? null : row.last_reported_at.toISOString(),
        automaticFlagCount: Number(row.automatic_flag_count),
        lastAutomaticFlaggedAt:
          row.last_automatic_flagged_at === null
            ? null
            : row.last_automatic_flagged_at.toISOString(),
      })),
      total: Number(total),
    }
  }
}
