import type { CommentImageAsset } from '../../domain/entities/CommentImageAsset'

export interface CommentImageAssetRepositoryPort {
  save(asset: CommentImageAsset): Promise<void>
  findById(assetId: string): Promise<CommentImageAsset | null>
  update(asset: CommentImageAsset): Promise<void>
}

export const COMMENT_IMAGE_ASSET_REPOSITORY = Symbol('CommentImageAssetRepositoryPort')
