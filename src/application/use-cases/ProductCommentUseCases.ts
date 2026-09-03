import { ProductComment } from '../../domain/entities/ProductComment'
import { AuthorId } from '../../domain/value-objects/community-values'
import {
  CommentContent,
  ImageReference,
  ProductCommentId,
  ProductId,
} from '../../domain/value-objects/product-review-values'
import type { ClockPort } from '../ports/ClockPort'
import type { IdGeneratorPort } from '../ports/IdGeneratorPort'
import type { ProductExistencePort } from '../ports/ProductExistencePort'
import type { ProductCommentRepositoryPort } from '../ports/ProductCommentRepositoryPort'
import { ProductNotFoundError } from '../errors/ApplicationError'
import {
  toProductCommentDto,
  type ProductCommentDto,
  type ProductCommentPageDto,
} from '../dto/ProductCommentDto'

export interface ProductCommentDependencies {
  readonly comments: ProductCommentRepositoryPort
  readonly catalog: ProductExistencePort
  readonly clock: ClockPort
  readonly ids: IdGeneratorPort
}

export interface PublishProductCommentCommand {
  readonly productId: string
  readonly authorId: string
  readonly content: string
  readonly images?: readonly string[]
}

const ensureProductExists = async (
  catalog: ProductExistencePort,
  productId: ProductId,
): Promise<void> => {
  if (!(await catalog.exists(productId.value))) {
    throw new ProductNotFoundError(productId.value)
  }
}

/**
 * Publica un comentario asociado a un producto.
 *
 * NO registra ninguna calificacion: esa es responsabilidad de `RateProduct`.
 * Mantener las dos operaciones separadas es lo que permite que HU-40.1 se
 * pruebe y evolucione sin arrastrar la regla de unicidad de HU-40.3.
 */
export class PublishProductComment {
  private readonly deps: ProductCommentDependencies

  constructor(deps: ProductCommentDependencies) {
    this.deps = deps
  }

  async execute(command: PublishProductCommentCommand): Promise<ProductCommentDto> {
    const productId = ProductId.create(command.productId)

    await ensureProductExists(this.deps.catalog, productId)

    const comment = ProductComment.publish({
      id: ProductCommentId.create(this.deps.ids.generate()),
      productId,
      authorId: AuthorId.create(command.authorId),
      content: CommentContent.create(command.content),
      images: (command.images ?? []).map((image) => ImageReference.create(image)),
      occurredAt: this.deps.clock.now(),
    })

    await this.deps.comments.save(comment)

    return toProductCommentDto(comment.toSnapshot())
  }
}

export interface ListProductCommentsQuery {
  readonly productId: string
  readonly limit?: number
  readonly offset?: number
}

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

/**
 * Lista los comentarios de un producto, mas recientes primero.
 *
 * No exige que el producto exista: un producto retirado del catalogo puede
 * seguir teniendo comentarios historicos que continuan siendo legibles.
 */
export class ListProductComments {
  private readonly comments: ProductCommentRepositoryPort

  constructor(comments: ProductCommentRepositoryPort) {
    this.comments = comments
  }

  async execute(query: ListProductCommentsQuery): Promise<ProductCommentPageDto> {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
    const offset = Math.max(query.offset ?? 0, 0)

    const page = await this.comments.listByProduct(ProductId.create(query.productId), {
      limit,
      offset,
    })

    return {
      items: page.items.map((comment) => toProductCommentDto(comment.toSnapshot())),
      total: page.total,
      limit,
      offset,
    }
  }
}
