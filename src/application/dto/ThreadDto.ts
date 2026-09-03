import type { ThreadSnapshot } from '../../domain/entities/Thread'

export interface PostDto {
  readonly id: string
  readonly authorId: string
  readonly content: string
  readonly createdAt: string
}

export interface ThreadDto {
  readonly id: string
  readonly title: string
  readonly authorId: string
  readonly status: string
  readonly postCount: number
  readonly posts: readonly PostDto[]
}

export interface ThreadSummaryDto {
  readonly id: string
  readonly title: string
  readonly authorId: string
  readonly status: string
  readonly postCount: number
}

export interface OwnPostDto {
  readonly id: string
  readonly threadId: string
  readonly content: string
  readonly createdAt: string
}

/**
 * Proyecta el hilo hacia el exterior **omitiendo los mensajes ocultos**.
 *
 * La persistencia los conserva para que una decision de moderacion pueda
 * revisarse; la lectura publica no debe exponerlos. Separar ambas cosas es lo
 * que hace que ocultar sea reversible sin ser visible.
 */
export const toThreadDto = (snapshot: ThreadSnapshot): ThreadDto => {
  const visible = snapshot.posts.filter((post) => !post.hidden)

  return {
    id: snapshot.id,
    title: snapshot.title,
    authorId: snapshot.authorId,
    status: snapshot.status,
    postCount: visible.length,
    posts: visible.map((post) => ({
      id: post.id,
      authorId: post.authorId,
      content: post.content,
      createdAt: post.createdAt,
    })),
  }
}

export const toThreadSummaryDto = (snapshot: ThreadSnapshot): ThreadSummaryDto => ({
  id: snapshot.id,
  title: snapshot.title,
  authorId: snapshot.authorId,
  status: snapshot.status,
  postCount: snapshot.posts.filter((post) => !post.hidden).length,
})
