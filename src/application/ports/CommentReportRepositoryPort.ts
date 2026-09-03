import type { CommentReport } from '../../domain/entities/CommentReport'
import type { AuthorId } from '../../domain/value-objects/community-values'

/**
 * Puerto de persistencia del reporte de comentario.
 *
 * `countByAuthorSince` es lo que hace cumplir el limite de reportes por
 * jugador de HU-46.3: cuenta los reportes de un jugador dentro de una
 * ventana de tiempo, no el total historico -- un limite sin ventana
 * terminaria bloqueando para siempre a cualquier jugador activo, que no es
 * "prevenir abuso" sino inutilizar el mecanismo.
 */
export interface CommentReportRepositoryPort {
  save(report: CommentReport): Promise<void>
  countByAuthorSince(authorId: AuthorId, since: Date): Promise<number>
}

export const COMMENT_REPORT_REPOSITORY = Symbol('CommentReportRepositoryPort')
