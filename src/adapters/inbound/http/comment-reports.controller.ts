import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'

import { DomainError } from '../../../domain/errors/DomainError'
import {
  CommentNotFoundError,
  ReportLimitExceededError,
} from '../../../application/errors/ApplicationError'
import type { ReportComment } from '../../../application/use-cases/CommentReportUseCases'
import { REPORT_COMMENT } from './tokens'
import { CommentReportResponse, ReportCommentRequest } from './comment-reports.dto'
import { CurrentIdentity } from './auth/decorators'
import type { VerifiedIdentity } from '../../../application/ports/TokenVerifierPort'

/**
 * Adaptador de entrada HTTP del reporte de comentarios (HU-46).
 *
 * No vive bajo `/products`: un reporte se identifica por su comentario, no
 * por el producto al que ese comentario pertenece, y no hay ninguna
 * operacion de esta HU que necesite el `productId` en la ruta.
 */
@ApiTags('comments')
@ApiBearerAuth()
@Controller('comments')
export class CommentReportsController {
  constructor(@Inject(REPORT_COMMENT) private readonly reportComment: ReportComment) {}

  @Post(':commentId/reports')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Reporta un comentario indicando la categoria de la violacion' })
  @ApiResponse({ status: 201, type: CommentReportResponse })
  @ApiResponse({ status: 400, description: 'Categoria o descripcion invalidas' })
  @ApiResponse({ status: 404, description: 'El comentario no existe' })
  @ApiResponse({ status: 429, description: 'El jugador excedio el limite de reportes' })
  async report(
    @Param('commentId') commentId: string,
    @Body() body: ReportCommentRequest,
    @CurrentIdentity() identity: VerifiedIdentity,
  ): Promise<CommentReportResponse> {
    try {
      // El autor NO se lee del cuerpo: sale del testimonio verificado.
      return await this.reportComment.execute({
        commentId,
        authorId: identity.subject,
        category: body.category,
        description: body.description,
      })
    } catch (error: unknown) {
      throw CommentReportsController.translate(error)
    }
  }

  private static translate(error: unknown): Error {
    if (error instanceof CommentNotFoundError) {
      return new NotFoundException(error.message)
    }

    // Limitacion de tasa, no un dato mal formado ni un conflicto de estado.
    if (error instanceof ReportLimitExceededError) {
      return new HttpException(error.message, HttpStatus.TOO_MANY_REQUESTS)
    }

    if (error instanceof DomainError) {
      return new BadRequestException(error.message)
    }

    return error instanceof Error ? error : new Error('Fallo desconocido del servicio.')
  }
}
