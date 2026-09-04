import type { CommentReport, CommentReportSnapshot } from '../../../domain/entities/CommentReport'
import type { AuthorId } from '../../../domain/value-objects/community-values'
import type {
  CommentReportRepositoryPort,
  ModerationQueuePage,
  ModerationQueuePageResult,
} from '../../../application/ports/CommentReportRepositoryPort'

export class InMemoryCommentReportRepository implements CommentReportRepositoryPort {
  private readonly byId = new Map<string, CommentReportSnapshot>()

  save(report: CommentReport): Promise<void> {
    this.byId.set(report.id.value, report.toSnapshot())

    return Promise.resolve()
  }

  countByAuthorSince(authorId: AuthorId, since: Date): Promise<number> {
    const sinceIso = since.toISOString()
    const count = [...this.byId.values()].filter(
      (snapshot) => snapshot.authorId === authorId.value && snapshot.createdAt >= sinceIso,
    ).length

    return Promise.resolve(count)
  }

  listModerationQueue(page: ModerationQueuePage): Promise<ModerationQueuePageResult> {
    const byComment = new Map<string, { reportCount: number; lastReportedAt: string }>()

    for (const snapshot of this.byId.values()) {
      const current = byComment.get(snapshot.commentId)

      byComment.set(snapshot.commentId, {
        reportCount: (current?.reportCount ?? 0) + 1,
        lastReportedAt:
          current === undefined || snapshot.createdAt > current.lastReportedAt
            ? snapshot.createdAt
            : current.lastReportedAt,
      })
    }

    const all = [...byComment.entries()]
      .map(([commentId, entry]) => ({ commentId, ...entry }))
      .sort((a, b) => b.lastReportedAt.localeCompare(a.lastReportedAt))

    const items = all.slice(page.offset, page.offset + page.limit)

    return Promise.resolve({ items, total: all.length })
  }

  get size(): number {
    return this.byId.size
  }

  clear(): void {
    this.byId.clear()
  }
}
