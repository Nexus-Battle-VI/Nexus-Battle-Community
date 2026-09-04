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
export interface ModerationQueuePage {
  readonly limit: number
  readonly offset: number
}

/**
 * Un comentario con al menos un reporte, tal y como lo necesita la cola de
 * moderacion (HU-41.1): cuantos reportes tiene y cuando llego el mas
 * reciente, sin duplicar el contenido del comentario -eso lo resuelve
 * `ProductCommentRepositoryPort.findById` sobre `commentId`-.
 */
export interface ModerationQueueEntry {
  readonly commentId: string
  readonly reportCount: number
  readonly lastReportedAt: string
}

export interface ModerationQueuePageResult {
  readonly items: readonly ModerationQueueEntry[]
  readonly total: number
}

export interface CommentReportRepositoryPort {
  save(report: CommentReport): Promise<void>
  countByAuthorSince(authorId: AuthorId, since: Date): Promise<number>

  /**
   * Comentarios con al menos un reporte, del mas recientemente reportado al
   * mas antiguo. Es la fuente de la cola de moderacion de HU-41.1: sin
   * filtros automaticos de lenguaje ofensivo implementados en ningun
   * servicio del org, el reporte de otro jugador (HU-46) es la unica entrada
   * real -no inventada- por la que un comentario llega a moderacion.
   */
  listModerationQueue(page: ModerationQueuePage): Promise<ModerationQueuePageResult>
}

export const COMMENT_REPORT_REPOSITORY = Symbol('CommentReportRepositoryPort')
