import {
  AutomaticModerationFlag,
  type AutomaticModerationFlagSnapshot,
} from '../../../domain/entities/AutomaticModerationFlag'
import { ProductCommentId } from '../../../domain/value-objects/product-review-values'
import {
  AutomaticModerationFlagId,
  ModerationSignalMatch,
} from '../../../domain/value-objects/moderation-signal-values'
import type { AutomaticModerationFlagRepositoryPort } from '../../../application/ports/AutomaticModerationFlagRepositoryPort'

export class InMemoryAutomaticModerationFlagRepository implements AutomaticModerationFlagRepositoryPort {
  private readonly byId = new Map<string, AutomaticModerationFlagSnapshot>()

  save(flag: AutomaticModerationFlag): Promise<void> {
    this.byId.set(flag.id.value, flag.toSnapshot())

    return Promise.resolve()
  }

  listByComment(commentId: ProductCommentId): Promise<readonly AutomaticModerationFlag[]> {
    const items = [...this.byId.values()]
      .filter((snapshot) => snapshot.commentId === commentId.value)
      .sort((a, b) => b.detectedAt.localeCompare(a.detectedAt))
      .map((snapshot) => InMemoryAutomaticModerationFlagRepository.hydrate(snapshot))

    return Promise.resolve(items)
  }

  /** Enumeracion completa, para que `InMemoryModerationQueueRepository` agregue por comentario. */
  listAll(): readonly AutomaticModerationFlagSnapshot[] {
    return [...this.byId.values()]
  }

  get size(): number {
    return this.byId.size
  }

  clear(): void {
    this.byId.clear()
  }

  private static hydrate(snapshot: AutomaticModerationFlagSnapshot): AutomaticModerationFlag {
    return AutomaticModerationFlag.restore({
      id: AutomaticModerationFlagId.create(snapshot.id),
      commentId: ProductCommentId.create(snapshot.commentId),
      ruleType: snapshot.ruleType,
      match: ModerationSignalMatch.create(snapshot.match),
      detectedAt: new Date(snapshot.detectedAt),
    })
  }
}
