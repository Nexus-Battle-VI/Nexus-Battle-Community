import { DomainError } from '../errors/DomainError'

export class AutomaticModerationFlagId {
  readonly value: string

  private constructor(value: string) {
    this.value = value
  }

  static create(raw: string): AutomaticModerationFlagId {
    const normalized = raw.trim()

    if (normalized.length === 0) {
      throw new DomainError('El identificador de la senal de moderacion no puede estar vacio.')
    }

    return new AutomaticModerationFlagId(normalized)
  }

  equals(other: AutomaticModerationFlagId): boolean {
    return this.value === other.value
  }

  toString(): string {
    return this.value
  }
}

/**
 * Origen de una senal automatica. Vocabulario cerrado de un unico valor a
 * proposito: hoy solo existe el filtro de contenido local (Management#29),
 * y anadir un origen nuevo es una decision de producto, no un detalle de
 * persistencia -- por eso el valor se declara explicito en vez de omitirse.
 */
export const ModerationSignalSource = {
  AutomaticFilter: 'AUTOMATIC_FILTER',
} as const

export type ModerationSignalSource =
  (typeof ModerationSignalSource)[keyof typeof ModerationSignalSource]

export const ALL_MODERATION_SIGNAL_SOURCES: readonly ModerationSignalSource[] = [
  ModerationSignalSource.AutomaticFilter,
]

export const isModerationSignalSource = (value: string): value is ModerationSignalSource =>
  (ALL_MODERATION_SIGNAL_SOURCES as readonly string[]).includes(value)

/**
 * Tipo de regla tecnica que disparo la senal. Corresponde 1 a 1 con lo que
 * describe el PDF fuente (7.3.3): "palabras prohibidas" y "patrones
 * sospechosos", y ninguna otra categoria.
 */
export const ModerationSignalRuleType = {
  ForbiddenTerm: 'FORBIDDEN_TERM',
  SuspiciousPattern: 'SUSPICIOUS_PATTERN',
} as const

export type ModerationSignalRuleType =
  (typeof ModerationSignalRuleType)[keyof typeof ModerationSignalRuleType]

export const ALL_MODERATION_SIGNAL_RULE_TYPES: readonly ModerationSignalRuleType[] = [
  ModerationSignalRuleType.ForbiddenTerm,
  ModerationSignalRuleType.SuspiciousPattern,
]

export const isModerationSignalRuleType = (value: string): value is ModerationSignalRuleType =>
  (ALL_MODERATION_SIGNAL_RULE_TYPES as readonly string[]).includes(value)

/**
 * Evidencia tecnica minima de por que disparo la regla: el termino
 * configurado o el fragmento que coincidio con el patron, nunca el
 * comentario completo. Acotado en longitud por el mismo motivo que
 * `ModerationReason`: es texto libre que termina en una columna de base de
 * datos.
 */
export class ModerationSignalMatch {
  static readonly MAX_LENGTH = 200

  readonly value: string

  private constructor(value: string) {
    this.value = value
  }

  static create(raw: string): ModerationSignalMatch {
    const normalized = raw.trim()

    if (normalized.length === 0) {
      throw new DomainError('La evidencia de la senal de moderacion no puede estar vacia.')
    }

    if (normalized.length > ModerationSignalMatch.MAX_LENGTH) {
      throw new DomainError(
        `La evidencia de la senal de moderacion no puede superar ${String(ModerationSignalMatch.MAX_LENGTH)} caracteres.`,
      )
    }

    return new ModerationSignalMatch(normalized)
  }

  toString(): string {
    return this.value
  }
}
