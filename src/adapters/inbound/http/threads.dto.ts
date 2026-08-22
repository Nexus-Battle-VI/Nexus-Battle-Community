import { ApiProperty } from '@nestjs/swagger'
import { IsString, Length } from 'class-validator'

export class OpenThreadRequest {
  @ApiProperty({ example: 'Estrategias para el jefe final', minLength: 5, maxLength: 120 })
  @IsString()
  @Length(5, 120)
  title!: string

  @ApiProperty({ example: 'acc-0b1d5b0e' })
  @IsString()
  @Length(1, 128)
  authorId!: string
}

export class PublishPostRequest {
  @ApiProperty({ example: 'acc-0b1d5b0e' })
  @IsString()
  @Length(1, 128)
  authorId!: string

  @ApiProperty({ example: 'Conviene abrir con el escudo equipado.', maxLength: 2000 })
  @IsString()
  @Length(1, 2000)
  content!: string
}

export class ModerateRequest {
  @ApiProperty({ example: 'acc-moderador' })
  @IsString()
  @Length(1, 128)
  moderatorId!: string
}

export class PostResponse {
  @ApiProperty({ example: 'post-1' })
  readonly id!: string

  @ApiProperty({ example: 'acc-0b1d5b0e' })
  readonly authorId!: string

  @ApiProperty({ example: 'Conviene abrir con el escudo equipado.' })
  readonly content!: string

  @ApiProperty({ example: '2026-08-21T10:00:00.000Z' })
  readonly createdAt!: string
}

export class ThreadResponse {
  @ApiProperty({ example: 'thread-1' })
  readonly id!: string

  @ApiProperty({ example: 'Estrategias para el jefe final' })
  readonly title!: string

  @ApiProperty({ example: 'acc-0b1d5b0e' })
  readonly authorId!: string

  @ApiProperty({ example: 'OPEN', enum: ['OPEN', 'CLOSED'] })
  readonly status!: string

  @ApiProperty({ example: 3, description: 'Numero de mensajes visibles' })
  readonly postCount!: number

  @ApiProperty({ type: PostResponse, isArray: true })
  readonly posts!: readonly PostResponse[]
}

export class ThreadSummaryResponse {
  @ApiProperty({ example: 'thread-1' })
  readonly id!: string

  @ApiProperty({ example: 'Estrategias para el jefe final' })
  readonly title!: string

  @ApiProperty({ example: 'acc-0b1d5b0e' })
  readonly authorId!: string

  @ApiProperty({ example: 'OPEN', enum: ['OPEN', 'CLOSED'] })
  readonly status!: string

  @ApiProperty({ example: 3 })
  readonly postCount!: number
}
