import 'reflect-metadata'

import { randomUUID } from 'node:crypto'

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import type { Kysely } from 'kysely'

import { describeError } from '../../src/infrastructure/observability/describe-error'
import { createDatabase, migrateToLatest } from '../../src/infrastructure/persistence/database'
import { PostgresCommentPublicationTransaction } from '../../src/adapters/outbound/persistence/PostgresCommentPublicationTransaction'
import { PostgresProductCommentRepository } from '../../src/adapters/outbound/persistence/PostgresProductCommentRepository'
import type { Database } from '../../src/adapters/outbound/persistence/schema'
import { ProductComment } from '../../src/domain/entities/ProductComment'
import { AutomaticModerationFlag } from '../../src/domain/entities/AutomaticModerationFlag'
import { AuthorId } from '../../src/domain/value-objects/community-values'
import {
  CommentContent,
  ProductCommentId,
  ProductId,
} from '../../src/domain/value-objects/product-review-values'
import {
  AutomaticModerationFlagId,
  ModerationSignalMatch,
  ModerationSignalRuleType,
} from '../../src/domain/value-objects/moderation-signal-values'

/**
 * Atomicidad de la publicacion de un comentario con senal automatica
 * (Management#29, HU-41.7), contra PostgreSQL REAL: ni una senal sin
 * comentario, ni un comentario que debia quedar senalado sin su senal, por
 * un fallo intermedio.
 */
describe('PostgresCommentPublicationTransaction', () => {
  let container: StartedPostgreSqlContainer
  let db: Kysely<Database>
  let transaction: PostgresCommentPublicationTransaction
  let comments: PostgresProductCommentRepository

  const AT = new Date('2026-09-04T10:00:00.000Z')
  const PRODUCTO = randomUUID()

  const buildComment = (id: string): ProductComment =>
    ProductComment.publish({
      id: ProductCommentId.create(id),
      productId: ProductId.create(PRODUCTO),
      authorId: AuthorId.create('acc-autor'),
      content: CommentContent.create('Comentario de prueba de atomicidad.'),
      images: [],
      occurredAt: AT,
    })

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start()
    db = createDatabase({ connectionString: container.getConnectionUri() })

    const { error } = await migrateToLatest(db)

    if (error !== undefined) {
      throw new Error(`Las migraciones fallaron: ${describeError(error)}`)
    }
  }, 120_000)

  afterAll(async () => {
    await db.destroy()
    await container.stop()
  })

  beforeEach(() => {
    transaction = new PostgresCommentPublicationTransaction(db)
    comments = new PostgresProductCommentRepository(db)
  })

  it('persiste el comentario y la senal juntos cuando todo sale bien', async () => {
    const commentId = randomUUID()

    await transaction.run(async ({ comments: trxComments, automaticModerationFlags }) => {
      await trxComments.save(buildComment(commentId))
      await automaticModerationFlags.save(
        AutomaticModerationFlag.detect({
          id: AutomaticModerationFlagId.create(randomUUID()),
          commentId: ProductCommentId.create(commentId),
          ruleType: ModerationSignalRuleType.ForbiddenTerm,
          match: ModerationSignalMatch.create('forbidden-test-term'),
          occurredAt: AT,
        }),
      )
    })

    const storedComment = await comments.findById(ProductCommentId.create(commentId))
    const storedFlags = await db
      .selectFrom('comment_moderation_signals')
      .selectAll()
      .where('comment_id', '=', commentId)
      .execute()

    expect(storedComment).not.toBeNull()
    expect(storedFlags).toHaveLength(1)
  })

  it('si la escritura de la senal falla, el comentario tampoco queda persistido (ROLLBACK)', async () => {
    const commentId = randomUUID()

    await expect(
      transaction.run(async ({ comments: trxComments }) => {
        await trxComments.save(buildComment(commentId))

        // Fuerza el fallo DESPUES de escribir el comentario, dentro de la
        // misma transaccion: una fila que viola la restriccion de vocabulario
        // de `comment_moderation_signals`.
        await db
          .insertInto('comment_moderation_signals')
          .values({
            id: randomUUID(),
            comment_id: commentId,
            source: 'AUTOMATIC_FILTER',
            rule_type: 'REGLA_INEXISTENTE',
            rule_match: 'forbidden-test-term',
            detected_at: AT,
          })
          .execute()
      }),
    ).rejects.toThrow()

    const storedComment = await comments.findById(ProductCommentId.create(commentId))
    expect(storedComment).toBeNull()
  })
})
