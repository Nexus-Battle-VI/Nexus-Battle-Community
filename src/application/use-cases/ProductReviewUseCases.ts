import { ProductReview } from '../../domain/entities/ProductReview'
import { AuthorId } from '../../domain/value-objects/community-values'
import {
  ProductId,
  ProductReviewId,
  Rating,
} from '../../domain/value-objects/product-review-values'
import type { ClockPort } from '../ports/ClockPort'
import type { IdGeneratorPort } from '../ports/IdGeneratorPort'
import type { ProductCatalogPort } from '../ports/ProductCatalogPort'
import type { ProductReviewRepositoryPort } from '../ports/ProductReviewRepositoryPort'
import { DuplicateProductReviewError, ProductNotFoundError } from '../errors/ApplicationError'
import {
  toProductReviewDto,
  toProductReviewSummaryDto,
  type ProductReviewDto,
  type ProductReviewSummaryDto,
} from '../dto/ProductReviewDto'

export interface ProductReviewDependencies {
  readonly reviews: ProductReviewRepositoryPort
  readonly catalog: ProductCatalogPort
  readonly clock: ClockPort
  readonly ids: IdGeneratorPort
}

export interface RateProductCommand {
  readonly productId: string
  readonly authorId: string
  readonly rating: number
}

/**
 * Registra la calificacion de un jugador sobre un producto.
 *
 * Como mucho una por jugador y producto. La comprobacion previa aqui es una
 * respuesta rapida y con buen mensaje para el caso comun; la garantia final
 * ante dos solicitudes concurrentes la da la restriccion de unicidad del
 * repositorio, que `save` traduce al mismo `DuplicateProductReviewError`.
 */
export class RateProduct {
  private readonly deps: ProductReviewDependencies

  constructor(deps: ProductReviewDependencies) {
    this.deps = deps
  }

  async execute(command: RateProductCommand): Promise<ProductReviewDto> {
    const productId = ProductId.create(command.productId)

    if (!(await this.deps.catalog.exists(productId.value))) {
      throw new ProductNotFoundError(productId.value)
    }

    const authorId = AuthorId.create(command.authorId)

    const existing = await this.deps.reviews.findByAuthorAndProduct(authorId, productId)

    if (existing !== null) {
      throw new DuplicateProductReviewError(productId.value)
    }

    const review = ProductReview.create({
      id: ProductReviewId.create(this.deps.ids.generate()),
      productId,
      authorId,
      rating: Rating.create(command.rating),
      occurredAt: this.deps.clock.now(),
    })

    await this.deps.reviews.save(review)

    return toProductReviewDto(review.toSnapshot())
  }
}

/**
 * Recupera el promedio y el numero de calificaciones validas de un producto.
 *
 * Es la respuesta de Community a CA-03 de HU-40. No escribe en el producto
 * canonico de Catalog: esa integracion (`POST /api/internal/products/:id/rating`)
 * es un desarrollo separado del lado de Catalog, coordinado pero no incluido
 * en esta tarea.
 */
export class GetProductReviewSummary {
  private readonly reviews: ProductReviewRepositoryPort

  constructor(reviews: ProductReviewRepositoryPort) {
    this.reviews = reviews
  }

  async execute(productId: string): Promise<ProductReviewSummaryDto> {
    const id = ProductId.create(productId)
    const summary = await this.reviews.summaryFor(id)

    return toProductReviewSummaryDto(id.value, summary)
  }
}
