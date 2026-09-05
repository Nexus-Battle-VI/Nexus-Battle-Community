import 'reflect-metadata'

import { randomUUID } from 'node:crypto'

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { sql, type Kysely } from 'kysely'

import { describeError } from '../../src/infrastructure/observability/describe-error'
import { createDatabase, migrateToLatest } from '../../src/infrastructure/persistence/database'
import { PostgresAutomaticModerationFlagRepository } from '../../src/adapters/outbound/persistence/PostgresAutomaticModerationFlagRepository'
import type { Database } from '../../src/adapters/outbound/persistence/schema'
import { AutomaticModerationFlag } from '../../src/domain/entities/AutomaticModerationFlag'
import { ProductCommentId } from '../../src/domain/value-objects/product-review-values'
import {
  AutomaticModerationFlagId,
  ModerationSignalMatch,
  ModerationSignalRuleType,
} from '../../src/domain/value-objects/moderation-signal-values'

/**
 * Senales del filtro automatico de contenido (Management#29, HU-41.7) sobre
 * PostgreSQL, contra un motor REAL en contenedor: comprueba que las
 * restricciones de vocabulario, el indice y la ausencia de clave foranea
 * cross-service existen de verdad.
 */
describe('PostgresAutomaticModerationFlagRepository', () => {
  let container: StartedPostgreSqlContainer
  let db: Kysely<Database>
  let repository: PostgresAutomaticModerationFlagRepository

  const AT = new Date('2026-09-04T10:00:00.000Z')

  const buildFlag = (params: {
    commentId: string
    ruleType?: ModerationSignalRuleType
    match?: string
    detectedAt?: Date
  }): AutomaticModerationFlag =>
    AutomaticModerationFlag.detect({
      id: AutomaticModerationFlagId.create(randomUUID()),
      commentId: ProductCommentId.create(params.commentId),
      ruleType: params.ruleType ?? ModerationSignalRuleType.ForbiddenTerm,
      match: ModerationSignalMatch.create(params.match ?? 'forbidden-test-term'),
      occurredAt: params.detectedAt ?? AT,
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
    repository = new PostgresAutomaticModerationFlagRepository(db)
  })

  it('guarda una senal y puede consultarse tras reiniciar el repositorio', async () => {
    const commentId = randomUUID()

    await repository.save(buildFlag({ commentId }))

    // Un repositorio nuevo apuntando a la MISMA conexion: la senal debe
    // seguir ahi, no depender de un cache en memoria del repositorio.
    const reiniciado = new PostgresAutomaticModerationFlagRepository(db)
    const flags = await reiniciado.listByComment(ProductCommentId.create(commentId))

    expect(flags).toHaveLength(1)
    expect(flags[0]?.toSnapshot()).toMatchObject({
      commentId,
      source: 'AUTOMATIC_FILTER',
      ruleType: 'FORBIDDEN_TERM',
      match: 'forbidden-test-term',
    })
  })

  it('no mezcla las senales de comentarios distintos', async () => {
    const comentarioA = randomUUID()
    const comentarioB = randomUUID()

    await repository.save(buildFlag({ commentId: comentarioA }))
    await repository.save(buildFlag({ commentId: comentarioB }))

    const senalesA = await repository.listByComment(ProductCommentId.create(comentarioA))

    expect(senalesA).toHaveLength(1)
    expect(senalesA[0]?.commentId.value).toBe(comentarioA)
  })

  it('un comentario puede acumular varias senales, del mas reciente al mas antiguo', async () => {
    const commentId = randomUUID()

    await repository.save(buildFlag({ commentId, detectedAt: AT, match: 'forbidden-test-term' }))
    await repository.save(
      buildFlag({
        commentId,
        detectedAt: new Date(AT.getTime() + 1_000),
        ruleType: ModerationSignalRuleType.SuspiciousPattern,
        match: 'http://enlace-sospechoso.test',
      }),
    )

    const senales = await repository.listByComment(ProductCommentId.create(commentId))

    expect(senales.map((s) => s.ruleType)).toEqual(['SUSPICIOUS_PATTERN', 'FORBIDDEN_TERM'])
  })

  describe('Las restricciones viven en el motor, no solo en el codigo', () => {
    it('rechaza un origen que no sea AUTOMATIC_FILTER', async () => {
      await expect(
        db
          .insertInto('comment_moderation_signals')
          .values({
            id: randomUUID(),
            comment_id: randomUUID(),
            source: 'MANUAL',
            rule_type: 'FORBIDDEN_TERM',
            rule_match: 'forbidden-test-term',
            detected_at: AT,
          })
          .execute(),
      ).rejects.toThrow()
    })

    it('rechaza un tipo de regla que no pertenece al vocabulario de HU-41.7', async () => {
      await expect(
        db
          .insertInto('comment_moderation_signals')
          .values({
            id: randomUUID(),
            comment_id: randomUUID(),
            source: 'AUTOMATIC_FILTER',
            rule_type: 'MACHINE_LEARNING_MODEL',
            rule_match: 'forbidden-test-term',
            detected_at: AT,
          })
          .execute(),
      ).rejects.toThrow()
    })

    it('crea un indice para la cola eficiente por comentario', async () => {
      const index = await sql<{ indexdef: string }>`
        select indexdef
        from pg_indexes
        where schemaname = current_schema()
          and tablename = 'comment_moderation_signals'
          and indexname = 'comment_moderation_signals_por_comentario'
      `.execute(db)

      expect(index.rows[0]?.indexdef).toContain('(comment_id, detected_at)')
    })

    it('no existe ninguna clave foranea desde comment_moderation_signals', async () => {
      const constraints = await sql<{ constraint_type: string }>`
        select constraint_type
        from information_schema.table_constraints
        where table_schema = current_schema()
          and table_name = 'comment_moderation_signals'
          and constraint_type = 'FOREIGN KEY'
      `.execute(db)

      expect(constraints.rows).toHaveLength(0)
    })
  })

  it('la migracion es idempotente: volver a aplicarla no cambia nada', async () => {
    const { applied, error } = await migrateToLatest(db)

    expect(error).toBeUndefined()
    expect(applied).toEqual([])
  })
})
