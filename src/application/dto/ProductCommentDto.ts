import type { ProductCommentSnapshot } from '../../domain/entities/ProductComment'
import type { CommentModerationStatus } from '../../domain/value-objects/moderation-values'

export interface ProductCommentDto {
  readonly id: string
  readonly productId: string
  readonly authorId: string
  readonly content: string
  readonly images: readonly string[]
  readonly createdAt: string
  readonly moderationStatus: CommentModerationStatus
}

export const toProductCommentDto = (snapshot: ProductCommentSnapshot): ProductCommentDto => ({
  id: snapshot.id,
  productId: snapshot.productId,
  authorId: snapshot.authorId,
  content: snapshot.content,
  images: snapshot.images,
  createdAt: snapshot.createdAt,
  moderationStatus: snapshot.moderationStatus,
})

export interface ProductCommentPageDto {
  readonly items: readonly ProductCommentDto[]
  readonly total: number
  readonly limit: number
  readonly offset: number
}
