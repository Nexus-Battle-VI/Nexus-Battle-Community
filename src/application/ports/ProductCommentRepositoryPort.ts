import type { ProductComment } from '../../domain/entities/ProductComment'
import type { ProductCommentId, ProductId } from '../../domain/value-objects/product-review-values'

export interface ListProductCommentsPage {
  readonly limit: number
  readonly offset: number
}

export interface ProductCommentPage {
  readonly items: readonly ProductComment[]
  readonly total: number
}

/**
 * Puerto de persistencia del comentario de producto.
 *
 * A diferencia de `ThreadRepositoryPort`, no guarda un agregado con hijos:
 * cada comentario es su propia fila, sin padre que cargar entero para leer
 * uno. Es precisamente lo que permite que HU-40 no imponga un tope de
 * comentarios por producto.
 */
export interface ProductCommentRepositoryPort {
  save(comment: ProductComment): Promise<void>
  listByProduct(productId: ProductId, page: ListProductCommentsPage): Promise<ProductCommentPage>
  /** Lo consume HU-46: un reporte debe poder confirmar que el comentario existe. */
  findById(commentId: ProductCommentId): Promise<ProductComment | null>
}

export const PRODUCT_COMMENT_REPOSITORY = Symbol('ProductCommentRepositoryPort')
