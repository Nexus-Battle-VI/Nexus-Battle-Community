import { Thread } from '../../../domain/entities/Thread'
import type { ThreadSnapshot } from '../../../domain/entities/Thread'
import {
  AuthorId,
  PostContent,
  PostId,
  ThreadId,
  ThreadTitle,
} from '../../../domain/value-objects/community-values'
import type { ThreadRepositoryPort } from '../../../application/ports/ThreadRepositoryPort'

/**
 * Repositorio en memoria del agregado Thread.
 *
 * Almacena instantaneas, no referencias al agregado, de modo que una mutacion
 * no persistida nunca se filtra al almacen.
 *
 * El adaptador definitivo sobre PostgreSQL queda sujeto a ADR-005.
 */
export class InMemoryThreadRepository implements ThreadRepositoryPort {
  private readonly byId = new Map<string, ThreadSnapshot>()

  save(thread: Thread): Promise<void> {
    this.byId.set(thread.id.value, thread.toSnapshot())

    return Promise.resolve()
  }

  findById(id: ThreadId): Promise<Thread | null> {
    const snapshot = this.byId.get(id.value)

    return Promise.resolve(
      snapshot === undefined ? null : InMemoryThreadRepository.hydrate(snapshot),
    )
  }

  list(): Promise<readonly Thread[]> {
    const found = [...this.byId.values()]
      .map((snapshot) => InMemoryThreadRepository.hydrate(snapshot))
      .sort((a, b) => a.id.value.localeCompare(b.id.value))

    return Promise.resolve(found)
  }

  get size(): number {
    return this.byId.size
  }

  clear(): void {
    this.byId.clear()
  }

  private static hydrate(snapshot: ThreadSnapshot): Thread {
    return Thread.restore({
      id: ThreadId.create(snapshot.id),
      title: ThreadTitle.create(snapshot.title),
      authorId: AuthorId.create(snapshot.authorId),
      status: snapshot.status,
      posts: snapshot.posts.map((post) => ({
        id: PostId.create(post.id),
        authorId: AuthorId.create(post.authorId),
        content: PostContent.create(post.content),
        hidden: post.hidden,
        createdAt: new Date(post.createdAt),
      })),
    })
  }
}
