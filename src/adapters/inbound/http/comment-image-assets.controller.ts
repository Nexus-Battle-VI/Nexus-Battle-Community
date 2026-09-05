import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Res,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'

import { DomainError } from '../../../domain/errors/DomainError'
import {
  CommentImageAssetConflictError,
  CommentImageAssetExpiredError,
  CommentImageAssetNotFoundError,
  CommentImageAssetOwnershipError,
  CommentImageChecksumMismatchError,
  CommentImageInvalidContentError,
  CommentImageLengthMismatchError,
  CommentImageStorageUnavailableError,
} from '../../../application/errors/ApplicationError'
import type { CreateCommentImageUploadIntent } from '../../../application/use-cases/CreateCommentImageUploadIntent'
import type { FinalizeCommentImageAsset } from '../../../application/use-cases/FinalizeCommentImageAsset'
import type { GetCommentImageContent } from '../../../application/use-cases/GetCommentImageContent'
import {
  CREATE_COMMENT_IMAGE_UPLOAD_INTENT,
  FINALIZE_COMMENT_IMAGE_ASSET,
  GET_COMMENT_IMAGE_CONTENT,
} from './tokens'
import {
  CommentImageUploadResponse,
  CreateCommentImageUploadRequest,
  FinalizedCommentImageResponse,
} from './comment-image-assets.dto'
import { CurrentIdentity, Public } from './auth/decorators'
import type { VerifiedIdentity } from '../../../application/ports/TokenVerifierPort'

/**
 * Adaptador de entrada HTTP de imagenes de comentario (HU-40.1, EN-028).
 *
 * A DIFERENCIA de Catalog (`AdminProductAssetsController`), la carga aqui NO
 * exige rol administrativo ni evidencia MFA: cualquier jugador autenticado
 * puede adjuntar una imagen a SU propio comentario, igual que puede publicar
 * el comentario mismo (`ProductCommentsController.publish`). La finalizacion
 * exige que el autor coincida con quien creo la intencion.
 */
@ApiTags('comment-image-assets')
@ApiBearerAuth()
@Controller('comment-image-assets')
export class CommentImageAssetsController {
  constructor(
    @Inject(CREATE_COMMENT_IMAGE_UPLOAD_INTENT)
    private readonly createUploadIntent: CreateCommentImageUploadIntent,
    @Inject(FINALIZE_COMMENT_IMAGE_ASSET)
    private readonly finalizeAsset: FinalizeCommentImageAsset,
    @Inject(GET_COMMENT_IMAGE_CONTENT)
    private readonly getContentUseCase: GetCommentImageContent,
  ) {}

  @Post('uploads')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crea una intencion firmada de carga directa a S3' })
  @ApiResponse({ status: 201, type: CommentImageUploadResponse })
  @ApiResponse({ status: 400, description: 'JSON o campos invalidos' })
  @ApiResponse({ status: 401, description: 'Token de acceso ausente o invalido' })
  @ApiResponse({ status: 422, description: 'Tipo MIME o tamano no admitido' })
  @ApiResponse({ status: 503, description: 'Almacenamiento no disponible' })
  async createUpload(
    @Body() body: CreateCommentImageUploadRequest,
    @CurrentIdentity() identity: VerifiedIdentity,
  ): Promise<CommentImageUploadResponse> {
    try {
      return await this.createUploadIntent.execute({
        authorId: identity.subject,
        contentType: body.contentType,
        contentLength: body.contentLength,
        checksumSha256: body.checksumSha256,
      })
    } catch (error: unknown) {
      throw CommentImageAssetsController.translate(error)
    }
  }

  @Post(':assetId/finalization')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verifica el contenido cargado y promueve la imagen a READY' })
  @ApiResponse({ status: 200, type: FinalizedCommentImageResponse })
  @ApiResponse({ status: 401, description: 'Token ausente o invalido' })
  @ApiResponse({ status: 403, description: 'La imagen no pertenece al autor del testimonio' })
  @ApiResponse({ status: 404, description: 'Imagen o archivo cargado no encontrado' })
  @ApiResponse({ status: 409, description: 'Intencion expirada o conflicto de estado' })
  @ApiResponse({ status: 422, description: 'Contenido invalido o checksum distinto' })
  @ApiResponse({ status: 503, description: 'Almacenamiento no disponible' })
  async finalize(
    @Param('assetId') assetId: string,
    @CurrentIdentity() identity: VerifiedIdentity,
  ): Promise<FinalizedCommentImageResponse> {
    try {
      return await this.finalizeAsset.execute(assetId, identity.subject)
    } catch (error: unknown) {
      throw CommentImageAssetsController.translate(error)
    }
  }

  /**
   * Publica, igual que `GET /products/:productId/comments`: una imagen ya
   * promovida es contenido visible de un comentario publico, y ocultarla tras
   * autenticacion mostraria comentarios con imagenes rotas a quien no tenga
   * sesion.
   */
  @Public()
  @Get(':assetId/content')
  @ApiOperation({ summary: 'Redirige temporalmente al contenido firmado de la imagen (HTTP 307)' })
  @ApiResponse({ status: 307, description: 'Redireccion temporal a la URL firmada (max. 5 min)' })
  @ApiResponse({ status: 404, description: 'Imagen no encontrada o no disponible' })
  @ApiResponse({ status: 503, description: 'Almacenamiento no disponible' })
  async getContent(@Param('assetId') assetId: string, @Res() res: Response): Promise<void> {
    try {
      const downloadUrl = await this.getContentUseCase.execute(assetId)
      res.setHeader('Cache-Control', 'private, max-age=240')
      res.redirect(HttpStatus.TEMPORARY_REDIRECT, downloadUrl)
    } catch (error: unknown) {
      if (error instanceof CommentImageAssetNotFoundError) {
        throw new NotFoundException(error.message)
      }
      if (error instanceof CommentImageStorageUnavailableError) {
        throw new ServiceUnavailableException(error.message)
      }
      throw error
    }
  }

  private static translate(error: unknown): Error {
    if (error instanceof CommentImageAssetNotFoundError) {
      return new NotFoundException(error.message)
    }

    if (error instanceof CommentImageAssetOwnershipError) {
      return new ForbiddenException(error.message)
    }

    if (
      error instanceof CommentImageAssetExpiredError ||
      error instanceof CommentImageAssetConflictError
    ) {
      return new ConflictException(error.message)
    }

    if (
      error instanceof CommentImageChecksumMismatchError ||
      error instanceof CommentImageInvalidContentError ||
      error instanceof CommentImageLengthMismatchError
    ) {
      return new UnprocessableEntityException(error.message)
    }

    if (error instanceof CommentImageStorageUnavailableError) {
      return new ServiceUnavailableException(error.message)
    }

    if (error instanceof DomainError) {
      return new UnprocessableEntityException(error.message)
    }

    if (error instanceof Error && error.message.includes('UUID')) {
      return new BadRequestException(error.message)
    }

    return error instanceof Error ? error : new Error(String(error))
  }
}
