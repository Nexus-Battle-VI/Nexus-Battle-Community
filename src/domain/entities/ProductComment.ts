import { DomainError } from '../errors/DomainError'
import type {
  CommentContent,
  ImageReference,
  ProductCommentId,
  ProductId,
} from '../value-objects/product-review-values'
import { MAX_COMMENT_IMAGES } from '../value-objects/product-review-values'
import type { AuthorId } from '../value-objects/community-values'

export interface ProductCommentSnapshot {
  readonly id: string
  readonly productId: string
  readonly authorId: string
  readonly content: string
  readonly images: readonly string[]
  readonly createdAt: string
}

/**
 * Comentario sobre un producto.
 *
 * NO es un mensaje dentro de un `Thread`. Vive como entidad independiente,
 * identificada por su propio id y asociada a un `productId`, sin agregado
 * padre ni invariantes de "hilo cerrado". Esa es la decision de diseño que
 * resuelve la incongruencia entre HU-40 ("sin limite de comentarios por
 * producto") y `ModerationPolicy.MAX_POSTS_PER_THREAD` de `Thread`, pensado
 * para el hilo de conversacion general y no para esto.
 */
export class ProductComment {
  readonly id: ProductCommentId
  readonly productId: ProductId
  readonly authorId: AuthorId
  readonly content: CommentContent
  readonly images: readonly ImageReference[]
  readonly createdAt: Date

  private constructor(params: {
    id: ProductCommentId
    productId: ProductId
    authorId: AuthorId
    content: CommentContent
    images: readonly ImageReference[]
    createdAt: Date
  }) {
    this.id = params.id
    this.productId = params.productId
    this.authorId = params.authorId
    this.content = params.content
    this.images = params.images
    this.createdAt = params.createdAt
  }

  /**
   * Publica un comentario nuevo. El tope de imagenes se exige aqui, en la
   * accion que las incorpora -- no en `restore`, que reconstruye un estado ya
   * valido en su momento de guardarse.
   */
  static publish(params: {
    id: ProductCommentId
    productId: ProductId
    authorId: AuthorId
    content: CommentContent
    images: readonly ImageReference[]
    occurredAt: Date
  }): ProductComment {
    if (params.images.length > MAX_COMMENT_IMAGES) {
      throw new DomainError(
        `Un comentario admite como maximo ${String(MAX_COMMENT_IMAGES)} imagenes.`,
      )
    }

    return new ProductComment({ ...params, createdAt: params.occurredAt })
  }

  static restore(params: {
    id: ProductCommentId
    productId: ProductId
    authorId: AuthorId
    content: CommentContent
    images: readonly ImageReference[]
    createdAt: Date
  }): ProductComment {
    return new ProductComment(params)
  }

  toSnapshot(): ProductCommentSnapshot {
    return {
      id: this.id.value,
      productId: this.productId.value,
      authorId: this.authorId.value,
      content: this.content.value,
      images: this.images.map((image) => image.value),
      createdAt: this.createdAt.toISOString(),
    }
  }
}
