import type { DomainEvent } from './DomainEvent'

export interface PostPublished extends DomainEvent {
  readonly name: 'community.post.published'
  readonly postId: string
  readonly authorId: string
  readonly contentLength: number
}

export interface PostHidden extends DomainEvent {
  readonly name: 'community.post.hidden'
  readonly postId: string
  readonly moderatorId: string
}

export interface ThreadClosed extends DomainEvent {
  readonly name: 'community.thread.closed'
  readonly moderatorId: string
}

export const postPublished = (params: {
  aggregateId: string
  postId: string
  authorId: string
  contentLength: number
  occurredAt: Date
}): PostPublished => ({
  name: 'community.post.published',
  aggregateId: params.aggregateId,
  postId: params.postId,
  authorId: params.authorId,
  // Se publica la longitud, no el contenido: el evento no debe transportar
  // texto escrito por personas usuarias fuera del contexto que lo custodia.
  contentLength: params.contentLength,
  occurredAt: params.occurredAt,
})

export const postHidden = (params: {
  aggregateId: string
  postId: string
  moderatorId: string
  occurredAt: Date
}): PostHidden => ({
  name: 'community.post.hidden',
  aggregateId: params.aggregateId,
  postId: params.postId,
  moderatorId: params.moderatorId,
  occurredAt: params.occurredAt,
})

export const threadClosed = (params: {
  aggregateId: string
  moderatorId: string
  occurredAt: Date
}): ThreadClosed => ({
  name: 'community.thread.closed',
  aggregateId: params.aggregateId,
  moderatorId: params.moderatorId,
  occurredAt: params.occurredAt,
})
