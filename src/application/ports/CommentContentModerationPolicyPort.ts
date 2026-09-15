import type { ModerationSignalRuleType } from '../../domain/value-objects/moderation-signal-values'

/**
 * Una coincidencia candidata a senal de moderacion, antes de convertirse en
 * `AutomaticModerationFlag`. `match` es la evidencia minima -el termino o el
 * fragmento que disparo la regla-, nunca el comentario completo.
 */
export interface ModerationSignalCandidate {
  readonly ruleType: ModerationSignalRuleType
  readonly match: string
}

/**
 * Puerto de dominio/aplicacion del filtro automatico de contenido
 * (Management#29, HU-41.7).
 *
 * Evalua el contenido y devuelve senales, sin decidir nada por si mismo: no
 * sanciona, no oculta, no elimina. Es sincrono a proposito -no depende de
 * ningun servicio externo, ver ADR sobre la politica local en
 * `docs/architecture.md`- lo que hace que evaluarlo no pueda fallar por una
 * red caida.
 */
export interface CommentContentModerationPolicyPort {
  evaluate(content: string): readonly ModerationSignalCandidate[]
}

export const COMMENT_CONTENT_MODERATION_POLICY = Symbol('CommentContentModerationPolicyPort')
