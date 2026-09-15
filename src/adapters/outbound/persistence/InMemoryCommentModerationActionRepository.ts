import {
  CommentModerationAction,
  type CommentModerationActionSnapshot,
} from '../../../domain/entities/CommentModerationAction'
import { AuthorId } from '../../../domain/value-objects/community-values'
import { ProductCommentId } from '../../../domain/value-objects/product-review-values'
import {
  CommentModerationActionId,
  IpAddress,
  ModerationReason,
} from '../../../domain/value-objects/moderation-values'
import type { CommentModerationActionRepositoryPort } from '../../../application/ports/CommentModerationActionRepositoryPort'

export class InMemoryCommentModerationActionRepository implements CommentModerationActionRepositoryPort {
  private readonly byId = new Map<string, CommentModerationActionSnapshot>()

  save(action: CommentModerationAction): Promise<void> {
    this.byId.set(action.id.value, action.toSnapshot())

    return Promise.resolve()
  }

  listByComment(commentId: ProductCommentId): Promise<readonly CommentModerationAction[]> {
    const items = [...this.byId.values()]
      .filter((snapshot) => snapshot.commentId === commentId.value)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((snapshot) => InMemoryCommentModerationActionRepository.hydrate(snapshot))

    return Promise.resolve(items)
  }

  get size(): number {
    return this.byId.size
  }

  clear(): void {
    this.byId.clear()
  }

  private static hydrate(snapshot: CommentModerationActionSnapshot): CommentModerationAction {
    return CommentModerationAction.restore({
      id: CommentModerationActionId.create(snapshot.id),
      commentId: ProductCommentId.create(snapshot.commentId),
      actorId: AuthorId.create(snapshot.actorId),
      action: snapshot.action,
      reason: ModerationReason.create(snapshot.reason),
      previousStatus: snapshot.previousStatus,
      newStatus: snapshot.newStatus,
      createdAt: new Date(snapshot.createdAt),
      ipAddress: snapshot.ipAddress === null ? null : IpAddress.create(snapshot.ipAddress),
    })
  }
}
