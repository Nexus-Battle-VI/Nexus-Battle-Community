import type {
  CommentPublicationTransactionContext,
  CommentPublicationTransactionPort,
} from '../../../application/ports/CommentPublicationTransactionPort'

/**
 * Adaptador en memoria de `CommentPublicationTransactionPort`.
 *
 * No hay una transaccion real que revertir: cada operacion sobre los mapas en
 * memoria es sincrona y no puede fallar a mitad de camino, asi que envolver
 * el trabajo aqui solo reutiliza las MISMAS instancias de repositorio que el
 * resto de la aplicacion, sin crear un almacen paralelo.
 */
export class InMemoryCommentPublicationTransaction implements CommentPublicationTransactionPort {
  constructor(private readonly context: CommentPublicationTransactionContext) {}

  run<T>(work: (context: CommentPublicationTransactionContext) => Promise<T>): Promise<T> {
    return work(this.context)
  }
}
