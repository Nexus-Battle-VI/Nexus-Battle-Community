import { ApiProperty } from '@nestjs/swagger'

export class OwnPostResponse {
  @ApiProperty({ example: 'post-1' })
  readonly id!: string

  @ApiProperty({ example: 'thread-1' })
  readonly threadId!: string

  @ApiProperty({ example: 'Conviene abrir con el escudo equipado.' })
  readonly content!: string

  @ApiProperty({ example: '2026-08-21T10:00:00.000Z' })
  readonly createdAt!: string
}
