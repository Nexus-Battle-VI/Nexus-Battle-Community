import type { Kysely } from 'kysely'

import { AutomaticModerationFlag } from '../../../domain/entities/AutomaticModerationFlag'
import { ProductCommentId } from '../../../domain/value-objects/product-review-values'
import {
  AutomaticModerationFlagId,
  ModerationSignalMatch,
} from '../../../domain/value-objects/moderation-signal-values'
import type { AutomaticModerationFlagRepositoryPort } from '../../../application/ports/AutomaticModerationFlagRepositoryPort'
import type { Database } from './schema'
import { toAutomaticModerationFlagRow, toAutomaticModerationFlagSnapshot } from './mapping'
import type { AutomaticModerationFlagRow } from './mapping'

/**
 * Repositorio de senales de moderacion automatica (Management#29, HU-41.7)
 * sobre PostgreSQL.
 *
 * `ON CONFLICT(id) DO NOTHING` es identico al de `PostgresCommentReportRepository`
 * y `PostgresCommentModerationActionRepository`: aqui una colision de id
 * generado no representa perdida de evidencia -a diferencia de la auditoria
 * de acciones humanas de HU-41.8- porque el propio `IdGeneratorPort` es la
 * unica fuente de este id y una repeticion solo puede significar un reintento
 * del mismo evento.
 */
export class PostgresAutomaticModerationFlagRepository implements AutomaticModerationFlagRepositoryPort {
  private readonly db: Kysely<Database>

  constructor(db: Kysely<Database>) {
    this.db = db
  }

  async save(flag: AutomaticModerationFlag): Promise<void> {
    const row = toAutomaticModerationFlagRow(flag.toSnapshot())

    await this.db
      .insertInto('comment_moderation_signals')
      .values(row)
      .onConflict((oc) => oc.column('id').doNothing())
      .execute()
  }

  async listByComment(commentId: ProductCommentId): Promise<readonly AutomaticModerationFlag[]> {
    const rows = await this.db
      .selectFrom('comment_moderation_signals')
      .selectAll()
      .where('comment_id', '=', commentId.value)
      .orderBy('detected_at', 'desc')
      .execute()

    return rows.map((row) => PostgresAutomaticModerationFlagRepository.hydrate(row))
  }

  private static hydrate(row: AutomaticModerationFlagRow): AutomaticModerationFlag {
    const snapshot = toAutomaticModerationFlagSnapshot(row)

    return AutomaticModerationFlag.restore({
      id: AutomaticModerationFlagId.create(snapshot.id),
      commentId: ProductCommentId.create(snapshot.commentId),
      ruleType: snapshot.ruleType,
      match: ModerationSignalMatch.create(snapshot.match),
      detectedAt: new Date(snapshot.detectedAt),
    })
  }
}
