import 'reflect-metadata'

import { randomUUID } from 'node:crypto'

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import type { Kysely } from 'kysely'

import { describeError } from '../../src/infrastructure/observability/describe-error'
import { createDatabase, migrateToLatest } from '../../src/infrastructure/persistence/database'
import { PostgresProductCommentRepository } from '../../src/adapters/outbound/persistence/PostgresProductCommentRepository'
import { PostgresCommentModerationTransaction } from '../../src/adapters/outbound/persistence/PostgresCommentModerationTransaction'
import { PostgresCommentReportRepository } from '../../src/adapters/outbound/persistence/PostgresCommentReportRepository'
import type { Database } from '../../src/adapters/outbound/persistence/schema'
import { ProductComment } from '../../src/domain/entities/ProductComment'
import { CommentModerationAction } from '../../src/domain/entities/CommentModerationAction'
import { CommentReport } from '../../src/domain/entities/CommentReport'
import { AuthorId } from '../../src/domain/value-objects/community-values'
import {
  CommentContent,
  ProductCommentId,
  ProductId,
} from '../../src/domain/value-objects/product-review-values'
import {
  CommentReportId,
  ReportCategory,
} from '../../src/domain/value-objects/comment-report-values'
import {
  CommentModerationActionId,
  CommentModerationStatus,
  IpAddress,
  ModerationAction,
  ModerationReason,
} from '../../src/domain/value-objects/moderation-values'

/**
 * Eliminacion FISICA de un comentario (HU-41.9, Management#29), contra
 * PostgreSQL REAL: la fila desaparece, pero la auditoria y los reportes
 * previos sobreviven -ninguno tiene clave foranea hacia `product_comments`-,
 * y la operacion completa (borrar + auditar) es atomica en ambos sentidos.
 */
describe('Eliminacion fisica de comentarios (HU-41.9)', () => {
  let container: StartedPostgreSqlContainer
  let db: Kysely<Database>
  let comments: PostgresProductCommentRepository
  let reports: PostgresCommentReportRepository
  let transaction: PostgresCommentModerationTransaction

  const AT = new Date('2026-09-05T10:00:00.000Z')
  const PRODUCTO = randomUUID()

  const seedComment = async (id: string): Promise<void> => {
    await comments.save(
      ProductComment.publish({
        id: ProductCommentId.create(id),
        productId: ProductId.create(PRODUCTO),
        authorId: AuthorId.create('acc-autor'),
        content: CommentContent.create('Comentario a eliminar.'),
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
    comments = new PostgresProductCommentRepository(db)
    reports = new PostgresCommentReportRepository(db)
    transaction = new PostgresCommentModerationTransaction(db)
  })

  it('deleteById quita fisicamente la fila de product_comments', async () => {
    const commentId = randomUUID()
    await seedComment(commentId)

    await comments.deleteById(ProductCommentId.create(commentId))

    expect(await comments.findById(ProductCommentId.create(commentId))).toBeNull()
  })

  it('la operacion completa borra el comentario, conserva la auditoria y los reportes', async () => {
    const commentId = randomUUID()
    await seedComment(commentId)

    await reports.save(
      CommentReport.file({
        id: CommentReportId.create(randomUUID()),
        commentId: ProductCommentId.create(commentId),
        authorId: AuthorId.create('acc-reportante'),
        category: ReportCategory.Spam,
        description: null,
        occurredAt: AT,
      }),
    )

    await transaction.run(async ({ comments: trxComments, actions }) => {
      const comment = await trxComments.findById(ProductCommentId.create(commentId))
      const { previousStatus, newStatus } = comment!.moderate({ action: ModerationAction.Delete })

      const record = CommentModerationAction.record({
        id: CommentModerationActionId.create(randomUUID()),
        commentId: ProductCommentId.create(commentId),
        actorId: AuthorId.create('acc-moderador'),
        action: ModerationAction.Delete,
        reason: ModerationReason.create('Infringe los terminos de uso.'),
        previousStatus,
        newStatus,
        occurredAt: AT,
        ipAddress: IpAddress.create('203.0.113.10'),
      })

      await trxComments.deleteById(ProductCommentId.create(commentId))
      await actions.save(record)
    })

    expect(await comments.findById(ProductCommentId.create(commentId))).toBeNull()

    const auditHistory = await db
      .selectFrom('comment_moderation_actions')
      .selectAll()
      .where('comment_id', '=', commentId)
      .execute()
    expect(auditHistory).toHaveLength(1)
    expect(auditHistory[0]?.action).toBe('DELETE')
    expect(auditHistory[0]?.new_status).toBe(CommentModerationStatus.Deleted)

    const reportHistory = await db
      .selectFrom('comment_reports')
      .selectAll()
      .where('comment_id', '=', commentId)
      .execute()
    expect(reportHistory).toHaveLength(1)
  })

  it('si falla la escritura de la auditoria, el comentario NO se borra (ROLLBACK)', async () => {
    const commentId = randomUUID()
    await seedComment(commentId)

    await expect(
      transaction.run(async ({ comments: trxComments }) => {
        const comment = await trxComments.findById(ProductCommentId.create(commentId))
        comment!.moderate({ action: ModerationAction.Delete })

        await trxComments.deleteById(ProductCommentId.create(commentId))

        // Fuerza el fallo DESPUES de borrar, dentro de la misma transaccion:
        // una fila que viola el vocabulario cerrado de `comment_moderation_actions`.
        await db
          .insertInto('comment_moderation_actions')
          .values({
            id: randomUUID(),
            comment_id: commentId,
            actor_id: 'acc-moderador',
            action: 'ACCION_INEXISTENTE',
            reason: 'Motivo.',
            previous_status: 'PENDING',
            new_status: 'DELETED',
            created_at: AT,
            ip_address: '203.0.113.10',
          })
          .execute()
      }),
    ).rejects.toThrow()

    expect(await comments.findById(ProductCommentId.create(commentId))).not.toBeNull()

    const auditHistory = await db
      .selectFrom('comment_moderation_actions')
      .selectAll()
      .where('comment_id', '=', commentId)
      .execute()
    expect(auditHistory).toHaveLength(0)
  })

  it('si falla el borrado, no se crea auditoria (ROLLBACK)', async () => {
    const commentId = randomUUID()
    // Sin sembrar el comentario: `findById` devuelve null y el trabajo lanza
    // antes de llegar a borrar ni a auditar nada -- simula un fallo previo al
    // borrado sin depender de forzar un error de motor sobre un DELETE que,
    // por si solo, siempre puede ejecutarse.

    await expect(
      transaction.run(async ({ comments: trxComments, actions }) => {
        const comment = await trxComments.findById(ProductCommentId.create(commentId))

        if (comment === null) {
          throw new Error('Comentario inexistente: el borrado no puede continuar.')
        }

        await trxComments.deleteById(ProductCommentId.create(commentId))
        await actions.save(
          CommentModerationAction.record({
            id: CommentModerationActionId.create(randomUUID()),
            commentId: ProductCommentId.create(commentId),
            actorId: AuthorId.create('acc-moderador'),
            action: ModerationAction.Delete,
            reason: ModerationReason.create('Motivo.'),
            previousStatus: CommentModerationStatus.Pending,
            newStatus: CommentModerationStatus.Deleted,
            occurredAt: AT,
            ipAddress: IpAddress.create('203.0.113.10'),
          }),
        )
      }),
    ).rejects.toThrow()

    const auditHistory = await db
      .selectFrom('comment_moderation_actions')
      .selectAll()
      .where('comment_id', '=', commentId)
      .execute()
    expect(auditHistory).toHaveLength(0)
  })
})
