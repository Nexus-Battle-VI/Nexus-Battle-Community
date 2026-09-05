import { ApiProperty } from '@nestjs/swagger'
import { IsIn, IsInt, IsNotEmpty, IsPositive, IsString, Max, Min } from 'class-validator'

/**
 * Contrato de carga de imagenes de comentario (HU-40.1, EN-028).
 *
 * Mismo patron de dos fases que Catalog para HU-33: una intencion firmada
 * (esta peticion) y una finalizacion tras la carga directa a S3. Sin
 * `purpose`, a diferencia de Catalog: una imagen de comentario tiene un unico
 * uso posible.
 */
export class CreateCommentImageUploadRequest {
  @ApiProperty({
    example: 'image/webp',
    description: 'Tipo MIME del archivo. Se admiten image/jpeg, image/png, image/webp.',
    enum: ['image/jpeg', 'image/png', 'image/webp'],
  })
  @IsString()
  @IsIn(['image/jpeg', 'image/png', 'image/webp'], {
    message: 'contentType debe ser image/jpeg, image/png o image/webp',
  })
  readonly contentType!: string

  @ApiProperty({
    example: 245760,
    description: 'Longitud en bytes del archivo. Maximo 5 MiB (5242880 bytes).',
  })
  @IsInt()
  @IsPositive()
  @Min(1)
  @Max(5 * 1024 * 1024, { message: 'contentLength no puede superar los 5 MiB (5242880 bytes)' })
  readonly contentLength!: number

  @ApiProperty({
    example: 'b64:ZHVtbXktc2hhMjU2LWVqZW1wbG8=',
    description: 'Checksum SHA-256 en formato b64:... o hexadecimal.',
  })
  @IsString()
  @IsNotEmpty({ message: 'checksumSha256 es obligatorio' })
  readonly checksumSha256!: string
}

export class CommentImageUploadFormResponse {
  @ApiProperty({ example: 'POST' })
  readonly method!: 'POST'

  @ApiProperty({ example: 'https://<bucket>.s3.us-east-1.amazonaws.com' })
  readonly url!: string

  @ApiProperty({ type: Object })
  readonly fields!: Record<string, string>

  @ApiProperty({ example: '2026-09-04T20:10:00.000Z' })
  readonly expiresAt!: string
}

export class CommentImageUploadResponse {
  @ApiProperty({ example: 'f293ce6b-98e9-41da-99ef-0ad4e3a95120' })
  readonly assetId!: string

  @ApiProperty({ type: CommentImageUploadFormResponse })
  readonly upload!: CommentImageUploadFormResponse
}

export class FinalizedCommentImageResponse {
  @ApiProperty({ example: 'f293ce6b-98e9-41da-99ef-0ad4e3a95120' })
  readonly assetId!: string

  @ApiProperty({ example: 'READY' })
  readonly status!: string

  @ApiProperty({ example: 'image/webp' })
  readonly contentType!: string

  @ApiProperty({ example: 245760 })
  readonly contentLength!: number

  @ApiProperty({ example: 'b64:ZHVtbXktc2hhMjU2LWVqZW1wbG8=' })
  readonly checksumSha256!: string

  @ApiProperty({
    example: 'https://api.nexusbattle.example/api/comment-image-assets/f293ce6b.../content',
  })
  readonly imageUrl!: string
}
