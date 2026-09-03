import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsEnum, IsOptional, IsString, Length } from 'class-validator'

import { ReportCategory } from '../../../domain/value-objects/comment-report-values'

/**
 * Ninguna peticion declara quien reporta. El autor sale del testimonio
 * verificado, igual que en el resto de este servicio.
 */

export class ReportCommentRequest {
  @ApiProperty({ enum: ReportCategory, example: ReportCategory.Spam })
  @IsEnum(ReportCategory)
  category!: ReportCategory

  @ApiPropertyOptional({
    example: 'Repite el mismo enlace en varios comentarios.',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  description?: string
}

export class CommentReportResponse {
  @ApiProperty({ example: 'report-1' })
  readonly id!: string

  @ApiProperty({ example: 'comment-1' })
  readonly commentId!: string

  @ApiProperty({ example: 'acc-0b1d5b0e' })
  readonly authorId!: string

  @ApiProperty({ enum: ReportCategory })
  readonly category!: string

  @ApiProperty({ example: 'Repite el mismo enlace en varios comentarios.', nullable: true })
  readonly description!: string | null

  @ApiProperty({ example: '2026-09-03T10:00:00.000Z' })
  readonly createdAt!: string
}
