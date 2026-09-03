import { CommentReport } from '../../domain/entities/CommentReport'
import { AuthorId } from '../../domain/value-objects/community-values'
import { ProductCommentId } from '../../domain/value-objects/product-review-values'
import {
  CommentReportId,
  ReportDescription,
  isReportCategory,
  type ReportCategory,
} from '../../domain/value-objects/comment-report-values'
import { DomainError } from '../../domain/errors/DomainError'
import type { ClockPort } from '../ports/ClockPort'
import type { IdGeneratorPort } from '../ports/IdGeneratorPort'
import type { ProductCommentRepositoryPort } from '../ports/ProductCommentRepositoryPort'
import type { CommentReportRepositoryPort } from '../ports/CommentReportRepositoryPort'
import { CommentNotFoundError, ReportLimitExceededError } from '../errors/ApplicationError'
import { toCommentReportDto, type CommentReportDto } from '../dto/CommentReportDto'

export interface CommentReportDependencies {
  readonly comments: ProductCommentRepositoryPort
  readonly reports: CommentReportRepositoryPort
  readonly clock: ClockPort
  readonly ids: IdGeneratorPort
  /** HU-46.3: sin un valor numerico definido por el requisito, es configuracion. */
  readonly reportLimit: number
  readonly reportWindowHours: number
}

export interface ReportCommentCommand {
  readonly commentId: string
  readonly authorId: string
  readonly category: string
  readonly description?: string
}

/**
 * Registra el reporte de un comentario.
 *
 * El orden importa: primero se comprueba que el comentario exista (404 si
 * no), despues el limite de reportes del jugador (429 si lo excede). Un
 * jugador que ya agoto su limite no necesita saber si el comentario que
 * intentaba reportar existia o no.
 */
export class ReportComment {
  private readonly deps: CommentReportDependencies

  constructor(deps: CommentReportDependencies) {
    this.deps = deps
  }

  async execute(command: ReportCommentCommand): Promise<CommentReportDto> {
    const commentId = ProductCommentId.create(command.commentId)

    if ((await this.deps.comments.findById(commentId)) === null) {
      throw new CommentNotFoundError(commentId.value)
    }

    if (!isReportCategory(command.category)) {
      throw new DomainError(`"${command.category}" no es una categoria de reporte reconocida.`)
    }

    const authorId = AuthorId.create(command.authorId)
    const now = this.deps.clock.now()
    const since = new Date(now.getTime() - this.deps.reportWindowHours * 60 * 60 * 1000)
    const recentReports = await this.deps.reports.countByAuthorSince(authorId, since)

    if (recentReports >= this.deps.reportLimit) {
      throw new ReportLimitExceededError(
        authorId.value,
        this.deps.reportLimit,
        this.deps.reportWindowHours,
      )
    }

    const category: ReportCategory = command.category

    const report = CommentReport.file({
      id: CommentReportId.create(this.deps.ids.generate()),
      commentId,
      authorId,
      category,
      description:
        command.description === undefined ? null : ReportDescription.create(command.description),
      occurredAt: now,
    })

    await this.deps.reports.save(report)

    return toCommentReportDto(report.toSnapshot())
  }
}
