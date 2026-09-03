import type { ProductReview } from '../../domain/entities/ProductReview'
import type { AuthorId } from '../../domain/value-objects/community-values'
import type { ProductId } from '../../domain/value-objects/product-review-values'

export interface ProductReviewSummary {
  /** `null` cuando el producto todavia no tiene ninguna calificacion valida. */
  readonly average: number | null
  readonly count: number
}

/**
 * Puerto de persistencia de la calificacion de producto.
 *
 * `save` es quien garantiza, en ultima instancia, que un jugador no pueda
 * registrar dos calificaciones sobre el mismo producto: debe rechazar el
 * duplicado con `DuplicateProductReviewError` incluso ante dos solicitudes
 * concurrentes, lo que exige una restriccion real en el almacen y no solo una
 * comprobacion previa en el caso de uso.
 */
export interface ProductReviewRepositoryPort {
  /** @throws {import('../errors/ApplicationError').DuplicateProductReviewError} */
  save(review: ProductReview): Promise<void>
  findByAuthorAndProduct(authorId: AuthorId, productId: ProductId): Promise<ProductReview | null>
  summaryFor(productId: ProductId): Promise<ProductReviewSummary>
}

export const PRODUCT_REVIEW_REPOSITORY = Symbol('ProductReviewRepositoryPort')
