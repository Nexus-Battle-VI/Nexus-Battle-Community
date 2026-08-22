import { DomainError } from '../errors/DomainError'
import type { DomainEvent } from '../events/DomainEvent'
import { postHidden, postPublished, threadClosed } from '../events/ThreadEvents'
import { ModerationPolicy } from '../policies/ModerationPolicy'
import type {
  AuthorId,
  PostContent,
  PostId,
  ThreadId,
  ThreadTitle,
} from '../value-objects/community-values'

export const ThreadStatus = {
  Open: 'OPEN',
  Closed: 'CLOSED',
} as const

export type ThreadStatus = (typeof ThreadStatus)[keyof typeof ThreadStatus]

export interface PostSnapshot {
  readonly id: string
  readonly authorId: string
  readonly content: string
  readonly hidden: boolean
  readonly createdAt: string
}

export interface ThreadSnapshot {
  readonly id: string
  readonly title: string
  readonly authorId: string
  readonly status: ThreadStatus
  readonly posts: readonly PostSnapshot[]
}

interface Post {
  readonly id: PostId
  readonly authorId: AuthorId
  readonly content: PostContent
  hidden: boolean
  readonly createdAt: Date
}

/**
 * Raiz de agregado del contexto Community.
 *
 * Un hilo contiene los mensajes que lo componen. Los mensajes no son un
 * agregado propio porque no tienen sentido fuera de su hilo, y porque las
 * reglas que los gobiernan — no publicar en un hilo cerrado, no superar el
 * limite de mensajes — son invariantes del hilo completo.
 */
export class Thread {
  readonly id: ThreadId
  readonly authorId: AuthorId
  private title: ThreadTitle
  private status: ThreadStatus
  private readonly posts: Post[]
  private readonly events: DomainEvent[] = []

  private constructor(params: {
    id: ThreadId
    title: ThreadTitle
    authorId: AuthorId
    status: ThreadStatus
    posts: Post[]
  }) {
    this.id = params.id
    this.title = params.title
    this.authorId = params.authorId
    this.status = params.status
    this.posts = params.posts
  }

  static open(params: { id: ThreadId; title: ThreadTitle; authorId: AuthorId }): Thread {
    return new Thread({ ...params, status: ThreadStatus.Open, posts: [] })
  }

  /** Reconstituye un hilo persistido. No emite eventos. */
  static restore(params: {
    id: ThreadId
    title: ThreadTitle
    authorId: AuthorId
    status: ThreadStatus
    posts: readonly {
      id: PostId
      authorId: AuthorId
      content: PostContent
      hidden: boolean
      createdAt: Date
    }[]
  }): Thread {
    return new Thread({
      id: params.id,
      title: params.title,
      authorId: params.authorId,
      status: params.status,
      posts: params.posts.map((post) => ({ ...post })),
    })
  }

  get currentTitle(): ThreadTitle {
    return this.title
  }

  get currentStatus(): ThreadStatus {
    return this.status
  }

  get isOpen(): boolean {
    return this.status === ThreadStatus.Open
  }

  get postCount(): number {
    return this.posts.length
  }

  /** Mensajes visibles: los ocultados por moderacion no se cuentan. */
  get visiblePostCount(): number {
    return this.posts.filter((post) => !post.hidden).length
  }

  rename(title: ThreadTitle): void {
    if (!this.isOpen) {
      throw new DomainError(`El hilo ${this.id.value} esta cerrado y no admite cambios de titulo.`)
    }

    this.title = title
  }

  /**
   * Publica un mensaje.
   *
   * Un hilo cerrado no admite mensajes nuevos. La regla vive aqui y no en el
   * controlador, de modo que se aplica llegue la peticion por donde llegue.
   */
  publishPost(params: {
    id: PostId
    authorId: AuthorId
    content: PostContent
    occurredAt: Date
  }): void {
    if (!this.isOpen) {
      throw new DomainError(`El hilo ${this.id.value} esta cerrado y no admite mensajes nuevos.`)
    }

    if (this.posts.length >= ModerationPolicy.MAX_POSTS_PER_THREAD) {
      throw new DomainError(
        `El hilo ${this.id.value} alcanzo el limite de ${String(ModerationPolicy.MAX_POSTS_PER_THREAD)} mensajes.`,
      )
    }

    if (this.posts.some((post) => post.id.equals(params.id))) {
      throw new DomainError(`El hilo ${this.id.value} ya contiene un mensaje ${params.id.value}.`)
    }

    this.posts.push({
      id: params.id,
      authorId: params.authorId,
      content: params.content,
      hidden: false,
      createdAt: params.occurredAt,
    })

    this.events.push(
      postPublished({
        aggregateId: this.id.value,
        postId: params.id.value,
        authorId: params.authorId.value,
        contentLength: params.content.length,
        occurredAt: params.occurredAt,
      }),
    )
  }

  /**
   * Oculta un mensaje por moderacion.
   *
   * Ocultar no borra: el contenido se conserva para que una decision de
   * moderacion pueda revisarse o revertirse. Deja de ser visible, que es lo que
   * la comunidad necesita de inmediato.
   */
  hidePost(postId: PostId, moderatorId: AuthorId, occurredAt: Date): void {
    const post = this.posts.find((candidate) => candidate.id.equals(postId))

    if (post === undefined) {
      throw new DomainError(`El hilo ${this.id.value} no contiene el mensaje ${postId.value}.`)
    }

    if (post.hidden) {
      throw new DomainError(`El mensaje ${postId.value} ya estaba oculto.`)
    }

    post.hidden = true

    this.events.push(
      postHidden({
        aggregateId: this.id.value,
        postId: postId.value,
        moderatorId: moderatorId.value,
        occurredAt,
      }),
    )
  }

  /** Restituye un mensaje ocultado por error. */
  restorePost(postId: PostId): void {
    const post = this.posts.find((candidate) => candidate.id.equals(postId))

    if (post === undefined) {
      throw new DomainError(`El hilo ${this.id.value} no contiene el mensaje ${postId.value}.`)
    }

    if (!post.hidden) {
      throw new DomainError(`El mensaje ${postId.value} no estaba oculto.`)
    }

    post.hidden = false
  }

  close(moderatorId: AuthorId, occurredAt: Date): void {
    if (!this.isOpen) {
      throw new DomainError(`El hilo ${this.id.value} ya esta cerrado.`)
    }

    this.status = ThreadStatus.Closed
    this.events.push(
      threadClosed({
        aggregateId: this.id.value,
        moderatorId: moderatorId.value,
        occurredAt,
      }),
    )
  }

  reopen(): void {
    if (this.isOpen) {
      throw new DomainError(`El hilo ${this.id.value} ya esta abierto.`)
    }

    this.status = ThreadStatus.Open
  }

  pullEvents(): readonly DomainEvent[] {
    const pulled = [...this.events]
    this.events.length = 0

    return pulled
  }

  /**
   * Instantanea completa, incluidos los mensajes ocultos. La persistencia debe
   * conservarlos; decidir que se muestra es responsabilidad de la lectura.
   */
  toSnapshot(): ThreadSnapshot {
    return {
      id: this.id.value,
      title: this.title.value,
      authorId: this.authorId.value,
      status: this.status,
      posts: this.posts.map((post) => ({
        id: post.id.value,
        authorId: post.authorId.value,
        content: post.content.value,
        hidden: post.hidden,
        createdAt: post.createdAt.toISOString(),
      })),
    }
  }
}
