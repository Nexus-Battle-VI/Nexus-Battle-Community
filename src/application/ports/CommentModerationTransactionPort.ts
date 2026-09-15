import type { CommentModerationActionRepositoryPort } from './CommentModerationActionRepositoryPort'
import type { ProductCommentRepositoryPort } from './ProductCommentRepositoryPort'

/**
 * Contexto transaccional de una accion de moderacion (HU-41.8).
 *
 * Agrupa exactamente los dos repositorios que deben escribirse de forma
 * atomica: la actualizacion del comentario y su registro de auditoria se
 * persisten juntos o ninguno de los dos queda escrito.
 */
export interface CommentModerationTransactionContext {
  readonly comments: ProductCommentRepositoryPort
  readonly actions: CommentModerationActionRepositoryPort
}

/**
 * Puerto de atomicidad de las cinco acciones de moderacion.
 *
 * No es un Unit of Work generico: esta acotado a esta unica necesidad de
 * atomicidad (comentario + registro de auditoria), para no introducir una
 * abstraccion transversal que ningun otro caso de uso pide todavia.
 */
export interface CommentModerationTransactionPort {
  run<T>(work: (context: CommentModerationTransactionContext) => Promise<T>): Promise<T>
}

export const COMMENT_MODERATION_TRANSACTION = Symbol('CommentModerationTransactionPort')
