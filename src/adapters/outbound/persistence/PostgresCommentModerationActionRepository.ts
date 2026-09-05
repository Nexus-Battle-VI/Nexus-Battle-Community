import type { Kysely } from 'kysely'

import { CommentModerationAction } from '../../../domain/entities/CommentModerationAction'
import { AuthorId } from '../../../domain/value-objects/community-values'
import { ProductCommentId } from '../../../domain/value-objects/product-review-values'
import {
  CommentModerationActionId,
  IpAddress,
  ModerationReason,
} from '../../../domain/value-objects/moderation-values'
import type { CommentModerationActionRepositoryPort } from '../../../application/ports/CommentModerationActionRepositoryPort'
import type { Database } from './schema'
import { toCommentModerationActionRow, toCommentModerationActionSnapshot } from './mapping'
import type { CommentModerationActionRow } from './mapping'

export class PostgresCommentModerationActionRepository implements CommentModerationActionRepositoryPort {
  private readonly db: Kysely<Database>

  constructor(db: Kysely<Database>) {
    this.db = db
  }

  /**
   * SIN `onConflict`: una colision de id sobre una tabla de auditoria
   * append-only (HU-41.8) debe fallar de forma audible -violacion de clave
   * primaria-, nunca ignorarse en silencio como si la escritura hubiera ido
   * bien. `ON CONFLICT DO NOTHING` haria desaparecer evidencia sin que nadie
   * se entere.
   */
  async save(action: CommentModerationAction): Promise<void> {
    const row = toCommentModerationActionRow(action.toSnapshot())

    await this.db.insertInto('comment_moderation_actions').values(row).execute()
  }

  async listByComment(commentId: ProductCommentId): Promise<readonly CommentModerationAction[]> {
    const rows = await this.db
      .selectFrom('comment_moderation_actions')
      .selectAll()
      .where('comment_id', '=', commentId.value)
      .orderBy('created_at', 'desc')
      .execute()

    return rows.map((row) => PostgresCommentModerationActionRepository.hydrate(row))
  }

  private static hydrate(row: CommentModerationActionRow): CommentModerationAction {
    const snapshot = toCommentModerationActionSnapshot(row)

    return CommentModerationAction.restore({
      id: CommentModerationActionId.create(snapshot.id),
      commentId: ProductCommentId.create(snapshot.commentId),
      actorId: AuthorId.create(snapshot.actorId),
      action: snapshot.action,
      reason: ModerationReason.create(snapshot.reason),
      previousStatus: snapshot.previousStatus,
      newStatus: snapshot.newStatus,
      createdAt: new Date(snapshot.createdAt),
      ipAddress: snapshot.ipAddress === null ? null : IpAddress.create(snapshot.ipAddress),
    })
  }
}
