import type { Kysely } from 'kysely'

import { ProductReview } from '../../../domain/entities/ProductReview'
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
import type { Database } from './schema'
import { toProductReviewRow, toProductReviewSnapshot, type ProductReviewRow } from './mapping'

/** Codigo SQLSTATE de PostgreSQL para violacion de restriccion unica. */
const UNIQUE_VIOLATION = '23505'

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === UNIQUE_VIOLATION

/**
 * Repositorio de calificaciones de producto sobre PostgreSQL.
 *
 * `save` es donde vive la garantia definitiva de unicidad: la restriccion
 * `product_reviews_jugador_producto_unico` del motor rechaza el duplicado
 * incluso si dos solicitudes concurrentes pasaron la comprobacion previa del
 * caso de uso a la vez, y este metodo traduce ese rechazo al mismo
 * `DuplicateProductReviewError` que la comprobacion previa lanza.
 */
export class PostgresProductReviewRepository implements ProductReviewRepositoryPort {
  private readonly db: Kysely<Database>

  constructor(db: Kysely<Database>) {
    this.db = db
  }

  async save(review: ProductReview): Promise<void> {
    const row = toProductReviewRow(review.toSnapshot())

    try {
      await this.db.insertInto('product_reviews').values(row).execute()
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        throw new DuplicateProductReviewError(review.productId.value)
      }

      throw error
    }
  }

  async findByAuthorAndProduct(
    authorId: AuthorId,
    productId: ProductId,
  ): Promise<ProductReview | null> {
    const row = await this.db
      .selectFrom('product_reviews')
      .selectAll()
      .where('product_id', '=', productId.value)
      .where('author_id', '=', authorId.value)
      .executeTakeFirst()

    return row === undefined ? null : PostgresProductReviewRepository.hydrate(row)
  }

  async summaryFor(productId: ProductId): Promise<ProductReviewSummary> {
    const result = await this.db
      .selectFrom('product_reviews')
      .select((eb) => [eb.fn.avg('rating').as('average'), eb.fn.countAll().as('count')])
      .where('product_id', '=', productId.value)
      .executeTakeFirstOrThrow()

    const count = Number(result.count)

    return {
      average: count === 0 ? null : Number(result.average),
      count,
    }
  }

  private static hydrate(row: ProductReviewRow): ProductReview {
    const snapshot = toProductReviewSnapshot(row)

    return ProductReview.restore({
      id: ProductReviewId.create(snapshot.id),
      productId: ProductId.create(snapshot.productId),
      authorId: AuthorId.create(snapshot.authorId),
      rating: Rating.create(snapshot.rating),
      createdAt: new Date(snapshot.createdAt),
    })
  }
}
