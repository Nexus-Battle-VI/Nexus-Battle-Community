import { DomainError } from '../errors/DomainError'

export class CommentModerationActionId {
  readonly value: string

  private constructor(value: string) {
    this.value = value
  }

  static create(raw: string): CommentModerationActionId {
    const normalized = raw.trim()

    if (normalized.length === 0) {
      throw new DomainError('El identificador de la accion de moderacion no puede estar vacio.')
    }

    return new CommentModerationActionId(normalized)
  }

  equals(other: CommentModerationActionId): boolean {
    return this.value === other.value
  }

  toString(): string {
    return this.value
  }
}

/**
 * Acciones de moderacion admitidas por HU-41. Vocabulario cerrado: el
 * requisito enumera exactamente estas cinco -aprobar, eliminar, ocultar,
 * editar, marcar- y ninguna otra.
 */
export const ModerationAction = {
  Approve: 'APPROVE',
  Delete: 'DELETE',
  Hide: 'HIDE',
  Edit: 'EDIT',
  Mark: 'MARK',
} as const

export type ModerationAction = (typeof ModerationAction)[keyof typeof ModerationAction]

export const ALL_MODERATION_ACTIONS: readonly ModerationAction[] = [
  ModerationAction.Approve,
  ModerationAction.Delete,
  ModerationAction.Hide,
  ModerationAction.Edit,
  ModerationAction.Mark,
]

export const isModerationAction = (value: string): value is ModerationAction =>
  (ALL_MODERATION_ACTIONS as readonly string[]).includes(value)

/**
 * Estado de moderacion de un comentario. `Pending` es el estado inicial de
 * todo comentario publicado: ningun comentario nace ya revisado. Los otros
 * cinco son el resultado de la accion de moderacion correspondiente -uno a
 * uno con `ModerationAction`-, y HU-41 no declara ninguna transicion vetada
 * entre ellos: un comentario oculto puede aprobarse despues, por ejemplo.
 */
export const CommentModerationStatus = {
  Pending: 'PENDING',
  Approved: 'APPROVED',
  Deleted: 'DELETED',
  Hidden: 'HIDDEN',
  Edited: 'EDITED',
  Marked: 'MARKED',
} as const

export type CommentModerationStatus =
  (typeof CommentModerationStatus)[keyof typeof CommentModerationStatus]

export const ALL_COMMENT_MODERATION_STATUSES: readonly CommentModerationStatus[] = [
  CommentModerationStatus.Pending,
  CommentModerationStatus.Approved,
  CommentModerationStatus.Deleted,
  CommentModerationStatus.Hidden,
  CommentModerationStatus.Edited,
  CommentModerationStatus.Marked,
]

export const isCommentModerationStatus = (value: string): value is CommentModerationStatus =>
  (ALL_COMMENT_MODERATION_STATUSES as readonly string[]).includes(value)

/**
 * Motivo de la accion de moderacion. A diferencia de `ReportDescription`
 * (HU-46, opcional), HU-41 exige motivo en TODA accion: "cada accion debe
 * registrar el motivo" es una regla de negocio, no una posibilidad.
 */
export class ModerationReason {
  static readonly MAX_LENGTH = 500

  readonly value: string

  private constructor(value: string) {
    this.value = value
  }

  static create(raw: string): ModerationReason {
    const normalized = raw.trim()

    if (normalized.length === 0) {
      throw new DomainError('El motivo de la accion de moderacion no puede estar vacio.')
    }

    if (normalized.length > ModerationReason.MAX_LENGTH) {
      throw new DomainError(
        `El motivo de la accion de moderacion no puede superar ${String(ModerationReason.MAX_LENGTH)} caracteres.`,
      )
    }

    return new ModerationReason(normalized)
  }

  toString(): string {
    return this.value
  }
}
