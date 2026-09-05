import type { Kysely } from 'kysely'

import { CommentImageAsset } from '../../../domain/entities/CommentImageAsset'
import type { CommentImageAssetRepositoryPort } from '../../../application/ports/CommentImageAssetRepositoryPort'
import type { Database } from './schema'
import { toCommentImageAssetRow, toCommentImageAssetSnapshot } from './mapping'

export class PostgresCommentImageAssetRepository implements CommentImageAssetRepositoryPort {
  private readonly db: Kysely<Database>

  constructor(db: Kysely<Database>) {
    this.db = db
  }

  async save(asset: CommentImageAsset): Promise<void> {
    const row = toCommentImageAssetRow(asset.toSnapshot())

    await this.db
      .insertInto('comment_image_assets')
      .values(row)
      .onConflict((oc) => oc.column('asset_id').doNothing())
      .execute()
  }

  async findById(assetId: string): Promise<CommentImageAsset | null> {
    const row = await this.db
      .selectFrom('comment_image_assets')
      .selectAll()
      .where('asset_id', '=', assetId)
      .executeTakeFirst()

    return row === undefined
      ? null
      : CommentImageAsset.fromSnapshot(toCommentImageAssetSnapshot(row))
  }

  /**
   * `doUpdateSet`, no `doNothing`: la finalizacion cambia `status`,
   * `target_key` y `finalized_at` sobre la MISMA fila creada por
   * `save`, mismo criterio que `PostgresProductCommentRepository.save`
   * tras HU-41.
   */
  async update(asset: CommentImageAsset): Promise<void> {
    const row = toCommentImageAssetRow(asset.toSnapshot())

    await this.db
      .insertInto('comment_image_assets')
      .values(row)
      .onConflict((oc) =>
        oc.column('asset_id').doUpdateSet({
          status: row.status,
          target_key: row.target_key,
          finalized_at: row.finalized_at,
        }),
      )
      .execute()
  }
}
