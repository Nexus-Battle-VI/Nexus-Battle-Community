import type { ProductCommentDto } from './ProductCommentDto'

export interface ModerationQueueEntryDto {
  readonly comment: ProductCommentDto
  readonly reportCount: number
  readonly lastReportedAt: string
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
