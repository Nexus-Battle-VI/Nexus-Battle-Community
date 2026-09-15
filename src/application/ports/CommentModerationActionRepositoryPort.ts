import type { CommentModerationAction } from '../../domain/entities/CommentModerationAction'
import type { ProductCommentId } from '../../domain/value-objects/product-review-values'

/**
 * Puerto de persistencia del registro de auditoria de moderacion (HU-41.3).
 *
 * `listByComment` es lo que permite verificar la trazabilidad exigida por
 * HU-41 -"cada accion... debe generar un registro de auditoria"- sin
 * depender de logs temporales de aplicacion.
 */
export interface CommentModerationActionRepositoryPort {
  save(action: CommentModerationAction): Promise<void>
  listByComment(commentId: ProductCommentId): Promise<readonly CommentModerationAction[]>
}

export const COMMENT_MODERATION_ACTION_REPOSITORY = Symbol('CommentModerationActionRepositoryPort')
