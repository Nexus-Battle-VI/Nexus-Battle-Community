/**
 * Puerto de lectura de la cola de moderacion (HU-41.1), combinando AMBAS
 * fuentes de entrada de Management#29: reportes de jugador (HU-46) y
 * detecciones del filtro automatico (HU-41.7).
 *
 * Es un puerto propio, distinto de `CommentReportRepositoryPort`: la cola es
 * una vista de lectura que agrega dos fuentes, no una responsabilidad del
 * repositorio de reportes. Un comentario con ambos origenes aparece UNA sola
 * vez, con sus dos conteos por separado -- eso es lo que permite que Web
 * distinga, si lo necesita, reporte de usuario, filtro automatico o ambos.
 */
export interface ModerationQueuePage {
  readonly limit: number
  readonly offset: number
}

export interface ModerationQueueEntry {
  readonly commentId: string
  readonly reportCount: number
  readonly lastReportedAt: string | null
  readonly automaticFlagCount: number
  readonly lastAutomaticFlaggedAt: string | null
}

export interface ModerationQueuePageResult {
  readonly items: readonly ModerationQueueEntry[]
  readonly total: number
}

export interface ModerationQueueRepositoryPort {
  listModerationQueue(page: ModerationQueuePage): Promise<ModerationQueuePageResult>
}

export const MODERATION_QUEUE_REPOSITORY = Symbol('ModerationQueueRepositoryPort')
