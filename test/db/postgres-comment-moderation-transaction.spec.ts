import 'reflect-metadata'

import { randomUUID } from 'node:crypto'

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import type { Kysely } from 'kysely'

import { describeError } from '../../src/infrastructure/observability/describe-error'
import { createDatabase, migrateToLatest } from '../../src/infrastructure/persistence/database'
import { PostgresCommentModerationTransaction } from '../../src/adapters/outbound/persistence/PostgresCommentModerationTransaction'
import { PostgresProductCommentRepository } from '../../src/adapters/outbound/persistence/PostgresProductCommentRepository'
import type { Database } from '../../src/adapters/outbound/persistence/schema'
import { ProductComment } from '../../src/domain/entities/ProductComment'
import { CommentModerationAction } from '../../src/domain/entities/CommentModerationAction'
import { AuthorId } from '../../src/domain/value-objects/community-values'
import {
  CommentContent,
  ProductCommentId,
  ProductId,
} from '../../src/domain/value-objects/product-review-values'
import {
  CommentModerationActionId,
  CommentModerationStatus,
  IpAddress,
  ModerationAction,
  ModerationReason,
} from '../../src/domain/value-objects/moderation-values'

/**
 * Atomicidad de una accion de moderacion (HU-41.8), contra PostgreSQL REAL:
 * ni el comentario queda actualizado sin su auditoria, ni la auditoria queda
 * escrita sin que el comentario refleje el nuevo estado, por un fallo
 * intermedio.
 */
describe('PostgresCommentModerationTransaction', () => {
  let container: StartedPostgreSqlContainer
  let db: Kysely<Database>
  let transaction: PostgresCommentModerationTransaction
  let comments: PostgresProductCommentRepository

  const AT = new Date('2026-09-04T10:00:00.000Z')
  const PRODUCTO = randomUUID()

  const seedComment = async (id: string): Promise<void> => {
    await comments.save(
      ProductComment.publish({
        id: ProductCommentId.create(id),
        productId: ProductId.create(PRODUCTO),
        authorId: AuthorId.create('acc-autor'),
        content: CommentContent.create('Comentario a moderar.'),
        images: [],
        occurredAt: AT,
      }),
    )
  }

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
    transaction = new PostgresCommentModerationTransaction(db)
    comments = new PostgresProductCommentRepository(db)
  })

  it('actualiza el comentario y registra la auditoria juntos cuando todo sale bien', async () => {
    const commentId = randomUUID()
    await seedComment(commentId)

    await transaction.run(async ({ comments: trxComments, actions }) => {
      const comment = await trxComments.findById(ProductCommentId.create(commentId))
      const { previousStatus, newStatus } = comment!.moderate({ action: ModerationAction.Hide })

      await trxComments.save(comment!)
      await actions.save(
        CommentModerationAction.record({
          id: CommentModerationActionId.create(randomUUID()),
          commentId: ProductCommentId.create(commentId),
          actorId: AuthorId.create('acc-moderador'),
          action: ModerationAction.Hide,
          reason: ModerationReason.create('Contenido ofensivo.'),
          previousStatus,
          newStatus,
          occurredAt: AT,
          ipAddress: IpAddress.create('203.0.113.10'),
        }),
      )
    })

    const stored = await comments.findById(ProductCommentId.create(commentId))
    const history = await db
      .selectFrom('comment_moderation_actions')
      .selectAll()
      .where('comment_id', '=', commentId)
      .execute()

    expect(stored?.currentModerationStatus).toBe(CommentModerationStatus.Hidden)
    expect(history).toHaveLength(1)
  })

  it('si falla la escritura de la auditoria, el comentario NO queda actualizado (ROLLBACK)', async () => {
    const commentId = randomUUID()
    await seedComment(commentId)

    await expect(
      transaction.run(async ({ comments: trxComments }) => {
        const comment = await trxComments.findById(ProductCommentId.create(commentId))
        comment!.moderate({ action: ModerationAction.Hide })
        await trxComments.save(comment!)

        // Fuerza el fallo DESPUES de actualizar el comentario, dentro de la
        // misma transaccion: una fila que viola el vocabulario cerrado de
        // `comment_moderation_actions`.
        await db
          .insertInto('comment_moderation_actions')
          .values({
            id: randomUUID(),
            comment_id: commentId,
            actor_id: 'acc-moderador',
            action: 'ACCION_INEXISTENTE',
            reason: 'Motivo.',
            previous_status: 'PENDING',
            new_status: 'HIDDEN',
            created_at: AT,
            ip_address: '203.0.113.10',
          })
          .execute()
      }),
    ).rejects.toThrow()

    const stored = await comments.findById(ProductCommentId.create(commentId))
    expect(stored?.currentModerationStatus).toBe(CommentModerationStatus.Pending)
  })

  it('si falla la actualizacion del comentario, NO se crea auditoria (ROLLBACK)', async () => {
    const commentId = randomUUID()
    // Comentario deliberadamente NO sembrado: `findById` devuelve null y el
    // trabajo lanza antes de llegar a guardar nada.

    await expect(
      transaction.run(async ({ comments: trxComments, actions }) => {
        const comment = await trxComments.findById(ProductCommentId.create(commentId))

        if (comment === null) {
          throw new Error('Comentario inexistente (simulado).')
        }

        await actions.save(
          CommentModerationAction.record({
            id: CommentModerationActionId.create(randomUUID()),
            commentId: ProductCommentId.create(commentId),
            actorId: AuthorId.create('acc-moderador'),
            action: ModerationAction.Hide,
            reason: ModerationReason.create('Motivo.'),
            previousStatus: CommentModerationStatus.Pending,
            newStatus: CommentModerationStatus.Hidden,
            occurredAt: AT,
            ipAddress: IpAddress.create('203.0.113.10'),
          }),
        )
      }),
    ).rejects.toThrow()

    const history = await db
      .selectFrom('comment_moderation_actions')
      .selectAll()
      .where('comment_id', '=', commentId)
      .execute()

    expect(history).toHaveLength(0)
  })
})
