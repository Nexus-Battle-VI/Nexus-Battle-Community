import {
  CommentImageAsset,
  type CommentImageAssetSnapshot,
} from '../../../domain/entities/CommentImageAsset'
import type { CommentImageAssetRepositoryPort } from '../../../application/ports/CommentImageAssetRepositoryPort'

export class InMemoryCommentImageAssetRepository implements CommentImageAssetRepositoryPort {
  private readonly assets = new Map<string, CommentImageAssetSnapshot>()

  save(asset: CommentImageAsset): Promise<void> {
    this.assets.set(asset.assetId, asset.toSnapshot())
    return Promise.resolve()
  }

  findById(assetId: string): Promise<CommentImageAsset | null> {
    const snapshot = this.assets.get(assetId)
    return Promise.resolve(snapshot === undefined ? null : CommentImageAsset.fromSnapshot(snapshot))
  }

  update(asset: CommentImageAsset): Promise<void> {
    this.assets.set(asset.assetId, asset.toSnapshot())
    return Promise.resolve()
  }

  clear(): void {
    this.assets.clear()
  }
}
