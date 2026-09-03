import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'

import { DomainError } from '../../../domain/errors/DomainError'
import { CommentNotFoundError } from '../../../application/errors/ApplicationError'
import type {
  ApproveComment,
  DeleteComment,
  EditComment,
  HideComment,
  ListModerationQueue,
  MarkComment,
} from '../../../application/use-cases/CommentModerationUseCases'
import type { ProductCommentDto } from '../../../application/dto/ProductCommentDto'
import type { ModerationQueuePageDto } from '../../../application/dto/ModerationQueueDto'
import {
  APPROVE_COMMENT,
  DELETE_COMMENT,
  EDIT_COMMENT,
  HIDE_COMMENT,
  LIST_MODERATION_QUEUE,
  MARK_COMMENT,
} from './tokens'
import {
  EditCommentRequest,
  ListModerationQueueQuery,
  ModerationActionRequest,
  ModerationQueueResponse,
} from './comment-moderation.dto'
import { ProductCommentResponse } from './product-comments.dto'
import { CurrentIdentity, Roles } from './auth/decorators'
import { Role, type VerifiedIdentity } from '../../../application/ports/TokenVerifierPort'

/**
 * Adaptador de entrada HTTP de la moderacion de comentarios (HU-41).
 *
 * Vive aparte de `CommentReportsController`: reportar es una accion de
 * cualquier jugador, moderar es una accion restringida a roles de moderacion.
 * Todas las rutas de este controlador exigen `Moderador` o `Administrador`
 * (`SuperAdministrator` satisface `Administrator`, ver `RolesGuard`) --
 * mismo criterio que `ThreadsController.hide`/`close`.
 */
@ApiTags('comments')
@ApiBearerAuth()
@Roles(Role.Moderator, Role.Administrator)
@Controller('comments')
export class CommentModerationController {
  constructor(
    @Inject(LIST_MODERATION_QUEUE) private readonly listQueue: ListModerationQueue,
    @Inject(APPROVE_COMMENT) private readonly approveComment: ApproveComment,
    @Inject(HIDE_COMMENT) private readonly hideComment: HideComment,
    @Inject(DELETE_COMMENT) private readonly deleteComment: DeleteComment,
    @Inject(EDIT_COMMENT) private readonly editComment: EditComment,
    @Inject(MARK_COMMENT) private readonly markComment: MarkComment,
  ) {}

  @Get('moderation-queue')
  @ApiOperation({
    summary: 'Consulta la cola de moderacion: comentarios con al menos un reporte (HU-41.1)',
  })
  @ApiResponse({ status: 200, type: ModerationQueueResponse })
  @ApiResponse({ status: 403, description: 'La identidad no tiene rol de moderacion' })
  async queue(@Query() query: ListModerationQueueQuery): Promise<ModerationQueuePageDto> {
    return await this.listQueue.execute({ limit: query.limit, offset: query.offset })
  }

  @Post(':commentId/approval')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Aprueba un comentario (HU-41.2)' })
  @ApiResponse({ status: 200, type: ProductCommentResponse })
  @ApiResponse({ status: 400, description: 'Motivo invalido' })
  @ApiResponse({ status: 404, description: 'El comentario no existe' })
  async approve(
    @Param('commentId') commentId: string,
    @Body() body: ModerationActionRequest,
    @CurrentIdentity() identity: VerifiedIdentity,
  ): Promise<ProductCommentDto> {
    return await this.moderate(() =>
      this.approveComment.execute({ commentId, actorId: identity.subject, reason: body.reason }),
    )
  }

  @Post(':commentId/hiding')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Oculta un comentario por moderacion (HU-41.2)' })
  @ApiResponse({ status: 200, type: ProductCommentResponse })
  @ApiResponse({ status: 400, description: 'Motivo invalido' })
  @ApiResponse({ status: 404, description: 'El comentario no existe' })
  async hide(
    @Param('commentId') commentId: string,
    @Body() body: ModerationActionRequest,
    @CurrentIdentity() identity: VerifiedIdentity,
  ): Promise<ProductCommentDto> {
    return await this.moderate(() =>
      this.hideComment.execute({ commentId, actorId: identity.subject, reason: body.reason }),
    )
  }

  /**
   * Borrado LOGICO por moderacion: el comentario pasa a `DELETED`, la fila
   * permanece como evidencia de la accion (HU-41.3). Es `POST .../deletion`,
   * no `DELETE`, por el mismo motivo que `ThreadsController` usa
   * `POST .../hiding` y `POST .../closure`: la accion exige un motivo en el
   * cuerpo, y las convenciones de este servicio expresan una accion de
   * moderacion como un sub-recurso, no como el verbo HTTP crudo.
   */
  @Post(':commentId/deletion')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Elimina (logicamente) un comentario por moderacion (HU-41.2)' })
  @ApiResponse({ status: 200, type: ProductCommentResponse })
  @ApiResponse({ status: 400, description: 'Motivo invalido' })
  @ApiResponse({ status: 404, description: 'El comentario no existe' })
  async remove(
    @Param('commentId') commentId: string,
    @Body() body: ModerationActionRequest,
    @CurrentIdentity() identity: VerifiedIdentity,
  ): Promise<ProductCommentDto> {
    return await this.moderate(() =>
      this.deleteComment.execute({ commentId, actorId: identity.subject, reason: body.reason }),
    )
  }

  @Post(':commentId/edits')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Edita el contenido de un comentario por moderacion (HU-41.2)' })
  @ApiResponse({ status: 200, type: ProductCommentResponse })
  @ApiResponse({ status: 400, description: 'Contenido o motivo invalidos' })
  @ApiResponse({ status: 404, description: 'El comentario no existe' })
  async edit(
    @Param('commentId') commentId: string,
    @Body() body: EditCommentRequest,
    @CurrentIdentity() identity: VerifiedIdentity,
  ): Promise<ProductCommentDto> {
    return await this.moderate(() =>
      this.editComment.execute({
        commentId,
        actorId: identity.subject,
        reason: body.reason,
        content: body.content,
      }),
    )
  }

  @Post(':commentId/marks')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Marca un comentario para seguimiento (HU-41.2)' })
  @ApiResponse({ status: 200, type: ProductCommentResponse })
  @ApiResponse({ status: 400, description: 'Motivo invalido' })
  @ApiResponse({ status: 404, description: 'El comentario no existe' })
  async mark(
    @Param('commentId') commentId: string,
    @Body() body: ModerationActionRequest,
    @CurrentIdentity() identity: VerifiedIdentity,
  ): Promise<ProductCommentDto> {
    return await this.moderate(() =>
      this.markComment.execute({ commentId, actorId: identity.subject, reason: body.reason }),
    )
  }

  private async moderate(action: () => Promise<ProductCommentDto>): Promise<ProductCommentDto> {
    try {
      return await action()
    } catch (error: unknown) {
      throw CommentModerationController.translate(error)
    }
  }

  private static translate(error: unknown): Error {
    if (error instanceof CommentNotFoundError) {
      return new NotFoundException(error.message)
    }

    if (error instanceof DomainError) {
      return new BadRequestException(error.message)
    }

    return error instanceof Error ? error : new Error('Fallo desconocido del servicio.')
  }
}
