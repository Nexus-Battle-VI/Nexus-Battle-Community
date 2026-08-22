import { Thread } from '../../domain/entities/Thread'
import {
  AuthorId,
  PostContent,
  PostId,
  ThreadId,
  ThreadTitle,
} from '../../domain/value-objects/community-values'
import type { ClockPort } from '../ports/ClockPort'
import type { IdGeneratorPort } from '../ports/IdGeneratorPort'
import type { ThreadRepositoryPort } from '../ports/ThreadRepositoryPort'
import { ThreadNotFoundError } from '../errors/ApplicationError'
import {
  type ThreadDto,
  type ThreadSummaryDto,
  toThreadDto,
  toThreadSummaryDto,
} from '../dto/ThreadDto'

export interface ThreadDependencies {
  readonly threads: ThreadRepositoryPort
  readonly clock: ClockPort
  readonly ids: IdGeneratorPort
}

export interface OpenThreadCommand {
  readonly title: string
  readonly authorId: string
}

export interface PublishPostCommand {
  readonly threadId: string
  readonly authorId: string
  readonly content: string
}

export interface ModeratePostCommand {
  readonly threadId: string
  readonly postId: string
  readonly moderatorId: string
}

const load = async (threads: ThreadRepositoryPort, rawId: string): Promise<Thread> => {
  const id = ThreadId.create(rawId)
  const thread = await threads.findById(id)

  if (thread === null) {
    throw new ThreadNotFoundError(id.value)
  }

  return thread
}

/**
 * Abre un hilo nuevo. Nace abierto y sin mensajes.
 */
export class OpenThread {
  private readonly deps: ThreadDependencies

  constructor(deps: ThreadDependencies) {
    this.deps = deps
  }

  async execute(command: OpenThreadCommand): Promise<ThreadDto> {
    const thread = Thread.open({
      id: ThreadId.create(this.deps.ids.generate()),
      title: ThreadTitle.create(command.title),
      authorId: AuthorId.create(command.authorId),
    })

    await this.deps.threads.save(thread)

    return toThreadDto(thread.toSnapshot())
  }
}

/**
 * Publica un mensaje en un hilo abierto.
 */
export class PublishPost {
  private readonly deps: ThreadDependencies

  constructor(deps: ThreadDependencies) {
    this.deps = deps
  }

  async execute(command: PublishPostCommand): Promise<ThreadDto> {
    const thread = await load(this.deps.threads, command.threadId)

    thread.publishPost({
      id: PostId.create(this.deps.ids.generate()),
      authorId: AuthorId.create(command.authorId),
      content: PostContent.create(command.content),
      occurredAt: this.deps.clock.now(),
    })

    await this.deps.threads.save(thread)
    thread.pullEvents()

    return toThreadDto(thread.toSnapshot())
  }
}

/**
 * Oculta un mensaje por moderacion. El contenido se conserva.
 */
export class HidePost {
  private readonly deps: ThreadDependencies

  constructor(deps: ThreadDependencies) {
    this.deps = deps
  }

  async execute(command: ModeratePostCommand): Promise<ThreadDto> {
    const thread = await load(this.deps.threads, command.threadId)

    thread.hidePost(
      PostId.create(command.postId),
      AuthorId.create(command.moderatorId),
      this.deps.clock.now(),
    )

    await this.deps.threads.save(thread)
    thread.pullEvents()

    return toThreadDto(thread.toSnapshot())
  }
}

/**
 * Cierra un hilo. Deja de admitir mensajes nuevos, pero sigue siendo legible.
 */
export class CloseThread {
  private readonly deps: ThreadDependencies

  constructor(deps: ThreadDependencies) {
    this.deps = deps
  }

  async execute(threadId: string, moderatorId: string): Promise<ThreadDto> {
    const thread = await load(this.deps.threads, threadId)

    thread.close(AuthorId.create(moderatorId), this.deps.clock.now())

    await this.deps.threads.save(thread)
    thread.pullEvents()

    return toThreadDto(thread.toSnapshot())
  }
}

/**
 * Recupera un hilo con sus mensajes visibles.
 */
export class GetThread {
  private readonly threads: ThreadRepositoryPort

  constructor(threads: ThreadRepositoryPort) {
    this.threads = threads
  }

  async execute(threadId: string): Promise<ThreadDto> {
    const thread = await load(this.threads, threadId)

    return toThreadDto(thread.toSnapshot())
  }
}

/**
 * Lista los hilos existentes con su resumen.
 */
export class ListThreads {
  private readonly threads: ThreadRepositoryPort

  constructor(threads: ThreadRepositoryPort) {
    this.threads = threads
  }

  async execute(): Promise<readonly ThreadSummaryDto[]> {
    const found = await this.threads.list()

    return found.map((thread) => toThreadSummaryDto(thread.toSnapshot()))
  }
}
