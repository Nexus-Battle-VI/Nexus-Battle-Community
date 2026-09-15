import type {
  CommentContentModerationPolicyPort,
  ModerationSignalCandidate,
} from '../../../application/ports/CommentContentModerationPolicyPort'
import { ModerationSignalRuleType } from '../../../domain/value-objects/moderation-signal-values'

export interface ConfigurableCommentContentModerationPolicyOptions {
  /** Terminos prohibidos, ya normalizados (recortados, en minusculas). */
  readonly forbiddenTerms: readonly string[]
  /** Patrones sospechosos, ya compilados. */
  readonly suspiciousPatterns: readonly RegExp[]
}

/**
 * Implementacion LOCAL y configurable de `CommentContentModerationPolicyPort`
 * (Management#29, HU-41.7).
 *
 * No hay en el organizacion ningun contrato reutilizable de lista negra de
 * contenido -ni en Account ni en ningun otro servicio- y HU-41.7 prohibe
 * llamar a otro servicio para esto: por eso es una politica local de
 * Community, con su fuente de terminos/patrones en configuracion
 * (`COMMENT_MODERATION_FORBIDDEN_TERMS` / `COMMENT_MODERATION_SUSPICIOUS_PATTERNS`),
 * nunca hardcodeada en el codigo de produccion.
 *
 * Coincidencia de termino: subcadena, insensible a mayusculas. Un termino
 * configurado que aparece varias veces en el mismo comentario produce una
 * unica candidata -la cola de moderacion ya no necesita saber cuantas veces
 * coincidio, solo que coincidio-.
 */
export class ConfigurableCommentContentModerationPolicy implements CommentContentModerationPolicyPort {
  private readonly forbiddenTerms: readonly string[]
  private readonly suspiciousPatterns: readonly RegExp[]

  constructor(options: ConfigurableCommentContentModerationPolicyOptions) {
    this.forbiddenTerms = options.forbiddenTerms
    this.suspiciousPatterns = options.suspiciousPatterns
  }

  evaluate(content: string): readonly ModerationSignalCandidate[] {
    const normalized = content.toLowerCase()
    const candidates: ModerationSignalCandidate[] = []

    for (const term of this.forbiddenTerms) {
      if (normalized.includes(term)) {
        candidates.push({ ruleType: ModerationSignalRuleType.ForbiddenTerm, match: term })
      }
    }

    for (const pattern of this.suspiciousPatterns) {
      const match = content.match(pattern)

      if (match !== null && match[0].length > 0) {
        candidates.push({
          ruleType: ModerationSignalRuleType.SuspiciousPattern,
          match: match[0],
        })
      }
    }

    return candidates
  }
}
