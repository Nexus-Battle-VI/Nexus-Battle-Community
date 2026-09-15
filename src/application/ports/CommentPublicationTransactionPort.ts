import type { AutomaticModerationFlagRepositoryPort } from './AutomaticModerationFlagRepositoryPort'
import type { ProductCommentRepositoryPort } from './ProductCommentRepositoryPort'

/**
 * Contexto transaccional de la publicacion de un comentario (HU-41.7).
 *
 * Agrupa exactamente los dos repositorios que deben escribirse de forma
 * atomica: si el filtro automatico detecta contenido, el comentario y su
 * senal se persisten juntos o ninguno de los dos queda escrito.
 */
export interface CommentPublicationTransactionContext {
  readonly comments: ProductCommentRepositoryPort
  readonly automaticModerationFlags: AutomaticModerationFlagRepositoryPort
}

/**
 * Puerto de atomicidad de `PublishProductComment`.
 *
 * No es un Unit of Work generico: esta acotado a esta unica necesidad de
 * atomicidad (comentario + senal automatica), para no introducir una
 * abstraccion transversal que ningun otro caso de uso pide todavia.
 */
export interface CommentPublicationTransactionPort {
  run<T>(work: (context: CommentPublicationTransactionContext) => Promise<T>): Promise<T>
}

export const COMMENT_PUBLICATION_TRANSACTION = Symbol('CommentPublicationTransactionPort')
