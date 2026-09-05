import { ThreadStatus } from '../../../domain/entities/Thread'
import type { PostSnapshot, ThreadSnapshot } from '../../../domain/entities/Thread'
import type { ProductCommentSnapshot } from '../../../domain/entities/ProductComment'
import type { ProductReviewSnapshot } from '../../../domain/entities/ProductReview'
import type { CommentReportSnapshot } from '../../../domain/entities/CommentReport'
import type { CommentModerationActionSnapshot } from '../../../domain/entities/CommentModerationAction'
import type { AutomaticModerationFlagSnapshot } from '../../../domain/entities/AutomaticModerationFlag'
import {
  isCommentModerationStatus,
  isModerationAction,
  type CommentModerationStatus,
} from '../../../domain/value-objects/moderation-values'
import {
  isModerationSignalRuleType,
  isModerationSignalSource,
} from '../../../domain/value-objects/moderation-signal-values'

/**
 * Traduccion entre filas de PostgreSQL y la instantanea del agregado.
 *
 * Vive aparte del repositorio y es **puro** a proposito: es la parte del
 * adaptador donde de verdad se puede equivocar uno, y sacarla del repositorio
 * permite probarla sin base de datos ni contenedor.
 */

export class PersistenceMappingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PersistenceMappingError'
  }
}

export interface ThreadRow {
  readonly id: string
  readonly title: string
  readonly author_id: string
  readonly status: string
}

export interface PostRow {
  readonly id: string
  readonly thread_id: string
  readonly position: number
  readonly author_id: string
  readonly content: string
  readonly hidden: boolean
  readonly created_at: Date
}

const STATUSES: readonly string[] = Object.values(ThreadStatus)

/**
 * Construye la instantanea a partir de la fila del hilo y sus mensajes.
 *
 * Valida lo que lee en lugar de confiar en la columna. Puede parecer excesivo
 * —la base de datos tiene sus propias restricciones— pero una fila escrita por
 * una version anterior del esquema, o por una migracion a medias, llegaria aqui
 * sin que nada la detuviera. Fallar al leerla es preferible a construir un
 * agregado con un estado que el dominio no reconoce.
 *
 * Los mensajes se ordenan por posicion aqui y no solo en la consulta: el orden
 * es parte del agregado, y depender de que quien consulte se acuerde de pedirlo
 * es depender de que nadie se olvide.
 */
export const toSnapshot = (row: ThreadRow, posts: readonly PostRow[]): ThreadSnapshot => {
  if (!STATUSES.includes(row.status)) {
    throw new PersistenceMappingError(
      `El hilo ${row.id} tiene un estado desconocido: "${row.status}".`,
    )
  }

  const ordered = [...posts].sort((a, b) => a.position - b.position)

  return {
    id: row.id,
    title: row.title,
    authorId: row.author_id,
    status: row.status as ThreadStatus,
    posts: ordered.map(toPostSnapshot),
  }
}

const toPostSnapshot = (post: PostRow): PostSnapshot => ({
  id: post.id,
  authorId: post.author_id,
  content: post.content,
  hidden: post.hidden,
  createdAt: post.created_at.toISOString(),
})

/** Descompone la instantanea en la fila de `threads`. */
export const toThreadRow = (snapshot: ThreadSnapshot): ThreadRow => ({
  id: snapshot.id,
  title: snapshot.title,
  author_id: snapshot.authorId,
  status: snapshot.status,
})

/**
 * Descompone los mensajes en filas, asignando la posicion por su lugar en el
 * agregado. El agregado es la autoridad sobre el orden; la columna solo lo
 * conserva.
 */
export const toPostRows = (snapshot: ThreadSnapshot): readonly PostRow[] =>
  snapshot.posts.map((post, index) => {
    const createdAt = new Date(post.createdAt)

    if (Number.isNaN(createdAt.getTime())) {
      throw new PersistenceMappingError(
        `El mensaje ${post.id} del hilo ${snapshot.id} tiene una fecha invalida: "${post.createdAt}".`,
      )
    }

    return {
      id: post.id,
      thread_id: snapshot.id,
      position: index,
      author_id: post.authorId,
      content: post.content,
      hidden: post.hidden,
      created_at: createdAt,
    }
  })

export interface ProductCommentRow {
  readonly id: string
  readonly product_id: string
  readonly author_id: string
  readonly content: string
  readonly images: string[]
  readonly created_at: Date
  readonly moderation_status: string
}

export const toProductCommentSnapshot = (row: ProductCommentRow): ProductCommentSnapshot => {
  if (!isCommentModerationStatus(row.moderation_status)) {
    throw new PersistenceMappingError(
      `El comentario ${row.id} tiene un estado de moderacion desconocido: "${row.moderation_status}".`,
    )
  }

  return {
    id: row.id,
    productId: row.product_id,
    authorId: row.author_id,
    content: row.content,
    images: row.images,
    createdAt: row.created_at.toISOString(),
    moderationStatus: row.moderation_status,
  }
}

export const toProductCommentRow = (snapshot: ProductCommentSnapshot): ProductCommentRow => {
  const createdAt = new Date(snapshot.createdAt)

  if (Number.isNaN(createdAt.getTime())) {
    throw new PersistenceMappingError(
      `El comentario ${snapshot.id} tiene una fecha invalida: "${snapshot.createdAt}".`,
    )
  }

  return {
    id: snapshot.id,
    product_id: snapshot.productId,
    author_id: snapshot.authorId,
    content: snapshot.content,
    images: [...snapshot.images],
    created_at: createdAt,
    moderation_status: snapshot.moderationStatus,
  }
}

