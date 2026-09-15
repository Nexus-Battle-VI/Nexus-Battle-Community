import type {
  CommentModerationTransactionContext,
  CommentModerationTransactionPort,
} from '../../../application/ports/CommentModerationTransactionPort'

/**
 * Adaptador en memoria de `CommentModerationTransactionPort`.
 *
 * No hay una transaccion real que revertir: cada operacion sobre los mapas en
 * memoria es sincrona y no puede fallar a mitad de camino, asi que envolver
 * el trabajo aqui solo reutiliza las MISMAS instancias de repositorio que el
 * resto de la aplicacion, sin crear un almacen paralelo.
 */
export class InMemoryCommentModerationTransaction implements CommentModerationTransactionPort {
  constructor(private readonly context: CommentModerationTransactionContext) {}

  run<T>(work: (context: CommentModerationTransactionContext) => Promise<T>): Promise<T> {
    return work(this.context)
  }
}
