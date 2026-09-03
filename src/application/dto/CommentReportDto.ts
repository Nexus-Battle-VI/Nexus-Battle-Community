import type { CommentReportSnapshot } from '../../domain/entities/CommentReport'

export interface CommentReportDto {
  readonly id: string
  readonly commentId: string
  readonly authorId: string
  readonly category: string
  readonly description: string | null
  readonly createdAt: string
}

export const toCommentReportDto = (snapshot: CommentReportSnapshot): CommentReportDto => ({
  id: snapshot.id,
  commentId: snapshot.commentId,
  authorId: snapshot.authorId,
  category: snapshot.category,
  description: snapshot.description,
  createdAt: snapshot.createdAt,
})
