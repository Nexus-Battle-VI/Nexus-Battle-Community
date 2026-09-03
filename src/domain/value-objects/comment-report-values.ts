import { DomainError } from '../errors/DomainError'

export class CommentReportId {
  readonly value: string

  private constructor(value: string) {
    this.value = value
  }

  static create(raw: string): CommentReportId {
    const normalized = raw.trim()

    if (normalized.length === 0) {
      throw new DomainError('El identificador del reporte no puede estar vacio.')
    }

    return new CommentReportId(normalized)
  }

  equals(other: CommentReportId): boolean {
    return this.value === other.value
  }

  toString(): string {
    return this.value
  }
}

/**
 * Categorias de violacion admitidas por HU-46. Es un vocabulario cerrado: el
 * requisito enumera exactamente estas seis, y ninguna otra.
 */
export const ReportCategory = {
  Spam: 'SPAM',
  OffensiveContent: 'OFFENSIVE_CONTENT',
  Harassment: 'HARASSMENT',
  FalseInformation: 'FALSE_INFORMATION',
  InappropriateContent: 'INAPPROPRIATE_CONTENT',
  CopyrightViolation: 'COPYRIGHT_VIOLATION',
} as const

export type ReportCategory = (typeof ReportCategory)[keyof typeof ReportCategory]

export const ALL_REPORT_CATEGORIES: readonly ReportCategory[] = [
  ReportCategory.Spam,
  ReportCategory.OffensiveContent,
  ReportCategory.Harassment,
  ReportCategory.FalseInformation,
  ReportCategory.InappropriateContent,
  ReportCategory.CopyrightViolation,
]

export const isReportCategory = (value: string): value is ReportCategory =>
  (ALL_REPORT_CATEGORIES as readonly string[]).includes(value)

/**
 * Descripcion adicional del reporte. Es opcional -- HU-46 es explicito en que
 * su ausencia no debe impedir registrar un reporte valido.
 *
 * `MAX_LENGTH` es un limite tecnico PROVISIONAL, no una regla de HU-46:
 * RF-46 (Management#40) no fija una longitud, y no es -contra lo que decia
 * antes este comentario- el mismo limite que usa otro texto libre de este
 * servicio: `PostContent`/`CommentContent` usan 2000, `ThreadTitle` usa 120.
 * Auditoria de alineacion HU-46 (2026-09): no se encontro ninguna fuente
 * formal -la propia Issue, sus comentarios, ni una politica transversal en
 * Infrastructure- que respalde 500 especificamente. Se conserva el valor
 * -cambiarlo por otro numero seria inventar una cifra igual de infundada- y
 * se corrige unicamente la afirmacion falsa sobre su origen. Queda pendiente
 * que Management defina esta cifra como decision de negocio cerrada.
 */
export class ReportDescription {
  static readonly MAX_LENGTH = 500

  readonly value: string

  private constructor(value: string) {
    this.value = value
  }

  static create(raw: string): ReportDescription {
    const normalized = raw.trim()

    if (normalized.length === 0) {
      throw new DomainError('La descripcion del reporte no puede ser una cadena vacia.')
    }

    if (normalized.length > ReportDescription.MAX_LENGTH) {
      throw new DomainError(
        `La descripcion del reporte no puede superar ${String(ReportDescription.MAX_LENGTH)} caracteres.`,
      )
    }

    return new ReportDescription(normalized)
  }

  toString(): string {
    return this.value
  }
}
