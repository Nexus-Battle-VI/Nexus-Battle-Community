import type { ProductReviewSnapshot } from '../../domain/entities/ProductReview'
import type { ProductReviewSummary } from '../ports/ProductReviewRepositoryPort'

export interface ProductReviewDto {
  readonly id: string
  readonly productId: string
  readonly authorId: string
  readonly rating: number
  readonly createdAt: string
}

export const toProductReviewDto = (snapshot: ProductReviewSnapshot): ProductReviewDto => ({
  id: snapshot.id,
  productId: snapshot.productId,
  authorId: snapshot.authorId,
  rating: snapshot.rating,
  createdAt: snapshot.createdAt,
})

export interface ProductReviewSummaryDto {
  readonly productId: string
  readonly average: number | null
  readonly count: number
}

export const toProductReviewSummaryDto = (
  productId: string,
  summary: ProductReviewSummary,
): ProductReviewSummaryDto => ({
  productId,
  average: summary.average,
  count: summary.count,
})
