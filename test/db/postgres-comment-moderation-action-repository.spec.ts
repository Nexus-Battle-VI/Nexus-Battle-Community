import 'reflect-metadata'

import { randomUUID } from 'node:crypto'

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { sql, type Kysely } from 'kysely'

import { describeError } from '../../src/infrastructure/observability/describe-error'
import { createDatabase, migrateToLatest } from '../../src/infrastructure/persistence/database'
import { PostgresCommentModerationActionRepository } from '../../src/adapters/outbound/persistence/PostgresCommentModerationActionRepository'
import type { Database } from '../../src/adapters/outbound/persistence/schema'
import { CommentModerationAction } from '../../src/domain/entities/CommentModerationAction'
import { AuthorId } from '../../src/domain/value-objects/community-values'
import { ProductCommentId } from '../../src/domain/value-objects/product-review-values'
import {
  CommentModerationActionId,
  ModerationReason,
} from '../../src/domain/value-objects/moderation-values'

/**
 * Registro de auditoria de moderacion (HU-41.3) sobre PostgreSQL, contra un
 * motor REAL en contenedor: comprueba que las restricciones de vocabulario y
 * el indice por comentario existen de verdad.
 */
describe('PostgresCommentModerationActionRepository', () => {
  let container: StartedPostgreSqlContainer
  let db: Kysely<Database>
  let repository: PostgresCommentModerationActionRepository

  const AT = new Date('2026-09-03T10:00:00.000Z')

  const buildAction = (params: {
    commentId: string
    action?: string
    createdAt?: Date
  }): CommentModerationAction =>
    CommentModerationAction.record({
      id: CommentModerationActionId.create(randomUUID()),
      commentId: ProductCommentId.create(params.commentId),
      actorId: AuthorId.create('acc-moderador'),
      action: (params.action ?? 'HIDE') as CommentModerationAction['action'],
      reason: ModerationReason.create('Motivo de prueba.'),
      previousStatus: 'PENDING',
      newStatus: 'HIDDEN',
      occurredAt: params.createdAt ?? AT,
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
    repository = new PostgresCommentModerationActionRepository(db)
  })

  it('guarda y lista el historial de un comentario, del mas reciente al mas antiguo', async () => {
    const commentId = randomUUID()

    await repository.save(buildAction({ commentId, action: 'HIDE', createdAt: AT }))
    await repository.save(
      buildAction({ commentId, action: 'APPROVE', createdAt: new Date(AT.getTime() + 1_000) }),
    )

    const history = await repository.listByComment(ProductCommentId.create(commentId))

    expect(history.map((a) => a.action)).toEqual(['APPROVE', 'HIDE'])
  })

  it('no mezcla el historial de comentarios distintos', async () => {
    const comentarioA = randomUUID()
    const comentarioB = randomUUID()

    await repository.save(buildAction({ commentId: comentarioA }))
    await repository.save(buildAction({ commentId: comentarioB }))

    const historyA = await repository.listByComment(ProductCommentId.create(comentarioA))

    expect(historyA).toHaveLength(1)
    expect(historyA[0]?.commentId.value).toBe(comentarioA)
  })

  describe('Las restricciones viven en el motor, no solo en el codigo', () => {
    it('rechaza una accion que no pertenece al vocabulario de HU-41', async () => {
      await expect(
        db
          .insertInto('comment_moderation_actions')
          .values({
            id: randomUUID(),
            comment_id: randomUUID(),
            actor_id: 'acc-moderador',
            action: 'RECHAZAR',
            reason: 'Motivo.',
            previous_status: 'PENDING',
            new_status: 'HIDDEN',
            created_at: AT,
          })
          .execute(),
      ).rejects.toThrow()
    })

    it('crea un indice para el historial eficiente por comentario', async () => {
      const index = await sql<{ indexdef: string }>`
        select indexdef
        from pg_indexes
        where schemaname = current_schema()
          and tablename = 'comment_moderation_actions'
          and indexname = 'comment_moderation_actions_por_comentario'
      `.execute(db)

      expect(index.rows[0]?.indexdef).toContain('(comment_id, created_at)')
    })
  })

  it('la migracion es idempotente: volver a aplicarla no cambia nada', async () => {
    const { applied, error } = await migrateToLatest(db)

    expect(error).toBeUndefined()
    expect(applied).toEqual([])
  })
})
