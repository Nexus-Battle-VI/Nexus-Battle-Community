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
  IpAddress,
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
    ipAddress?: string
    id?: string
  }): CommentModerationAction =>
    CommentModerationAction.record({
      id: CommentModerationActionId.create(params.id ?? randomUUID()),
      commentId: ProductCommentId.create(params.commentId),
      actorId: AuthorId.create('acc-moderador'),
      action: (params.action ?? 'HIDE') as CommentModerationAction['action'],
      reason: ModerationReason.create('Motivo de prueba.'),
      previousStatus: 'PENDING',
      newStatus: 'HIDDEN',
      occurredAt: params.createdAt ?? AT,
      ipAddress: IpAddress.create(params.ipAddress ?? '203.0.113.10'),
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

  /**
   * HU-41.8 (PDF fuente 7.3.5): la IP de origen se resuelve del servidor, se
   * persiste, y la tabla es de solo insercion frente al motor -no solo
   * frente al codigo de aplicacion-.
   */
  describe('IP de origen y proteccion append-only (HU-41.8)', () => {
    it('persiste la IP capturada por el servidor', async () => {
      const commentId = randomUUID()

      await repository.save(buildAction({ commentId, ipAddress: '198.51.100.7' }))

      const history = await repository.listByComment(ProductCommentId.create(commentId))

      expect(history[0]?.ipAddress?.value).toBe('198.51.100.7')
    })

    it('acepta ip_address NULL para filas historicas (compatibilidad hacia atras)', async () => {
      const commentId = randomUUID()

      await db
        .insertInto('comment_moderation_actions')
        .values({
          id: randomUUID(),
          comment_id: commentId,
          actor_id: 'acc-moderador',
          action: 'HIDE',
          reason: 'Registro historico sin IP.',
          previous_status: 'PENDING',
          new_status: 'HIDDEN',
          created_at: AT,
          ip_address: null,
        })
        .execute()

      const history = await repository.listByComment(ProductCommentId.create(commentId))

      expect(history[0]?.ipAddress).toBeNull()
    })

    it('una colision de id falla de forma audible y no se ignora en silencio', async () => {
      const id = randomUUID()
      const commentId = randomUUID()

      await repository.save(buildAction({ id, commentId }))

      await expect(repository.save(buildAction({ id, commentId }))).rejects.toThrow()
    })

    it('un UPDATE directo sobre la tabla falla: es de solo insercion', async () => {
      const commentId = randomUUID()
      await repository.save(buildAction({ commentId }))

      await expect(
        db
          .updateTable('comment_moderation_actions')
          .set({ reason: 'Motivo alterado.' })
          .where('comment_id', '=', commentId)
          .execute(),
      ).rejects.toThrow()

      const history = await repository.listByComment(ProductCommentId.create(commentId))
      expect(history[0]?.reason.toString()).toBe('Motivo de prueba.')
    })

    it('un DELETE directo sobre la tabla falla: es de solo insercion', async () => {
      const commentId = randomUUID()
      await repository.save(buildAction({ commentId }))

      await expect(
        db.deleteFrom('comment_moderation_actions').where('comment_id', '=', commentId).execute(),
      ).rejects.toThrow()

      const history = await repository.listByComment(ProductCommentId.create(commentId))
      expect(history).toHaveLength(1)
    })
  })

  it('la migracion es idempotente: volver a aplicarla no cambia nada', async () => {
    const { applied, error } = await migrateToLatest(db)

    expect(error).toBeUndefined()
    expect(applied).toEqual([])
  })
})
