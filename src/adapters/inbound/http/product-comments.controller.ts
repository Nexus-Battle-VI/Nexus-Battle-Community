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
import {
  DuplicateProductReviewError,
  ProductNotFoundError,
} from '../../../application/errors/ApplicationError'
import type {
  ListProductComments,
  PublishProductComment,
} from '../../../application/use-cases/ProductCommentUseCases'
import type {
  GetProductReviewSummary,
  RateProduct,
} from '../../../application/use-cases/ProductReviewUseCases'
import type {
  ProductCommentDto,
  ProductCommentPageDto,
} from '../../../application/dto/ProductCommentDto'
import {
  GET_PRODUCT_REVIEW_SUMMARY,
  LIST_PRODUCT_COMMENTS,
  PUBLISH_PRODUCT_COMMENT,
  RATE_PRODUCT,
} from './tokens'
import {
  ListProductCommentsQuery,
  ProductCommentPageResponse,
  ProductReviewResponse,
  ProductReviewSummaryResponse,
  PublishProductCommentRequest,
  RateProductRequest,
} from './product-comments.dto'
import { CurrentIdentity, Public } from './auth/decorators'
import type { VerifiedIdentity } from '../../../application/ports/TokenVerifierPort'

/**
 * Adaptador de entrada HTTP de comentarios y calificaciones de producto.
 *
 * Comentar y calificar son operaciones independientes, aunque compartan
 * `productId`: HU-40.1 y HU-40.3 las definen como tareas separadas, y el
 * comentario de `RateProduct` explica por que una calificacion no borra los
 * comentarios ni al reves.
 */
@ApiTags('products')
@ApiBearerAuth()
@Controller('products')
export class ProductCommentsController {
  constructor(
    @Inject(PUBLISH_PRODUCT_COMMENT) private readonly publishComment: PublishProductComment,
    @Inject(LIST_PRODUCT_COMMENTS) private readonly listComments: ListProductComments,
    @Inject(RATE_PRODUCT) private readonly rateProduct: RateProduct,
    @Inject(GET_PRODUCT_REVIEW_SUMMARY) private readonly getReviewSummary: GetProductReviewSummary,
  ) {}

  @Post(':productId/comments')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Publica un comentario sobre un producto' })
  @ApiResponse({ status: 201, description: 'Comentario publicado' })
  @ApiResponse({ status: 400, description: 'Datos invalidos' })
  @ApiResponse({ status: 404, description: 'El producto no existe' })
  async publish(
    @Param('productId') productId: string,
    @Body() body: PublishProductCommentRequest,
    @CurrentIdentity() identity: VerifiedIdentity,
  ): Promise<ProductCommentDto> {
    try {
      // El autor NO se lee del cuerpo: sale del testimonio verificado.
      return await this.publishComment.execute({
        productId,
        authorId: identity.subject,
        content: body.content,
        images: body.images,
      })
    } catch (error: unknown) {
      throw ProductCommentsController.translate(error)
    }
  }

  @Public()
  @Get(':productId/comments')
  @ApiOperation({ summary: 'Lista los comentarios de un producto, mas recientes primero' })
  @ApiResponse({ status: 200, type: ProductCommentPageResponse })
  async list(
    @Param('productId') productId: string,
    @Query() query: ListProductCommentsQuery,
  ): Promise<ProductCommentPageDto> {
    return await this.listComments.execute({
      productId,
      limit: query.limit,
      offset: query.offset,
    })
  }

  @Post(':productId/reviews')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Registra la calificacion de un jugador sobre un producto' })
  @ApiResponse({ status: 201, type: ProductReviewResponse })
  @ApiResponse({ status: 400, description: 'Ya existe una calificacion de este jugador' })
  @ApiResponse({ status: 404, description: 'El producto no existe' })
  async rate(
    @Param('productId') productId: string,
    @Body() body: RateProductRequest,
    @CurrentIdentity() identity: VerifiedIdentity,
  ): Promise<ProductReviewResponse> {
    try {
      return await this.rateProduct.execute({
        productId,
        authorId: identity.subject,
        rating: body.rating,
      })
    } catch (error: unknown) {
      throw ProductCommentsController.translate(error)
    }
  }

  @Public()
  @Get(':productId/reviews/summary')
  @ApiOperation({ summary: 'Recupera el promedio y el numero de calificaciones de un producto' })
  @ApiResponse({ status: 200, type: ProductReviewSummaryResponse })
  async summary(@Param('productId') productId: string): Promise<ProductReviewSummaryResponse> {
    return await this.getReviewSummary.execute(productId)
  }

  private static translate(error: unknown): Error {
    if (error instanceof ProductNotFoundError) {
      return new NotFoundException(error.message)
    }

    if (error instanceof DuplicateProductReviewError || error instanceof DomainError) {
      return new BadRequestException(error.message)
    }

    return error instanceof Error ? error : new Error('Fallo desconocido del servicio.')
  }
}
