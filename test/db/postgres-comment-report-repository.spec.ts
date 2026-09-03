import 'reflect-metadata'

import { randomUUID } from 'node:crypto'

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { sql, type Kysely } from 'kysely'

import { describeError } from '../../src/infrastructure/observability/describe-error'
import { createDatabase, migrateToLatest } from '../../src/infrastructure/persistence/database'
import { PostgresCommentReportRepository } from '../../src/adapters/outbound/persistence/PostgresCommentReportRepository'
import type { Database } from '../../src/adapters/outbound/persistence/schema'
import { CommentReport } from '../../src/domain/entities/CommentReport'
import { AuthorId } from '../../src/domain/value-objects/community-values'
import { ProductCommentId } from '../../src/domain/value-objects/product-review-values'
import {
  CommentReportId,
  ReportCategory,
  ReportDescription,
} from '../../src/domain/value-objects/comment-report-values'

/**
 * Adaptador de reportes de comentario (HU-46) sobre PostgreSQL, contra un
 * motor REAL en contenedor. Comprueba lo que el repositorio en memoria no
 * puede: que la restriccion de categoria y el indice de conteo por autor
 * existan de verdad en el motor.
 */
describe('PostgresCommentReportRepository', () => {
  let container: StartedPostgreSqlContainer
  let db: Kysely<Database>
  let repository: PostgresCommentReportRepository

  const AT = new Date('2026-09-03T10:00:00.000Z')

  const buildReport = (params: {
    authorId: string
    createdAt: Date
    description?: string
  }): CommentReport =>
    CommentReport.file({
      id: CommentReportId.create(randomUUID()),
      commentId: ProductCommentId.create(randomUUID()),
      authorId: AuthorId.create(params.authorId),
      category: ReportCategory.Spam,
      description:
        params.description === undefined ? null : ReportDescription.create(params.description),
      occurredAt: params.createdAt,
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
    repository = new PostgresCommentReportRepository(db)
  })

  it('guarda un reporte sin descripcion', async () => {
    const authorId = `acc-${randomUUID()}`
    await repository.save(buildReport({ authorId, createdAt: AT }))

    expect(await repository.countByAuthorSince(AuthorId.create(authorId), AT)).toBe(1)
  })

  it('guarda un reporte con descripcion', async () => {
    const authorId = `acc-${randomUUID()}`
    await repository.save(
      buildReport({ authorId, createdAt: AT, description: 'Contenido repetido.' }),
    )

    const row = await db
      .selectFrom('comment_reports')
      .select('description')
      .where('author_id', '=', authorId)
      .executeTakeFirstOrThrow()

    expect(row.description).toBe('Contenido repetido.')
  })

  it('cuenta solo los reportes del autor y dentro de la ventana', async () => {
    const authorId = `acc-${randomUUID()}`
    const otroAutor = `acc-${randomUUID()}`

    await repository.save(buildReport({ authorId, createdAt: AT }))
    await repository.save(buildReport({ authorId, createdAt: new Date(AT.getTime() + 1_000) }))
    // Fuera de la ventana: no debe contarse.
    await repository.save(buildReport({ authorId, createdAt: new Date(AT.getTime() - 3_600_000) }))
    // De otro autor: no debe contarse.
    await repository.save(buildReport({ authorId: otroAutor, createdAt: AT }))

    const desde = new Date(AT.getTime() - 1_000)
    expect(await repository.countByAuthorSince(AuthorId.create(authorId), desde)).toBe(2)
  })

  it('devuelve cero cuando el autor no tiene reportes', async () => {
    expect(await repository.countByAuthorSince(AuthorId.create(`acc-${randomUUID()}`), AT)).toBe(0)
  })

  describe('Las restricciones viven en el motor, no solo en el codigo', () => {
    it('rechaza una categoria que no pertenece al vocabulario de RF-46', async () => {
      await expect(
        db
          .insertInto('comment_reports')
          .values({
            id: randomUUID(),
            comment_id: randomUUID(),
            author_id: 'acc-directo',
            category: 'OTHER',
            description: null,
            created_at: AT,
          })
          .execute(),
      ).rejects.toThrow()
    })

    it('crea un indice para el conteo eficiente de reportes por autor', async () => {
      const index = await sql<{ indexdef: string }>`
        select indexdef
        from pg_indexes
        where schemaname = current_schema()
          and tablename = 'comment_reports'
          and indexname = 'comment_reports_por_autor'
      `.execute(db)

      expect(index.rows[0]?.indexdef).toContain('(author_id, created_at)')
    })
  })

  it('la migracion es idempotente: volver a aplicarla no cambia nada', async () => {
    const { applied, error } = await migrateToLatest(db)

    expect(error).toBeUndefined()
    expect(applied).toEqual([])
  })
})
