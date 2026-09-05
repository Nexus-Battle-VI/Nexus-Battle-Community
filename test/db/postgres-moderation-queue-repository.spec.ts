import 'reflect-metadata'

import { randomUUID } from 'node:crypto'

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import type { Kysely } from 'kysely'

import { describeError } from '../../src/infrastructure/observability/describe-error'
import { createDatabase, migrateToLatest } from '../../src/infrastructure/persistence/database'
import { PostgresModerationQueueRepository } from '../../src/adapters/outbound/persistence/PostgresModerationQueueRepository'
import { PostgresCommentReportRepository } from '../../src/adapters/outbound/persistence/PostgresCommentReportRepository'
import { PostgresAutomaticModerationFlagRepository } from '../../src/adapters/outbound/persistence/PostgresAutomaticModerationFlagRepository'
import type { Database } from '../../src/adapters/outbound/persistence/schema'
import { CommentReport } from '../../src/domain/entities/CommentReport'
import { AutomaticModerationFlag } from '../../src/domain/entities/AutomaticModerationFlag'
import { AuthorId } from '../../src/domain/value-objects/community-values'
import { ProductCommentId } from '../../src/domain/value-objects/product-review-values'
import {
  CommentReportId,
  ReportCategory,
} from '../../src/domain/value-objects/comment-report-values'
import {
  AutomaticModerationFlagId,
  ModerationSignalMatch,
  ModerationSignalRuleType,
} from '../../src/domain/value-objects/moderation-signal-values'

/**
 * Lectura combinada de la cola de moderacion (HU-41.1, Management#29) contra
 * PostgreSQL REAL: reportes (HU-46) UNION senales automaticas (HU-41.7),
 * agrupadas por comentario.
 */
describe('PostgresModerationQueueRepository', () => {
  let container: StartedPostgreSqlContainer
  let db: Kysely<Database>
  let queue: PostgresModerationQueueRepository
  let reports: PostgresCommentReportRepository
  let automaticFlags: PostgresAutomaticModerationFlagRepository

  const AT = new Date('2026-09-04T10:00:00.000Z')

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
    queue = new PostgresModerationQueueRepository(db)
    reports = new PostgresCommentReportRepository(db)
    automaticFlags = new PostgresAutomaticModerationFlagRepository(db)
  })

  const fileReport = (commentId: string): Promise<void> =>
    reports.save(
      CommentReport.file({
        id: CommentReportId.create(randomUUID()),
        commentId: ProductCommentId.create(commentId),
        authorId: AuthorId.create(`acc-${randomUUID()}`),
        category: ReportCategory.Spam,
        description: null,
        occurredAt: AT,
      }),
    )

  const detect = (commentId: string): Promise<void> =>
    automaticFlags.save(
      AutomaticModerationFlag.detect({
        id: AutomaticModerationFlagId.create(randomUUID()),
        commentId: ProductCommentId.create(commentId),
        ruleType: ModerationSignalRuleType.ForbiddenTerm,
        match: ModerationSignalMatch.create('forbidden-test-term'),
        occurredAt: AT,
      }),
    )

  it('un comentario solo reportado aparece con reportCount y sin senales', async () => {
    const commentId = randomUUID()
    await fileReport(commentId)

    const { items } = await queue.listModerationQueue({ limit: 100, offset: 0 })
    const entrada = items.find((item) => item.commentId === commentId)

    expect(entrada?.reportCount).toBe(1)
    expect(entrada?.automaticFlagCount).toBe(0)
    expect(entrada?.lastAutomaticFlaggedAt).toBeNull()
  })

  it('un comentario solo detectado automaticamente aparece con automaticFlagCount y sin reportes', async () => {
    const commentId = randomUUID()
    await detect(commentId)

    const { items } = await queue.listModerationQueue({ limit: 100, offset: 0 })
    const entrada = items.find((item) => item.commentId === commentId)

    expect(entrada?.automaticFlagCount).toBe(1)
    expect(entrada?.reportCount).toBe(0)
    expect(entrada?.lastReportedAt).toBeNull()
  })

  it('un comentario con ambos origenes aparece UNA sola vez, con los dos conteos', async () => {
    const commentId = randomUUID()
    await fileReport(commentId)
    await detect(commentId)

    const { items } = await queue.listModerationQueue({ limit: 100, offset: 0 })
    const entradas = items.filter((item) => item.commentId === commentId)

    expect(entradas).toHaveLength(1)
    expect(entradas[0]?.reportCount).toBe(1)
    expect(entradas[0]?.automaticFlagCount).toBe(1)
  })

  it('un comentario sin reporte ni senal no aparece en la cola', async () => {
    const commentId = randomUUID()

    const { items } = await queue.listModerationQueue({ limit: 1_000, offset: 0 })

    expect(items.find((item) => item.commentId === commentId)).toBeUndefined()
  })

  it('respeta el limite y el desplazamiento', async () => {
    await fileReport(randomUUID())
    await detect(randomUUID())

    const { items, total } = await queue.listModerationQueue({ limit: 1, offset: 0 })

    expect(items.length).toBeLessThanOrEqual(1)
    expect(total).toBeGreaterThanOrEqual(2)
  })
})
