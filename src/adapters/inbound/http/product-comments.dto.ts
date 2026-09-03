import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  Min,
} from 'class-validator'
import { Type } from 'class-transformer'

/**
 * Ninguna peticion declara quien la realiza ni el promedio del producto.
 *
 * `authorId` sale del testimonio verificado, igual que en `ThreadsController`.
 * La calificacion promedio la calcula Community, nunca la envia el cliente.
 */

export class PublishProductCommentRequest {
  @ApiProperty({ example: 'La espada llego antes de lo esperado, muy buen filo.', maxLength: 2000 })
  @IsString()
  @Length(1, 2000)
  content!: string

  @ApiPropertyOptional({
    type: [String],
    maxItems: 5,
    example: ['https://cdn.nexusbattle.example/comentarios/foto-1.jpg'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true }, { each: true })
  images?: string[]
}

export class RateProductRequest {
  @ApiProperty({ example: 5, minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number
}

export class ListProductCommentsQuery {
  @ApiPropertyOptional({ example: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number

  @ApiPropertyOptional({ example: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number
}

export class ProductCommentResponse {
  @ApiProperty({ example: 'comment-1' })
  readonly id!: string

  @ApiProperty({ example: '3f2a1e4c-6b7d-4a8e-9c1f-2d3e4f5a6b7c' })
  readonly productId!: string

  @ApiProperty({ example: 'acc-0b1d5b0e' })
  readonly authorId!: string

  @ApiProperty({ example: 'La espada llego antes de lo esperado, muy buen filo.' })
  readonly content!: string

  @ApiProperty({ type: [String] })
  readonly images!: readonly string[]

  @ApiProperty({ example: '2026-09-02T10:00:00.000Z' })
  readonly createdAt!: string
}

export class ProductCommentPageResponse {
  @ApiProperty({ type: [ProductCommentResponse] })
  readonly items!: readonly ProductCommentResponse[]

  @ApiProperty({ example: 3 })
  readonly total!: number

  @ApiProperty({ example: 20 })
  readonly limit!: number

  @ApiProperty({ example: 0 })
  readonly offset!: number
}

export class ProductReviewResponse {
  @ApiProperty({ example: 'review-1' })
  readonly id!: string

  @ApiProperty({ example: '3f2a1e4c-6b7d-4a8e-9c1f-2d3e4f5a6b7c' })
  readonly productId!: string

  @ApiProperty({ example: 'acc-0b1d5b0e' })
  readonly authorId!: string

  @ApiProperty({ example: 5, minimum: 1, maximum: 5 })
  readonly rating!: number

  @ApiProperty({ example: '2026-09-02T10:00:00.000Z' })
  readonly createdAt!: string
}

export class ProductReviewSummaryResponse {
  @ApiProperty({ example: '3f2a1e4c-6b7d-4a8e-9c1f-2d3e4f5a6b7c' })
  readonly productId!: string

  @ApiProperty({ example: 4.5, nullable: true })
  readonly average!: number | null

  @ApiProperty({ example: 2 })
  readonly count!: number
}
