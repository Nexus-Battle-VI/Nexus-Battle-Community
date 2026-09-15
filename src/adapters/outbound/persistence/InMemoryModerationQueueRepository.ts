import type {
  ModerationQueueEntry,
  ModerationQueuePage,
  ModerationQueuePageResult,
  ModerationQueueRepositoryPort,
} from '../../../application/ports/ModerationQueueRepositoryPort'
import type { InMemoryCommentReportRepository } from './InMemoryCommentReportRepository'
import type { InMemoryAutomaticModerationFlagRepository } from './InMemoryAutomaticModerationFlagRepository'

interface Aggregate {
  reportCount: number
  lastReportedAt: string | null
  automaticFlagCount: number
  lastAutomaticFlaggedAt: string | null
}

const latest = (a: string | null, b: string): string => (a === null || b > a ? b : a)

/**
 * Combina reportes de jugador (HU-46) y detecciones del filtro automatico
 * (HU-41.7) en una unica cola de moderacion (HU-41.1), en memoria.
 *
 * Compone los dos repositorios en memoria en lugar de mantener su propio
 * almacen: son ellos quienes ya tienen la fuente de verdad de cada origen, y
 * duplicarla aqui abriria la puerta a que ambas copias diverjan.
 */
export class InMemoryModerationQueueRepository implements ModerationQueueRepositoryPort {
  constructor(
    private readonly reports: InMemoryCommentReportRepository,
    private readonly automaticFlags: InMemoryAutomaticModerationFlagRepository,
  ) {}

  listModerationQueue(page: ModerationQueuePage): Promise<ModerationQueuePageResult> {
    const byComment = new Map<string, Aggregate>()

    const entry = (commentId: string): Aggregate => {
      const current = byComment.get(commentId)

      if (current !== undefined) {
        return current
      }

      const created: Aggregate = {
        reportCount: 0,
        lastReportedAt: null,
        automaticFlagCount: 0,
        lastAutomaticFlaggedAt: null,
      }

      byComment.set(commentId, created)

      return created
    }

    for (const report of this.reports.listAll()) {
      const aggregate = entry(report.commentId)
      aggregate.reportCount += 1
      aggregate.lastReportedAt = latest(aggregate.lastReportedAt, report.createdAt)
    }

    for (const flag of this.automaticFlags.listAll()) {
      const aggregate = entry(flag.commentId)
      aggregate.automaticFlagCount += 1
      aggregate.lastAutomaticFlaggedAt = latest(aggregate.lastAutomaticFlaggedAt, flag.detectedAt)
    }

    const lastActivity = (aggregate: Aggregate): string =>
      [aggregate.lastReportedAt, aggregate.lastAutomaticFlaggedAt]
        .filter((value): value is string => value !== null)
        .sort()
        .at(-1) ?? ''

    const all: readonly ModerationQueueEntry[] = [...byComment.entries()]
      .map(([commentId, aggregate]) => ({ commentId, ...aggregate }))
      .sort((a, b) => lastActivity(b).localeCompare(lastActivity(a)))

    const items = all.slice(page.offset, page.offset + page.limit)

    return Promise.resolve({ items, total: all.length })
  }
}
