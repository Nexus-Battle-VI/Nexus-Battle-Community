import { ProductReview, type ProductReviewSnapshot } from '../../../domain/entities/ProductReview'
import { AuthorId } from '../../../domain/value-objects/community-values'
import {
  ProductId,
  ProductReviewId,
  Rating,
} from '../../../domain/value-objects/product-review-values'
import type {
  ProductReviewRepositoryPort,
  ProductReviewSummary,
} from '../../../application/ports/ProductReviewRepositoryPort'
import { DuplicateProductReviewError } from '../../../application/errors/ApplicationError'

const keyOf = (authorId: string, productId: string): string => `${productId}::${authorId}`

/**
 * Repositorio en memoria de calificaciones de producto.
 *
 * La clave compuesta `productId::authorId` es lo que hace que un segundo
 * `save` para el mismo jugador y producto sea, por construccion, un
 * duplicado detectable -- el mismo contrato que la restriccion `UNIQUE` de
 * PostgreSQL debe ofrecer.
 */
export class InMemoryProductReviewRepository implements ProductReviewRepositoryPort {
  private readonly byKey = new Map<string, ProductReviewSnapshot>()

  save(review: ProductReview): Promise<void> {
    const key = keyOf(review.authorId.value, review.productId.value)

    if (this.byKey.has(key)) {
      throw new DuplicateProductReviewError(review.productId.value)
    }

    this.byKey.set(key, review.toSnapshot())

    return Promise.resolve()
  }

  findByAuthorAndProduct(authorId: AuthorId, productId: ProductId): Promise<ProductReview | null> {
    const snapshot = this.byKey.get(keyOf(authorId.value, productId.value))

    return Promise.resolve(
      snapshot === undefined ? null : InMemoryProductReviewRepository.hydrate(snapshot),
    )
  }

  summaryFor(productId: ProductId): Promise<ProductReviewSummary> {
    const ratings = [...this.byKey.values()]
      .filter((snapshot) => snapshot.productId === productId.value)
      .map((snapshot) => snapshot.rating)

    if (ratings.length === 0) {
      return Promise.resolve({ average: null, count: 0 })
    }

    const sum = ratings.reduce((total, rating) => total + rating, 0)

    return Promise.resolve({ average: sum / ratings.length, count: ratings.length })
  }

  get size(): number {
    return this.byKey.size
  }

  clear(): void {
    this.byKey.clear()
  }

  private static hydrate(snapshot: ProductReviewSnapshot): ProductReview {
    return ProductReview.restore({
      id: ProductReviewId.create(snapshot.id),
      productId: ProductId.create(snapshot.productId),
      authorId: AuthorId.create(snapshot.authorId),
      rating: Rating.create(snapshot.rating),
      createdAt: new Date(snapshot.createdAt),
    })
  }
}
