import { DomainError } from '../errors/DomainError'
import type {
  CommentContent,
  ImageReference,
  ProductCommentId,
  ProductId,
} from '../value-objects/product-review-values'
import { MAX_COMMENT_IMAGES } from '../value-objects/product-review-values'
import type { AuthorId } from '../value-objects/community-values'
import { CommentModerationStatus, ModerationAction } from '../value-objects/moderation-values'

export interface ProductCommentSnapshot {
  readonly id: string
  readonly productId: string
  readonly authorId: string
  readonly content: string
  readonly images: readonly string[]
  readonly createdAt: string
  /** HU-41: estado de moderacion. `PENDING` para todo comentario recien publicado. */
  readonly moderationStatus: CommentModerationStatus
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
  private content: CommentContent
  readonly images: readonly ImageReference[]
  readonly createdAt: Date
  private moderationStatus: CommentModerationStatus

  private constructor(params: {
    id: ProductCommentId
    productId: ProductId
    authorId: AuthorId
    content: CommentContent
    images: readonly ImageReference[]
    createdAt: Date
    moderationStatus: CommentModerationStatus
  }) {
    this.id = params.id
    this.productId = params.productId
    this.authorId = params.authorId
    this.content = params.content
    this.images = params.images
    this.createdAt = params.createdAt
    this.moderationStatus = params.moderationStatus
  }

  /**
   * Publica un comentario nuevo. El tope de imagenes se exige aqui, en la
   * accion que las incorpora -- no en `restore`, que reconstruye un estado ya
   * valido en su momento de guardarse. Nace `PENDING`: HU-41 no distingue un
   * comentario "ya revisado de antemano".
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

    return new ProductComment({
      ...params,
      createdAt: params.occurredAt,
      moderationStatus: CommentModerationStatus.Pending,
    })
  }

  static restore(params: {
    id: ProductCommentId
    productId: ProductId
    authorId: AuthorId
    content: CommentContent
    images: readonly ImageReference[]
    createdAt: Date
    moderationStatus: CommentModerationStatus
  }): ProductComment {
    return new ProductComment(params)
  }

  get currentContent(): CommentContent {
    return this.content
  }

  get currentModerationStatus(): CommentModerationStatus {
    return this.moderationStatus
  }

  /**
   * Aplica una accion de moderacion (HU-41.2/41.3) y devuelve el estado
   * anterior, que es lo que el registro de auditoria necesita conservar.
   *
   * Sin restriccion de transicion: HU-41 no declara ningun camino vetado
   * entre los cinco estados -un comentario oculto puede aprobarse despues, uno
   * marcado puede eliminarse-, asi que la unica regla es que la accion
   * corresponda al vocabulario cerrado de `ModerationAction`. `edit` es la
   * unica accion que ademas cambia el contenido.
   */
  moderate(params: { readonly action: ModerationAction; readonly newContent?: CommentContent }): {
    readonly previousStatus: CommentModerationStatus
    readonly newStatus: CommentModerationStatus
  } {
    const previousStatus = this.moderationStatus
    const newStatus = MODERATION_ACTION_TARGET_STATUS[params.action]

    if (params.action === ModerationAction.Edit) {
      if (params.newContent === undefined) {
        throw new DomainError('Editar un comentario exige el nuevo contenido.')
      }

      this.content = params.newContent
    }

    this.moderationStatus = newStatus

    return { previousStatus, newStatus }
  }

  toSnapshot(): ProductCommentSnapshot {
    return {
      id: this.id.value,
      productId: this.productId.value,
      authorId: this.authorId.value,
      content: this.content.value,
      images: this.images.map((image) => image.value),
      createdAt: this.createdAt.toISOString(),
      moderationStatus: this.moderationStatus,
    }
  }
}

/** Cada accion de moderacion produce exactamente un estado, uno a uno. */
const MODERATION_ACTION_TARGET_STATUS: Readonly<Record<ModerationAction, CommentModerationStatus>> =
  {
    [ModerationAction.Approve]: CommentModerationStatus.Approved,
    [ModerationAction.Delete]: CommentModerationStatus.Deleted,
    [ModerationAction.Hide]: CommentModerationStatus.Hidden,
    [ModerationAction.Edit]: CommentModerationStatus.Edited,
    [ModerationAction.Mark]: CommentModerationStatus.Marked,
  }
