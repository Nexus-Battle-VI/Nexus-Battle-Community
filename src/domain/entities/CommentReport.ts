import type { AuthorId } from '../value-objects/community-values'
import type { ProductCommentId } from '../value-objects/product-review-values'
import type {
  CommentReportId,
  ReportCategory,
  ReportDescription,
} from '../value-objects/comment-report-values'

export interface CommentReportSnapshot {
  readonly id: string
  readonly commentId: string
  readonly authorId: string
  readonly category: ReportCategory
  readonly description: string | null
  readonly createdAt: string
}

/**
 * Reporte de un comentario, con la categoria de violacion que HU-46 exige.
 *
 * Es una entidad independiente, igual que `ProductComment` y `ProductReview`:
 * no hay agregado padre, y su unica relacion con el comentario reportado es
 * la referencia a `commentId`. El limite de reportes por jugador (HU-46.3) NO
 * es un invariante de esta entidad -- un reporte aislado no sabe cuantos mas
 * existen -- vive en el caso de uso `ReportComment`.
 */
export class CommentReport {
  readonly id: CommentReportId
  readonly commentId: ProductCommentId
  readonly authorId: AuthorId
  readonly category: ReportCategory
  readonly description: ReportDescription | null
  readonly createdAt: Date

  private constructor(params: {
    id: CommentReportId
    commentId: ProductCommentId
    authorId: AuthorId
    category: ReportCategory
    description: ReportDescription | null
    createdAt: Date
  }) {
    this.id = params.id
    this.commentId = params.commentId
    this.authorId = params.authorId
    this.category = params.category
    this.description = params.description
    this.createdAt = params.createdAt
  }

  static file(params: {
    id: CommentReportId
    commentId: ProductCommentId
    authorId: AuthorId
    category: ReportCategory
    description: ReportDescription | null
    occurredAt: Date
  }): CommentReport {
    return new CommentReport({ ...params, createdAt: params.occurredAt })
  }

  static restore(params: {
    id: CommentReportId
    commentId: ProductCommentId
    authorId: AuthorId
    category: ReportCategory
    description: ReportDescription | null
    createdAt: Date
  }): CommentReport {
    return new CommentReport(params)
  }

  toSnapshot(): CommentReportSnapshot {
    return {
      id: this.id.value,
      commentId: this.commentId.value,
      authorId: this.authorId.value,
      category: this.category,
      description: this.description?.toString() ?? null,
      createdAt: this.createdAt.toISOString(),
    }
  }
}
