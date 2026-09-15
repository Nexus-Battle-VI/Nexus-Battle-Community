import type { CommentReport, CommentReportSnapshot } from '../../../domain/entities/CommentReport'
import type { AuthorId } from '../../../domain/value-objects/community-values'
import type { CommentReportRepositoryPort } from '../../../application/ports/CommentReportRepositoryPort'

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

  /** Enumeracion completa, para que `InMemoryModerationQueueRepository` agregue por comentario. */
  listAll(): readonly CommentReportSnapshot[] {
    return [...this.byId.values()]
  }

  get size(): number {
    return this.byId.size
  }

  clear(): void {
    this.byId.clear()
  }
}
