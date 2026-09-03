import {
  ProductComment,
  type ProductCommentSnapshot,
} from '../../../domain/entities/ProductComment'
import { AuthorId } from '../../../domain/value-objects/community-values'
import {
  CommentContent,
  ImageReference,
  ProductCommentId,
  ProductId,
} from '../../../domain/value-objects/product-review-values'
import type {
  ListProductCommentsPage,
  ProductCommentPage,
  ProductCommentRepositoryPort,
} from '../../../application/ports/ProductCommentRepositoryPort'

/**
 * Repositorio en memoria de comentarios de producto.
 *
 * Cada comentario es su propia entrada, sin agregado que cargar entero: es la
 * consecuencia directa de no modelar esto sobre `Thread`.
 */
export class InMemoryProductCommentRepository implements ProductCommentRepositoryPort {
  private readonly byId = new Map<string, ProductCommentSnapshot>()

  save(comment: ProductComment): Promise<void> {
    this.byId.set(comment.id.value, comment.toSnapshot())

    return Promise.resolve()
  }

  listByProduct(productId: ProductId, page: ListProductCommentsPage): Promise<ProductCommentPage> {
    const all = [...this.byId.values()]
      .filter((snapshot) => snapshot.productId === productId.value)
      // Mas recientes primero; el id desempata cuando el reloj de pruebas es fijo.
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))

    const items = all
      .slice(page.offset, page.offset + page.limit)
      .map((snapshot) => InMemoryProductCommentRepository.hydrate(snapshot))

    return Promise.resolve({ items, total: all.length })
  }

  get size(): number {
    return this.byId.size
  }

  clear(): void {
    this.byId.clear()
  }

  private static hydrate(snapshot: ProductCommentSnapshot): ProductComment {
    return ProductComment.restore({
      id: ProductCommentId.create(snapshot.id),
      productId: ProductId.create(snapshot.productId),
      authorId: AuthorId.create(snapshot.authorId),
      content: CommentContent.create(snapshot.content),
      images: snapshot.images.map((image) => ImageReference.create(image)),
      createdAt: new Date(snapshot.createdAt),
    })
  }
}
