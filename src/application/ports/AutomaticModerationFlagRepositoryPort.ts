import type { AutomaticModerationFlag } from '../../domain/entities/AutomaticModerationFlag'
import type { ProductCommentId } from '../../domain/value-objects/product-review-values'

/**
 * Puerto de persistencia de las senales del filtro automatico (Management#29,
 * HU-41.7).
 *
 * Append-only, igual que `CommentModerationActionRepositoryPort`: una senal
 * es evidencia y no se actualiza ni se borra cuando el comentario se modera
 * -HU-41.7 lo exige explicitamente-.
 */
export interface AutomaticModerationFlagRepositoryPort {
  save(flag: AutomaticModerationFlag): Promise<void>
  listByComment(commentId: ProductCommentId): Promise<readonly AutomaticModerationFlag[]>
}

export const AUTOMATIC_MODERATION_FLAG_REPOSITORY = Symbol('AutomaticModerationFlagRepositoryPort')
