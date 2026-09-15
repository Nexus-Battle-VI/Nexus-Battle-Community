import type { Kysely } from 'kysely'

import type {
  CommentModerationTransactionContext,
  CommentModerationTransactionPort,
} from '../../../application/ports/CommentModerationTransactionPort'
import type { Database } from './schema'
import { PostgresProductCommentRepository } from './PostgresProductCommentRepository'
import { PostgresCommentModerationActionRepository } from './PostgresCommentModerationActionRepository'

/**
 * Adaptador PostgreSQL de `CommentModerationTransactionPort`.
 *
 * `db.transaction().execute(...)` de Kysely abre una transaccion real: si el
 * trabajo lanza, hace ROLLBACK de todo lo escrito dentro -ni el comentario
 * queda actualizado sin su auditoria, ni la auditoria queda escrita sin que
 * el comentario refleje el nuevo estado-. Los repositorios se construyen
 * DENTRO de la transaccion (ligados a `trx`, no al pool) porque
 * `Transaction<Database>` implementa la misma interfaz de consulta que
 * `Kysely<Database>`.
 */
export class PostgresCommentModerationTransaction implements CommentModerationTransactionPort {
  private readonly db: Kysely<Database>

  constructor(db: Kysely<Database>) {
    this.db = db
  }

  run<T>(work: (context: CommentModerationTransactionContext) => Promise<T>): Promise<T> {
    return this.db.transaction().execute((trx) =>
      work({
        comments: new PostgresProductCommentRepository(trx),
        actions: new PostgresCommentModerationActionRepository(trx),
      }),
    )
  }
}
