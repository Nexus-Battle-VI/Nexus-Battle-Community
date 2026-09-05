import type { Kysely } from 'kysely'

import type {
  CommentPublicationTransactionContext,
  CommentPublicationTransactionPort,
} from '../../../application/ports/CommentPublicationTransactionPort'
import type { Database } from './schema'
import { PostgresProductCommentRepository } from './PostgresProductCommentRepository'
import { PostgresAutomaticModerationFlagRepository } from './PostgresAutomaticModerationFlagRepository'

/**
 * Adaptador PostgreSQL de `CommentPublicationTransactionPort`.
 *
 * `db.transaction().execute(...)` de Kysely abre una transaccion real: si el
 * trabajo lanza, hace ROLLBACK de todo lo escrito dentro. Los repositorios se
 * construyen DENTRO de la transaccion (ligados a `trx`, no al pool) porque
 * `Transaction<Database>` implementa la misma interfaz de consulta que
 * `Kysely<Database>` -- son la MISMA clase de repositorio, solo que atada a
 * la conexion de la transaccion en vez de al pool completo.
 */
export class PostgresCommentPublicationTransaction implements CommentPublicationTransactionPort {
  private readonly db: Kysely<Database>

  constructor(db: Kysely<Database>) {
    this.db = db
  }

  run<T>(work: (context: CommentPublicationTransactionContext) => Promise<T>): Promise<T> {
    return this.db.transaction().execute((trx) =>
      work({
        comments: new PostgresProductCommentRepository(trx),
        automaticModerationFlags: new PostgresAutomaticModerationFlagRepository(trx),
      }),
    )
  }
}
