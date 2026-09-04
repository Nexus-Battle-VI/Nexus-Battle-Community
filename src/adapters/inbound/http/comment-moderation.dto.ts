import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsString, Length, Min } from 'class-validator'

import { ModerationReason } from '../../../domain/value-objects/moderation-values'
import { ProductCommentResponse } from './product-comments.dto'

/**
 * Motivo de la accion de moderacion. HU-41 lo exige en TODA accion, a
 * diferencia de la descripcion opcional de un reporte (HU-46).
 */
export class ModerationActionRequest {
  @ApiProperty({
    example: 'Contenido publicitario repetido en varios productos.',
    maxLength: ModerationReason.MAX_LENGTH,
  })
  @IsString()
  @Length(1, ModerationReason.MAX_LENGTH)
  reason!: string
}

export class EditCommentRequest extends ModerationActionRequest {
  @ApiProperty({ example: 'Buen producto. [Enlace externo retirado por moderacion.]' })
  @IsString()
  @Length(1, 2000)
  content!: string
}

export class ListModerationQueueQuery {
  @ApiPropertyOptional({ example: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number

  @ApiPropertyOptional({ example: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number
}

export class ModerationQueueEntryResponse {
  @ApiProperty({ type: ProductCommentResponse })
  readonly comment!: ProductCommentResponse

  @ApiProperty({ example: 3 })
  readonly reportCount!: number

  @ApiProperty({ example: '2026-09-03T10:00:00.000Z' })
  readonly lastReportedAt!: string
}

export class ModerationQueueResponse {
  @ApiProperty({ type: [ModerationQueueEntryResponse] })
  readonly items!: readonly ModerationQueueEntryResponse[]

  @ApiProperty({ example: 3 })
  readonly total!: number

  @ApiProperty({ example: 20 })
  readonly limit!: number

  @ApiProperty({ example: 0 })
  readonly offset!: number
}
