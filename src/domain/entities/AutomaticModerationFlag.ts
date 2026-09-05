import type { ProductCommentId } from '../value-objects/product-review-values'
import {
  ModerationSignalSource,
  type AutomaticModerationFlagId,
  type ModerationSignalMatch,
  type ModerationSignalRuleType,
} from '../value-objects/moderation-signal-values'

export interface AutomaticModerationFlagSnapshot {
  readonly id: string
  readonly commentId: string
  readonly source: ModerationSignalSource
  readonly ruleType: ModerationSignalRuleType
  readonly match: string
  readonly detectedAt: string
}

/**
 * Senal de moderacion generada por el filtro automatico de contenido
 * (Management#29, HU-41.7).
 *
 * Es una entidad independiente, igual que `CommentReport`: sin agregado
 * padre, sin clave foranea a `product_comments` -una senal es evidencia y
 * debe sobrevivir aunque el comentario deje de estar disponible-, y con su
 * unica relacion expresada como referencia (`commentId`). NO es un
 * `CommentReport`: mezclar ambos convertiria una deteccion tecnica en un
 * reporte falso de un jugador que nunca reporto nada (HU-46).
 *
 * NO implica ninguna sancion: crearla solo dejar constancia de que el
 * contenido coincidio con una regla configurada. La decision sigue siendo
 * exclusiva del Moderador, en la cola de HU-41.1.
 */
export class AutomaticModerationFlag {
  readonly id: AutomaticModerationFlagId
  readonly commentId: ProductCommentId
  readonly source: ModerationSignalSource
  readonly ruleType: ModerationSignalRuleType
  readonly match: ModerationSignalMatch
  readonly detectedAt: Date

  private constructor(params: {
    id: AutomaticModerationFlagId
    commentId: ProductCommentId
    ruleType: ModerationSignalRuleType
    match: ModerationSignalMatch
    detectedAt: Date
  }) {
    this.id = params.id
    this.commentId = params.commentId
    this.source = ModerationSignalSource.AutomaticFilter
    this.ruleType = params.ruleType
    this.match = params.match
    this.detectedAt = params.detectedAt
  }

  static detect(params: {
    id: AutomaticModerationFlagId
    commentId: ProductCommentId
    ruleType: ModerationSignalRuleType
    match: ModerationSignalMatch
    occurredAt: Date
  }): AutomaticModerationFlag {
    return new AutomaticModerationFlag({ ...params, detectedAt: params.occurredAt })
  }

  static restore(params: {
    id: AutomaticModerationFlagId
    commentId: ProductCommentId
    ruleType: ModerationSignalRuleType
    match: ModerationSignalMatch
    detectedAt: Date
  }): AutomaticModerationFlag {
    return new AutomaticModerationFlag(params)
  }

  toSnapshot(): AutomaticModerationFlagSnapshot {
    return {
      id: this.id.value,
      commentId: this.commentId.value,
      source: this.source,
      ruleType: this.ruleType,
      match: this.match.value,
      detectedAt: this.detectedAt.toISOString(),
    }
  }
}
