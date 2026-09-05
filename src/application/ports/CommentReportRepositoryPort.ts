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
 *
 * La cola de moderacion (HU-41.1) YA NO se lee a traves de este puerto desde
 * HU-41.7: `ModerationQueueRepositoryPort` combina reportes y detecciones
 * automaticas, y este puerto sigue ocupandose exclusivamente de reportes.
 */
export interface CommentReportRepositoryPort {
  save(report: CommentReport): Promise<void>
  countByAuthorSince(authorId: AuthorId, since: Date): Promise<number>
}

export const COMMENT_REPORT_REPOSITORY = Symbol('CommentReportRepositoryPort')