export interface CommentModerationActionRow {
  readonly id: string
  readonly comment_id: string
  readonly actor_id: string
  readonly action: string
  readonly reason: string
  readonly previous_status: string
  readonly new_status: string
  readonly created_at: Date
  readonly ip_address: string | null
}

const asModerationStatus = (
  value: string,
  contextId: string,
  field: string,
): CommentModerationStatus => {
  if (!isCommentModerationStatus(value)) {
    throw new PersistenceMappingError(
      `La accion de moderacion ${contextId} tiene un ${field} desconocido: "${value}".`,
    )
  }

  return value
}

export const toCommentModerationActionSnapshot = (
  row: CommentModerationActionRow,
): CommentModerationActionSnapshot => {
  if (!isModerationAction(row.action)) {
    throw new PersistenceMappingError(
      `La accion de moderacion ${row.id} tiene una accion desconocida: "${row.action}".`,
    )
  }

  return {
    id: row.id,
    commentId: row.comment_id,
    actorId: row.actor_id,
    action: row.action,
    reason: row.reason,
    previousStatus: asModerationStatus(row.previous_status, row.id, 'estado anterior'),
    newStatus: asModerationStatus(row.new_status, row.id, 'estado nuevo'),
    createdAt: row.created_at.toISOString(),
    ipAddress: row.ip_address,
  }
}

export const toCommentModerationActionRow = (
  snapshot: CommentModerationActionSnapshot,
): CommentModerationActionRow => {
  const createdAt = new Date(snapshot.createdAt)

  if (Number.isNaN(createdAt.getTime())) {
    throw new PersistenceMappingError(
      `La accion de moderacion ${snapshot.id} tiene una fecha invalida: "${snapshot.createdAt}".`,
    )
  }

  return {
    id: snapshot.id,
    comment_id: snapshot.commentId,
    actor_id: snapshot.actorId,
    action: snapshot.action,
    reason: snapshot.reason,
    previous_status: snapshot.previousStatus,
    new_status: snapshot.newStatus,
    created_at: createdAt,
    ip_address: snapshot.ipAddress,
  }
}

export interface CommentReportRow {
  readonly id: string
  readonly comment_id: string
  readonly author_id: string
  readonly category: string
  readonly description: string | null
  readonly created_at: Date
}

export const toCommentReportRow = (snapshot: CommentReportSnapshot): CommentReportRow => {
  const createdAt = new Date(snapshot.createdAt)

  if (Number.isNaN(createdAt.getTime())) {
    throw new PersistenceMappingError(
      `El reporte ${snapshot.id} tiene una fecha invalida: "${snapshot.createdAt}".`,
    )
  }

  return {
    id: snapshot.id,
    comment_id: snapshot.commentId,
    author_id: snapshot.authorId,
    category: snapshot.category,
    description: snapshot.description,
    created_at: createdAt,
  }
}

export interface ProductReviewRow {
  readonly id: string
  readonly product_id: string
  readonly author_id: string
  readonly rating: number
  readonly created_at: Date
}

export const toProductReviewSnapshot = (row: ProductReviewRow): ProductReviewSnapshot => ({
  id: row.id,
  productId: row.product_id,
  authorId: row.author_id,
  rating: row.rating,
  createdAt: row.created_at.toISOString(),
})

export const toProductReviewRow = (snapshot: ProductReviewSnapshot): ProductReviewRow => {
  const createdAt = new Date(snapshot.createdAt)

  if (Number.isNaN(createdAt.getTime())) {
    throw new PersistenceMappingError(
      `La calificacion ${snapshot.id} tiene una fecha invalida: "${snapshot.createdAt}".`,
    )
  }

  return {
    id: snapshot.id,
    product_id: snapshot.productId,
    author_id: snapshot.authorId,
    rating: snapshot.rating,
    created_at: createdAt,
  }
}

export interface AutomaticModerationFlagRow {
  readonly id: string
  readonly comment_id: string
  readonly source: string
  readonly rule_type: string
  readonly rule_match: string
  readonly detected_at: Date
}

export const toAutomaticModerationFlagSnapshot = (
  row: AutomaticModerationFlagRow,
): AutomaticModerationFlagSnapshot => {
  if (!isModerationSignalSource(row.source)) {
    throw new PersistenceMappingError(
      `La senal de moderacion ${row.id} tiene un origen desconocido: "${row.source}".`,
    )
  }

  if (!isModerationSignalRuleType(row.rule_type)) {
    throw new PersistenceMappingError(
      `La senal de moderacion ${row.id} tiene un tipo de regla desconocido: "${row.rule_type}".`,
    )
  }

  return {
    id: row.id,
    commentId: row.comment_id,
    source: row.source,
    ruleType: row.rule_type,
    match: row.rule_match,
    detectedAt: row.detected_at.toISOString(),
  }
}

export const toAutomaticModerationFlagRow = (
  snapshot: AutomaticModerationFlagSnapshot,
): AutomaticModerationFlagRow => {
  const detectedAt = new Date(snapshot.detectedAt)

  if (Number.isNaN(detectedAt.getTime())) {
    throw new PersistenceMappingError(
      `La senal de moderacion ${snapshot.id} tiene una fecha invalida: "${snapshot.detectedAt}".`,
    )
  }

  return {
    id: snapshot.id,
    comment_id: snapshot.commentId,
    source: snapshot.source,
    rule_type: snapshot.ruleType,
    rule_match: snapshot.match,
    detected_at: detectedAt,
  }
}
