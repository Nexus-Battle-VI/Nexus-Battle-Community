import type { AuthorId } from '../value-objects/community-values'
import type { ProductCommentId } from '../value-objects/product-review-values'
import type {
  CommentModerationActionId,
  CommentModerationStatus,
  ModerationAction,
  ModerationReason,
} from '../value-objects/moderation-values'

export interface CommentModerationActionSnapshot {
  readonly id: string
  readonly commentId: string
  readonly actorId: string
  readonly action: ModerationAction
  readonly reason: string
  readonly previousStatus: CommentModerationStatus
  readonly newStatus: CommentModerationStatus
  readonly createdAt: string
}

/**
 * Registro de auditoria de una accion de moderacion (HU-41.3).
 *
 * Es una entidad independiente, igual que `CommentReport`: sin agregado
 * padre, sin clave foranea a `product_comments` -un registro de auditoria es
 * evidencia y debe sobrevivir aunque el comentario deje de estar disponible-
 * y con su unica relacion expresada como referencia (`commentId`).
 *
 * NO sustituye a EN-006 (Trazabilidad y auditoria transversal, Management
 * #194): esa capacidad comun sigue sin definirse -su propio Enabler no tiene
 * todavia ninguna Task ni decision del Product Owner sobre donde vive-. Este
 * registro es el minimo que HU-41 exige por si misma (actor, fecha, motivo,
 * estado anterior y nuevo), acotado a la moderacion de comentarios, y queda
 * documentado como candidato a reconciliarse con EN-006 cuando esta exista,
 * no como su implementacion.
 */
export class CommentModerationAction {
  readonly id: CommentModerationActionId
  readonly commentId: ProductCommentId
  readonly actorId: AuthorId
  readonly action: ModerationAction
  readonly reason: ModerationReason
  readonly previousStatus: CommentModerationStatus
  readonly newStatus: CommentModerationStatus
  readonly createdAt: Date

  private constructor(params: {
    id: CommentModerationActionId
    commentId: ProductCommentId
    actorId: AuthorId
    action: ModerationAction
    reason: ModerationReason
    previousStatus: CommentModerationStatus
    newStatus: CommentModerationStatus
    createdAt: Date
  }) {
    this.id = params.id
    this.commentId = params.commentId
    this.actorId = params.actorId
    this.action = params.action
    this.reason = params.reason
    this.previousStatus = params.previousStatus
    this.newStatus = params.newStatus
    this.createdAt = params.createdAt
  }

  static record(params: {
    id: CommentModerationActionId
    commentId: ProductCommentId
    actorId: AuthorId
    action: ModerationAction
    reason: ModerationReason
    previousStatus: CommentModerationStatus
    newStatus: CommentModerationStatus
    occurredAt: Date
  }): CommentModerationAction {
    return new CommentModerationAction({ ...params, createdAt: params.occurredAt })
  }

  static restore(params: {
    id: CommentModerationActionId
    commentId: ProductCommentId
    actorId: AuthorId
    action: ModerationAction
    reason: ModerationReason
    previousStatus: CommentModerationStatus
    newStatus: CommentModerationStatus
    createdAt: Date
  }): CommentModerationAction {
    return new CommentModerationAction(params)
  }

  toSnapshot(): CommentModerationActionSnapshot {
    return {
      id: this.id.value,
      commentId: this.commentId.value,
      actorId: this.actorId.value,
      action: this.action,
      reason: this.reason.toString(),
      previousStatus: this.previousStatus,
      newStatus: this.newStatus,
      createdAt: this.createdAt.toISOString(),
    }
  }
}
