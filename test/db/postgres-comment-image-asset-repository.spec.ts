import 'reflect-metadata'

import { randomUUID } from 'node:crypto'

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import type { Kysely } from 'kysely'

import { describeError } from '../../src/infrastructure/observability/describe-error'
import { createDatabase, migrateToLatest } from '../../src/infrastructure/persistence/database'
import { PostgresCommentImageAssetRepository } from '../../src/adapters/outbound/persistence/PostgresCommentImageAssetRepository'
import type { Database } from '../../src/adapters/outbound/persistence/schema'
import {
  CommentImageAsset,
  CommentImageAssetStatus,
} from '../../src/domain/entities/CommentImageAsset'

/**
 * Adaptador de imagenes de comentario (HU-40, EN-028) sobre PostgreSQL,
 * contra un motor REAL en contenedor. Comprueba lo que el repositorio en
 * memoria no puede: que la restriccion de estado y de tipo MIME existan de
 * verdad en el motor, y que `update` sobrescriba la misma fila creada por
 * `save` (mismo criterio que `PostgresProductCommentRepository` tras HU-41).
 */
describe('PostgresCommentImageAssetRepository', () => {
  let container: StartedPostgreSqlContainer
  let db: Kysely<Database>
  let repository: PostgresCommentImageAssetRepository

  const AT = new Date('2026-09-04T10:00:00.000Z')

  const buildAsset = (params: { assetId: string; authorId: string }): CommentImageAsset =>
    CommentImageAsset.createPending({
      assetId: params.assetId,
      authorId: params.authorId,
      contentType: 'image/png',
      contentLength: 1024,
      checksumSha256: 'hash-de-prueba',
      stagingKey: `staging/comments/${params.assetId}`,
      imageUrl: `https://api.test/api/comment-image-assets/${params.assetId}/content`,
      createdAt: AT,
      expiresAt: new Date(AT.getTime() + 600_000),
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
    repository = new PostgresCommentImageAssetRepository(db)
  })

  it('guarda una intencion pendiente y la recupera identica', async () => {
    const assetId = randomUUID()
    const asset = buildAsset({ assetId, authorId: `acc-${randomUUID()}` })

    await repository.save(asset)
    const found = await repository.findById(assetId)

    expect(found).not.toBeNull()
    expect(found?.status).toBe(CommentImageAssetStatus.Pending)
    expect(found?.targetKey).toBeUndefined()
  })

  it('un assetId inexistente devuelve null, no lanza', async () => {
    const found = await repository.findById(randomUUID())

    expect(found).toBeNull()
  })

  it('update sobrescribe la misma fila: la finalizacion no crea un duplicado', async () => {
    const assetId = randomUUID()
    const asset = buildAsset({ assetId, authorId: `acc-${randomUUID()}` })

    await repository.save(asset)

    asset.markFinalized({ targetKey: `assets/comments/${assetId}/hash.png`, finalizedAt: AT })
    await repository.update(asset)

    const found = await repository.findById(assetId)

    expect(found?.status).toBe(CommentImageAssetStatus.Ready)
    expect(found?.targetKey).toBe(`assets/comments/${assetId}/hash.png`)
  })

  it('la restriccion de tipo MIME vive en el motor, no solo en el codigo', async () => {
    const assetId = randomUUID()

    await expect(
      db
        .insertInto('comment_image_assets')
        .values({
          asset_id: assetId,
          author_id: `acc-${randomUUID()}`,
          status: 'PENDING',
          content_type: 'image/gif',
          content_length: 1024,
          checksum_sha256: 'hash',
          staging_key: `staging/comments/${assetId}`,
          target_key: null,
          image_url: `https://api.test/api/comment-image-assets/${assetId}/content`,
          created_at: AT,
          expires_at: new Date(AT.getTime() + 600_000),
          finalized_at: null,
        })
        .execute(),
    ).rejects.toThrow()
  })

  it('la migracion es idempotente: volver a aplicarla no cambia nada', async () => {
    const { applied, error } = await migrateToLatest(db)

    expect(error).toBeUndefined()
    expect(applied).toEqual([])
  })
})
