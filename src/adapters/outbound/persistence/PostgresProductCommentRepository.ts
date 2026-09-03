import type { Kysely } from 'kysely'

import { ProductComment } from '../../../domain/entities/ProductComment'
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
import type { Database } from './schema'
import { toProductCommentRow, toProductCommentSnapshot, type ProductCommentRow } from './mapping'

/**
 * Repositorio de comentarios de producto sobre PostgreSQL.
 *
 * Cada comentario es un `insert` propio, sin la coreografia de
 * `PostgresThreadRepository.save`: no hay agregado que reconciliar, porque no
 * hay agregado.
 */
export class PostgresProductCommentRepository implements ProductCommentRepositoryPort {
  private readonly db: Kysely<Database>

  constructor(db: Kysely<Database>) {
    this.db = db
  }

  /**
   * `doUpdateSet` -no `doNothing`- desde HU-41: un comentario ya no es
   * inmutable una vez publicado. Las acciones de moderacion (aprobar, ocultar,
   * eliminar, editar, marcar) reutilizan `save` sobre el MISMO id para
   * persistir el nuevo `moderation_status` -y, cuando corresponde, el
   * `content` editado-. `product_id`, `author_id`, `images` y `created_at` no
   * se tocan: ninguna accion de moderacion los cambia.
   */
  async save(comment: ProductComment): Promise<void> {
    const row = toProductCommentRow(comment.toSnapshot())

    await this.db
      .insertInto('product_comments')
      .values(row)
      .onConflict((oc) =>
        oc.column('id').doUpdateSet({
          content: row.content,
          moderation_status: row.moderation_status,
        }),
      )
      .execute()
  }

  async findById(commentId: ProductCommentId): Promise<ProductComment | null> {
    const row = await this.db
      .selectFrom('product_comments')
      .selectAll()
      .where('id', '=', commentId.value)
      .executeTakeFirst()

    return row === undefined ? null : PostgresProductCommentRepository.hydrate(row)
  }

  async listByProduct(
    productId: ProductId,
    page: ListProductCommentsPage,
  ): Promise<ProductCommentPage> {
    const rows = await this.db
      .selectFrom('product_comments')
      .selectAll()
      .where('product_id', '=', productId.value)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(page.limit)
      .offset(page.offset)
      .execute()

    const { total } = await this.db
      .selectFrom('product_comments')
      .select((eb) => eb.fn.countAll().as('total'))
      .where('product_id', '=', productId.value)
      .executeTakeFirstOrThrow()

    return {
      items: rows.map((row) => PostgresProductCommentRepository.hydrate(row)),
      total: Number(total),
    }
  }

  private static hydrate(row: ProductCommentRow): ProductComment {
    const snapshot = toProductCommentSnapshot(row)

    return ProductComment.restore({
      id: ProductCommentId.create(snapshot.id),
      productId: ProductId.create(snapshot.productId),
      authorId: AuthorId.create(snapshot.authorId),
      content: CommentContent.create(snapshot.content),
      images: snapshot.images.map((image) => ImageReference.create(image)),
      createdAt: new Date(snapshot.createdAt),
      moderationStatus: snapshot.moderationStatus,
    })
  }
}
