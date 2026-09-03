import type { AuthorId } from '../value-objects/community-values'
import type { ProductId, ProductReviewId, Rating } from '../value-objects/product-review-values'

export interface ProductReviewSnapshot {
  readonly id: string
  readonly productId: string
  readonly authorId: string
  readonly rating: number
  readonly createdAt: string
}

/**
 * Calificacion de un jugador sobre un producto.
 *
 * Es una entidad independiente de `ProductComment`, a proposito: retirar un
 * comentario no debe borrar la calificacion, y viceversa. La unicidad de
 * "una calificacion por jugador y producto" NO es un invariante de esta
 * entidad -- una calificacion aislada no sabe nada de las demas -- vive en el
 * caso de uso (`RateProduct`) y, con caracter definitivo frente a solicitudes
 * concurrentes, en la restriccion de unicidad del repositorio.
 */
export class ProductReview {
  readonly id: ProductReviewId
  readonly productId: ProductId
  readonly authorId: AuthorId
  readonly rating: Rating
  readonly createdAt: Date

  private constructor(params: {
    id: ProductReviewId
    productId: ProductId
    authorId: AuthorId
    rating: Rating
    createdAt: Date
  }) {
    this.id = params.id
    this.productId = params.productId
    this.authorId = params.authorId
    this.rating = params.rating
    this.createdAt = params.createdAt
  }

  static create(params: {
    id: ProductReviewId
    productId: ProductId
    authorId: AuthorId
    rating: Rating
    occurredAt: Date
  }): ProductReview {
    return new ProductReview({ ...params, createdAt: params.occurredAt })
  }

  static restore(params: {
    id: ProductReviewId
    productId: ProductId
    authorId: AuthorId
    rating: Rating
    createdAt: Date
  }): ProductReview {
    return new ProductReview(params)
  }

  toSnapshot(): ProductReviewSnapshot {
    return {
      id: this.id.value,
      productId: this.productId.value,
      authorId: this.authorId.value,
      rating: this.rating.value,
      createdAt: this.createdAt.toISOString(),
    }
  }
}
