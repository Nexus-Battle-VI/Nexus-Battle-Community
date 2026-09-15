import type { ProductCommentDto } from './ProductCommentDto'

/**
 * `sources` deja explicito, sin que Web tenga que inferirlo de los conteos,
 * si el comentario llego a la cola por reporte de otro jugador, por el
 * filtro automatico (Management#29, HU-41.7), o por ambos.
 */
export type ModerationQueueEntrySource = 'USER_REPORT' | 'AUTOMATIC_FILTER'

export interface ModerationQueueEntryDto {
  readonly comment: ProductCommentDto
  readonly reportCount: number
  readonly lastReportedAt: string | null
  readonly automaticFlagCount: number
  readonly lastAutomaticFlaggedAt: string | null
  readonly sources: readonly ModerationQueueEntrySource[]
}

export interface ModerationQueuePageDto {
  readonly items: readonly ModerationQueueEntryDto[]
  readonly total: number
  readonly limit: number
  readonly offset: number
}

export const toModerationQueuePageDto = (params: {
  readonly items: readonly ModerationQueueEntryDto[]
  readonly total: number
  readonly limit: number
  readonly offset: number
}): ModerationQueuePageDto => ({
  items: params.items,
  total: params.total,
  limit: params.limit,
  offset: params.offset,
})
